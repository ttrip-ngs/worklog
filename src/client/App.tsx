import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClientWithContracts, Entry, MonthResponse } from "../shared/types";
import { formatDuration, shiftMonth, sumDuration } from "../shared/time";
import { api, type ClientInput, type ContractInput, type EntryPayload } from "./api";
import { EntryTable } from "./components/EntryTable";
import { QuickAdd } from "./components/QuickAdd";
import { MonthCalendar } from "./components/MonthCalendar";
import { ManagePanel } from "./components/ManagePanel";

const LAST_CONTRACT_KEY = "worklog.lastContractId";

function currentMonthJst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

export default function App() {
  const [clients, setClients] = useState<ClientWithContracts[]>([]);
  const [contractId, setContractId] = useState<number | null>(null);
  const [month, setMonth] = useState(currentMonthJst());
  const [data, setData] = useState<MonthResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [managing, setManaging] = useState(false);
  const [inputDate, setInputDate] = useState(`${month}-01`);
  const [savedAt, setSavedAt] = useState("");

  // 帳票ヘッダ(提出日・特記事項)のローカル編集状態
  const [submittedOn, setSubmittedOn] = useState("");
  const [specialNotes, setSpecialNotes] = useState("");

  // clients は非表示のものも含めて保持し(管理パネルで戻せるように)、
  // 選択肢としては非表示でないものだけを使う。
  const activeClients = useMemo(
    () =>
      clients
        .filter((c) => !c.archived)
        .map((c) => ({ ...c, contracts: c.contracts.filter((ct) => !ct.archived) })),
    [clients],
  );
  const activeContractIds = useMemo(
    () => activeClients.flatMap((c) => c.contracts.map((ct) => ct.id)),
    [activeClients],
  );

  const loadClients = useCallback(async () => {
    const list = await api.clients(true);
    setClients(list);
    const ids = list
      .filter((c) => !c.archived)
      .flatMap((c) => c.contracts.filter((ct) => !ct.archived).map((ct) => ct.id));
    setContractId((prev) => {
      if (prev !== null && ids.includes(prev)) return prev;
      const saved = Number(localStorage.getItem(LAST_CONTRACT_KEY));
      return ids.includes(saved) ? saved : (ids[0] ?? null);
    });
    return list;
  }, []);

  const loadMonth = useCallback(async (id: number, m: string) => {
    const res = await api.month(id, m);
    setData(res);
    setSubmittedOn(res.meta.submitted_on ?? "");
    setSpecialNotes(res.meta.special_notes);
    return res;
  }, []);

  useEffect(() => {
    loadClients()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [loadClients]);

  useEffect(() => {
    if (contractId === null) {
      setData(null);
      return;
    }
    localStorage.setItem(LAST_CONTRACT_KEY, String(contractId));
    setLoading(true);
    loadMonth(contractId, month)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [contractId, month, loadMonth]);

  useEffect(() => {
    setInputDate((d) => (d.startsWith(month) ? d : `${month}-01`));
  }, [month]);

  const refresh = useCallback(async () => {
    if (contractId === null) return;
    await loadMonth(contractId, month);
    setSavedAt(new Date().toLocaleTimeString("ja-JP"));
  }, [contractId, month, loadMonth]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        setError("");
        await fn();
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "処理に失敗しました");
      }
    },
    [refresh],
  );

  const totalMin = useMemo(() => (data ? sumDuration(data.entries) : 0), [data]);
  const lastEntry: Entry | undefined = data?.entries[data.entries.length - 1];

  const saveMeta = async () => {
    if (contractId === null) return;
    await run(() =>
      api.saveMeta(contractId, month, {
        submitted_on: submittedOn || null,
        special_notes: specialNotes,
      }),
    );
  };

  const managePanel = managing && (
    <ManagePanel
      clients={clients}
      onClose={() => setManaging(false)}
      onCreateClient={async (input: ClientInput) => {
        const created = await api.createClient(input);
        await loadClients();
        return created;
      }}
      onUpdateClient={async (id, input) => {
        await api.updateClient(id, input);
        await loadClients();
        await refresh();
      }}
      onCreateContract={async (clientId, input: ContractInput) => {
        const created = await api.createContract(clientId, input);
        await loadClients();
        setContractId(created.id);
        return created;
      }}
      onUpdateContract={async (id, input) => {
        await api.updateContract(id, input);
        await loadClients();
        await refresh();
      }}
      onSetClientArchived={async (id, archived) => {
        await api.setClientArchived(id, archived);
        await loadClients();
      }}
      onSetContractArchived={async (id, archived) => {
        await api.setContractArchived(id, archived);
        await loadClients();
      }}
    />
  );

  if (loading && clients.length === 0 && !error) {
    return (
      <main className="app">
        <p>読み込み中…</p>
      </main>
    );
  }

  if (activeContractIds.length === 0) {
    return (
      <main className="app">
        <h1>稼働実績管理</h1>
        {error && <p className="error">{error}</p>}
        <p>まず取引先と委託件名を登録してください。</p>
        <button type="button" className="primary" onClick={() => setManaging(true)}>
          取引先・委託件名を登録
        </button>
        {managePanel}
      </main>
    );
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1>稼働実績管理</h1>
        <div className="header-controls">
          <select
            className="contract-select"
            value={contractId ?? ""}
            onChange={(e) => setContractId(Number(e.target.value))}
          >
            {activeClients
              .filter((c) => c.contracts.length > 0)
              .map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {c.contracts.map((ct) => (
                    <option key={ct.id} value={ct.id}>
                      {ct.project_name}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
          <button type="button" onClick={() => setManaging(true)}>
            取引先・委託件名の管理
          </button>
          <span className="spacer" />
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))}>
            ◀
          </button>
          <input
            className="month-field"
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
          />
          <button type="button" onClick={() => setMonth(shiftMonth(month, 1))}>
            ▶
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="summary">
        <div className="summary-item">
          <span className="summary-label">取引先</span>
          <strong>{data?.client.name ?? "-"}</strong>
        </div>
        <div className="summary-item">
          <span className="summary-label">委託件名</span>
          <strong>{data?.contract.project_name ?? "-"}</strong>
        </div>
        <div className="summary-item">
          <span className="summary-label">明細件数</span>
          <strong>{data?.entries.length ?? 0} 件</strong>
        </div>
        <div className="summary-item">
          <span className="summary-label">稼働時間計</span>
          <strong className="total">{formatDuration(totalMin)}</strong>
          <span className="sub">({(totalMin / 60).toFixed(2)} h)</span>
        </div>
        <a
          className="button primary"
          href={contractId !== null ? api.reportUrl(contractId, month) : "#"}
          download
        >
          Excel帳票をダウンロード
        </a>
      </section>

      <div className="layout">
        <div className="main-col">
          <EntryTable
            month={month}
            entries={data?.entries ?? []}
            onUpdate={(id, payload) => void run(() => api.updateEntry(id, payload))}
            onDelete={(id) => void run(() => api.deleteEntry(id))}
            onDuplicate={(e) =>
              void run(() =>
                api.addEntries(e.contract_id, {
                  work_date: e.work_date,
                  start_min: e.start_min,
                  end_min: e.end_min,
                  content: e.content,
                  location: e.location,
                }),
              )
            }
          />

          {contractId !== null && data && (
            <QuickAdd
              month={month}
              date={inputDate}
              onDateChange={setInputDate}
              suggestions={data.suggestions}
              defaultLocation={data.contract.default_location}
              lastEntry={lastEntry}
              onAdd={async (payload: EntryPayload) => {
                await api.addEntries(contractId, payload);
                await refresh();
              }}
            />
          )}
        </div>

        <aside className="side-col">
          <MonthCalendar
            month={month}
            entries={data?.entries ?? []}
            selected={inputDate}
            onSelect={setInputDate}
          />

          <div className="report-meta">
            <h2>帳票ヘッダ</h2>
            <label>
              提出日
              <input
                type="date"
                value={submittedOn}
                onChange={(e) => setSubmittedOn(e.target.value)}
                onBlur={() => void saveMeta()}
              />
            </label>
            <p className="hint">未設定なら出力時の当日が入ります。</p>
            <label>
              特記事項
              <textarea
                rows={4}
                value={specialNotes}
                onChange={(e) => setSpecialNotes(e.target.value)}
                onBlur={() => void saveMeta()}
              />
            </label>
            {savedAt && <p className="hint">最終保存 {savedAt}</p>}
          </div>
        </aside>
      </div>

      <datalist id="dl-contents">
        {(data?.suggestions.contents ?? []).map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="dl-locations">
        {(data?.suggestions.locations ?? []).map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>

      {managePanel}
    </main>
  );
}
