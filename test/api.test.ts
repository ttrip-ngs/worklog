import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/server/index";
import { call, entry, json, resetDb, seedContract, testEnv } from "./helpers";

beforeEach(resetDb);

describe("認証と CSRF", () => {
  it("認証設定が無ければ 401 を返す(fail-closed)", async () => {
    const res = await call("GET", "/me", undefined, { DEV_AUTH_EMAIL: undefined });
    expect(res.status).toBe(401);
  });

  it("Access 有効時は JWT の無いリクエストを 401 にし、擬似ログインを見ない", async () => {
    const res = await call("GET", "/me", undefined, {
      ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
      ACCESS_AUD: "aud",
    });
    expect(res.status).toBe(401);
  });

  it("擬似ログインでは利用者情報を返す", async () => {
    expect(await json(call("GET", "/me"))).toEqual({ email: "tester@example.com", name: "テスト" });
  });

  it("更新系は Origin が無いと 403 を返す", async () => {
    const res = await app.request(
      "http://localhost/api/clients",
      { method: "POST", body: JSON.stringify({ name: "x" }) },
      testEnv(),
    );
    expect(res.status).toBe(403);
  });

  it("更新系は Origin が別オリジンだと 403 を返す", async () => {
    const res = await app.request(
      "http://localhost/api/clients",
      { method: "POST", headers: { Origin: "https://evil.example" }, body: JSON.stringify({ name: "x" }) },
      testEnv(),
    );
    expect(res.status).toBe(403);
  });

  it("未定義のパスは認証後に JSON の 404 を返す", async () => {
    const res = await call("GET", "/nope");
    expect(res.status).toBe(404);
    expect((await res.json()) as object).toHaveProperty("error");
    const unauth = await call("GET", "/nope", undefined, { DEV_AUTH_EMAIL: undefined });
    expect(unauth.status).toBe(401);
  });
});

describe("取引先", () => {
  it("単体取得は既定で非表示の委託件名を除き、include_archived=1 で含める", async () => {
    const { clientId, contractId } = await seedContract();
    await call("POST", `/contracts/${contractId}/archive`, { archived: true });

    const visible = await json(call("GET", `/clients/${clientId}`));
    expect(visible.name).toBe("架空商事");
    expect(visible.contracts).toEqual([]);

    const all = await json(call("GET", `/clients/${clientId}?include_archived=1`));
    expect(all.contracts.map((c: { id: number }) => c.id)).toEqual([contractId]);
  });

  it("存在しない id は 404、名前が空なら 400 を返す", async () => {
    expect((await call("GET", "/clients/999")).status).toBe(404);
    expect((await call("GET", "/clients/abc")).status).toBe(404);
    expect((await call("POST", "/clients", { name: "  " })).status).toBe(400);
  });

  it("非表示の取引先は読めるが更新や委託件名の追加はできず、再表示で戻る", async () => {
    const { clientId } = await seedContract();
    expect((await call("POST", `/clients/${clientId}/archive`)).status).toBe(204);

    expect((await call("GET", `/clients/${clientId}`)).status).toBe(200);
    expect((await call("PUT", `/clients/${clientId}`, { name: "変更" })).status).toBe(400);
    expect((await call("POST", `/clients/${clientId}/contracts`, { project_name: "新" })).status).toBe(400);
    expect(await json(call("GET", "/clients"))).toEqual([]);

    await call("POST", `/clients/${clientId}/archive`, { archived: false });
    expect((await call("PUT", `/clients/${clientId}`, { name: "変更" })).status).toBe(200);
  });
});

describe("委託件名", () => {
  it("単体取得で scope_items を配列として返す", async () => {
    const { contractId } = await seedContract();
    const contract = await json(call("GET", `/contracts/${contractId}`));
    expect(contract.scope_items).toEqual(["運用"]);
    expect((await call("GET", "/contracts/999")).status).toBe(404);
  });

  it("scope_items は空行を除いて先頭4件に切り詰める", async () => {
    const { clientId } = await seedContract();
    const created = await json(
      call("POST", `/clients/${clientId}/contracts`, {
        project_name: "別件",
        scope_items: ["a", " ", "b", "c", "d", "e"],
      }),
    );
    expect(created.scope_items).toEqual(["a", "b", "c", "d"]);
  });

  it("非表示の委託件名は読めるが更新できない", async () => {
    const { contractId } = await seedContract();
    await call("POST", `/contracts/${contractId}/archive`);
    expect((await call("GET", `/contracts/${contractId}`)).status).toBe(200);
    expect((await call("PUT", `/contracts/${contractId}`, { project_name: "変更" })).status).toBe(400);
  });
});

