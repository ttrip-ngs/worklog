import type { Entry } from "../../shared/types";
import { daysOfMonth, formatDuration, isWeekend } from "../../shared/time";

type Props = {
  month: string;
  entries: Entry[];
  selected: string;
  onSelect: (date: string) => void;
};

/** 月内の入力状況を一覧できるカレンダー。日をクリックすると入力欄の日付が変わる。 */
export function MonthCalendar({ month, entries, selected, onSelect }: Props) {
  const totals = new Map<string, number>();
  for (const e of entries) {
    totals.set(e.work_date, (totals.get(e.work_date) ?? 0) + (e.end_min - e.start_min));
  }
  const days = daysOfMonth(month);
  const leading = new Date(`${days[0]}T00:00:00Z`).getUTCDay();

  return (
    <div className="calendar">
      <div className="calendar-grid">
        {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
          <div key={w} className="calendar-head">
            {w}
          </div>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <div key={`pad-${i}`} className="calendar-cell is-pad" />
        ))}
        {days.map((d) => {
          const min = totals.get(d);
          const classes = ["calendar-cell"];
          if (isWeekend(d)) classes.push("is-weekend");
          if (min) classes.push("has-entry");
          if (d === selected) classes.push("is-selected");
          return (
            <button type="button" key={d} className={classes.join(" ")} onClick={() => onSelect(d)}>
              <span className="day">{Number(d.slice(8))}</span>
              <span className="amount">{min ? formatDuration(min) : ""}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
