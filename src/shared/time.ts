/** 分 -> "H:MM"。1440 は "24:00"、1440 超は "翌H:MM"。 */
export function formatMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const pad = String(m).padStart(2, "0");
  if (h >= 24 && min !== 1440) return `翌${h - 24}:${pad}`;
  return `${h}:${pad}`;
}

/** 分 -> "HH:MM"(input[type=text] 用の正規表記)。 */
export function formatMinPadded(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** 稼働時間(分) -> "H:MM"。 */
export function formatDuration(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

/**
 * 時刻入力のゆるいパース。手入力を減らすための要。
 * "9" -> 9:00 / "930" -> 9:30 / "0930" -> 9:30 / "9:3" -> 9:30
 * "9.5" -> 9:30 / "24" "2400" "24:00" -> 1440 / "翌1:00" -> 1500
 * 返り値は分。解釈できなければ null。
 */
export function parseTimeInput(raw: string): number | null {
  let s = raw.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  s = s.replace(/[：.．。]/g, ":").replace(/\s/g, "");
  let nextDay = false;
  if (s.startsWith("翌")) {
    nextDay = true;
    s = s.slice(1);
  }
  let h: number;
  let m: number;
  if (s.includes(":")) {
    const [hs, ms = "0"] = s.split(":");
    if (!/^\d{1,2}$/.test(hs) || !/^\d{1,2}$/.test(ms)) return null;
    h = Number(hs);
    // "9:3" は 9:30 とみなす(1桁は十の位)
    m = ms.length === 1 ? Number(ms) * 10 : Number(ms);
  } else if (/^\d{1,2}$/.test(s)) {
    h = Number(s);
    m = 0;
  } else if (/^\d{3}$/.test(s)) {
    h = Number(s.slice(0, 1));
    m = Number(s.slice(1));
  } else if (/^\d{4}$/.test(s)) {
    h = Number(s.slice(0, 2));
    m = Number(s.slice(2));
  } else {
    return null;
  }
  if (m > 59) return null;
  if (nextDay) h += 24;
  const min = h * 60 + m;
  if (min < 0 || min > 2880) return null;
  return min;
}

export function sumDuration(entries: { start_min: number; end_min: number }[]): number {
  return entries.reduce((acc, e) => acc + Math.max(0, e.end_min - e.start_min), 0);
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function weekdayOf(isoDate: string): string {
  return WEEKDAYS[new Date(`${isoDate}T00:00:00Z`).getUTCDay()];
}

export function isWeekend(isoDate: string): boolean {
  const d = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

/** "YYYY-MM" の日数分の ISO 日付配列。 */
export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
