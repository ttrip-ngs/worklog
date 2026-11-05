import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // 本番の Access 設定を打ち消し、テストごとに認証方式を明示できるようにする
      miniflare: { bindings: { ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "", ALLOWED_EMAILS: "" } },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
