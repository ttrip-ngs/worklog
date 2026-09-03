export type Env = {
  DB: D1Database;
  /** ローカルプロト用の擬似ログイン。本番では未設定にする。 */
  DEV_AUTH_EMAIL?: string;
  DEV_AUTH_NAME?: string;
  /** Google Workspace のドメイン制限(本番の OAuth 実装で使用予定)。 */
  ALLOWED_HD?: string;
};
