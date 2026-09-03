/**
 * 既存の「業務日報」Excel と同一レイアウトの xlsx を組み立てる。
 *
 * 方針: 元ファイルの styles.xml / theme1.xml をそのまま流用し、sheet1.xml だけを
 * 生成する。これにより罫線・フォント・網掛け・印刷設定を完全に維持したまま、
 * 明細行数を19行固定から可変にできる。
 */
import { zipSync, strToU8 } from "fflate";
import stylesXml from "./template/styles.xml?raw";
import themeXml from "./template/theme1.xml?raw";

export type ReportRow = {
  date: string; // YYYY-MM-DD
  startMin: number;
  endMin: number;
  content: string;
  location: string;
};

export type ReportData = {
  projectName: string;
  scopeItems: string[];
  reporterName: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  submittedOn: string;
  rows: ReportRow[];
  specialNotes: string;
};

/** 元ファイルの明細行数。これより少ない月は空行で埋めて見た目を揃える。 */
const MIN_DATA_ROWS = 19;
const LAST_COL = 34; // AH

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

function serial(isoDate: string): number {
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - EXCEL_EPOCH_UTC) / 86400000);
}

function col(n: number): string {
  let s = "";
  let v = n;
  while (v > 0) {
    const r = (v - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    v = Math.floor((v - 1) / 26);
  }
  return s;
}

function esc(s: string): string {
  return s
    // XML 1.0 で表現できない制御文字は落とす(貼り付け由来のゴミで xlsx が壊れるのを防ぐ)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type CellValue =
  | { kind: "num"; v: number }
  | { kind: "str"; v: string }
  | { kind: "formula"; f: string; v: number };

/** [開始列, 終了列, スタイルID] の並びから 1..34 列のスタイル配列を作る。未指定列は null(セル省略)。 */
function pattern(...segments: [number, number, number][]): (number | null)[] {
  const out: (number | null)[] = new Array(LAST_COL).fill(null);
  for (const [from, to, style] of segments) {
    for (let c = from; c <= to; c++) out[c - 1] = style;
  }
  return out;
}

function renderRow(
  rowNum: number,
  styles: (number | null)[],
  values: Map<number, CellValue>,
  height: number,
): string {
  const cells: string[] = [];
  for (let c = 1; c <= LAST_COL; c++) {
    const s = styles[c - 1];
    if (s === null) continue;
    const ref = `${col(c)}${rowNum}`;
    const val = values.get(c);
    if (!val) {
      cells.push(`<c r="${ref}" s="${s}"/>`);
    } else if (val.kind === "num") {
      cells.push(`<c r="${ref}" s="${s}"><v>${val.v}</v></c>`);
    } else if (val.kind === "formula") {
      cells.push(`<c r="${ref}" s="${s}"><f>${esc(val.f)}</f><v>${val.v}</v></c>`);
    } else {
      cells.push(
        `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(val.v)}</t></is></c>`,
      );
    }
  }
  return `<row r="${rowNum}" spans="1:${LAST_COL}" ht="${height}" customHeight="1">${cells.join("")}</row>`;
}

function emptyRow(rowNum: number, height = 22.5): string {
  return `<row r="${rowNum}" spans="1:${LAST_COL}" ht="${height}" customHeight="1"/>`;
}

const V = {
  num: (v: number): CellValue => ({ kind: "num", v }),
  str: (v: string): CellValue => ({ kind: "str", v }),
  formula: (f: string, v: number): CellValue => ({ kind: "formula", f, v }),
};

function vals(entries: [number, CellValue][]): Map<number, CellValue> {
  return new Map(entries);
}

// 明細行のスタイルパターン(元ファイルの奇数行/偶数行の縞模様をそのまま再現)
const DATA_ROW_A = pattern(
  [1, 1, 30], [2, 2, 31], [3, 3, 32],
  [4, 4, 39], [5, 5, 40], [6, 6, 41],
  [7, 7, 39], [8, 8, 40], [9, 9, 41],
  [10, 10, 33], [11, 11, 34], [12, 12, 35],
  [13, 13, 36], [14, 14, 37],
  [15, 15, 11], [16, 26, 12], [27, 27, 38],
  [28, 28, 11], [29, 33, 12], [34, 34, 13],
);
const DATA_ROW_B = pattern(
  [1, 1, 14], [2, 2, 15], [3, 3, 16],
  [4, 4, 17], [5, 5, 18], [6, 6, 19],
  [7, 7, 20], [8, 8, 21], [9, 9, 22],
  [10, 10, 20], [11, 11, 21], [12, 12, 23],
  [13, 13, 24], [14, 14, 25],
  [15, 15, 26], [16, 26, 27], [27, 27, 28],
  [28, 28, 26], [29, 33, 27], [34, 34, 29],
);

const HEADER_MERGES = [
  "AA1:AC1",
  "A3:AH3",
  "A5:C6", "D5:U5", "W5:Y6", "AA5:AH5",
  "D6:U6", "AA6:AH6",
  "W7:Y7", "Z7:AF7", "AG7:AH7",
  "A9:C9", "D9:AH9",
  "A10:C13", "D10:AH10", "D11:AH11", "D12:AH12", "D13:AH13",
  "A15:C15", "D15:F15", "G15:I15", "J15:L15", "M15:N15", "O15:AA15", "AB15:AH15",
];

function buildSheetXml(data: ReportData): string {
  const dataRowCount = Math.max(MIN_DATA_ROWS, data.rows.length);
  const firstDataRow = 16;
  const lastDataRow = firstDataRow + dataRowCount - 1;
  const notesLabelRow = lastDataRow + 2;
  const notesFirstRow = notesLabelRow + 1;
  const lastRow = notesLabelRow + 3;

  const [sy, sm, sd] = data.submittedOn.split("-").map(Number);
  const totalMin = data.rows.reduce((a, r) => a + (r.endMin - r.startMin), 0);
  const scope = [0, 1, 2, 3].map((i) => data.scopeItems[i] ?? "");

  const rowsXml: string[] = [];

  // 1行目: 提出日
  rowsXml.push(
    renderRow(1, pattern([25, 25, 9], [26, 26, 10], [27, 29, 44], [30, 34, 1]),
      vals([
        [25, V.str("提出日")],
        [27, V.num(sy)],
        [30, V.str("年")],
        [31, V.num(sm)],
        [32, V.str("月")],
        [33, V.num(sd)],
        [34, V.str("日")],
      ]), 22.5),
  );
  rowsXml.push(emptyRow(2));

  // 3行目: タイトル
  rowsXml.push(
    renderRow(3, pattern([1, 1, 47], [2, 33, 48], [34, 34, 49]),
      vals([[1, V.str("業 務 日 報")]]), 26.25),
  );
  rowsXml.push(emptyRow(4));

  // 5-6行目: 報告者 / 期間
  // 注: Z5 は元ファイルでは「自」ではなく「時」が入っている(原本の誤字をそのまま踏襲)。
  rowsXml.push(
    renderRow(5, pattern(
      [1, 1, 53], [2, 2, 54], [3, 3, 55], [4, 4, 63], [5, 20, 64], [21, 21, 65],
      [23, 23, 53], [24, 24, 66], [25, 25, 67], [26, 26, 2], [27, 27, 71], [28, 33, 72], [34, 34, 73],
    ), vals([
      // 「報告者」ラベルは A5:C6 の結合セルなので A5 に入れる
      [1, V.str("報告者")],
      [23, V.str("期間")],
      [26, V.str("時")],
      [27, V.num(serial(data.periodStart))],
    ]), 22.5),
  );
  rowsXml.push(
    renderRow(6, pattern(
      [1, 1, 56], [2, 2, 57], [3, 3, 58], [4, 4, 63], [5, 20, 64], [21, 21, 65],
      [23, 23, 68], [24, 24, 69], [25, 25, 70], [26, 26, 3], [27, 27, 79], [28, 33, 80], [34, 34, 81],
    ), vals([
      [4, V.str(data.reporterName)],
      [26, V.str("至")],
      [27, V.num(serial(data.periodEnd))],
    ]), 22.5),
  );
  // 7行目: 稼働時間計
  rowsXml.push(
    renderRow(7, pattern([23, 23, 86], [24, 25, 87], [26, 26, 42], [27, 32, 43], [33, 33, 77], [34, 34, 78]),
      vals([
        [23, V.str("稼働時間計")],
        [26, V.formula(`SUM(J${firstDataRow}:L${lastDataRow})`, totalMin / 1440)],
        [33, V.str("時間")],
      ]), 22.5),
  );
  rowsXml.push(
    renderRow(8, pattern([23, 23, 8], [24, 25, 4], [26, 26, 5], [27, 32, 6], [33, 34, 7]), vals([]), 10.25),
  );

  // 9-13行目: 委託件名 / 委託内容
  rowsXml.push(
    renderRow(9, pattern([1, 1, 84], [2, 3, 85], [4, 34, 59]),
      vals([[1, V.str("委託件名")], [4, V.str(data.projectName)]]), 22.5),
  );
  rowsXml.push(
    renderRow(10, pattern([1, 3, 54], [4, 34, 60]),
      vals([[1, V.str("委託内容")], [4, V.str(scope[0])]]), 22.5),
  );
  rowsXml.push(renderRow(11, pattern([1, 3, 88], [4, 34, 61]), vals([[4, V.str(scope[1])]]), 22.5));
  rowsXml.push(renderRow(12, pattern([1, 3, 88], [4, 34, 62]), vals([[4, V.str(scope[2])]]), 22.5));
  rowsXml.push(renderRow(13, pattern([1, 3, 88], [4, 34, 89]), vals([[4, V.str(scope[3])]]), 22.5));
  rowsXml.push(emptyRow(14));

  // 15行目: 明細ヘッダ
  rowsXml.push(
    renderRow(15, pattern(
      [1, 1, 82], [2, 2, 75], [3, 3, 83],
      [4, 4, 82], [5, 5, 75], [6, 6, 83],
      [7, 7, 82], [8, 8, 75], [9, 9, 83],
      [10, 10, 82], [11, 11, 75], [12, 12, 83],
      [13, 13, 45], [14, 14, 46],
      [15, 15, 50], [16, 26, 51], [27, 27, 52],
      [28, 28, 74], [29, 33, 75], [34, 34, 76],
    ), vals([
      [1, V.str("年月日")],
      [4, V.str("業務開始時刻")],
      [7, V.str("業務終了時刻")],
      [10, V.str("稼働時間")],
      [15, V.str("業務内容")],
      [28, V.str("備考")],
    ]), 22.5),
  );

  // 明細行
  for (let i = 0; i < dataRowCount; i++) {
    const r = firstDataRow + i;
    const styles = i % 2 === 0 ? DATA_ROW_A : DATA_ROW_B;
    const src = data.rows[i];
    const v: [number, CellValue][] = [];
    if (src) {
      v.push([1, V.num(serial(src.date))]);
      v.push([4, V.num(src.startMin / 1440)]);
      v.push([7, V.num(src.endMin / 1440)]);
      v.push([10, V.formula(`G${r}-D${r}`, (src.endMin - src.startMin) / 1440)]);
      if (src.content) v.push([15, V.str(src.content)]);
      if (src.location) v.push([28, V.str(src.location)]);
    }
    rowsXml.push(renderRow(r, styles, vals(v), 22.25));
  }

  rowsXml.push(emptyRow(lastDataRow + 1));

  // 特記事項
  rowsXml.push(
    renderRow(notesLabelRow, pattern([1, 1, 90], [2, 33, 64], [34, 34, 65]),
      vals([[1, V.str("特記事項")]]), 22.5),
  );
  rowsXml.push(
    renderRow(notesFirstRow, pattern([1, 1, 91], [2, 33, 92], [34, 34, 93]),
      vals(data.specialNotes ? [[1, V.str(data.specialNotes)]] : []), 22.5),
  );
  rowsXml.push(renderRow(notesFirstRow + 1, pattern([1, 1, 94], [2, 33, 92], [34, 34, 93]), vals([]), 22.5));
  rowsXml.push(renderRow(notesFirstRow + 2, pattern([1, 1, 68], [2, 33, 69], [34, 34, 95]), vals([]), 22.5));

  // 結合セル
  const merges = [...HEADER_MERGES];
  for (let r = firstDataRow; r <= lastDataRow; r++) {
    merges.push(`A${r}:C${r}`, `D${r}:F${r}`, `G${r}:I${r}`, `J${r}:L${r}`, `M${r}:N${r}`, `O${r}:AA${r}`, `AB${r}:AH${r}`);
  }
  merges.push(`A${notesLabelRow}:AH${notesLabelRow}`, `A${notesFirstRow}:AH${notesFirstRow + 2}`);

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetPr codeName="Sheet2"><pageSetUpPr fitToPage="1"/></sheetPr>' +
    `<dimension ref="A1:AH${lastRow}"/>` +
    '<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>' +
    '<sheetFormatPr baseColWidth="10" defaultColWidth="14.3984375" defaultRowHeight="15" customHeight="1"/>' +
    '<cols>' +
    '<col min="1" max="1" width="3.59765625" customWidth="1"/>' +
    '<col min="2" max="2" width="3.796875" customWidth="1"/>' +
    '<col min="3" max="3" width="4.796875" customWidth="1"/>' +
    '<col min="4" max="31" width="3.59765625" customWidth="1"/>' +
    '<col min="32" max="32" width="4" customWidth="1"/>' +
    '<col min="33" max="34" width="3.59765625" customWidth="1"/>' +
    '</cols>' +
    `<sheetData>${rowsXml.join("")}</sheetData>` +
    `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` +
    '<phoneticPr fontId="7"/>' +
    '<pageMargins left="0.25" right="0.25" top="0.75" bottom="0.75" header="0" footer="0"/>' +
    // 元ファイルは1ページに収める設定。明細が既定の19行を超える月は縦フィットを外し、
    // 極端に縮小されて判読できなくなるのを防ぐ(幅は1ページに収めたまま)。
    `<pageSetup paperSize="9" scale="86" orientation="portrait"${
      dataRowCount > MIN_DATA_ROWS ? ' fitToWidth="1" fitToHeight="0"' : ""
    }/>` +
    "</worksheet>"
  );
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  "</Types>";

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  "</Relationships>";

const WORKBOOK =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<workbookPr codeName="ThisWorkbook"/>' +
  '<sheets><sheet name="業務日誌" sheetId="1" r:id="rId1"/></sheets>' +
  '<calcPr calcId="191029"/>' +
  "</workbook>";

const WORKBOOK_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
  "</Relationships>";

export function buildWorkReportXlsx(data: ReportData): Uint8Array {
  return zipSync(
    {
      "[Content_Types].xml": strToU8(CONTENT_TYPES),
      "_rels/.rels": strToU8(ROOT_RELS),
      "xl/workbook.xml": strToU8(WORKBOOK),
      "xl/_rels/workbook.xml.rels": strToU8(WORKBOOK_RELS),
      "xl/styles.xml": strToU8(stylesXml),
      "xl/theme/theme1.xml": strToU8(themeXml),
      "xl/worksheets/sheet1.xml": strToU8(buildSheetXml(data)),
    },
    { level: 6 },
  );
}
