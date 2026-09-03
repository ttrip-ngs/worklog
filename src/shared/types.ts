export type Client = {
  id: number;
  name: string;
  reporter_name: string;
  sort_order: number;
  archived: number;
};

/** 委託件名(委託契約)。1つの取引先に複数ぶら下がる。帳票1枚に対応する単位。 */
export type Contract = {
  id: number;
  client_id: number;
  project_name: string;
  scope_items: string[];
  default_location: string;
  sort_order: number;
  archived: number;
};

export type ClientWithContracts = Client & { contracts: Contract[] };

export type Entry = {
  id: number;
  contract_id: number;
  work_date: string; // YYYY-MM-DD
  start_min: number;
  end_min: number;
  content: string;
  location: string;
};

export type ReportMeta = {
  contract_id: number;
  month: string; // YYYY-MM
  submitted_on: string | null;
  special_notes: string;
};

/** 入力補助に使う、過去実績から集計した候補。 */
export type Suggestions = {
  contents: string[];
  locations: string[];
  /** よく使う時間帯。start/end は分。 */
  timeSlots: { start_min: number; end_min: number; count: number }[];
};

export type MonthResponse = {
  client: Client;
  contract: Contract;
  month: string;
  entries: Entry[];
  meta: ReportMeta;
  suggestions: Suggestions;
};

export type SessionUser = { email: string; name: string };
