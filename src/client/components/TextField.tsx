import { useEffect, useState } from "react";
import { isEnterKey } from "../ime";

type Props = {
  value: string;
  onCommit: (v: string) => void;
  /** 一覧では列見出し(th)が入力欄の名前にならないため、行ごとに明示する。 */
  ariaLabel?: string;
  listId?: string;
  placeholder?: string;
};

/** blur / Enter で確定するテキスト入力(datalist 対応)。 */
export function TextField({ value, onCommit, ariaLabel, listId, placeholder }: Props) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);

  const commit = () => {
    if (text !== value) onCommit(text);
  };

  return (
    <input
      className="text-field"
      aria-label={ariaLabel}
      value={text}
      list={listId}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (isEnterKey(e)) commit();
      }}
    />
  );
}
