import { Hono, type Context } from "hono";
import type { AppBindings } from "./auth";
import { requireUser } from "./auth";
import * as db from "./db";
import { buildWorkReportXlsx } from "./xlsx/report";
import type { MonthResponse } from "../shared/types";

const app = new Hono<AppBindings>();

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BULK_ENTRIES = 100;

class BadRequest extends Error {}
class NotFound extends Error {}

/** 形式に加えて実在する日付か(2026-02-31 のような繰り上がりを弾く)を検証する。 */
function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new NotFound("対象が見つかりません");
  return id;
}

async function readJson(c: Context<AppBindings>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new BadRequest("リクエストの形式が不正です");
  }
}

function parseEntryInput(body: unknown): db.EntryInput {
  const b = body as Record<string, unknown>;
  const work_date = String(b?.work_date ?? "");
  if (!isValidDate(work_date)) throw new BadRequest("年月日が不正です");
  const start_min = Number(b?.start_min);
  const end_min = Number(b?.end_min);
  if (!Number.isInteger(start_min) || start_min < 0 || start_min > 1440) {
    throw new BadRequest("業務開始時刻が不正です");
  }
  if (!Number.isInteger(end_min) || end_min <= start_min || end_min > 2880) {
    throw new BadRequest("業務終了時刻は開始時刻より後にしてください");
  }
  return {
    work_date,
    start_min,
    end_min,
    content: String(b?.content ?? "").slice(0, 200),
    location: String(b?.location ?? "").slice(0, 100),
  };
}

function parseClientInput(body: unknown): db.ClientInput {
  const b = body as Record<string, unknown>;
  const name = String(b?.name ?? "").trim();
  if (!name) throw new BadRequest("取引先名は必須です");
  return {
    name: name.slice(0, 100),
    reporter_name: String(b?.reporter_name ?? "").trim().slice(0, 100),
    sort_order: Number.isFinite(Number(b?.sort_order)) ? Number(b?.sort_order) : 0,
  };
}

function parseContractInput(body: unknown): db.ContractInput {
  const b = body as Record<string, unknown>;
  const project = String(b?.project_name ?? "").trim();
  if (!project) throw new BadRequest("委託件名は必須です");
  const scope = Array.isArray(b?.scope_items) ? (b.scope_items as unknown[]).map(String) : [];
  return {
    project_name: project.slice(0, 200),
    scope_items: scope.map((s) => s.slice(0, 200)).filter((s) => s.trim() !== "").slice(0, 4),
    default_location: String(b?.default_location ?? "").trim().slice(0, 100),
    sort_order: Number.isFinite(Number(b?.sort_order)) ? Number(b?.sort_order) : 0,
  };
}

/** Asia/Tokyo の今日 (YYYY-MM-DD)。Worker のタイムゾーンは UTC のため明示的に変換する。 */
function todayJst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${month}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function requireMonth(raw: string): string {
  if (!MONTH_RE.test(raw)) throw new BadRequest("月の形式が不正です");
  return raw;
}

async function requireClient(dbi: D1Database, id: number) {
  const client = await db.getClient(dbi, id);
  if (!client) throw new NotFound("取引先が見つかりません");
  return client;
}

async function requireContract(dbi: D1Database, id: number) {
  const contract = await db.getContract(dbi, id);
  if (!contract) throw new NotFound("委託件名が見つかりません");
  return contract;
}

// 非表示(archived)のレコードは読み取りは許すが更新は拒否する。
// 過去帳票の再ダウンロードは非表示後も必要なため、読み取り側は塞がない。
async function requireWritableClient(dbi: D1Database, id: number) {
  const client = await requireClient(dbi, id);
  if (client.archived) throw new BadRequest("非表示にした取引先は編集できません");
  return client;
}

async function requireWritableContract(dbi: D1Database, id: number) {
  const contract = await requireContract(dbi, id);
  if (contract.archived) throw new BadRequest("非表示にした委託件名は編集できません");
  return contract;
}

const api = new Hono<AppBindings>();
api.use("*", requireUser);

api.get("/me", (c) => c.json(c.get("user")));

// ---- 取引先 ----

api.get("/clients", async (c) => {
  const includeArchived = c.req.query("include_archived") === "1";
  return c.json(await db.listClientsWithContracts(c.env.DB, includeArchived));
});

api.post("/clients", async (c) => {
  const input = parseClientInput(await readJson(c));
  return c.json(await db.createClient(c.env.DB, input), 201);
});

api.put("/clients/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  await requireWritableClient(c.env.DB, id);
  const input = parseClientInput(await readJson(c));
  const updated = await db.updateClient(c.env.DB, id, input);
  if (!updated) throw new NotFound("取引先が見つかりません");
  return c.json(updated);
});

// ---- 委託件名 ----

