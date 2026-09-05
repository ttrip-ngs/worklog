import { useEffect, useState } from "react";
import { formatMinPadded, parseTimeInput } from "../../shared/time";
import { isEnterKey } from "../ime";

type Props = {
  value: number | null;
  onCommit: (min: number) => void;
  /** 一覧では列見出し(th)が入力欄の名前にならないため、行ごとに明示する。 */
  ariaLabel?: string;
  placeholder?: string;
  autoFocus?: boolean;
};

/**
 * 時刻入力。"9" / "930" / "9:3" / "24:00" などを解釈して HH:MM に正規化する。
 * 確定は blur / Enter。解釈できない入力は直前の値に戻す。
 */
export function TimeField({ value, onCommit, ariaLabel, placeholder, autoFocus }: Props) {
  const [text, setText] = useState(value === null ? "" : formatMinPadded(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(value === null ? "" : formatMinPadded(value));
    setInvalid(false);
  }, [value]);

  const commit = () => {
    const parsed = parseTimeInput(text);
    if (parsed === null) {
      setInvalid(true);
      setText(value === null ? "" : formatMinPadded(value));
      window.setTimeout(() => setInvalid(false), 800);
      return;
    }
    setText(formatMinPadded(parsed));
    if (parsed !== value) onCommit(parsed);
  };

  return (
    <input
      className={`time-field${invalid ? " is-invalid" : ""}`}
      aria-label={ariaLabel}
      value={text}
      placeholder={placeholder}
      autoFocus={autoFocus}
      inputMode="numeric"
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (isEnterKey(e)) commit();
      }}
    />
  );
}
