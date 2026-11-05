import type { Context } from "hono";
import type { AppBindings } from "./auth";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class BadRequest extends Error {}
export class NotFound extends Error {}
/** 締め済みの月への更新。クライアントは 409 を「締め済み」として扱う。 */
export class Locked extends Error {}

/** 形式に加えて実在する日付か(2026-02-31 のような繰り上がりを弾く)を検証する。 */
export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new NotFound("対象が見つかりません");
  return id;
}

export function requireMonth(raw: string): string {
  if (!MONTH_RE.test(raw)) throw new BadRequest("月の形式が不正です");
  return raw;
}

export async function readJson(c: Context<AppBindings>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new BadRequest("リクエストの形式が不正です");
  }
}

/**
 * 切り替え系 API のフラグ。省略した場合は true(非表示にする / 締める)として扱う。
 * 省略や壊れた body で「解除」側に倒れないよう、安全側に寄せている。
 */
export function parseToggleFlag(body: unknown, key: string): boolean {
  const v = (body as Record<string, unknown> | null)?.[key];
  return v === undefined ? true : Boolean(v);
}

/** Asia/Tokyo の今日 (YYYY-MM-DD)。Worker のタイムゾーンは UTC のため明示的に変換する。 */
export function todayJst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function handleError(err: Error, c: Context<AppBindings>): Response {
  if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
  if (err instanceof NotFound) return c.json({ error: err.message }, 404);
  if (err instanceof Locked) return c.json({ error: err.message }, 409);
  console.error(err);
  return c.json({ error: "サーバエラーが発生しました" }, 500);
}
