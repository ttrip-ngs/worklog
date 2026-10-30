import type {
  Client,
  ClientWithContracts,
  Contract,
  Entry,
  ReportMeta,
  Suggestions,
} from "../shared/types";

type ContractRow = Omit<Contract, "scope_items"> & { scope_items: string };

function toContract(row: ContractRow): Contract {
  let scope: string[] = [];
  try {
    const parsed = JSON.parse(row.scope_items);
    if (Array.isArray(parsed)) scope = parsed.map(String);
  } catch {
    scope = [];
  }
  return { ...row, scope_items: scope };
}

// ---- 取引先 ----

export type ClientInput = { name: string; reporter_name: string; sort_order: number };

export async function listClientsWithContracts(
  db: D1Database,
  includeArchived = false,
): Promise<ClientWithContracts[]> {
  const filter = includeArchived ? "" : "WHERE archived = 0";
  const [clients, contracts] = await Promise.all([
    db.prepare(`SELECT * FROM clients ${filter} ORDER BY sort_order, id`).all<Client>(),
    db.prepare(`SELECT * FROM contracts ${filter} ORDER BY sort_order, id`).all<ContractRow>(),
  ]);
  const byClient = new Map<number, Contract[]>();
  for (const row of contracts.results) {
    const list = byClient.get(row.client_id) ?? [];
    list.push(toContract(row));
    byClient.set(row.client_id, list);
  }
  return clients.results.map((c) => ({ ...c, contracts: byClient.get(c.id) ?? [] }));
}

export async function getClient(db: D1Database, id: number): Promise<Client | null> {
  return await db.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first<Client>();
}

export async function createClient(db: D1Database, input: ClientInput): Promise<Client> {
  const row = await db
    .prepare(
      `INSERT INTO clients (name, reporter_name, sort_order) VALUES (?, ?, ?) RETURNING *`,
    )
    .bind(input.name, input.reporter_name, input.sort_order)
    .first<Client>();
  return row!;
}

export async function updateClient(
  db: D1Database,
  id: number,
  input: ClientInput,
): Promise<Client | null> {
  return await db
    .prepare(`UPDATE clients SET name = ?, reporter_name = ?, sort_order = ? WHERE id = ? RETURNING *`)
    .bind(input.name, input.reporter_name, input.sort_order, id)
    .first<Client>();
}

// ---- 委託件名 ----

export type ContractInput = {
  project_name: string;
  scope_items: string[];
  default_location: string;
  sort_order: number;
};

export async function getContract(db: D1Database, id: number): Promise<Contract | null> {
  const row = await db.prepare("SELECT * FROM contracts WHERE id = ?").bind(id).first<ContractRow>();
  return row ? toContract(row) : null;
}

