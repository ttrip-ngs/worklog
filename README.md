# 稼働実績管理ツール (worklog)

業務委託の稼働実績を日単位で蓄積し、取引先へ提出する「業務日報」Excel を出力するツール。
手元の既存 Excel 帳票とレイアウト・書式が一致する xlsx を生成する。

元帳票 (`reference/` 配下) は実在の取引先情報を含むため git 管理外。`db/seed.sql` に
入っているのは動作確認用の架空データで、実在の取引先・案件とは無関係。

## 構成

| レイヤ | 採用技術 | 備考 |
| --- | --- | --- |
| フロントエンド | React 19 + Vite | SPA。追加の UI ライブラリなし |
| API | Hono (Cloudflare Workers) | `src/server/` |
| DB | Cloudflare D1 (SQLite) | ローカルは miniflare の D1 を使用 |
| 帳票生成 | 自前 (fflate + OOXML 生成) | 元 Excel の `styles.xml` / `theme1.xml` を流用 |
| 認証 | Cloudflare Access (Zero Trust) | Worker 側は JWT を検証。ローカルは擬似ログイン |

Cloudflare Workers + D1 のみで動くため、無料枠の範囲でホスティングできる。

## ローカルでの起動

```bash
npm install
cp .dev.vars.example .dev.vars   # ローカルの擬似ログイン設定(git 管理外)
npm run db:init    # スキーマ作成 (.wrangler/state 配下のローカル D1)
npm run db:seed    # 架空のサンプルデータ (2026-07) を投入
npm run dev        # http://localhost:5173
```

`.dev.vars` の `DEV_AUTH_EMAIL` が未設定だと API は 401 を返す。この値は絶対に
`wrangler.jsonc` の `vars` に書かないこと(deploy でそのまま本番に載る)。

`.dev.vars.example` には `ACCESS_TEAM_DOMAIN=` / `ACCESS_AUD=` の空指定が入っている。
`wrangler.jsonc` の本番 Access 設定を打ち消して擬似ログインを有効にするためのもので、
消すとローカルでも 401 になる。

`npm run db:reset` でスキーマ再作成 + 初期データ再投入。

### 初期データの作り直し

手元の実データから作り直す場合:

```bash
python3 scripts/extract-seed.py reference/<既存の日報>.xlsx "<取引先名>" > db/seed.sql
```

出力には取引先名・報告者名・稼働実績がそのまま入るため、コミットしないこと。

## Cloudflare へのデプロイ

認証は Cloudflare Access (Zero Trust) に任せ、Worker 側は Access が付与する JWT を検証する。
詳細は [docs/design.md](docs/design.md) の「認証」を参照。

### 1. ログインと D1 の作成

```bash
npx wrangler login
npx wrangler d1 create worklog-db      # 出力された database_id を控える
```

### 2. Access アプリケーションを作る

Zero Trust ダッシュボード > Access > Applications で、公開する独自ドメインのホスト名に対する
Self-hosted アプリケーションを作成し、ポリシーを自分のメールアドレスに絞る。作成後の
Overview に表示される **Audience (AUD) タグ** を控える。チームドメイン
(`<team>.cloudflareaccess.com`) も控える。

### 3. wrangler.jsonc の TODO を差し替える

| 項目 | 入れる値 |
| --- | --- |
| `routes[0].pattern` | 公開する独自ドメインのホスト名 |
| `vars.ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` |
| `vars.ACCESS_AUD` | Access アプリの Audience タグ |
| `vars.ALLOWED_EMAILS` | (任意) 許可するメール。カンマ区切り |
| `d1_databases[0].database_id` | 手順1で控えた ID |

`database_id` を変えるとローカル D1 も別ファイルに切り替わるため、`npm run db:reset` で
作り直す。

### 4. 本番 D1 にスキーマを流してデプロイ

```bash
npm run db:init:remote   # 破壊的: DROP TABLE を含む。初回のみ実行すること
npm run deploy
```

`db/seed.sql` は架空の動作確認用データなので本番には投入しない。

### 既に運用中の D1 を更新する場合

