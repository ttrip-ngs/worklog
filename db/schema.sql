-- 業務委託 稼働実績管理 スキーマ (Cloudflare D1 / SQLite)
-- 冪等に流せるよう DROP -> CREATE。プロト段階のため migration は分割しない。

DROP TABLE IF EXISTS entries;
DROP TABLE IF EXISTS report_meta;
DROP TABLE IF EXISTS contracts;
DROP TABLE IF EXISTS clients;

-- 取引先(会社)。1社に複数の委託件名がぶら下がる。
CREATE TABLE clients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,             -- 取引先名
  reporter_name TEXT    NOT NULL DEFAULT '',  -- 報告者氏名(帳票に出力)
  sort_order    INTEGER NOT NULL DEFAULT 0,
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 委託件名(委託契約)。帳票ヘッダの案件固有情報をここに持たせる。
CREATE TABLE contracts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id        INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_name     TEXT    NOT NULL,             -- 委託件名
  scope_items      TEXT    NOT NULL DEFAULT '[]',-- 委託内容。JSON文字列配列(帳票では4行に出力)
  default_location TEXT    NOT NULL DEFAULT '',  -- 備考欄(作業場所)の既定値
  sort_order       INTEGER NOT NULL DEFAULT 0,
  archived         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_contracts_client ON contracts (client_id, sort_order);

-- 稼働実績。1日に複数明細を許す(午前打合せ / 午後作業 など)。
CREATE TABLE entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  work_date   TEXT    NOT NULL,                   -- YYYY-MM-DD
  start_min   INTEGER NOT NULL,                   -- 0:00 からの分。24:00 は 1440
  end_min     INTEGER NOT NULL,                   -- 日跨ぎは 1440 超の値で表現
  content     TEXT    NOT NULL DEFAULT '',        -- 業務内容
  location    TEXT    NOT NULL DEFAULT '',        -- 備考(作業場所)
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (start_min >= 0 AND start_min <= 1440),
  CHECK (end_min > start_min AND end_min <= 2880)
);

CREATE INDEX idx_entries_contract_date ON entries (contract_id, work_date);

-- 月次帳票のヘッダ情報(提出日・特記事項)。委託件名ごとに1枚。
CREATE TABLE report_meta (
  contract_id   INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  month         TEXT    NOT NULL,                -- YYYY-MM
  submitted_on  TEXT,                            -- YYYY-MM-DD。未設定なら出力時の当日
  special_notes TEXT    NOT NULL DEFAULT '',     -- 特記事項(改行区切り最大3行)
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (contract_id, month)
);