export async function createContract(
  db: D1Database,
  clientId: number,
  input: ContractInput,
): Promise<Contract> {
  const row = await db
    .prepare(
      `INSERT INTO contracts (client_id, project_name, scope_items, default_location, sort_order)
       VALUES (?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(
      clientId,
      input.project_name,
      JSON.stringify(input.scope_items),
      input.default_location,
      input.sort_order,
    )
    .first<ContractRow>();
  return toContract(row!);
}

export async function updateContract(
  db: D1Database,
  id: number,
  input: ContractInput,
): Promise<Contract | null> {
  const row = await db
    .prepare(
      `UPDATE contracts SET project_name = ?, scope_items = ?, default_location = ?, sort_order = ?
       WHERE id = ? RETURNING *`,
    )
    .bind(
      input.project_name,
      JSON.stringify(input.scope_items),
      input.default_location,
      input.sort_order,
      id,
    )
    .first<ContractRow>();
  return row ? toContract(row) : null;
}

/**
 * 論理削除の切り替え。実績データは残したまま一覧から外す(戻すことも可能)。
 * 取引先を非表示にしても配下の委託件名の archived は変えない。取引先を戻せば
 * 配下もそのまま戻るほうが直感的なため。
 */
export async function setContractArchived(
  db: D1Database,
  id: number,
  archived: boolean,
): Promise<boolean> {
  const res = await db
    .prepare("UPDATE contracts SET archived = ? WHERE id = ?")
    .bind(archived ? 1 : 0, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function setClientArchived(
  db: D1Database,
  id: number,
  archived: boolean,
): Promise<boolean> {
  const res = await db
    .prepare("UPDATE clients SET archived = ? WHERE id = ?")
    .bind(archived ? 1 : 0, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// ---- 稼働実績 ----

export type EntryInput = {
  work_date: string;
  start_min: number;
  end_min: number;
  content: string;
  location: string;
};

export async function listEntries(
  db: D1Database,
  contractId: number,
  month: string,
): Promise<Entry[]> {
  const { results } = await db
    .prepare(
      `SELECT id, contract_id, work_date, start_min, end_min, content, location
       FROM entries WHERE contract_id = ? AND work_date LIKE ?
       ORDER BY work_date, start_min, id`,
    )
    .bind(contractId, `${month}-%`)
    .all<Entry>();
  return results;
}

export async function getEntry(db: D1Database, id: number): Promise<Entry | null> {
  return await db
    .prepare(
      `SELECT id, contract_id, work_date, start_min, end_min, content, location
       FROM entries WHERE id = ?`,
    )
    .bind(id)
    .first<Entry>();
}

/** 複数明細をまとめて登録する。batch は1トランザクションで実行されるため部分登録が残らない。 */
export async function createEntries(
  db: D1Database,
  contractId: number,
  inputs: EntryInput[],
): Promise<Entry[]> {
  const stmt = db.prepare(
    `INSERT INTO entries (contract_id, work_date, start_min, end_min, content, location)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id, contract_id, work_date, start_min, end_min, content, location`,
  );
  const results = await db.batch<Entry>(
    inputs.map((i) => stmt.bind(contractId, i.work_date, i.start_min, i.end_min, i.content, i.location)),
  );
  return results.flatMap((r) => r.results);
}

export async function updateEntry(db: D1Database, id: number, input: EntryInput): Promise<Entry | null> {
  return await db
    .prepare(
      `UPDATE entries SET work_date = ?, start_min = ?, end_min = ?, content = ?, location = ?,
              updated_at = datetime('now')
       WHERE id = ?
       RETURNING id, contract_id, work_date, start_min, end_min, content, location`,
    )
    .bind(input.work_date, input.start_min, input.end_min, input.content, input.location, id)
    .first<Entry>();
}

export async function deleteEntry(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare("DELETE FROM entries WHERE id = ?").bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

// ---- 帳票ヘッダ ----

const META_COLS = "contract_id, month, submitted_on, special_notes, locked_at, locked_by";

/** 行が無い月は「未締めで空のヘッダ」として扱う。 */
function emptyMeta(contractId: number, month: string): ReportMeta {
  return {
    contract_id: contractId,
    month,
    submitted_on: null,
    special_notes: "",
    locked_at: null,
    locked_by: "",
  };
}

export async function getMeta(db: D1Database, contractId: number, month: string): Promise<ReportMeta> {
  const row = await db
    .prepare(
      `SELECT ${META_COLS} FROM report_meta WHERE contract_id = ? AND month = ?`,
    )
    .bind(contractId, month)
    .first<ReportMeta>();
  return row ?? emptyMeta(contractId, month);
}

/** 締め済みかどうかだけを見る軽いチェック(更新系の入口で使う)。 */
export async function isMonthLocked(
  db: D1Database,
  contractId: number,
  month: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT locked_at FROM report_meta WHERE contract_id = ? AND month = ?")
    .bind(contractId, month)
    .first<{ locked_at: string | null }>();
  return row?.locked_at != null;
}

/**
 * 月を締める。提出日が未設定ならこの時点の日付で確定させる。
 * 出力時の当日を使うままだと、締めたあとでもダウンロードするたびに帳票の提出日が
 * 変わってしまうため。special_notes は触らない。
 *
 * 既に締め済みの月に対しては何も変えない。二重クリックや再送で「最初に締めた日時・人」が
 * 後日の値に置き換わると、いつ提出したかの証跡が失われるため。
 */
export async function lockMonth(
  db: D1Database,
  contractId: number,
  month: string,
  lockedBy: string,
  fallbackSubmittedOn: string,
): Promise<ReportMeta> {
  const row = await db
    .prepare(
      `INSERT INTO report_meta (contract_id, month, submitted_on, special_notes, locked_at, locked_by)
       VALUES (?, ?, ?, '', datetime('now'), ?)
       ON CONFLICT (contract_id, month) DO UPDATE SET
         submitted_on = COALESCE(report_meta.submitted_on, excluded.submitted_on),
         locked_at = COALESCE(report_meta.locked_at, excluded.locked_at),
         locked_by = CASE WHEN report_meta.locked_at IS NULL THEN excluded.locked_by ELSE report_meta.locked_by END,
         updated_at = datetime('now')
       RETURNING ${META_COLS}`,
    )
    .bind(contractId, month, fallbackSubmittedOn, lockedBy)
    .first<ReportMeta>();
  return row!;
}

/** 締めを解除する。提出日・特記事項はそのまま残す。 */
export async function unlockMonth(
  db: D1Database,
  contractId: number,
  month: string,
): Promise<ReportMeta> {
  const row = await db
    .prepare(
      `UPDATE report_meta SET locked_at = NULL, locked_by = '', updated_at = datetime('now')
       WHERE contract_id = ? AND month = ?
       RETURNING ${META_COLS}`,
    )
    .bind(contractId, month)
    .first<ReportMeta>();
  // 行が無い = そもそも未締め。冪等に扱う。
  return row ?? emptyMeta(contractId, month);
}

export async function upsertMeta(
  db: D1Database,
  contractId: number,
  month: string,
  submittedOn: string | null,
  specialNotes: string,
): Promise<ReportMeta> {
  const row = await db
    .prepare(
      `INSERT INTO report_meta (contract_id, month, submitted_on, special_notes)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (contract_id, month) DO UPDATE SET
         submitted_on = excluded.submitted_on,
         special_notes = excluded.special_notes,
         updated_at = datetime('now')
       RETURNING ${META_COLS}`,
    )
    .bind(contractId, month, submittedOn, specialNotes)
    .first<ReportMeta>();
  return row!;
}

/**
 * 入力補助用の候補を過去実績から集計する。
 * 使用回数 + 最終使用日で並べる。同じ取引先の他案件(非表示にしたものも含む)から
 * 集めるので、案件をまたいで共通の作業場所や定型業務がそのまま候補になる。
 */
export async function getSuggestions(db: D1Database, contractId: number): Promise<Suggestions> {
  // 同一取引先配下の全案件を対象にする(作業場所や定型業務は案件をまたいで共通のため)
  const scope = `contract_id IN (
    SELECT id FROM contracts WHERE client_id = (SELECT client_id FROM contracts WHERE id = ?)
  )`;
  const [contents, locations, slots] = await Promise.all([
    db
      .prepare(
        `SELECT content AS v FROM entries WHERE ${scope} AND content <> ''
         GROUP BY content ORDER BY COUNT(*) DESC, MAX(work_date) DESC LIMIT 20`,
      )
      .bind(contractId)
      .all<{ v: string }>(),
    db
      .prepare(
        `SELECT location AS v FROM entries WHERE ${scope} AND location <> ''
         GROUP BY location ORDER BY COUNT(*) DESC, MAX(work_date) DESC LIMIT 20`,
      )
      .bind(contractId)
      .all<{ v: string }>(),
    db
      .prepare(
        `SELECT start_min, end_min, COUNT(*) AS count FROM entries WHERE ${scope}
         GROUP BY start_min, end_min ORDER BY count DESC, MAX(work_date) DESC LIMIT 6`,
      )
      .bind(contractId)
      .all<{ start_min: number; end_min: number; count: number }>(),
  ]);
  return {
    contents: contents.results.map((r) => r.v),
    locations: locations.results.map((r) => r.v),
    timeSlots: slots.results,
  };
}