`db/schema.sql` は `DROP TABLE` を含むため、データが入った D1 には流せない。既存 DB への
列追加は `db/migrations/` の追加専用ファイルで行う。

```bash
npm run db:migrate:remote   # 現在は 0001_report_meta_lock.sql (月締めの列を追加)
npm run deploy
```

新規に `db/schema.sql` から作った DB には同じ列が既にあるため、流す必要はない
(流すと `duplicate column name` で失敗する)。

順序は **マイグレーション → デプロイ**。旧コードは列名を明示して SELECT / RETURNING して
いるため、列が増えても壊れない。逆順にすると、新コードが存在しない `locked_at` を
SELECT して月データの取得が 500 になり、画面全体が使えなくなる。

### 5. デプロイ後の確認

```bash
# 未認証のリクエストが弾かれること (Access のログイン画面へリダイレクト、または 401)
curl -s -o /dev/null -w "%{http_code}\n" https://<ホスト名>/api/me

# ブラウザでログインし、帳票が xlsx としてダウンロードされること
# (HTML が返る場合は wrangler.jsonc の run_worker_first を確認)
```


## 主なコマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | Vite + Workers ランタイムの開発サーバ |
| `npm run build` | 本番ビルド |
| `npm run typecheck` | クライアント / Worker 双方の型チェック |
| `npm run db:reset` | ローカル D1 の初期化 |
| `npm run db:migrate` | ローカル D1 に追加マイグレーションを適用 |
| `npm run db:migrate:remote` | 本番 D1 に追加マイグレーションを適用 |
| `npm run deploy` | ビルドして Cloudflare へデプロイ |
| `npm run db:init:remote` | 本番 D1 にスキーマを流す(破壊的) |

## 帳票の検証

生成した xlsx が元ファイルと一致するかを比較する開発用ツール。元帳票は git 管理外の
ため、手元に置いたファイルを指定する:

```bash
curl -s -o ./tmp/out.xlsx "http://localhost:5173/api/contracts/1/months/2026-07/report.xlsx"
python3 scripts/compare-xlsx.py reference/<既存の日報>.xlsx ./tmp/out.xlsx
```

元帳票と同じ月のデータでは、セル値・スタイルID・結合セルがすべて一致する
(元ファイル側が共有数式 `<f t="shared">` を使っている行だけ、数式文字列の表現差が出る)。

## データモデル

```
取引先 (clients)  ─┬─ 委託件名 (contracts) ─┬─ 稼働実績 (entries)
                   │                         └─ 月次帳票ヘッダ (report_meta)
                   └─ 委託件名 (contracts) ─ ...
```

1つの取引先に複数の委託件名を登録でき、帳票は「委託件名 × 月」で1枚出力する。
取引先・委託件名の追加/編集/非表示は、画面上部の「取引先・委託件名の管理」から行う。

## 月締め

提出した月をあとから気付かずに書き換えないための機能。画面右の「帳票ヘッダ」にある
**「この月を締める」**で、表示中の委託件名 × 月を締める。

- 締めた月は明細の追加・変更・削除と、提出日・特記事項の変更ができなくなる
  (画面から操作を消すだけでなく、サーバも 409 で拒否する)
- 締めた時点で提出日が確定する。未設定のままだと、ダウンロードのたびに帳票の提出日が
  その日の日付に変わってしまうため
- 帳票のダウンロードと閲覧は締めたあとも従来どおり
- 修正が必要になったら「締めを解除」から戻せる。誤操作を防ぐため2段階の確認を挟む

## 入力補助

- 時刻は `9` / `930` / `9:3` / `2400` / `翌1:00` などを解釈して `HH:MM` に正規化
- 業務内容・備考は過去実績からの候補 (datalist)
- よく使う時間帯をワンクリックで適用、直近明細のコピー、行の複製
- 追加すると日付が自動で翌日へ送られる
- 月カレンダーで入力済みの日と日別稼働時間を一覧
- 取引先の新規追加では、報告者氏名にログイン中のアカウント名が初期値として入る(後から変更可)

## ドキュメント

- [docs/design.md](docs/design.md) — データモデル、帳票生成の仕組み、認証の実装方針
