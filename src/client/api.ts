import type {
  Client,
  ClientWithContracts,
  Contract,
  Entry,
  MonthResponse,
  ReportMeta,
  SessionUser,
} from "../shared/types";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `通信に失敗しました (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export type ClientInput = { name: string; reporter_name: string; sort_order: number };
export type ContractInput = {
  project_name: string;
  scope_items: string[];
  default_location: string;
  sort_order: number;
};
export type EntryPayload = {
  work_date: string;
  start_min: number;
  end_min: number;
  content: string;
  location: string;
};

export const api = {
  me: () => req<SessionUser>("/me"),
  clients: (includeArchived = false) =>
    req<ClientWithContracts[]>(`/clients${includeArchived ? "?include_archived=1" : ""}`),
  createClient: (input: ClientInput) => req<Client>("/clients", { method: "POST", body: JSON.stringify(input) }),
  updateClient: (id: number, input: ClientInput) =>
    req<Client>(`/clients/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  createContract: (clientId: number, input: ContractInput) =>
    req<Contract>(`/clients/${clientId}/contracts`, { method: "POST", body: JSON.stringify(input) }),
  updateContract: (id: number, input: ContractInput) =>
    req<Contract>(`/contracts/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  setContractArchived: (id: number, archived: boolean) =>
    req<void>(`/contracts/${id}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
  setClientArchived: (id: number, archived: boolean) =>
    req<void>(`/clients/${id}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
  month: (contractId: number, month: string) => req<MonthResponse>(`/contracts/${contractId}/months/${month}`),
  addEntries: (contractId: number, payload: EntryPayload | EntryPayload[]) =>
    req<Entry[]>(`/contracts/${contractId}/entries`, { method: "POST", body: JSON.stringify(payload) }),
  updateEntry: (id: number, payload: EntryPayload) =>
    req<Entry>(`/entries/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteEntry: (id: number) => req<void>(`/entries/${id}`, { method: "DELETE" }),
  saveMeta: (contractId: number, month: string, meta: { submitted_on: string | null; special_notes: string }) =>
    req<ReportMeta>(`/contracts/${contractId}/months/${month}/meta`, { method: "PUT", body: JSON.stringify(meta) }),
  reportUrl: (contractId: number, month: string) => `/api/contracts/${contractId}/months/${month}/report.xlsx`,
};
