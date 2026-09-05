import { useEffect, useState } from "react";
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

type RowProps = { entry: Entry } & Omit<Props, "entries">;

// 狭い画面に加えて、幅があってもタッチ操作の端末(スマホの横向きなど)はリスト表示にする。
// 幅だけで見ると iPhone の横向き(約 874px)がテーブルに切り替わってしまう。
const NARROW = "(max-width: 860px), (hover: none) and (pointer: coarse)";

/**
 * 一覧をテーブルで出せる環境かどうか。
 * 列固定幅の合計(約 682px)を確保できない幅ではテーブルが破綻し、
 * タッチ操作では行内の小さな入力欄を直接触るのが難しいため、リスト表示に切り替える。
 */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

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

/** 削除の2段確認。一覧・リストのどちらからも使う。 */
function DeleteButtons({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}>
        削除
      </button>
    );
  }
  return (
    <>
      <button type="button" className="danger" onClick={onDelete}>
        削除する
      </button>
      <button type="button" onClick={() => setConfirming(false)}>
        取消
      </button>
    </>
  );
}

function Row({ entry: e, month, onUpdate, onDelete, onDuplicate }: RowProps) {
  return (
    <tr className={isWeekend(e.work_date) ? "is-weekend" : undefined}>
      <td>
        <input
          className="date-field"
          type="date"
          aria-label="年月日"
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
        <TimeField
          ariaLabel="開始"
          value={e.start_min}
          onCommit={(v) => onUpdate(e.id, payloadOf(e, { start_min: v }))}
        />
      </td>
      <td>
        <TimeField
          ariaLabel="終了"
          value={e.end_min}
          onCommit={(v) => onUpdate(e.id, payloadOf(e, { end_min: v }))}
        />
      </td>
      <td className="num" title={`${formatMin(e.start_min)}〜${formatMin(e.end_min)}`}>
        {formatDuration(e.end_min - e.start_min)}
      </td>
      <td>
        <TextField
          ariaLabel="業務内容"
          value={e.content}
          listId="dl-contents"
          onCommit={(v) => onUpdate(e.id, payloadOf(e, { content: v }))}
        />
      </td>
      <td>
        <TextField
          ariaLabel="備考"
          value={e.location}
          listId="dl-locations"
          onCommit={(v) => onUpdate(e.id, payloadOf(e, { location: v }))}
        />
      </td>
      <td className="row-actions">
        <button type="button" title="この行を複製して追加" onClick={() => onDuplicate(e)}>
          複製
        </button>
        <DeleteButtons onDelete={() => onDelete(e.id)} />
      </td>
    </tr>
  );
}

/**
 * 狭い画面の1明細。既定は1件2行の読み取り表示で、タップしたときだけ編集欄を開く。
 * 月に20件前後並ぶため、全件を編集フォームのまま出すとスクロールが長くなりすぎる。
 */
function EntryItem({ entry: e, month, onUpdate, onDelete, onDuplicate }: RowProps) {
  const [open, setOpen] = useState(false);
  const dur = formatDuration(e.end_min - e.start_min);
  const desc = [e.content, e.location].filter((v) => v.trim() !== "").join(" ・ ");

  return (
    <li className={`entry-item${isWeekend(e.work_date) ? " is-weekend" : ""}${open ? " is-open" : ""}`}>
      <button type="button" className="entry-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="entry-date">
          {Number(e.work_date.slice(5, 7))}/{Number(e.work_date.slice(8))}
          <span className="entry-weekday">{weekdayOf(e.work_date)}</span>
        </span>
        <span className="entry-span">
          {formatMin(e.start_min)}〜{formatMin(e.end_min)}
        </span>
        <span className="entry-dur">{dur}</span>
        <span className="entry-desc">{desc || "(業務内容なし)"}</span>
      </button>

      {open && (
        <div className="entry-edit">
          <label className="entry-field entry-field-wide">
            年月日
            <input
              type="date"
              value={e.work_date}
              min={`${month}-01`}
              max={lastDayOfMonth(month)}
              onChange={(ev) => {
                if (ev.target.value.startsWith(month)) {
                  onUpdate(e.id, payloadOf(e, { work_date: ev.target.value }));
                }
              }}
            />
          </label>
          <label className="entry-field">
            開始
            <TimeField value={e.start_min} onCommit={(v) => onUpdate(e.id, payloadOf(e, { start_min: v }))} />
          </label>
          <label className="entry-field">
            終了
            <TimeField value={e.end_min} onCommit={(v) => onUpdate(e.id, payloadOf(e, { end_min: v }))} />
          </label>
          <label className="entry-field entry-field-wide">
            業務内容
            <TextField
              value={e.content}
              listId="dl-contents"
              onCommit={(v) => onUpdate(e.id, payloadOf(e, { content: v }))}
            />
          </label>
          <label className="entry-field entry-field-wide">
            備考
            <TextField
              value={e.location}
              listId="dl-locations"
              onCommit={(v) => onUpdate(e.id, payloadOf(e, { location: v }))}
            />
          </label>
          <div className="entry-actions">
            <button type="button" onClick={() => onDuplicate(e)}>
              複製
            </button>
            <DeleteButtons onDelete={() => onDelete(e.id)} />
          </div>
        </div>
      )}
    </li>
  );
}

export function EntryTable({ month, entries, onUpdate, onDelete, onDuplicate }: Props) {
  const narrow = useNarrow();

  if (entries.length === 0) {
    return <p className="empty">この月の実績はまだありません。入力欄から追加してください。</p>;
  }

  if (narrow) {
    return (
      <section className="entry-list">
        <h2 className="entry-list-title">この月の明細 {entries.length} 件</h2>
        <ul>
          {entries.map((e) => (
            <EntryItem
              key={e.id}
              entry={e}
              month={month}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
            />
          ))}
        </ul>
      </section>
    );
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