describe("明細", () => {
  it("登録・単体取得・更新・削除ができる", async () => {
    const { contractId } = await seedContract();
    const [created] = await json(call("POST", `/contracts/${contractId}/entries`, entry("2026-07-01")));
    expect(await json(call("GET", `/entries/${created.id}`))).toEqual(created);

    const updated = await json(
      call("PUT", `/entries/${created.id}`, entry("2026-07-02", { content: "変更" })),
    );
    expect(updated.content).toBe("変更");

    expect((await call("DELETE", `/entries/${created.id}`)).status).toBe(204);
    expect((await call("GET", `/entries/${created.id}`)).status).toBe(404);
  });

  it.each([
    ["実在しない日付", entry("2026-02-31")],
    ["開始が範囲外", entry("2026-07-01", { start_min: 1441 })],
    ["終了が開始以前", entry("2026-07-01", { start_min: 600, end_min: 600 })],
    ["終了が範囲外", entry("2026-07-01", { end_min: 2881 })],
    ["時刻が整数でない", entry("2026-07-01", { start_min: 1.5 })],
    ["null", null],
  ])("不正な入力は 400 を返す: %s", async (_label, body) => {
    const { contractId } = await seedContract();
    expect((await call("POST", `/contracts/${contractId}/entries`, body)).status).toBe(400);
  });

  it("日跨ぎの終了時刻を受け付ける", async () => {
    const { contractId } = await seedContract();
    const res = await call("POST", `/contracts/${contractId}/entries`, entry("2026-07-01", { end_min: 1500 }));
    expect(res.status).toBe(201);
  });

  it("一括登録は空配列と 101 件を拒否し、100 件まで受け付ける", async () => {
    const { contractId } = await seedContract();
    const path = `/contracts/${contractId}/entries`;
    expect((await call("POST", path, [])).status).toBe(400);
    expect((await call("POST", path, Array(101).fill(entry("2026-07-01")))).status).toBe(400);
    const created = await json(call("POST", path, Array(100).fill(entry("2026-07-01"))));
    expect(created).toHaveLength(100);
  });

  it("一括登録に不正な行があれば1件も登録しない", async () => {
    const { contractId } = await seedContract();
    const res = await call("POST", `/contracts/${contractId}/entries`, [
      entry("2026-07-01"),
      entry("2026-07-32"),
    ]);
    expect(res.status).toBe(400);
    expect(await json(call("GET", `/contracts/${contractId}/months`))).toEqual([]);
  });

  it("非表示の委託件名配下の明細は読めるが更新・削除できない", async () => {
    const { contractId } = await seedContract();
    const [created] = await json(call("POST", `/contracts/${contractId}/entries`, entry("2026-07-01")));
    await call("POST", `/contracts/${contractId}/archive`);

    expect((await call("GET", `/entries/${created.id}`)).status).toBe(200);
    expect((await call("POST", `/contracts/${contractId}/entries`, entry("2026-07-02"))).status).toBe(400);
    expect((await call("PUT", `/entries/${created.id}`, entry("2026-07-03"))).status).toBe(400);
    expect((await call("DELETE", `/entries/${created.id}`)).status).toBe(400);
  });
});

