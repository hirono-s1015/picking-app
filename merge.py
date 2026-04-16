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

# ===== AZU.csv を読み込む（完成済みデータ）=====
# 列構成: 伝票番号, 送り先名, 商品コード, 受注数, 商品名, ロケ, 発送伝票番号, JAN
azu_rows = read_csv_auto('AZU.csv')
new_rows = []
for row in azu_rows[1:]:  # ヘッダースキップ
    if len(row) < 6:
        continue
    new_rows.append([clean(c) for c in row])

print(f"AZU.csv新規データ: {len(new_rows)}件読み込み")

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

# ===== 重複処理：伝票番号＋商品コード＋発送伝票番号をキーに新しいデータで上書き =====
# キー：伝票番号_商品コード_発送伝票番号（再印刷で発送伝票番号が変わっても別行として扱う）
existing_dict = {}
for row in existing_rows:
    if len(row) < 3:
        continue
    ticket = clean(row[0])
    code   = clean(row[2])
    slip   = clean(row[6]) if len(row) >= 7 else ''
    key = ticket + '_' + code + '_' + slip
    existing_dict[key] = row

new_count = 0
update_count = 0
for row in new_rows:
    if len(row) < 3:
        continue
    ticket = clean(row[0])
    code   = clean(row[2])
    slip   = clean(row[6]) if len(row) >= 7 else ''
    key = ticket + '_' + code + '_' + slip
    if key in existing_dict:
        update_count += 1
    else:
        new_count += 1
    existing_dict[key] = row

print(f"新規追加: {new_count}件 / 更新: {update_count}件")

# ===== ZAC.csvに出力 =====
output_rows = [header] + list(existing_dict.values())

with open('ZAC.csv', 'w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    writer.writerows(output_rows)

print(f"ZAC.csv出力完了: {len(output_rows)-1}件")
