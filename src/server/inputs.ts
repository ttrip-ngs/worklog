import type * as db from "./db";
import { BadRequest, isValidDate } from "./http";

const asRecord = (body: unknown) => body as Record<string, unknown> | null;

export function parseEntryInput(body: unknown): db.EntryInput {
  const b = asRecord(body);
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

export function parseClientInput(body: unknown): db.ClientInput {
  const b = asRecord(body);
  const name = String(b?.name ?? "").trim();
  if (!name) throw new BadRequest("取引先名は必須です");
  return {
    name: name.slice(0, 100),
    reporter_name: String(b?.reporter_name ?? "").trim().slice(0, 100),
    sort_order: Number.isFinite(Number(b?.sort_order)) ? Number(b?.sort_order) : 0,
  };
}

export function parseContractInput(body: unknown): db.ContractInput {
  const b = asRecord(body);
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

export function parseMetaInput(body: unknown): { submitted_on: string | null; special_notes: string } {
  if (typeof body !== "object" || body === null) throw new BadRequest("リクエストの形式が不正です");
  const b = asRecord(body);
  const submitted_on = b?.submitted_on ? String(b.submitted_on) : null;
  if (submitted_on && !isValidDate(submitted_on)) throw new BadRequest("提出日が不正です");
  return { submitted_on, special_notes: String(b?.special_notes ?? "").slice(0, 500) };
}
