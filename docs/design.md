# 設計メモ

## 1. スコープ

プロト段階の目的は「ローカルで実運用に近い形で試せること」。以下を満たす。

- 日単位の稼働実績を蓄積できる
- 複数取引先を切り替えられる
- 既存 Excel と同じ帳票を出力できる
- 将来 Cloudflare (Workers + D1) にそのまま載せられる構成である

未実装(意図的に後回し):複数ユーザーのデータ分離。認証は Cloudflare Access で実装済み(4章)。

## 2. データモデル

```
clients (取引先 = 会社)
  id, name, reporter_name(報告者), sort_order, archived

contracts (委託件名 = 委託契約)  ... 1取引先に N件
  id, client_id, project_name(委託件名), scope_items(委託内容 JSON配列),
  default_location(備考の既定値), sort_order, archived

entries (稼働実績。1日に複数明細可)
  id, contract_id, work_date(YYYY-MM-DD), start_min, end_min, content, location

report_meta (月次帳票のヘッダ)
  contract_id, month(YYYY-MM), submitted_on, special_notes
```

帳票は「委託件名 × 月」で1枚。同じ取引先から複数案件を受託しても、案件ごとに別の日報を
出せる。報告者は案件ではなく人に紐づく情報のため `clients` 側に置いている。

論理削除(`archived`)のみで物理削除は用意していない。実績データを消さずに一覧から
外せれば、誤登録のリカバリとしては足りるため。非表示は「取引先・委託件名の管理」から
再表示できる。

非表示にしたレコードは**読み取りは可能、更新は拒否**する(`requireWritableClient` /
`requireWritableContract`)。過去帳票の再ダウンロードは非表示後も必要なため読み取りは
塞がず、一方で「非表示の取引先の下に新しい委託件名を作る」といった、どの一覧にも
現れないレコードが生まれる経路を防いでいる。

取引先を非表示にしても配下の委託件名の `archived` は変更しない。取引先を再表示すれば
配下もそのまま戻るほうが直感的なため。

### 時刻を「分」で持つ理由

元 Excel は終了時刻 24:00 を `1.0`(=翌0:00)として保持している。SQLite の TIME 型や
`HH:MM` 文字列では 24:00 を表現できないため、**0:00 からの経過分**を整数で持つ。

- `1440` = 24:00
- `1440` 超 = 日跨ぎ(例 `1500` = 翌 1:00)。Excel 側も `1.041666…` として素直に表現できる
- 稼働時間は単純に `end_min - start_min`(元 Excel の `=G-D` と同じ定義。休憩は明細を分けて表現)

### 1日複数明細

元ファイルの 2026-07-11 のように「午前:定例打ち合わせ / 午後:作業」と分けて記録する運用が
あるため、`(client_id, work_date)` に一意制約は付けない。

## 3. 帳票生成

`src/server/xlsx/report.ts`。

以下で「元ファイル」と呼ぶ既存の業務日報 xlsx は実在の取引先情報を含むため、
`reference/` ごと git 管理外に置いている(`styles.xml` / `theme1.xml` は
取引先情報を含まないため、テンプレートとしてリポジトリに含めている)。

### 方式

元ファイルをテンプレートとして穴埋めする方式ではなく、**`styles.xml` / `theme1.xml` を
そのまま流用しつつ `sheet1.xml` を生成する**方式を採る。

- 穴埋め方式だと明細が19行固定になり、31日分を書けない
- スタイル定義を丸ごと再利用すれば、罫線・網掛け・フォント・列幅・印刷設定は完全に一致する
- 生成側はスタイルID(`s="30"` など)を並べるだけでよい

元ファイルから読み取ったスタイルIDの対応:

| 位置 | 奇数行 | 偶数行 |
| --- | --- | --- |
| 年月日 (A:C) | 30 | 14 |
| 開始 (D:F) | 39 | 17 |
| 終了 (G:I) | 39 | 20 |
| 稼働時間 (J:L) | 33 | 20 |
| 業務内容 (O:AA) | 11 | 26 |
| 備考 (AB:AH) | 11 | 26 |

### レイアウト

- 1〜15行: ヘッダ(提出日 / タイトル / 報告者・期間・稼働時間計 / 委託件名 / 委託内容 / 明細見出し)
- 16行〜: 明細。件数が19未満なら空行で埋めて元ファイルと同じ見た目にする
- 明細の後: 空行 → 特記事項ラベル → 特記事項欄(3行結合)

行数に応じて `dimension` / `mergeCells` / `SUM(J16:L…)` の範囲を再計算する。

### 文字列の扱い

`sharedStrings.xml` は使わず `t="inlineStr"` で直接埋め込む。元ファイルにはふりがな
(`<rPh>`)が混ざっており、共有文字列を引き継ぐと不要なふりがなまで持ち込むため。

### 印刷設定

元ファイルは `fitToPage` で1ページに収める設定。明細が既定の19行を超える月は
`fitToHeight="0"` を付けて縦フィットを外し、極端な縮小で判読できなくなるのを防いでいる
(幅は1ページに収めたまま)。2ページ目以降に見出し行は繰り返されない。

### 既知の差異

- 元ファイルは稼働時間の数式に共有数式 `<f t="shared">` を使っている。生成側は各行に
  `G{n}-D{n}` を明示的に書く(計算結果は同一)
- 元ファイル Z5 セルは「自」ではなく「時」になっている(原本の誤字)。見た目を変えないため
  そのまま踏襲している。修正する場合は `report.ts` の該当箇所1行を変えるだけでよい
