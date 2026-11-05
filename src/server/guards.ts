import * as db from "./db";
import { BadRequest, Locked, NotFound } from "./http";

export async function requireClient(dbi: D1Database, id: number) {
  const client = await db.getClient(dbi, id);
  if (!client) throw new NotFound("取引先が見つかりません");
  return client;
}

export async function requireContract(dbi: D1Database, id: number) {
  const contract = await db.getContract(dbi, id);
  if (!contract) throw new NotFound("委託件名が見つかりません");
  return contract;
}

export async function requireEntry(dbi: D1Database, id: number) {
  const entry = await db.getEntry(dbi, id);
  if (!entry) throw new NotFound("明細が見つかりません");
  return entry;
}

// 非表示(archived)のレコードは読み取りは許すが更新は拒否する。
// 過去帳票の再ダウンロードは非表示後も必要なため、読み取り側は塞がない。
export async function requireWritableClient(dbi: D1Database, id: number) {
  const client = await requireClient(dbi, id);
  if (client.archived) throw new BadRequest("非表示にした取引先は編集できません");
  return client;
}

export async function requireWritableContract(dbi: D1Database, id: number) {
  const contract = await requireContract(dbi, id);
  if (contract.archived) throw new BadRequest("非表示にした委託件名は編集できません");
  return contract;
}

/** 明細は id 直指定で来るため、属する委託件名を引いて同じ archived 判定を適用する。 */
export async function requireWritableEntry(dbi: D1Database, id: number) {
  const entry = await requireEntry(dbi, id);
  await requireWritableContract(dbi, entry.contract_id);
  return entry;
}

/**
 * 締め済みの月は更新を拒否する。提出済みの帳票が知らないうちに変わらないようにするための
 * 最終防衛線で、画面側の入力欄の抑止だけに頼らない。
 */
export async function requireUnlockedMonth(dbi: D1Database, contractId: number, month: string) {
  if (await db.isMonthLocked(dbi, contractId, month)) {
    throw new Locked(`${month} は締め済みです。変更するには締めを解除してください。`);
  }
}
