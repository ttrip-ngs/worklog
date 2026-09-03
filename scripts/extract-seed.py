#!/usr/bin/env python3
"""既存の業務日報 xlsx から初期データ (db/seed.sql) を生成する。

使い方: python3 scripts/extract-seed.py <日報.xlsx> [取引先名] > db/seed.sql

出力には元ファイルの取引先名・報告者名・稼働実績がそのまま入る。実データから
生成したものはコミットしないこと(リポジトリの db/seed.sql は架空のサンプル)。
"""
import sys, zipfile, datetime
import xml.etree.ElementTree as ET

N = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
EPOCH = datetime.date(1899, 12, 30)  # Excel シリアル値の基準日


def plain_text(si):
    """ふりがな (rPh) を除いた文字列を取り出す。"""
    out = []
    for ch in si:
        if ch.tag == N + "t":
            out.append(ch.text or "")
        elif ch.tag == N + "r":
            for t in ch.findall(N + "t"):
                out.append(t.text or "")
    return "".join(out)


def load(path):
    with zipfile.ZipFile(path) as z:
        strings = [plain_text(si) for si in ET.fromstring(z.read("xl/sharedStrings.xml"))]
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    cells = {}
    for c in sheet.iter(N + "c"):
        v = c.find(N + "v")
        if v is None or v.text is None:
            continue
        cells[c.get("r")] = strings[int(v.text)] if c.get("t") == "s" else v.text
    return cells


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def serial_to_date(v):
    return EPOCH + datetime.timedelta(days=int(float(v)))


def frac_to_min(v):
    return round(float(v) * 1440)


def main():
    cells = load(sys.argv[1])
    client_name = sys.argv[2] if len(sys.argv) > 2 else "株式会社サンプル"
    reporter = cells.get("D6", "")
    project = cells.get("D9", "")
    scope = [cells.get(f"D{r}", "") for r in (10, 11, 12, 13)]
    scope_json = "[" + ",".join('"' + s.replace('"', '\\"') + '"' for s in scope if s) + "]"

    rows = []
    for r in range(16, 35):
        if f"A{r}" not in cells or f"D{r}" not in cells:
            continue
        rows.append(
            (
                serial_to_date(cells[f"A{r}"]).isoformat(),
                frac_to_min(cells[f"D{r}"]),
                frac_to_min(cells[f"G{r}"]),
                cells.get(f"O{r}", ""),
                cells.get(f"AB{r}", ""),
            )
        )

    submitted = "{:04d}-{:02d}-{:02d}".format(
        int(float(cells["AA1"])), int(float(cells["AE1"])), int(float(cells["AG1"]))
    )
    month = serial_to_date(cells["AA5"]).strftime("%Y-%m")
    total = sum(e - s for _, s, e, _, _ in rows)

    out = []
    out.append("-- scripts/extract-seed.py で既存の業務日報 xlsx から自動生成")
    out.append(f"-- 明細 {len(rows)} 件 / 稼働時間計 {total // 60}時間{total % 60:02d}分")
    for t in ("entries", "report_meta", "contracts", "clients"):
        out.append(f"DELETE FROM {t};")
    out.append(
        "INSERT INTO clients (id, name, reporter_name, sort_order) VALUES\n"
        f"  (1, {q(client_name)}, {q(reporter)}, 0);"
    )
    out.append(
        "INSERT INTO contracts (id, client_id, project_name, scope_items, default_location, sort_order) VALUES\n"
        f"  (1, 1, {q(project)}, {q(scope_json)}, {q('自宅')}, 0);"
    )
    out.append("INSERT INTO entries (contract_id, work_date, start_min, end_min, content, location) VALUES")
    body = [
        f"  (1, {q(d)}, {s}, {e}, {q(c)}, {q(loc)})" for d, s, e, c, loc in rows
    ]
    out.append(",\n".join(body) + ";")
    out.append(
        "INSERT INTO report_meta (contract_id, month, submitted_on, special_notes) VALUES\n"
        f"  (1, {q(month)}, {q(submitted)}, '');"
    )
    print("\n".join(out))


if __name__ == "__main__":
    main()
