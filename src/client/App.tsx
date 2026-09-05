import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClientWithContracts, Entry, MonthResponse, SessionUser } from "../shared/types";
import { formatDuration, shiftMonth, sumDuration } from "../shared/time";
import { api, type ClientInput, type ContractInput, type EntryPayload } from "./api";
import { EntryTable } from "./components/EntryTable";
import { QuickAdd } from "./components/QuickAdd";
import { MonthCalendar } from "./components/MonthCalendar";
import { ManagePanel, type ManageEditing } from "./components/ManagePanel";

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
  // 管理パネルを開いた直後に出すフォーム。「次にやること」を呼び出し側から指定する。
  const [manageIntent, setManageIntent] = useState<ManageEditing>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
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

  // DEV_AUTH_NAME 未設定だと name にメールアドレスが入る。帳票に出す報告者名としては
  // 使えないため、その場合は初期値を入れない。
  const loginName = user && user.name !== user.email ? user.name : "";

  const openManage = useCallback((intent: ManageEditing = null) => {
    setManageIntent(intent);
    setManaging(true);
  }, []);

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

  // 初回ロード。報告者の初期値にログイン名を使うため、/me が揃うまで画面を出さない
  // (先に出すと、名前が届く前に開いた取引先フォームで報告者が空のまま確定してしまう)。
  useEffect(() => {
    Promise.all([loadClients(), api.me()])
      .then(([, me]) => setUser(me))
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
      defaultReporter={loginName || undefined}
      initialEditing={manageIntent}
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

  const userBadge = user && (
    <span className="user-badge" title={user.email}>
      <span className="user-name">{user.name}</span>
      <span className="user-email">{user.email}</span>
    </span>
  );

  const appHeader = (
    <header className="app-header">
      <h1>稼働実績管理</h1>
      <span className="spacer" />
      {userBadge}
    </header>
  );

  // 読み込みに失敗したときは中身が空なのか取れていないのか区別できない。
  // 「まだ登録が無い」前提の案内を出すとかえって誤解させるため、エラーだけを見せる。
  if (error && clients.length === 0) {
    return (
      <main className="app">
        {appHeader}
        <p className="error">{error}</p>
      </main>
    );
  }

  // 選べる委託件名が1つも無いときは通常画面に出すものが何も無いため、
  // 「今どういう状態で、次に何をすればよいか」を説明する画面に切り替える。
  // 管理パネルは両方の画面で同じ位置に置く。位置がずれると画面の切り替わりで
  // 再マウントされ、開いていた編集フォームが initialEditing に巻き戻ってしまう。
  const onboarding = (() => {
    // 非表示にした / 取引先だけある / まっさらの3状態で、案内する内容が変わる。
    // 選べる委託件名が0件のこの分岐では、存在する委託件名はすべて非表示のもの。
    // 1チェックで元に戻せるため、新規登録より先に再表示を案内する。
    const hasHidden = clients.some((c) => c.archived === 1 || c.contracts.length > 0);
    // 委託件名を1件も持たない(非表示のものも無い)取引先。ここに1件足せば使い始められる。
    const clientWithoutContract = clients.find((c) => c.archived !== 1 && c.contracts.length === 0);

    return (
      <>
        {appHeader}

        {error && <p className="error">{error}</p>}

        <section className="onboarding">
          <p className="onboarding-lead">
            日々の稼働実績を記録して、取引先に提出する「業務日報」の Excel を出力するツールです。
            帳票は<strong>委託件名 × 月</strong>で1枚出力します。
          </p>

          <div className="onboarding-flow">
            <span className="flow-item">
              取引先<em>会社</em>
            </span>
            <span className="flow-arrow" aria-hidden="true">
              ▸
            </span>
            <span className="flow-item">
              委託件名<em>契約単位・帳票1枚に対応</em>
            </span>
            <span className="flow-arrow" aria-hidden="true">
              ▸
            </span>
            <span className="flow-item">
              稼働実績<em>日ごとの明細</em>
            </span>
          </div>

          {hasHidden ? (
            <>
              <p className="onboarding-status">
                いま選べる委託件名がありません。非表示にした取引先・委託件名が残っているため、
                管理画面で「非表示にしたものも表示する」にチェックを入れて再表示すれば元に戻せます
                (実績データは消えていません)。
              </p>
              <button type="button" className="primary" onClick={() => openManage()}>
                取引先・委託件名の管理を開く
              </button>
            </>
          ) : clientWithoutContract ? (
            <>
              <p className="onboarding-status">
                取引先「{clientWithoutContract.name}」は登録済みです。あと1ステップ、
                帳票の単位になる委託件名を登録すると稼働実績を入力できます。
              </p>
              <button
                type="button"
                className="primary"
                onClick={() => openManage({ kind: "contract", clientId: clientWithoutContract.id })}
              >
                「{clientWithoutContract.name}」に委託件名を登録
              </button>
            </>
          ) : (
            <>
              <ol className="onboarding-steps">
                <li>
                  <span className="step-title">取引先を登録する</span>
                  <span className="step-desc">
                    会社名と、帳票に出力する報告者氏名。報告者は
                    {loginName ? `ログイン中の「${loginName}」` : "ログイン中のアカウント名"}
                    を初期値にします(取引先ごとに後から変更できます)。
                  </span>
                </li>
                <li>
                  <span className="step-title">委託件名を登録する</span>
                  <span className="step-desc">
                    帳票ヘッダに出る委託件名・委託内容(最大4行)・備考欄の既定値。
                    1つの取引先に複数登録でき、それぞれ別の帳票になります。
                  </span>
                </li>
                <li>
                  <span className="step-title">稼働実績を入力する</span>
                  <span className="step-desc">
                    日付・開始/終了時刻・業務内容を追加すると、その月の Excel 帳票を
                    ダウンロードできるようになります。
                  </span>
                </li>
              </ol>
              <button type="button" className="primary" onClick={() => openManage({ kind: "client" })}>
                取引先を登録して始める
              </button>
            </>
          )}
        </section>
      </>
    );
  })();

  const workspace = (
    <>
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
          <button type="button" onClick={() => openManage()}>
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
          {userBadge}
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
    </>
  );

  return (
    <main className="app">
      {activeContractIds.length === 0 ? onboarding : workspace}
      {managePanel}
    </main>
  );
}