api.post("/clients/:id/contracts", async (c) => {
  const clientId = parseId(c.req.param("id"));
  await requireWritableClient(c.env.DB, clientId);
  const input = parseContractInput(await readJson(c));
  return c.json(await db.createContract(c.env.DB, clientId, input), 201);
});

api.put("/contracts/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  await requireWritableContract(c.env.DB, id);
  const input = parseContractInput(await readJson(c));
  const updated = await db.updateContract(c.env.DB, id, input);
  if (!updated) throw new NotFound("委託件名が見つかりません");
  return c.json(updated);
});

/** 非表示 / 再表示の切り替え。body の archived を省略した場合は非表示にする。 */
function parseArchivedFlag(body: unknown): boolean {
  const v = (body as Record<string, unknown> | null)?.archived;
  return v === undefined ? true : Boolean(v);
}

api.post("/contracts/:id/archive", async (c) => {
  const archived = parseArchivedFlag(await readJson(c).catch(() => null));
  const ok = await db.setContractArchived(c.env.DB, parseId(c.req.param("id")), archived);
  if (!ok) throw new NotFound("委託件名が見つかりません");
  return c.body(null, 204);
});

api.post("/clients/:id/archive", async (c) => {
  const archived = parseArchivedFlag(await readJson(c).catch(() => null));
  const ok = await db.setClientArchived(c.env.DB, parseId(c.req.param("id")), archived);
  if (!ok) throw new NotFound("取引先が見つかりません");
  return c.body(null, 204);
});

// ---- 月次データ ----

api.get("/contracts/:id/months/:month", async (c) => {
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

api.post("/contracts/:id/entries", async (c) => {
  const id = parseId(c.req.param("id"));
  await requireWritableContract(c.env.DB, id);
  const body = await readJson(c);
  // 配列を渡すと一括登録(範囲コピーなどの入力補助で使用)。まとめて1トランザクションで投入する。
  const raw = Array.isArray(body) ? body : [body];
  if (raw.length === 0) throw new BadRequest("明細がありません");
  if (raw.length > MAX_BULK_ENTRIES) throw new BadRequest(`一度に登録できるのは ${MAX_BULK_ENTRIES} 件までです`);
  return c.json(await db.createEntries(c.env.DB, id, raw.map(parseEntryInput)), 201);
});

api.put("/entries/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  const input = parseEntryInput(await readJson(c));
  const updated = await db.updateEntry(c.env.DB, id, input);
  if (!updated) throw new NotFound("明細が見つかりません");
  return c.json(updated);
});

api.delete("/entries/:id", async (c) => {
  const ok = await db.deleteEntry(c.env.DB, parseId(c.req.param("id")));
  if (!ok) throw new NotFound("明細が見つかりません");
  return c.body(null, 204);
});

api.put("/contracts/:id/months/:month/meta", async (c) => {
  const id = parseId(c.req.param("id"));
  const month = requireMonth(c.req.param("month"));
  await requireWritableContract(c.env.DB, id);
  const body = (await readJson(c)) as Record<string, unknown>;
  const submitted = body.submitted_on ? String(body.submitted_on) : null;
  if (submitted && !isValidDate(submitted)) throw new BadRequest("提出日が不正です");
  const notes = String(body.special_notes ?? "").slice(0, 500);
  return c.json(await db.upsertMeta(c.env.DB, id, month, submitted, notes));
});

// ---- 帳票 ----

api.get("/contracts/:id/months/:month/report.xlsx", async (c) => {
  const id = parseId(c.req.param("id"));
  const month = requireMonth(c.req.param("month"));
  const contract = await requireContract(c.env.DB, id);
  const client = await requireClient(c.env.DB, contract.client_id);
  const [entries, meta] = await Promise.all([
    db.listEntries(c.env.DB, id, month),
    db.getMeta(c.env.DB, id, month),
  ]);

  const xlsx = buildWorkReportXlsx({
    projectName: contract.project_name,
    scopeItems: contract.scope_items,
    reporterName: client.reporter_name,
    periodStart: `${month}-01`,
    periodEnd: lastDayOfMonth(month),
    submittedOn: meta.submitted_on ?? todayJst(),
    specialNotes: meta.special_notes,
    rows: entries.map((e) => ({
      date: e.work_date,
      startMin: e.start_min,
      endMin: e.end_min,
      content: e.content,
      location: e.location,
    })),
  });

  const stem = month.replace("-", "");
  const filename = `${stem}_${contract.project_name}.xlsx`;
  return c.body(xlsx as unknown as ArrayBuffer, 200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    // filename* を解釈しないブラウザ向けに ASCII のフォールバックも付ける
    "Content-Disposition":
      `attachment; filename="${stem}_report.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
});

api.onError((err, c) => {
  if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
  if (err instanceof NotFound) return c.json({ error: err.message }, 404);
  console.error(err);
  return c.json({ error: "サーバエラーが発生しました" }, 500);
});

app.route("/api", api);

export default app;
