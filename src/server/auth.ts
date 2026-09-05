import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";
import type { SessionUser } from "../shared/types";

export type AppBindings = { Bindings: Env; Variables: { user: SessionUser } };

const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";

// JWKS の取得結果は jose 側でキャッシュされる。isolate ごとに1つ作れば十分なため使い回す。
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksTeamDomain: string | undefined;

function getJwks(teamDomain: string) {
  if (!jwks || jwksTeamDomain !== teamDomain) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksTeamDomain = teamDomain;
  }
  return jwks;
}

function isAllowedEmail(env: Env, email: string): boolean {
  if (!env.ALLOWED_EMAILS) return true;
  const allowed = env.ALLOWED_EMAILS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allowed.length === 0 || allowed.includes(email.toLowerCase());
}

/**
 * Cloudflare Access が付与する JWT を検証する。
 *
 * Access はアプリの手前で認証を行い、通過したリクエストに Cf-Access-Jwt-Assertion を付ける。
 * ヘッダの存在だけを信用すると、Access を経由しない経路(別ルート・偽装ヘッダ)で素通しになるため、
 * 署名・iss・aud を必ず検証する。
 *
 * 静的アセットを使う Worker では新しい ctx.access API が伝播しないため、JWT を自前で検証している
 * (Cloudflare のドキュメント「ctx.access limitations」参照)。
 */
async function resolveAccessUser(req: Request, env: Env): Promise<SessionUser | null> {
  const token = req.headers.get(ACCESS_JWT_HEADER);
  if (!token) return null;

  const teamDomain = env.ACCESS_TEAM_DOMAIN!;
  try {
    const { payload } = await jwtVerify(token, getJwks(teamDomain), {
      issuer: `https://${teamDomain}`,
      audience: env.ACCESS_AUD,
    });
    const email = typeof payload.email === "string" ? payload.email : "";
    if (!email || !isAllowedEmail(env, email)) return null;
    const name = typeof payload.name === "string" && payload.name ? payload.name : email;
    return { email, name };
  } catch (err) {
    console.error("Access JWT の検証に失敗しました", err);
    return null;
  }
}

/**
 * 認証。ACCESS_TEAM_DOMAIN と ACCESS_AUD が両方設定されていれば Cloudflare Access、
 * どちらか欠けていればローカルの擬似ログイン(.dev.vars の DEV_AUTH_EMAIL)にフォールバックする。
 * どちらも無ければ null を返し、API は 401 になる(fail-closed)。
 *
 * Access が有効なときは擬似ログインを一切見ない。本番に DEV_AUTH_EMAIL が紛れ込んでも
 * 認証を素通りさせないため。
 */
export async function resolveUser(req: Request, env: Env): Promise<SessionUser | null> {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    return resolveAccessUser(req, env);
  }
  if (env.DEV_AUTH_EMAIL) {
    return { email: env.DEV_AUTH_EMAIL, name: env.DEV_AUTH_NAME ?? env.DEV_AUTH_EMAIL };
  }
  return null;
}

/**
 * 更新系リクエストの Origin を検証する (CSRF 対策)。
 *
 * Access のセッションは Cookie で維持されるため、他サイトからのフォーム送信でも
 * Cloudflare 側の認証は通ってしまう。同一オリジンからの fetch には Origin が必ず付くので、
 * 一致しないものを弾く。
 */
function hasValidOrigin(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.get("Origin");
  if (!origin) return false;
  return origin === new URL(req.url).origin;
}

export const requireUser: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!hasValidOrigin(c.req.raw)) {
    return c.json({ error: "リクエスト元が不正です" }, 403);
  }
  const user = await resolveUser(c.req.raw, c.env);
  if (!user) {
    return c.json(
      { error: "未認証です。ページを再読み込みしてログインし直してください。" },
      401,
    );
  }
  c.set("user", user);
  await next();
};
