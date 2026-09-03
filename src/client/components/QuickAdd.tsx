import { useEffect, useRef, useState } from "react";
import type { Entry, Suggestions } from "../../shared/types";
import { formatMin, parseTimeInput, formatMinPadded, weekdayOf, daysOfMonth } from "../../shared/time";
import type { EntryPayload } from "../api";

function lastDayOfMonth(month: string): string {
  const days = daysOfMonth(month);
  return days[days.length - 1];
}

type Props = {
  month: string;
  date: string;
  onDateChange: (d: string) => void;
  suggestions: Suggestions;
  defaultLocation: string;
  lastEntry: Entry | undefined;
  onAdd: (payload: EntryPayload) => Promise<void>;
};

/**
 * 明細の新規入力。入力補助として
 *  - よく使う時間帯のワンクリック適用
 *  - 直近明細のコピー
 *  - 業務内容 / 備考の候補(datalist)
 *  - 追加後に日付を翌日へ自動送り
 * を備える。
 */
export function QuickAdd({
  month,
  date,
  onDateChange,
  suggestions,
  defaultLocation,
  lastEntry,
  onAdd,
}: Props) {
  const [start, setStart] = useState("21:00");
  const [end, setEnd] = useState("24:00");
  const [content, setContent] = useState("");
  const [location, setLocation] = useState(defaultLocation);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const startRef = useRef<HTMLInputElement>(null);

  useEffect(() => setLocation(defaultLocation), [defaultLocation]);

  const applySlot = (s: number, e: number) => {
    setStart(formatMinPadded(s));
    setEnd(formatMinPadded(e));
  };

  const copyLast = () => {
    if (!lastEntry) return;
    applySlot(lastEntry.start_min, lastEntry.end_min);
    setContent(lastEntry.content);
    setLocation(lastEntry.location);
  };

  const submit = async () => {
    const s = parseTimeInput(start);
    const e = parseTimeInput(end);
    if (s === null || e === null) return setError("時刻の形式が不正です");
    if (e <= s) return setError("終了時刻は開始時刻より後にしてください");
    if (!date.startsWith(month)) return setError(`${month} 以外の日付です`);
    setBusy(true);
    setError("");
    try {
      await onAdd({ work_date: date, start_min: s, end_min: e, content, location });
      setStart(formatMinPadded(s));
      setEnd(formatMinPadded(e));
      // 続けて入力しやすいよう翌日へ送る(月末は据え置き)
      const next = new Date(`${date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const nextIso = next.toISOString().slice(0, 10);
      if (nextIso.startsWith(month)) onDateChange(nextIso);
      startRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "追加に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const onEnter = (ev: React.KeyboardEvent) => {
    if (ev.key === "Enter") void submit();
  };

  /** blur 時に "9" -> "09:00" のように表示を正規化する。 */
  const normalize = (raw: string, set: (v: string) => void) => {
    const min = parseTimeInput(raw);
    if (min !== null) set(formatMinPadded(min));
  };

  return (
    <div className="quick-add">
      <div className="quick-add-row">
        <label>
          年月日
          <span className="with-weekday">
            <input
              type="date"
              value={date}
              min={`${month}-01`}
              max={lastDayOfMonth(month)}
              onChange={(ev) => onDateChange(ev.target.value)}
            />
            <span className="weekday">{weekdayOf(date)}</span>
          </span>
        </label>
        <label>
          開始
          <input
            ref={startRef}
            value={start}
            onChange={(ev) => setStart(ev.target.value)}
            onBlur={() => normalize(start, setStart)}
            onKeyDown={onEnter}
            inputMode="numeric"
          />
        </label>
        <label>
          終了
          <input
            value={end}
            onChange={(ev) => setEnd(ev.target.value)}
            onBlur={() => normalize(end, setEnd)}
            onKeyDown={onEnter}
            inputMode="numeric"
          />
        </label>
        <label className="grow">
          業務内容
          <input list="dl-contents" value={content} onChange={(ev) => setContent(ev.target.value)} onKeyDown={onEnter} />
        </label>
        <label>
          備考
          <input list="dl-locations" value={location} onChange={(ev) => setLocation(ev.target.value)} onKeyDown={onEnter} />
        </label>
        <button type="button" className="primary" onClick={() => void submit()} disabled={busy}>
          追加
        </button>
      </div>

      <div className="quick-add-helpers">
        {suggestions.timeSlots.length > 0 && (
          <span className="helper-group">
            <span className="helper-label">よく使う時間帯</span>
            {suggestions.timeSlots.map((s) => (
              <button
                type="button"
                key={`${s.start_min}-${s.end_min}`}
                className="chip"
                onClick={() => applySlot(s.start_min, s.end_min)}
              >
                {formatMin(s.start_min)}〜{formatMin(s.end_min)}
                <em>{s.count}</em>
              </button>
            ))}
          </span>
        )}
        {lastEntry && (
          <button type="button" className="chip" onClick={copyLast}>
            直近の明細をコピー
          </button>
        )}
        <span className="hint">時刻は「9」「930」「24:00」などで入力できます。Enter で追加。</span>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
