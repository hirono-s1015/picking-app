// ============================================================
//  GitHub API 連携モジュール for WMS AZU ピッキングアプリ
//  - ① ピッキングログを log_YYYY_MM_担当者番号.csv に即時追記
//  - ② 完了済み伝票を done.json に保存・読み込み（多端末共有）
// ============================================================

const GitHubSync = (() => {

  const CONFIG = {
    owner:  'hirono-s1015',
    repo:   'picking-app',
    branch: 'main',
    token:  '',
  };

  const LS_TOKEN     = 'gh_pat';
  const LS_DONE      = 'done_local_cache';
  const LS_LOG_QUEUE = 'log_queue';

  function init() {
    CONFIG.token = localStorage.getItem(LS_TOKEN) || '';
  }

  function setToken(token) {
    CONFIG.token = token.trim();
    localStorage.setItem(LS_TOKEN, CONFIG.token);
  }

  function hasToken() {
    return CONFIG.token.length > 0;
  }

  // ─── GitHub Contents API GET ──────────────────────────────
  async function getFile(path) {
    const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}?ref=${CONFIG.branch}&t=${Date.now()}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
    return await res.json();
  }

  // ─── GitHub Contents API PUT ──────────────────────────────
  async function putFile(path, contentBase64, sha, commitMsg) {
    const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}`;
    const body = { message: commitMsg, content: contentBase64, branch: CONFIG.branch };
    if (sha) body.sha = sha;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`GitHub PUT failed: ${res.status} ${err.message || ''}`);
    }
    return await res.json();
  }

  function authHeaders() {
    return {
      Authorization: `Bearer ${CONFIG.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  // ─── ユーティリティ ───────────────────────────────────────
  function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach(b => bin += String.fromCharCode(b));
    return btoa(bin);
  }

  function fromBase64(b64) {
    const bin = atob(b64.replace(/\n/g, ''));
    const bytes = new Uint8Array([...bin].map(c => c.charCodeAt(0)));
    return new TextDecoder('utf-8').decode(bytes);
  }

  function nowJST() {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(new Date()).replace(/\//g, '-');
  }

  // 端末番号付きログファイル名: logs/log_YYYY_MM_担当者番号.csv
  function logFileName(operator) {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const op = (operator || 'unknown').replace(/[^a-zA-Z0-9]/g, '');
    return `logs/log_${y}_${m}_${op}.csv`;
  }

  function csvRow(fields) {
    return fields.map(f => {
      const s = String(f ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',') + '\n';
  }

  const CSV_HEADER = '日時,担当者名,送り先,商品コード,発送伝票番号,結果\n';

  // ─── ① ログ追記（端末別ファイルに即時保存）────────────────
  async function appendLog(entry) {
    if (!hasToken()) throw new Error('GitHub Token が未設定です');

    const row = csvRow([
      entry.scanTime || nowJST(),
      entry.operator    || '',
      entry.destination || '',
      entry.productCode || '',
      entry.slipNo      || '',
      entry.result      || 'OK',
    ]);

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const path = logFileName(entry.operator);
        const existing = await getFile(path);
        let newContent, sha;
        if (existing) {
          const old = fromBase64(existing.content);
          newContent = toBase64(old + row);
          sha = existing.sha;
        } else {
          newContent = toBase64(CSV_HEADER + row);
          sha = undefined;
        }
        await putFile(path, newContent, sha, `[log] ${entry.slipNo} ${entry.result}`);
        _flushQueue(entry.operator);
        return { ok: true };
      } catch (e) {
        if (attempt === 4 || !e.message.includes('409')) {
          _enqueue(row, entry.operator);
          throw e;
        }
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }

  // オフラインキュー
  function _enqueue(row, operator) {
    const key = 'log_queue_' + (operator || 'unknown');
    const q = JSON.parse(localStorage.getItem(key) || '[]');
    q.push(row);
    localStorage.setItem(key, JSON.stringify(q));
  }

  async function _flushQueue(operator) {
    const key = 'log_queue_' + (operator || 'unknown');
    const q = JSON.parse(localStorage.getItem(key) || '[]');
    if (!q.length) return;
    try {
      const path = logFileName(operator);
      const existing = await getFile(path);
      const rows = q.join('');
      const newContent = existing
        ? toBase64(fromBase64(existing.content) + rows)
        : toBase64(CSV_HEADER + rows);
      await putFile(path, newContent, existing?.sha, `[log-flush] ${q.length}件`);
      localStorage.removeItem(key);
    } catch (_) {}
  }

  // ─── ② done.json 読み込み ────────────────────────────────
  async function loadDone() {
    try {
      const file = await getFile('done.json');
      if (!file) {
        localStorage.setItem(LS_DONE, '[]');
        return new Set();
      }
      const json = fromBase64(file.content);
      localStorage.setItem(LS_DONE, json);
      return new Set(JSON.parse(json));
    } catch (_) {
      const cached = localStorage.getItem(LS_DONE);
      return new Set(cached ? JSON.parse(cached) : []);
    }
  }

  // ─── ② done.json 追記 ────────────────────────────────────
  async function markDone(slipNo) {
    if (!hasToken()) throw new Error('GitHub Token が未設定です');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const file = await getFile('done.json');
        let list = [], sha;
        if (file) { list = JSON.parse(fromBase64(file.content)); sha = file.sha; }
        if (list.includes(slipNo)) return { ok: true, already: true };
        list.push(slipNo);
        const newContent = toBase64(JSON.stringify(list, null, 2) + '\n');
        await putFile('done.json', newContent, sha, `[done] ${slipNo}`);
        localStorage.setItem(LS_DONE, JSON.stringify(list));
        return { ok: true };
      } catch (e) {
        if (attempt === 2 || !e.message.includes('409')) throw e;
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  // ─── ② done.json の定期ポーリング ────────────────────────
  let _pollTimer = null;
  let _onDoneUpdate = null;

  function startPolling(callback, intervalMs = 30_000) {
    _onDoneUpdate = callback;
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(async () => {
      try {
        const s = await loadDone();
        if (_onDoneUpdate) _onDoneUpdate(s);
      } catch (_) {}
    }, intervalMs);
  }

  function stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  return { init, setToken, hasToken, appendLog, loadDone, markDone, startPolling, stopPolling };

})();


// ============================================================
//  Settings UI
// ============================================================

const GitHubSettingsUI = (() => {

  function render() {
    const div = document.createElement('div');
    div.id = 'gh-settings-panel';
    div.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.55);
      display:flex; align-items:center; justify-content:center;
      z-index:9999; font-family:sans-serif;
    `;
    div.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:28px 24px;width:min(92vw,400px);box-shadow:0 8px 32px rgba(0,0,0,.25)">
        <h2 style="margin:0 0 6px;font-size:18px;color:#1a1a2e">⚙️ GitHub 連携設定</h2>
        <p style="margin:0 0 20px;font-size:13px;color:#666">
          Personal Access Token を入力してください。<br>
          必要な権限：<code>Contents: Read and write</code>
        </p>
        <label style="font-size:13px;font-weight:600;color:#333">GitHub PAT</label>
        <input id="gh-pat-input" type="password" placeholder="github_pat_xxxxxxxxxxxxxxxxxxxx"
          style="width:100%;box-sizing:border-box;margin-top:6px;padding:10px 12px;
                 border:1.5px solid #ddd;border-radius:8px;font-size:14px;outline:none"/>
        <div id="gh-pat-msg" style="min-height:20px;margin-top:8px;font-size:13px;color:#c0392b"></div>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button id="gh-pat-save"
            style="flex:1;padding:11px;background:#2ecc71;color:#fff;border:none;
                   border-radius:8px;font-size:15px;font-weight:700;cursor:pointer">
            💾 保存
          </button>
          <button id="gh-pat-cancel"
            style="padding:11px 18px;background:#eee;color:#333;border:none;
                   border-radius:8px;font-size:15px;cursor:pointer">
            キャンセル
          </button>
        </div>
        <p style="margin:16px 0 0;font-size:11px;color:#aaa;text-align:center">
          Token はこのデバイスの localStorage にのみ保存されます
        </p>
      </div>`;

    document.body.appendChild(div);

    const input   = div.querySelector('#gh-pat-input');
    const msg     = div.querySelector('#gh-pat-msg');
    const btnSave = div.querySelector('#gh-pat-save');
    const btnCan  = div.querySelector('#gh-pat-cancel');

    const existing = localStorage.getItem('gh_pat');
    if (existing) input.value = existing;

    btnSave.onclick = async () => {
      const val = input.value.trim();
      if (!val) { msg.textContent = '⚠️ Token を入力してください'; return; }
      btnSave.disabled = true;
      btnSave.textContent = '確認中…';
      msg.style.color = '#666';
      msg.textContent = 'GitHub API に接続確認中…';
      try {
        GitHubSync.setToken(val);
        await GitHubSync.loadDone();
        msg.style.color = '#27ae60';
        msg.textContent = '✅ 接続成功！';
        setTimeout(() => div.remove(), 900);
      } catch (e) {
        GitHubSync.setToken('');
        msg.style.color = '#c0392b';
        msg.textContent = `❌ 接続失敗: ${e.message}`;
        btnSave.disabled = false;
        btnSave.textContent = '💾 保存';
      }
    };

    btnCan.onclick = () => div.remove();
    div.onclick = e => { if (e.target === div) div.remove(); };
  }

  return { render };
})();
