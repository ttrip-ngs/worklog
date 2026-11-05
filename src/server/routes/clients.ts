import { Hono } from "hono";
import type { AppBindings } from "../auth";
import * as db from "../db";
import { requireClient, requireWritableClient } from "../guards";
import { NotFound, parseId, parseToggleFlag, readJson } from "../http";
import { parseClientInput } from "../inputs";

export const clients = new Hono<AppBindings>();

clients.get("/clients", async (c) => {
  const includeArchived = c.req.query("include_archived") === "1";
  return c.json(await db.listClientsWithContracts(c.env.DB, includeArchived));
});

clients.post("/clients", async (c) => {
  const input = parseClientInput(await readJson(c));
  return c.json(await db.createClient(c.env.DB, input), 201);
});

clients.get("/clients/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  const includeArchived = c.req.query("include_archived") === "1";
  const client = await requireClient(c.env.DB, id);
  return c.json({ ...client, contracts: await db.listContracts(c.env.DB, id, includeArchived) });
});

clients.put("/clients/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  await requireWritableClient(c.env.DB, id);
  const input = parseClientInput(await readJson(c));
  const updated = await db.updateClient(c.env.DB, id, input);
  if (!updated) throw new NotFound("取引先が見つかりません");
  return c.json(updated);
});

clients.post("/clients/:id/archive", async (c) => {
  const archived = parseToggleFlag(await readJson(c).catch(() => null), "archived");
  const ok = await db.setClientArchived(c.env.DB, parseId(c.req.param("id")), archived);
  if (!ok) throw new NotFound("取引先が見つかりません");
  return c.body(null, 204);
});
