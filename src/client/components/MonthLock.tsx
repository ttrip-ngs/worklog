import { useState } from "react";
import type { ReportMeta } from "../../shared/types";

/**
 * SQLite の datetime('now') は UTC の "YYYY-MM-DD HH:MM:SS"(末尾に Z が無い)。
 * そのまま Date に渡すと環境によってローカル時刻と解釈されるため、明示的に UTC として読む。
 */
function formatLockedAt(raw: string): string {
  const d = new Date(`${raw.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return raw;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

type Props = {
  month: string;
  meta: ReportMeta;
  onChange: (locked: boolean) => void;
};

/**
 * 月締めの操作。締めるのは1クリック、解除は2段確認にしている。
 * 提出済みの月をうっかり編集可能に戻すほうが事故として重いため。
 */
export function MonthLock({ month, meta, onChange }: Props) {
  const [confirming, setConfirming] = useState(false);

  if (meta.locked_at === null) {
    return (
      <div className="month-lock">
        <button type="button" onClick={() => onChange(true)}>
          この月を締める
        </button>
        <p className="hint">締めると明細と帳票ヘッダを変更できなくなります。提出日も確定します。</p>
      </div>
    );
  }

  return (
    <div className="month-lock is-locked">
      <p className="lock-state">
        <strong>締め済み</strong>
        <span className="hint">
          {formatLockedAt(meta.locked_at)}
          {meta.locked_by && ` / ${meta.locked_by}`}
        </span>
      </p>
      {confirming ? (
        <>
          <p className="hint">{month} の締めを解除して、編集できる状態に戻しますか?</p>
          <div className="lock-actions">
            <button
              type="button"
              className="danger"
              onClick={() => {
                setConfirming(false);
                onChange(false);
              }}
            >
              解除する
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              やめる
            </button>
          </div>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)}>
          締めを解除
        </button>
      )}
    </div>
  );
}
