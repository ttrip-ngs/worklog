export type Env = {
  DB: D1Database;
  /**
   * 本番の認証。Cloudflare Access のチーム(Zero Trust)ドメインと、
   * Access アプリケーションの Audience (AUD) タグ。
   * 両方が設定されているときだけ Access の JWT 検証が有効になる。
   * どちらも秘密情報ではないため wrangler.jsonc の vars に置く。
   */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /**
   * 追加のメール制限(カンマ区切り)。Access 側のポリシーで絞るのが本筋だが、
   * ポリシーの設定ミスに対する二重の防御として Worker 側でも照合する。未設定なら照合しない。
   */
  ALLOWED_EMAILS?: string;
  /** ローカル開発用の擬似ログイン。本番では未設定にする(.dev.vars に置く)。 */
  DEV_AUTH_EMAIL?: string;
  DEV_AUTH_NAME?: string;
};
