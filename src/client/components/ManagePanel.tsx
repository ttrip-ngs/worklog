import { useState } from "react";
import type { Client, ClientWithContracts, Contract } from "../../shared/types";
import type { ClientInput, ContractInput } from "../api";

/** パネルを開いた直後に表示する編集フォーム。null なら一覧のみ。 */
export type ManageEditing =
  | { kind: "client"; client?: Client }
  | { kind: "contract"; clientId: number; contract?: Contract }
  | null;

type Props = {
  clients: ClientWithContracts[];
  /** 報告者氏名の初期値(ログイン中のアカウント名)。取引先の新規追加時のみ使う。 */
  defaultReporter?: string;
  /** 開いた直後に表示する編集フォーム。呼び出し側が「次にやること」を指定する。 */
  initialEditing?: ManageEditing;
  onCreateClient: (input: ClientInput) => Promise<Client>;
  onUpdateClient: (id: number, input: ClientInput) => Promise<void>;
  onCreateContract: (clientId: number, input: ContractInput) => Promise<Contract>;
  onUpdateContract: (id: number, input: ContractInput) => Promise<void>;
  onSetClientArchived: (id: number, archived: boolean) => Promise<void>;
  onSetContractArchived: (id: number, archived: boolean) => Promise<void>;
  onClose: () => void;
};

