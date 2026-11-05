import { Hono } from "hono";
import type { AppBindings } from "../auth";
import * as db from "../db";
import {
  requireEntry,
  requireUnlockedMonth,
  requireWritableContract,
  requireWritableEntry,
} from "../guards";
import { BadRequest, NotFound, parseId, readJson } from "../http";
import { parseEntryInput } from "../inputs";

const MAX_BULK_ENTRIES = 100;

export const entries = new Hono<AppBindings>();

entries.post("/contracts/:id/entries", async (c) => {
  const id = parseId(c.req.param("id"));
  await requireWritableContract(c.env.DB, id);
  const body = await readJson(c);
  // 配列を渡すと一括登録(範囲コピーなどの入力補助で使用)。まとめて1トランザクションで投入する。
  const raw = Array.isArray(body) ? body : [body];
  if (raw.length === 0) throw new BadRequest("明細がありません");
  if (raw.length > MAX_BULK_ENTRIES) throw new BadRequest(`一度に登録できるのは ${MAX_BULK_ENTRIES} 件までです`);
  const inputs = raw.map(parseEntryInput);
  // 一括登録は複数月にまたがりうるため、含まれる月をすべて確認する
  for (const m of new Set(inputs.map((i) => i.work_date.slice(0, 7)))) {
    await requireUnlockedMonth(c.env.DB, id, m);
  }
  return c.json(await db.createEntries(c.env.DB, id, inputs), 201);
});

entries.get("/entries/:id", async (c) => {
  return c.json(await requireEntry(c.env.DB, parseId(c.req.param("id"))));
});

entries.put("/entries/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  const current = await requireWritableEntry(c.env.DB, id);
  const input = parseEntryInput(await readJson(c));
  // 移動元・移動先の両方を見る。締め済みの月から出すのも、締め済みの月へ入れるのも変更にあたる。
  await requireUnlockedMonth(c.env.DB, current.contract_id, current.work_date.slice(0, 7));
  await requireUnlockedMonth(c.env.DB, current.contract_id, input.work_date.slice(0, 7));
  const updated = await db.updateEntry(c.env.DB, id, input);
  if (!updated) throw new NotFound("明細が見つかりません");
  return c.json(updated);
});

entries.delete("/entries/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  const current = await requireWritableEntry(c.env.DB, id);
  await requireUnlockedMonth(c.env.DB, current.contract_id, current.work_date.slice(0, 7));
  const ok = await db.deleteEntry(c.env.DB, id);
  if (!ok) throw new NotFound("明細が見つかりません");
  return c.body(null, 204);
});