- `printerSettings1.bin`(プリンタ固有設定)は引き継いでいない。用紙・倍率・余白は
  `pageSetup` / `pageMargins` で再現済み

### 検証

`scripts/compare-xlsx.py` で元ファイルと生成物をセル単位で比較する。2026-07 のデータでは
値・スタイルID・結合セルがすべて一致し、macOS の Quick Look でレンダリングした画像も
バイト単位で一致することを確認済み。

## 4. 認証

`src/server/auth.ts` の `resolveUser()` が認証の差し替え点。本番は **Cloudflare Access**
(Zero Trust) をアプリの手前に置き、Worker 側は Access が付与する JWT を検証する。

### なぜ Cloudflare Access か

当初は Google Workspace の OAuth を自前実装する想定だったが、次の理由で Access に変えた。

- ログイン画面・セッション管理・IdP 連携を Cloudflare 側が持つ。クライアントシークレットを
  自分で保管しなくてよい
- 認証は Worker の手前で終わるため、静的アセット(index.html / JS / CSS)も同時に保護される。
  自前実装だと Worker のコードに到達する前のアセット配信を塞げない
- IdP は Google Workspace でもワンタイム PIN でも選べる。実装は変わらない

### 実装

`ACCESS_TEAM_DOMAIN` と `ACCESS_AUD` が**両方**設定されているときだけ Access モードになる。

1. Access が認証済みリクエストに `Cf-Access-Jwt-Assertion` ヘッダを付ける
2. `resolveAccessUser()` が `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` の
   JWKS で署名を検証し、`iss` と `aud` を照合する
3. `email` クレームをセッションユーザーとして返す

ヘッダの存在だけを信用しない。Access を経由しない経路や偽装ヘッダで素通しになるため、
署名・`iss`・`aud` を必ず検証する。`ALLOWED_EMAILS` を設定すると、Access ポリシーの
設定ミスに対する二重の防御として Worker 側でもメールを照合する。

`ctx.access` API は使っていない。静的アセットを使う Worker では内部ルータが `ctx.access` を
ユーザ Worker へ伝播しないため(Cloudflare ドキュメント「ctx.access limitations」)。

### 擬似ログインとの関係

`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` が欠けている場合のみ `.dev.vars` の `DEV_AUTH_EMAIL` に
フォールバックする。どちらも無ければ 401(fail-closed)。

Access モードのときは擬似ログインを**一切見ない**。本番に `DEV_AUTH_EMAIL` が紛れ込んでも
認証を素通りさせないため。逆にローカルでは `.dev.vars` で `ACCESS_TEAM_DOMAIN=` と
`ACCESS_AUD=` を空にして、`wrangler.jsonc` の `vars` を打ち消す(`.dev.vars` が優先される)。

### CSRF 対策

Access のセッションは Cookie で維持されるため、他サイトからのフォーム送信でも Cloudflare 側の
認証は通ってしまう。`requireUser` は GET / HEAD 以外で `Origin` ヘッダを検証し、リクエスト
URL のオリジンと一致しないもの(ヘッダが無いものも含む)を 403 で弾く。

### 認可(データ分離)は別作業

`resolveUser()` で分かるのは「誰がアクセスしているか」までで、「誰のデータか」は別途対応が
必要。現状は次の理由で単一ユーザー前提になっている。

- `clients` に所有者カラムがない
- `PUT /entries/:id` / `DELETE /entries/:id` は id 直指定で所有チェックがない

Access ポリシーを自分のメールアドレス1件に絞っている限り問題にならない。複数ユーザーで使う
場合は `clients` に所有者(またはメンバー表)を追加し、`src/server/db.ts` の各クエリに
スコープ条件を足す必要がある。

### デプロイ前に必要な差し替え

`wrangler.jsonc` の以下は `TODO` のままではデプロイできない / 認証が機能しない。

| 項目 | 取得方法 |
| --- | --- |
| `routes[0].pattern` | 公開する独自ドメインのホスト名 |
| `vars.ACCESS_TEAM_DOMAIN` | Zero Trust ダッシュボードの `<team>.cloudflareaccess.com` |
| `vars.ACCESS_AUD` | Zero Trust > Access > Applications > 当該アプリの Audience タグ |
| `d1_databases[0].database_id` | `wrangler d1 create worklog-db` の出力 |

`ACCESS_*` が誤った値でも JWT 検証に失敗して 401 になるだけで、素通しにはならない。

## 5. Workers の静的アセットと API のルーティング

`wrangler.jsonc` の `assets` は SPA 用に `not_found_handling: "single-page-application"` を
指定している。この設定だけだと、アセットルータがナビゲーション要求
(`Sec-Fetch-Dest: document`)を横取りして index.html を返してしまい、`<a download>` に
よる帳票ダウンロードが「中身が HTML の .xlsx」になる。

そのため `"run_worker_first": ["/api/*"]` を指定し、`/api/*` はアセットより先に Worker へ
渡している。SPA フォールバックは `/api/*` 以外にのみ効く。

## 6. コストとホスティング

- Workers: 無料枠 10万リクエスト/日
- D1: 無料枠 5GB / 500万行読み取り/日
- 静的アセット: Workers Static Assets(無料)

個人利用の稼働実績管理であれば無料枠に収まる。

## 7. 今後の候補

- 取引先ごとの帳票テンプレート差し替え(現在は1種類のみ)
- 月次締めのロック(提出済みの月を編集不可にする)
- CSV 取り込み / カレンダー連携
