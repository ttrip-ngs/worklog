import { useEffect, useState } from "react";

type Props = {
  value: string;
  onCommit: (v: string) => void;
  /** 一覧では列見出し(th)が入力欄の名前にならないため、行ごとに明示する。 */
  ariaLabel?: string;
  listId?: string;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
};

/** blur / Enter で確定するテキスト入力(datalist 対応)。 */
export function TextField({ value, onCommit, ariaLabel, listId, placeholder, onKeyDown }: Props) {
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
        if (e.key === "Enter") commit();
        onKeyDown?.(e);
      }}
    />
  );
}
