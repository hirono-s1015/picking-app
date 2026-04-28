// ============================================================
//  GitHub API 連携モジュール for WMS AZU ピッキングアプリ
//  - ① ピッキングログを log_YYYY_MM.csv に追記（月次・UTF-8）
//  - ① 本日分ログを logs/log.csv に追記（Shift-JIS・CR+LF・OKのみ）
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
  // UTF-8 → base64
  function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach(b => bin += String.fromCharCode(b));
    return btoa(bin);
  }

 // UTF-8 BOM付き → base64
function toBase64Bom(str) {
  const bom = '\uFEFF';
  const bytes = new TextEncoder().encode(bom + str);
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}
  function toBase64ShiftJIS(str) {
  const unicodeArray = Encoding.stringToCode(str);
  const sjisArray = Encoding.convert(unicodeArray, 'SJIS', 'UNICODE');
  let bin = '';
  sjisArray.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}

  // Unicode文字列をShift-JISバイト列に変換
  function unicodeToSjisBytes(str) {
    // TextEncoderでShift-JISが使えるブラウザ環境では直接変換
    // 使えない場合はUTF-8にフォールバック
    try {
      const encoder = new TextEncoder('shift-jis');
      // 標準のTextEncoderはUTF-8のみ対応のため、
      // Blobを使ってShift-JIS変換を行う
      const bytes = [];
      for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code < 0x80) {
          bytes.push(code);
        } else if (code === 0x00A5) {
          bytes.push(0x5C); // ¥ → \
        } else if (code === 0x203E) {
          bytes.push(0x7E); // ‾ → ~
        } else if (code >= 0xFF61 && code <= 0xFF9F) {
          // 半角カタカナ
          bytes.push(code - 0xFF61 + 0xA1);
        } else if (code >= 0x0391 && code <= 0x0451) {
          bytes.push(0x3F); // ? (未対応)
        } else {
          // 全角文字のShift-JIS変換（主要な文字のみ）
          const sjis = unicodeCharToSjis(code);
          if (sjis > 0xFF) {
            bytes.push((sjis >> 8) & 0xFF);
            bytes.push(sjis & 0xFF);
          } else if (sjis > 0) {
            bytes.push(sjis);
          } else {
            bytes.push(0x3F); // ?
          }
        }
      }
      return bytes;
    } catch(e) {
      // フォールバック：UTF-8
      const utf8bytes = new TextEncoder().encode(str);
      return Array.from(utf8bytes);
    }
  }

  // 主要なUnicode→Shift-JIS変換
  function unicodeCharToSjis(code) {
    // ひらがな (U+3041-U+3096)
    if (code >= 0x3041 && code <= 0x3096) {
      const offset = code - 0x3041;
      const row = Math.floor(offset / 94);
      const col = offset % 94;
      const sjisRow = row < 62 ? row + 0x20 : row + 0x40;
      const sjisHigh = Math.floor(sjisRow / 2) + (sjisRow < 0x3F ? 0x70 : 0xB0);
      const sjisLow = sjisRow % 2 === 0
        ? col + 0x40 + (col >= 0x3F ? 1 : 0)
        : col + 0x9E;
      return (sjisHigh << 8) | sjisLow;
    }
    // カタカナ (U+30A1-U+30F6)
    if (code >= 0x30A1 && code <= 0x30F6) {
      const offset = code - 0x30A1;
      const row = Math.floor(offset / 94) + 5;
      const col = offset % 94;
      const sjisRow = row < 62 ? row + 0x20 : row + 0x40;
      const sjisHigh = Math.floor(sjisRow / 2) + (sjisRow < 0x3F ? 0x70 : 0xB0);
      const sjisLow = sjisRow % 2 === 0
        ? col + 0x40 + (col >= 0x3F ? 1 : 0)
        : col + 0x9E;
      return (sjisHigh << 8) | sjisLow;
    }
    return 0;
  }

  function fromBase64(b64) {
    const bin = atob(b64.replace(/\n/g, ''));
    const bytes = new Uint8Array([...bin].map(c => c.charCodeAt(0)));
    return new TextDecoder('utf-8').decode(bytes);
  }

  function fromBase64ShiftJIS(b64) {
    const bin = atob(b64.replace(/\n/g, ''));
    const bytes = new Uint8Array([...bin].map(c => c.charCodeAt(0)));
    try {
      return new TextDecoder('shift-jis').decode(bytes);
    } catch(e) {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }

  function nowJST() {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(new Date()).replace(/\//g, '-');
  }

  function logFileName() {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `logs/log_${y}_${m}.csv`;
  }

  // CSV行生成（LF）
  function csvRow(fields, crlf) {
    const line = fields.map(f => {
      const s = String(f ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',');
    return line + (crlf ? '\r\n' : '\n');
  }

  const CSV_HEADER_LF   = '日時,担当者名,送り先,商品コード,発送伝票番号,結果\n';
  const CSV_HEADER_CRLF = '日時,担当者名,送り先,商品コード,発送伝票番号,結果\r\n';

  // ─── ① 月次ログ追記（UTF-8・LF）────────────────────────
  async function appendLog(entry) {
    if (!hasToken()) throw new Error('GitHub Token が未設定です');

    const row = csvRow([
      nowJST(),
      entry.operator    || '',
      entry.destination || '',
      entry.productCode || '',
      entry.slipNo      || '',
      entry.result      || 'OK',
    ], false);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const path = logFileName();
        const existing = await getFile(path);
        let newContent, sha;
        if (existing) {
          const old = fromBase64(existing.content);
          newContent = toBase64(old + row);
          sha = existing.sha;
        } else {
  newContent = toBase64Bom(CSV_HEADER_CRLF.replace(/^\uFEFF/, '') + rowCRLF);
  sha = undefined;
}
        await putFile(path, newContent, sha, `[log] ${entry.slipNo} ${entry.result}`);
        _flushQueue();

        

        return { ok: true };
      } catch (e) {
        if (attempt === 2 || !e.message.includes('409')) {
          _enqueue(row);
          throw e;
        }
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  // ─── 本日分ログ追記（Shift-JIS・CR+LF・OKのみ）──────────
  async function appendTodayLog(entry, rowLF) {
    const TODAY_LOG = 'logs/log.csv';
    // CR+LF版の行を生成
    const rowCRLF = csvRow([
      nowJST(),
      entry.operator    || '',
      entry.destination || '',
      entry.productCode || '',
      entry.slipNo      || '',
      entry.result      || 'OK',
    ], true);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const existing = await getFile(TODAY_LOG);
        let newContent, sha;
  if (existing) {
  const old = fromBase64(existing.content).replace(/^\uFEFF/, '');
  newContent = toBase64Bom(old + rowCRLF);
  sha = existing.sha;
} else {
  newContent = toBase64Bom(CSV_HEADER_CRLF + rowCRLF);
  sha = undefined;
}
        await putFile(TODAY_LOG, newContent, sha, `[today-log] ${entry.slipNo}`);
        return { ok: true };
      } catch (e) {
        if (attempt === 2 || !e.message.includes('409')) throw e;
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  // オフラインキュー
  function _enqueue(row) {
    const q = JSON.parse(localStorage.getItem(LS_LOG_QUEUE) || '[]');
    q.push(row);
    localStorage.setItem(LS_LOG_QUEUE, JSON.stringify(q));
  }

  async function _flushQueue() {
    const q = JSON.parse(localStorage.getItem(LS_LOG_QUEUE) || '[]');
    if (!q.length) return;
    try {
      const path = logFileName();
      const existing = await getFile(path);
      const rows = q.join('');
      const newContent = existing
        ? toBase64(fromBase64(existing.content) + rows)
        : toBase64(CSV_HEADER_LF + rows);
      await putFile(path, newContent, existing?.sha, `[log-flush] ${q.length}件`);
      localStorage.removeItem(LS_LOG_QUEUE);
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
