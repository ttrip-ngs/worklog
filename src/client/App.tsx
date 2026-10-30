import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientWithContracts, Entry, MonthResponse } from "../shared/types";
import { formatDuration, shiftMonth, sumDuration } from "../shared/time";
import { ApiError, api, type ClientInput, type ContractInput, type EntryPayload } from "./api";
import { EntryTable } from "./components/EntryTable";
import { QuickAdd } from "./components/QuickAdd";
import { MonthCalendar } from "./components/MonthCalendar";
import { ManagePanel } from "./components/ManagePanel";
import { MonthLock } from "./components/MonthLock";

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
  const quickAddRef = useRef<HTMLDivElement>(null);
  // 帳票ヘッダの保存(onBlur)は、締めるボタンのクリックより先に走る。締める前にこれを
  // 待たないと、保存が締めたあとに届いて 409 になり、入力した特記事項が消える。
  const pendingMetaRef = useRef<Promise<unknown> | null>(null);

  /**
   * カレンダーで日を選んだときの遷移。モバイルでは入力欄が画面上部・カレンダーが
   * 最下部にあり、選んだあと自力でスクロールし直すことになるため入力欄まで送る。
   */
  const selectDate = useCallback((d: string) => {
    setInputDate(d);
    if (window.matchMedia("(max-width: 720px)").matches) {
      quickAddRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

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
        // 409 = 別の画面で締められていた。画面はまだ編集できる見た目のままなので、
        // 締め済みの表示に追従させる(保存時刻は動かしたくないので refresh は使わない)。
        if (e instanceof ApiError && e.status === 409 && contractId !== null) {
          await loadMonth(contractId, month).catch(() => {});
        }
      }
    },
    [refresh, contractId, month, loadMonth],
  );

  const totalMin = useMemo(() => (data ? sumDuration(data.entries) : 0), [data]);
  // 締め済みの月は画面からも編集手段を消す(サーバ側でも 409 で拒否している)
  const locked = data?.meta.locked_at != null;
  const reportHref = contractId !== null ? api.reportUrl(contractId, month) : "#";
  const lastEntry: Entry | undefined = data?.entries[data.entries.length - 1];

  const setLocked = async (next: boolean) => {
    if (contractId === null) return;
    await pendingMetaRef.current;
    pendingMetaRef.current = null;
    await run(() => api.setMonthLocked(contractId, month, next));
  };

  const saveMeta = () => {
    if (contractId === null) return;
    const done = run(() =>
      api.saveMeta(contractId, month, {
        submitted_on: submittedOn || null,
        special_notes: specialNotes,
      }),
    );
    pendingMetaRef.current = done;
    return done;
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
          <button type="button" className="manage-button" onClick={() => setManaging(true)}>
            取引先・委託件名の管理
          </button>
          <span className="spacer" />
          <div className="month-nav">
            <button type="button" aria-label="前の月" onClick={() => setMonth(shiftMonth(month, -1))}>
              ◀
            </button>
            <input
              className="month-field"
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
            <button type="button" aria-label="次の月" onClick={() => setMonth(shiftMonth(month, 1))}>
              ▶
            </button>
          </div>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="summary">
        <div className="summary-item is-client">
          <span className="summary-label">取引先</span>
          <strong>{data?.client.name ?? "-"}</strong>
        </div>
        <div className="summary-item is-contract">
          <span className="summary-label">委託件名</span>
          <strong>{data?.contract.project_name ?? "-"}</strong>
        </div>
        {locked && (
          <div className="summary-item is-lock">
            <span className="summary-label">状態</span>
            <strong className="badge is-locked">締め済み</strong>
          </div>
        )}
        <div className="summary-item is-count">
          <span className="summary-label">明細件数</span>
          <strong>{data?.entries.length ?? 0} 件</strong>
        </div>
        <div className="summary-item is-total">
          <span className="summary-label">稼働時間計</span>
          <strong className="total">{formatDuration(totalMin)}</strong>
          <span className="sub">({(totalMin / 60).toFixed(2)} h)</span>
        </div>
        <a className="button primary summary-report" href={reportHref} download>
          Excel帳票をダウンロード
        </a>
      </section>

      <div className="layout">
        <div className="main-col">
          <EntryTable
            month={month}
            entries={data?.entries ?? []}
            locked={locked}
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

          {locked && (
            <p className="hint locked-note">
              この月は締め済みのため、明細の追加・変更はできません。修正が必要な場合は
              右の「締めを解除」から解除してください。
            </p>
          )}

          {contractId !== null && data && !locked && (
            <QuickAdd
              ref={quickAddRef}
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
            onSelect={selectDate}
          />

          <div className="report-meta">
            <h2>帳票ヘッダ</h2>
            <label>
              提出日
              <input
                type="date"
                value={submittedOn}
                disabled={locked}
                onChange={(e) => setSubmittedOn(e.target.value)}
                onBlur={() => void saveMeta()}
              />
            </label>
            <p className="hint">
              {locked ? "締めた時点の日付で確定しています。" : "未設定なら出力時の当日が入ります。"}
            </p>
            <label>
              特記事項
              <textarea
                rows={4}
                value={specialNotes}
                disabled={locked}
                onChange={(e) => setSpecialNotes(e.target.value)}
                onBlur={() => void saveMeta()}
              />
            </label>
            {savedAt && !locked && <p className="hint">最終保存 {savedAt}</p>}
            {/* key で月・委託件名ごとに作り直し、解除の確認状態を持ち越さないようにする */}
            {data && (
              <MonthLock
                key={`${contractId}-${month}`}
                month={month}
                meta={data.meta}
                onChange={(v) => void setLocked(v)}
              />
            )}
            {/* モバイルではサマリ側を隠し、こちらを出す(styles.css) */}
            <a className="button primary meta-report" href={reportHref} download>
              Excel帳票をダウンロード
            </a>
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
