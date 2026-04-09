import csv
import sys

def read_csv_auto(filename):
    """Shift-JIS / UTF-8 自動判別で読み込む"""
    for enc in ('shift-jis', 'utf-8-sig', 'utf-8'):
        try:
            with open(filename, encoding=enc) as f:
                rows = list(csv.reader(f))
            print(f"{filename}: {enc}で読み込み成功 ({len(rows)}行)")
            return rows
        except Exception as e:
            continue
    raise ValueError(f"{filename} の読み込みに失敗しました")

def clean(s):
    """前後の空白・引用符を除去"""
    return s.strip().strip('"').strip()

# ===== AZU.csv を読み込む =====
# 列構成: 伝票番号, 商品コード, 発送伝票番号, JANコード
azu_rows = read_csv_auto('AZU.csv')
azu_dict = {}
for row in azu_rows[1:]:  # ヘッダースキップ
    if len(row) < 3:
        continue
    ticket = clean(row[0])
    slip   = clean(row[2])  # 発送伝票番号
    jan    = clean(row[3]) if len(row) >= 4 else ''
    if ticket:
        azu_dict[ticket] = {'slip': slip, 'jan': jan}

print(f"AZU.csv: {len(azu_dict)}件読み込み")

# ===== ZAC1.csv + ZAC2.csv を縦結合 =====
# 列構成: 伝票番号, 送り先名, 商品コード, 受注数, 商品名, ロケ
zac_rows = []
for filename in ('ZAC1.csv', 'ZAC2.csv'):
    try:
        rows = read_csv_auto(filename)
        data_rows = rows[1:]  # ヘッダースキップ
        zac_rows.extend(data_rows)
        print(f"{filename}: {len(data_rows)}件追加")
    except FileNotFoundError:
        print(f"{filename}: 見つかりません（スキップ）")

print(f"ZAC合計: {len(zac_rows)}件")

# ===== 結合してZAC.csvを出力 =====
# 出力列: 伝票番号, 送り先名, 商品コード, 受注数, 商品名, ロケ, 発送伝票番号, JAN
output_rows = []
header = ['伝票番号', '送り先名', '商品コード', '受注数', '商品名', 'ロケ', '発送伝票番号', 'JAN']
output_rows.append(header)

matched = 0
unmatched = 0

for row in zac_rows:
    if len(row) < 6:
        continue
    ticket = clean(row[0])
    name   = clean(row[1])
    code   = clean(row[2])
    qty    = clean(row[3])
    pname  = clean(row[4])
    loc    = clean(row[5])

    # AZU.csvからVLOOKUP
    azu = azu_dict.get(ticket, {})
    slip = azu.get('slip', '')
    jan  = azu.get('jan', '')

    if slip:
        matched += 1
    else:
        unmatched += 1

    output_rows.append([ticket, name, code, qty, pname, loc, slip, jan])

# UTF-8（BOMなし）で出力
with open('ZAC.csv', 'w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    writer.writerows(output_rows)

print(f"ZAC.csv出力完了: {len(output_rows)-1}件 (マッチ:{matched} 未マッチ:{unmatched})")
