import { useState } from "react";
import type { Entry } from "../../shared/types";
import { formatDuration, formatMin, weekdayOf, isWeekend, daysOfMonth } from "../../shared/time";
import { TimeField } from "./TimeField";
import { TextField } from "./TextField";
import type { EntryPayload } from "../api";

type Props = {
  month: string; // YYYY-MM。日付をこの月の中に制限するために使う
  entries: Entry[];
  onUpdate: (id: number, payload: EntryPayload) => void;
  onDelete: (id: number) => void;
  onDuplicate: (entry: Entry) => void;
};

function lastDayOfMonth(month: string): string {
  const days = daysOfMonth(month);
  return days[days.length - 1];
}

function payloadOf(e: Entry, patch: Partial<EntryPayload>): EntryPayload {
  return {
    work_date: e.work_date,
    start_min: e.start_min,
    end_min: e.end_min,
    content: e.content,
    location: e.location,
    ...patch,
  };
}

function Row({ entry: e, month, onUpdate, onDelete, onDuplicate }: { entry: Entry } & Omit<Props, "entries">) {
  const [confirming, setConfirming] = useState(false);

  return (
    <tr className={isWeekend(e.work_date) ? "is-weekend" : undefined}>
      <td>
        <input
          className="date-field"
          type="date"
          value={e.work_date}
          min={`${month}-01`}
          max={lastDayOfMonth(month)}
          onChange={(ev) => {
            // 表示中の月の外へ移すと一覧から消えて削除に見えるため、月内に限定する
            if (ev.target.value.startsWith(month)) {
              onUpdate(e.id, payloadOf(e, { work_date: ev.target.value }));
            }
          }}
        />
        <span className="weekday">{weekdayOf(e.work_date)}</span>
      </td>
      <td>
        <TimeField value={e.start_min} onCommit={(v) => onUpdate(e.id, payloadOf(e, { start_min: v }))} />
      </td>
      <td>
        <TimeField value={e.end_min} onCommit={(v) => onUpdate(e.id, payloadOf(e, { end_min: v }))} />
      </td>
      <td className="num" title={`${formatMin(e.start_min)}〜${formatMin(e.end_min)}`}>
        {formatDuration(e.end_min - e.start_min)}
      </td>
      <td>
        <TextField
          value={e.content}
          listId="dl-contents"
          onCommit={(v) => onUpdate(e.id, payloadOf(e, { content: v }))}
        />
      </td>
      <td>
        <TextField
          value={e.location}
          listId="dl-locations"
          onCommit={(v) => onUpdate(e.id, payloadOf(e, { location: v }))}
        />
      </td>
      <td className="row-actions">
        <button type="button" title="この行を複製して追加" onClick={() => onDuplicate(e)}>
          複製
        </button>
        {confirming ? (
          <>
            <button type="button" className="danger" onClick={() => onDelete(e.id)}>
              削除する
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              取消
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirming(true)}>
            削除
          </button>
        )}
      </td>
    </tr>
  );
}

export function EntryTable({ month, entries, onUpdate, onDelete, onDuplicate }: Props) {
  if (entries.length === 0) {
    return <p className="empty">この月の実績はまだありません。下の入力欄から追加してください。</p>;
  }

  return (
    <table className="entry-table">
      <thead>
        <tr>
          <th className="col-date">年月日</th>
          <th className="col-time">開始</th>
          <th className="col-time">終了</th>
          <th className="col-dur">稼働</th>
          <th>業務内容</th>
          <th className="col-loc">備考</th>
          <th className="col-act"></th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <Row
            key={e.id}
            entry={e}
            month={month}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
          />
        ))}
      </tbody>
    </table>
  );
}
