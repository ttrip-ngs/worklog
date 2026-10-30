import type { KeyboardEvent } from "react";

/**
 * 確定操作としての Enter かどうか。
 *
 * 日本語入力(IME)では変換を確定する Enter も keydown として届くため、素朴に
 * `key === "Enter"` で拾うと、変換を確定しただけで明細が追加・更新されてしまう。
 * - isComposing: Chrome / Firefox は変換中の Enter でこれが true になる
 * - keyCode === 229: Safari は compositionend が先に出て isComposing が false になるため、
 *   代わりに「IME 処理中」を表す 229 で届く
 * の両方を見て、変換確定の Enter を除外する。
 */
export function isEnterKey(e: KeyboardEvent): boolean {
  return e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229;
}
