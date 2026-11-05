import { Hono } from "hono";
import type { AppBindings } from "../auth";
import * as db from "../db";
import { requireClient, requireContract } from "../guards";
import { parseId, requireMonth, todayJst } from "../http";
import { buildWorkReportXlsx } from "../xlsx/report";

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${month}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export const report = new Hono<AppBindings>();

report.get("/contracts/:id/months/:month/report.xlsx", async (c) => {
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
