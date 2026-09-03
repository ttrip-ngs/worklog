import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";
import type { SessionUser } from "../shared/types";

export type AppBindings = { Bindings: Env; Variables: { user: SessionUser } };

/**
 * 認証。プロト段階では wrangler.jsonc の DEV_AUTH_EMAIL による擬似ログインのみ。
 *
 * 本番は Google Workspace の OAuth (OIDC) に差し替える予定。
 * 差し替え箇所はこの関数だけで完結するようにしてある:
 *   1. /auth/login で Google の認可エンドポイントへリダイレクト
 *   2. /auth/callback で code を交換し、id_token の hd クレームを ALLOWED_HD と照合
 *   3. 署名付き Cookie にセッションを保存し、ここで検証する
 * 詳細は docs/design.md「認証」を参照。
 */
export function resolveUser(env: Env): SessionUser | null {
  if (env.DEV_AUTH_EMAIL) {
    return { email: env.DEV_AUTH_EMAIL, name: env.DEV_AUTH_NAME ?? env.DEV_AUTH_EMAIL };
  }
  return null;
}

export const requireUser: MiddlewareHandler<AppBindings> = async (c, next) => {
  const user = resolveUser(c.env);
  if (!user) {
    return c.json({ error: "未認証です。ローカル開発では wrangler.jsonc の DEV_AUTH_EMAIL を設定してください。" }, 401);
  }
  c.set("user", user);
  await next();
};
