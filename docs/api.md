# API リファレンス

稼働実績管理ツールの HTTP API。実装は `src/server/routes/`、型は `src/shared/types.ts`。
すべて `/api` 配下で、リクエスト・レスポンスとも JSON(帳票のみ xlsx)。

## 認証

`requireUser` がすべてのエンドポイントに適用される。詳細は
[design.md の「認証」](design.md#4-認証) を参照。

| 環境 | 方式 |
| --- | --- |
| 本番 | Cloudflare Access。Worker が `Cf-Access-Jwt-Assertion` の署名・`iss`・`aud` を検証する |
| ローカル | `.dev.vars` の `DEV_AUTH_EMAIL` による擬似ログイン |

GET / HEAD 以外は `Origin` ヘッダがリクエスト URL のオリジンと一致する必要がある(CSRF 対策)。
そのため現状の API は画面からの利用を前提としており、本番ではスクリプトや CLI から更新系を
呼ぶ経路はない。

## エラー

エラーはすべて `{ "error": "<日本語のメッセージ>" }` の形で返す。

| 状態コード | 意味 |
| --- | --- |
| 400 | 入力が不正。非表示(archived)のレコードへの更新もここに含む |
| 401 | 未認証 |
| 403 | `Origin` が不正 |
| 404 | 対象または API が存在しない。id の形式が不正な場合も含む |
| 409 | 締め済みの月への更新 |
| 500 | サーバエラー |

## エンドポイント

| メソッド | パス | 内容 | 成功時 |
| --- | --- | --- | --- |
| GET | `/me` | ログイン中のユーザー | 200 `SessionUser` |
| GET | `/clients` | 取引先と配下の委託件名の一覧 | 200 `ClientWithContracts[]` |
| POST | `/clients` | 取引先の追加 | 201 `Client` |
| GET | `/clients/:id` | 取引先と配下の委託件名 | 200 `ClientWithContracts` |
| PUT | `/clients/:id` | 取引先の更新 | 200 `Client` |
| POST | `/clients/:id/archive` | 取引先の非表示の切り替え | 204 |
| POST | `/clients/:id/contracts` | 委託件名の追加 | 201 `Contract` |
| GET | `/contracts/:id` | 委託件名 | 200 `Contract` |
| PUT | `/contracts/:id` | 委託件名の更新 | 200 `Contract` |
| POST | `/contracts/:id/archive` | 委託件名の非表示の切り替え | 204 |
| POST | `/contracts/:id/entries` | 明細の追加(配列で一括) | 201 `Entry[]` |
| GET | `/entries/:id` | 明細 | 200 `Entry` |
| PUT | `/entries/:id` | 明細の更新 | 200 `Entry` |
| DELETE | `/entries/:id` | 明細の削除 | 204 |
| GET | `/contracts/:id/months` | 月の一覧(新しい順) | 200 `MonthSummary[]` |
| GET | `/contracts/:id/months/:month` | 月次データ一式 | 200 `MonthResponse` |
| PUT | `/contracts/:id/months/:month/meta` | 帳票ヘッダの更新 | 200 `ReportMeta` |
| POST | `/contracts/:id/months/:month/lock` | 月締めの切り替え | 200 `ReportMeta` |
| GET | `/contracts/:id/months/:month/report.xlsx` | 帳票のダウンロード | 200 xlsx |

`:month` は `YYYY-MM`。取引先と委託件名に物理削除の API はない(論理削除のみ)。

### クエリパラメータ

`GET /clients` と `GET /clients/:id` は `include_archived=1` で非表示のレコードも返す。
`GET /clients/:id` は、指定した取引先自体が非表示でも返す。

### リクエスト body

| 対象 | 項目 |
| --- | --- |
| 取引先 | `name`(必須、100字)、`reporter_name`(100字)、`sort_order` |
| 委託件名 | `project_name`(必須、200字)、`scope_items`(文字列配列。空行を除いて先頭4件)、`default_location`(100字)、`sort_order` |
| 明細 | `work_date`(`YYYY-MM-DD`)、`start_min`(0〜1440)、`end_min`(`start_min` 超〜2880)、`content`(200字)、`location`(100字) |
| 帳票ヘッダ | `submitted_on`(`YYYY-MM-DD` または null)、`special_notes`(500字) |
| 切り替え | 非表示は `archived`、月締めは `locked`。どちらも boolean |

- 字数の上限を超えた文字列はエラーにせず切り詰める
- 時刻は 0:00 からの分。1440 が 24:00、1440 超は日跨ぎ(1500 は翌 1:00)
- PUT は全項目の置き換え。省略した項目は空または既定値になる

## 更新の規則

- **一括登録**: `POST /contracts/:id/entries` に配列を渡す。1回 100 件まで。1件でも不正なら
  全件を登録しない
- **切り替えの既定値**: `archived` / `locked` を省略すると true(非表示にする / 締める)。
  省略や壊れた body で解除側に倒れないようにしている
- **非表示**: 読み取りと帳票のダウンロードは可能で、更新は 400。非表示の切り替え自体はできる。
  判定は対象自身と、明細なら属する委託件名を見る。取引先を非表示にしても、配下の委託件名と
  明細の更新は止まらない
- **月締め**: 締めた月の明細の追加・更新・削除と帳票ヘッダの更新は 409。明細の更新は移動元と
  移動先の両方の月を確認する。締めると提出日が未設定ならその日付で確定し、再度締めても
  最初の `locked_at` / `locked_by` を保つ

背景は [design.md](design.md) の「データモデル」を参照。
