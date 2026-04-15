import csv
import os

def read_csv_auto(filename):
    """Shift-JIS / UTF-8 自動判別で読み込む"""
    for enc in ('shift-jis', 'utf-8-sig', 'utf-8'):
        try:
            with open(filename, encoding=enc) as f:
                rows = list(csv.reader(f))
            print(f"{filename}: {enc}で読み込み成功 ({len(rows)}行)")
            return rows
        except Exception:
            continue
    raise ValueError(f"{filename} の読み込みに失敗しました")

def clean(s):
    """前後の空白・引用符を除去"""
    return s.strip().strip('"').strip()

# ===== AZU.csv を読み込む =====
azu_rows = read_csv_auto('AZU.csv')
azu_dict = {}
for row in azu_rows[1:]:
    if len(row) < 3:
        continue
    ticket = clean(row[0])
    code   = clean(row[1])
    slip   = clean(row[2])
    jan    = clean(row[3]) if len(row) >= 4 else ''
    if ticket and code:
        key = ticket + '_' + code
        azu_dict[key] = {'slip': slip, 'jan': jan}

print(f"AZU.csv: {len(azu_dict)}件読み込み")

# ===== ZAC1.csv, ZAC2.csv を読み込む =====
zac_rows = []
for filename in ('ZAC1.csv', 'ZAC2.csv'):
    try:
        rows = read_csv_auto(filename)
        data_rows = rows[1:]
        zac_rows.extend(data_rows)
        print(f"{filename}: {len(data_rows)}件追加")
    except FileNotFoundError:
        print(f"{filename}: 見つかりません（スキップ）")
    except Exception as e:
        print(f"{filename}: 読み込みエラー（スキップ）: {e}")

print(f"ZAC新規データ合計: {len(zac_rows)}件")

# ===== 既存のZAC.csvを読み込む（追記モード）=====
header = ['伝票番号', '送り先名', '商品コード', '受注数', '商品名', 'ロケ', '発送伝票番号', 'JAN']
existing_rows = []

if os.path.exists('ZAC.csv'):
    try:
        existing_data = read_csv_auto('ZAC.csv')
        if len(existing_data) > 1:
            existing_rows = existing_data[1:]
            print(f"ZAC.csv既存データ: {len(existing_rows)}件読み込み")
    except Exception as e:
        print(f"ZAC.csv読み込みエラー: {e}")

# ===== 新規データをAZUと結合 =====
new_output_rows = []
for row in zac_rows:
    if len(row) < 6:
        continue
    ticket = clean(row[0])
    name   = clean(row[1])
    code   = clean(row[2])
    qty    = clean(row[3])
    pname  = clean(row[4])
    loc    = clean(row[5])

    key  = ticket + '_' + code
    azu  = azu_dict.get(key, {})
    slip = azu.get('slip', '')
    jan  = azu.get('jan', '')

    new_output_rows.append([ticket, name, code, qty, pname, loc, slip, jan])

# ===== 重複処理：伝票番号＋商品コードが同じ行は新しいデータで上書き =====
existing_dict = {}
for row in existing_rows:
    if len(row) < 3:
        continue
    t = clean(row[0])
    c = clean(row[2])
    existing_dict[t + '_' + c] = row

new_count = 0
update_count = 0
for row in new_output_rows:
    t = clean(row[0])
    c = clean(row[2])
    key = t + '_' + c
    if key in existing_dict:
        update_count += 1
    else:
        new_count += 1
    existing_dict[key] = row  # 新しいデータで上書き

print(f"新規追加: {new_count}件 / 更新（再印刷）: {update_count}件")

# ===== ZAC.csvに出力 =====
output_rows = [header] + list(existing_dict.values())

with open('ZAC.csv', 'w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    writer.writerows(output_rows)

print(f"ZAC.csv出力完了: {len(output_rows)-1}件")
