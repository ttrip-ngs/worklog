#!/usr/bin/env python3
"""2つの xlsx のシートを、セルの値・数式・スタイルID・結合範囲の観点で比較する。

生成した帳票が元の Excel と同一レイアウトかを検証するための開発用ツール。
使い方: python3 scripts/compare-xlsx.py <期待> <実際>
"""
import sys, zipfile
import xml.etree.ElementTree as ET

N = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def plain_text(si):
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
        names = z.namelist()
        strings = (
            [plain_text(si) for si in ET.fromstring(z.read("xl/sharedStrings.xml"))]
            if "xl/sharedStrings.xml" in names
            else []
        )
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    cells = {}
    for c in sheet.iter(N + "c"):
        ref, style, t = c.get("r"), c.get("s") or "0", c.get("t")
        v = c.find(N + "v")
        f = c.find(N + "f")
        if t == "s" and v is not None:
            val = strings[int(v.text)]
        elif t == "inlineStr":
            isel = c.find(N + "is")
            val = plain_text(isel) if isel is not None else ""
        elif v is not None and v.text is not None:
            val = round(float(v.text), 9)
        else:
            val = None
        cells[ref] = (style, val, f.text if f is not None else None)
    mc = sheet.find(N + "mergeCells")
    merges = {m.get("ref") for m in mc} if mc is not None else set()
    return cells, merges


def main():
    exp_cells, exp_merges = load(sys.argv[1])
    act_cells, act_merges = load(sys.argv[2])

    diffs = []
    for ref in sorted(set(exp_cells) | set(act_cells), key=lambda r: (int("".join(filter(str.isdigit, r))), r)):
        e = exp_cells.get(ref)
        a = act_cells.get(ref)
        if e == a:
            continue
        # 値が両方 None(空セル)でスタイルだけ一致していれば無視しない: スタイルも比較対象
        diffs.append((ref, e, a))

    print(f"セル差分: {len(diffs)} 件")
    for ref, e, a in diffs[:80]:
        print(f"  {ref}: 期待={e} 実際={a}")
    if len(diffs) > 80:
        print(f"  ... 他 {len(diffs) - 80} 件")

    only_e = exp_merges - act_merges
    only_a = act_merges - exp_merges
    print(f"結合セル: 期待のみ {len(only_e)} 件 / 実際のみ {len(only_a)} 件")
    if only_e:
        print("  期待のみ:", sorted(only_e))
    if only_a:
        print("  実際のみ:", sorted(only_a))

    return 1 if diffs or only_e or only_a else 0


if __name__ == "__main__":
    sys.exit(main())
