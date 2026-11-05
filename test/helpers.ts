import { env } from "cloudflare:workers";
import schema from "../db/schema.sql?raw";
import app from "../src/server/index";
import type { Env } from "../src/server/env";

const ORIGIN = "http://localhost";

export const testEnv = (overrides: Partial<Env> = {}): Env => ({
  ...(env as unknown as Env),
  DEV_AUTH_EMAIL: "tester@example.com",
  DEV_AUTH_NAME: "テスト",
  ...overrides,
});

/** schema.sql は DROP -> CREATE なので、流し直すだけでテスト間の状態が消える。 */
export async function resetDb(): Promise<void> {
  const statements = schema
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  await testEnv().DB.batch(statements.map((s) => testEnv().DB.prepare(s)));
}

/** 画面と同じく同一オリジンの JSON リクエストとして API を呼ぶ。 */
export function call(method: string, path: string, body?: unknown, overrides: Partial<Env> = {}) {
  return app.request(
    `${ORIGIN}/api${path}`,
    {
      method,
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    testEnv(overrides),
  );
}

export async function json<T = any>(res: Response | Promise<Response>): Promise<T> {
  return (await (await res).json()) as T;
}

export const entry = (work_date: string, over: Record<string, unknown> = {}) => ({
  work_date,
  start_min: 540,
  end_min: 1080,
  content: "作業",
  location: "自宅",
  ...over,
});

/** 取引先と委託件名を1組作り、それぞれの id を返す。 */
export async function seedContract(): Promise<{ clientId: number; contractId: number }> {
  const client = await json(call("POST", "/clients", { name: "架空商事", reporter_name: "山田" }));
  const contract = await json(
    call("POST", `/clients/${client.id}/contracts`, { project_name: "保守", scope_items: ["運用"] }),
  );
  return { clientId: client.id, contractId: contract.id };
}