function ClientFields({
  initial,
  defaultReporter,
  onSave,
  onCancel,
}: {
  initial?: Client;
  defaultReporter?: string;
  onSave: (input: ClientInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  // 新規追加のときだけログイン中のアカウント名を初期値に入れる。
  // 編集では保存済みの値をそのまま出す(空なら空のまま)。
  const [reporter, setReporter] = useState(initial ? initial.reporter_name : (defaultReporter ?? ""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return setError("取引先名は必須です");
    setBusy(true);
    setError("");
    try {
      await onSave({ name, reporter_name: reporter, sort_order: initial?.sort_order ?? 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
      setBusy(false);
    }
  };

  return (
    <div className="edit-form">
      <h3>{initial ? "取引先の編集" : "取引先の追加"}</h3>
      <label>
        取引先名
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label>
        報告者氏名(帳票に出力)
        <input value={reporter} onChange={(e) => setReporter(e.target.value)} />
      </label>
      {!initial && defaultReporter && (
        <p className="hint">
          ログイン中のアカウント名を初期値にしています。帳票に出す名前が違う場合は変更してください。
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="panel-actions">
        <button type="button" onClick={onCancel}>
          キャンセル
        </button>
        <button type="button" className="primary" onClick={() => void save()} disabled={busy}>
          保存
        </button>
      </div>
    </div>
  );
}

function ContractFields({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Contract;
  onSave: (input: ContractInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [projectName, setProjectName] = useState(initial?.project_name ?? "");
  const [location, setLocation] = useState(initial?.default_location ?? "");
  const [scope, setScope] = useState<string[]>(() =>
    [0, 1, 2, 3].map((i) => initial?.scope_items[i] ?? ""),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!projectName.trim()) return setError("委託件名は必須です");
    setBusy(true);
    setError("");
    try {
      await onSave({
        project_name: projectName,
        scope_items: scope.filter((s) => s.trim() !== ""),
        default_location: location,
        sort_order: initial?.sort_order ?? 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
      setBusy(false);
    }
  };

  return (
    <div className="edit-form">
      <h3>{initial ? "委託件名の編集" : "委託件名の追加"}</h3>
      <label>
        委託件名(帳票に出力)
        <input value={projectName} onChange={(e) => setProjectName(e.target.value)} autoFocus />
      </label>
      <fieldset>
        <legend>委託内容(最大4行・帳票に出力)</legend>
        {scope.map((s, i) => (
          <input
            key={i}
            value={s}
            placeholder={`${i + 1}行目`}
            onChange={(e) => setScope(scope.map((v, j) => (i === j ? e.target.value : v)))}
          />
        ))}
      </fieldset>
      <label>
        備考欄の既定値(作業場所)
        <input value={location} onChange={(e) => setLocation(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="panel-actions">
        <button type="button" onClick={onCancel}>
          キャンセル
        </button>
        <button type="button" className="primary" onClick={() => void save()} disabled={busy}>
          保存
        </button>
      </div>
    </div>
  );
}

/**
 * 非表示 / 再表示の切り替えボタン。非表示は2回押しで確定する。
 * 実績データは削除せず、選択肢から外すだけ。
 */
function ArchiveButton({
  archived,
  title,
  onToggle,
}: {
  archived: boolean;
  title: string;
  onToggle: (archived: boolean) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);

  if (archived) {
    return (
      <button type="button" onClick={() => void onToggle(false)}>
        再表示
      </button>
    );
  }
  if (!confirming) {
    return (
      <button type="button" title={title} onClick={() => setConfirming(true)}>
        非表示
      </button>
    );
  }
  return (
    <>
      <button type="button" className="danger" onClick={() => void onToggle(true)}>
        非表示にする
      </button>
      <button type="button" onClick={() => setConfirming(false)}>
        取消
      </button>
    </>
  );
}

/** 取引先と、その配下の委託件名をまとめて管理するパネル。 */
export function ManagePanel({
  clients,
  defaultReporter,
  initialEditing,
  onCreateClient,
  onUpdateClient,
  onCreateContract,
  onUpdateContract,
  onSetClientArchived,
  onSetContractArchived,
  onClose,
}: Props) {
  const hasArchived = clients.some(
    (c) => c.archived === 1 || c.contracts.some((ct) => ct.archived === 1),
  );
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ManageEditing>(initialEditing ?? null);
  const visibleClients = showArchived ? clients : clients.filter((c) => c.archived !== 1);

  return (
    <div className="overlay">
      <div className="panel">
        <div className="panel-head">
          <h2>取引先・委託件名の管理</h2>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>

        {clients.length === 0 && !editing && <p className="hint">まず取引先を登録してください。</p>}

        {hasArchived && (
          <label className="show-archived">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            非表示にしたものも表示する
          </label>
        )}

        <ul className="manage-tree">
          {visibleClients.map((c) => (
            <li key={c.id} className={c.archived === 1 ? "is-archived" : undefined}>
              <div className="manage-row">
                <span className="manage-name">
                  {c.name}
                  {c.archived === 1 && <span className="badge">非表示</span>}
                </span>
                <span className="manage-sub">報告者: {c.reporter_name || "(未設定)"}</span>
                <button
                  type="button"
                  onClick={() => setEditing({ kind: "client", client: c })}
                  disabled={c.archived === 1}
                >
                  編集
                </button>
                <ArchiveButton
                  archived={c.archived === 1}
                  title="この取引先と配下の委託件名すべてを選択肢から外す(実績データは残ります)"
                  onToggle={(a) => onSetClientArchived(c.id, a)}
                />
              </div>
              <ul className="manage-contracts">
                {c.contracts
                  .filter((ct) => showArchived || ct.archived !== 1)
                  .map((ct) => (
                  <li key={ct.id} className={`manage-row${ct.archived === 1 ? " is-archived" : ""}`}>
                    <span className="manage-name">
                      {ct.project_name}
                      {ct.archived === 1 && <span className="badge">非表示</span>}
                    </span>
                    <span className="manage-sub">{ct.scope_items.length} 行の委託内容</span>
                    <button
                      type="button"
                      onClick={() => setEditing({ kind: "contract", clientId: c.id, contract: ct })}
                      disabled={ct.archived === 1}
                    >
                      編集
                    </button>
                    <ArchiveButton
                      archived={ct.archived === 1}
                      title="この委託件名を選択肢から外す(実績データは残ります)"
                      onToggle={(a) => onSetContractArchived(ct.id, a)}
                    />
                  </li>
                ))}
                {c.archived !== 1 && (
                  <li>
                    <button type="button" onClick={() => setEditing({ kind: "contract", clientId: c.id })}>
                      ＋ 委託件名を追加
                    </button>
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ul>

        <button type="button" onClick={() => setEditing({ kind: "client" })}>
          ＋ 取引先を追加
        </button>

        {editing?.kind === "client" && (
          <ClientFields
            initial={editing.client}
            defaultReporter={defaultReporter}
            onCancel={() => setEditing(null)}
            onSave={async (input) => {
              if (editing.client) {
                await onUpdateClient(editing.client.id, input);
                setEditing(null);
                return;
              }
              // 取引先だけでは帳票を出せないため、続けて委託件名の入力に進む。
              const created = await onCreateClient(input);
              setEditing({ kind: "contract", clientId: created.id });
            }}
          />
        )}
        {editing?.kind === "contract" && (
          <ContractFields
            initial={editing.contract}
            onCancel={() => setEditing(null)}
            onSave={async (input) => {
              if (editing.contract) await onUpdateContract(editing.contract.id, input);
              else await onCreateContract(editing.clientId, input);
              setEditing(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
