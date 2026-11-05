import { Hono } from "hono";
import type { AppBindings } from "../auth";
import * as db from "../db";
import {
  requireClient,
  requireContract,
  requireUnlockedMonth,
  requireWritableContract,
} from "../guards";
import { parseId, parseToggleFlag, readJson, requireMonth, todayJst } from "../http";
import { parseMetaInput } from "../inputs";
import type { MonthResponse } from "../../shared/types";

export const months = new Hono<AppBindings>();

months.get("/contracts/:id/months", async (c) => {
  const id = parseId(c.req.param("id"));
  await requireContract(c.env.DB, id);
  return c.json(await db.listMonthSummaries(c.env.DB, id));
});

months.get("/contracts/:id/months/:month", async (c) => {
  const id = parseId(c.req.param("id"));
  const month = requireMonth(c.req.param("month"));
  const contract = await requireContract(c.env.DB, id);
  const client = await requireClient(c.env.DB, contract.client_id);
  const [entries, meta, suggestions] = await Promise.all([
    db.listEntries(c.env.DB, id, month),
    db.getMeta(c.env.DB, id, month),
    db.getSuggestions(c.env.DB, id),
  ]);
  const res: MonthResponse = { client, contract, month, entries, meta, suggestions };
  return c.json(res);
});

months.put("/contracts/:id/months/:month/meta", async (c) => {
  const id = parseId(c.req.param("id"));
  const month = requireMonth(c.req.param("month"));
  await requireWritableContract(c.env.DB, id);
  await requireUnlockedMonth(c.env.DB, id, month);
  const { submitted_on, special_notes } = parseMetaInput(await readJson(c));
  return c.json(await db.upsertMeta(c.env.DB, id, month, submitted_on, special_notes));
});

/**
 * 月締めの切り替え。body の locked を省略した場合は締める(安全側)。
 * 締めると提出日が未設定でもその時点の日付で確定する。出力時の当日を使ったままだと、
 * 提出後もダウンロードのたびに帳票の提出日が変わってしまうため。
 */
months.post("/contracts/:id/months/:month/lock", async (c) => {
  const id = parseId(c.req.param("id"));
  const month = requireMonth(c.req.param("month"));
  await requireWritableContract(c.env.DB, id);
  const locked = parseToggleFlag(await readJson(c).catch(() => null), "locked");
  const meta = locked
    ? await db.lockMonth(c.env.DB, id, month, c.get("user").email, todayJst())
    : await db.unlockMonth(c.env.DB, id, month);
  return c.json(meta);
});