describe("月締め", () => {
  it("締めた月の明細とヘッダの変更を 409 で拒否し、解除で戻す", async () => {
    const { contractId } = await seedContract();
    const [e] = await json(call("POST", `/contracts/${contractId}/entries`, entry("2026-07-01")));
    const lock = `/contracts/${contractId}/months/2026-07/lock`;
    expect((await call("POST", lock)).status).toBe(200);

    expect((await call("POST", `/contracts/${contractId}/entries`, entry("2026-07-02"))).status).toBe(409);
    expect((await call("PUT", `/entries/${e.id}`, entry("2026-07-03"))).status).toBe(409);
    expect((await call("DELETE", `/entries/${e.id}`)).status).toBe(409);
    expect(
      (await call("PUT", `/contracts/${contractId}/months/2026-07/meta`, { special_notes: "x" })).status,
    ).toBe(409);

    await call("POST", lock, { locked: false });
    expect((await call("DELETE", `/entries/${e.id}`)).status).toBe(204);
  });

  it("明細の更新は移動元と移動先の両方の締めを確認する", async () => {
    const { contractId } = await seedContract();
    const [inJuly, inAugust] = await json(
      call("POST", `/contracts/${contractId}/entries`, [entry("2026-07-01"), entry("2026-08-01")]),
    );
    await call("POST", `/contracts/${contractId}/months/2026-07/lock`);

    // 締めた月から出す
    expect((await call("PUT", `/entries/${inJuly.id}`, entry("2026-08-02"))).status).toBe(409);
    // 締めた月へ入れる
    expect((await call("PUT", `/entries/${inAugust.id}`, entry("2026-07-02"))).status).toBe(409);
    // 未締めの月の中での変更は通る
    expect((await call("PUT", `/entries/${inAugust.id}`, entry("2026-08-02"))).status).toBe(200);
  });

  it("複数月にまたがる一括登録は、締めた月が1つでもあれば全件拒否する", async () => {
    const { contractId } = await seedContract();
    await call("POST", `/contracts/${contractId}/months/2026-08/lock`);
    const res = await call("POST", `/contracts/${contractId}/entries`, [
      entry("2026-07-01"),
      entry("2026-08-01"),
    ]);
    expect(res.status).toBe(409);
    const month = await json(call("GET", `/contracts/${contractId}/months/2026-07`));
    expect(month.entries).toEqual([]);
  });

  it("締めると提出日が確定し、再度締めても最初の記録を保つ", async () => {
    const { contractId } = await seedContract();
    const lock = `/contracts/${contractId}/months/2026-07/lock`;
    const first = await json(call("POST", lock));
    expect(first.submitted_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.locked_by).toBe("tester@example.com");

    const again = await json(call("POST", lock, undefined, { DEV_AUTH_EMAIL: "other@example.com" }));
    expect(again.locked_by).toBe("tester@example.com");
    expect(again.locked_at).toBe(first.locked_at);
  });

  it("解除しても提出日を残し、未締めの月の解除は冪等に成功する", async () => {
    const { contractId } = await seedContract();
    const lock = `/contracts/${contractId}/months/2026-07/lock`;
    const locked = await json(call("POST", lock));
    const unlocked = await json(call("POST", lock, { locked: false }));
    expect(unlocked.locked_at).toBeNull();
    expect(unlocked.submitted_on).toBe(locked.submitted_on);

    const untouched = await json(call("POST", `/contracts/${contractId}/months/2026-09/lock`, { locked: false }));
    expect(untouched.locked_at).toBeNull();
  });
});

describe("月次データ", () => {
  it("月一覧は明細かヘッダのある月を新しい順に集計して返す", async () => {
    const { contractId } = await seedContract();
    await call("POST", `/contracts/${contractId}/entries`, [
      entry("2026-06-01", { start_min: 540, end_min: 600 }),
      entry("2026-07-01", { start_min: 540, end_min: 600 }),
      entry("2026-07-02", { start_min: 600, end_min: 720 }),
    ]);
    await call("POST", `/contracts/${contractId}/months/2026-08/lock`);

    const months = await json(call("GET", `/contracts/${contractId}/months`));
    expect(months.map((m: { month: string }) => m.month)).toEqual(["2026-08", "2026-07", "2026-06"]);
    expect(months[0]).toMatchObject({ entry_count: 0, total_min: 0, locked_by: "tester@example.com" });
    expect(months[1]).toMatchObject({ entry_count: 2, total_min: 180, locked_at: null, locked_by: "" });
  });

  it("月一覧は他の委託件名の明細を含めず、存在しない委託件名は 404 を返す", async () => {
    const { clientId, contractId } = await seedContract();
    const other = await json(call("POST", `/clients/${clientId}/contracts`, { project_name: "別件" }));
    await call("POST", `/contracts/${other.id}/entries`, entry("2026-07-01"));
    await call("POST", `/contracts/${contractId}/entries`, entry("2026-07-01"));

    const months = await json(call("GET", `/contracts/${contractId}/months`));
    expect(months).toHaveLength(1);
    expect(months[0].entry_count).toBe(1);
    expect((await call("GET", "/contracts/999/months")).status).toBe(404);
  });

  it("月の形式が不正なら 400 を返す", async () => {
    const { contractId } = await seedContract();
    expect((await call("GET", `/contracts/${contractId}/months/2026-13`)).status).toBe(400);
  });

  it("帳票ヘッダは不正な提出日と JSON オブジェクト以外の body を 400 にする", async () => {
    const { contractId } = await seedContract();
    const path = `/contracts/${contractId}/months/2026-07/meta`;
    expect((await call("PUT", path, { submitted_on: "2026-02-31" })).status).toBe(400);
    expect((await call("PUT", path, null)).status).toBe(400);
    const saved = await json(call("PUT", path, { submitted_on: "2026-07-31", special_notes: "特記" }));
    expect(saved).toMatchObject({ submitted_on: "2026-07-31", special_notes: "特記" });
  });

  it("帳票は非表示や締めの後もダウンロードできる", async () => {
    const { contractId } = await seedContract();
    await call("POST", `/contracts/${contractId}/entries`, entry("2026-07-01"));
    await call("POST", `/contracts/${contractId}/months/2026-07/lock`);
    await call("POST", `/contracts/${contractId}/archive`);

    const res = await call("GET", `/contracts/${contractId}/months/2026-07/report.xlsx`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]); // zip のマジックナンバー
  });
});
