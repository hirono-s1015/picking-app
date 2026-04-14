import csv

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

# ===== ZAC1.csv〜ZAC6.csv を縦結合（存在するファイルだけ読み込む）=====
zac_rows = []
for i in range(1, 7):
    filename = f'ZAC{i}.csv'
    try:
        rows = read_csv_auto(filename)
        data_rows = rows[1:]
        zac_rows.extend(data_rows)
        print(f"{filename}: {len(data_rows)}件追加")
    except FileNotFoundError:
        print(f"{filename}: 見つかりません（スキップ）")
    except Exception as e:
        print(f"{filename}: 読み込みエラー（スキップ）: {e}")

print(f"ZAC合計: {len(zac_rows)}件")

# ===== 結合してZAC.csvを出力 =====
output_rows = []
header = ['伝票番号', '送り先名', '商品コード', '受注数', '商品名', 'ロケ', '発送伝票番号', 'JAN']
output_rows.append(header)

matched   = 0
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

    key  = ticket + '_' + code
    azu  = azu_dict.get(key, {})
    slip = azu.get('slip', '')
    jan  = azu.get('jan', '')

    if slip:
        matched += 1
    else:
        unmatched += 1

    output_rows.append([ticket, name, code, qty, pname, loc, slip, jan])

with open('ZAC.csv', 'w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    writer.writerows(output_rows)

print(f"ZAC.csv出力完了: {len(output_rows)-1}件 (マッチ:{matched} 未マッチ:{unmatched})")
