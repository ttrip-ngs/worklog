import { Hono } from "hono";
import type { AppBindings } from "../auth";
import * as db from "../db";
import { requireContract, requireWritableClient, requireWritableContract } from "../guards";
import { NotFound, parseId, parseToggleFlag, readJson } from "../http";
import { parseContractInput } from "../inputs";

export const contracts = new Hono<AppBindings>();

contracts.post("/clients/:id/contracts", async (c) => {
  const clientId = parseId(c.req.param("id"));
  await requireWritableClient(c.env.DB, clientId);
  const input = parseContractInput(await readJson(c));
  return c.json(await db.createContract(c.env.DB, clientId, input), 201);
});

contracts.get("/contracts/:id", async (c) => {
  return c.json(await requireContract(c.env.DB, parseId(c.req.param("id"))));
});

contracts.put("/contracts/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  await requireWritableContract(c.env.DB, id);
  const input = parseContractInput(await readJson(c));
  const updated = await db.updateContract(c.env.DB, id, input);
  if (!updated) throw new NotFound("委託件名が見つかりません");
  return c.json(updated);
});

contracts.post("/contracts/:id/archive", async (c) => {
  const archived = parseToggleFlag(await readJson(c).catch(() => null), "archived");
  const ok = await db.setContractArchived(c.env.DB, parseId(c.req.param("id")), archived);
  if (!ok) throw new NotFound("委託件名が見つかりません");
  return c.body(null, 204);
});
