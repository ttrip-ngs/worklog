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
| 認証 | 未実装(ローカルは擬似ログイン) | 本番は Google Workspace OAuth を想定 |

Cloudflare Workers + D1 のみで動くため、無料枠の範囲でホスティングできる。

## ローカルでの起動

```bash
npm install
cp .dev.vars.example .dev.vars   # ローカルの擬似ログイン設定(git 管理外)
npm run db:init    # スキーマ作成 (.wrangler/state 配下のローカル D1)
npm run db:seed    # 架空のサンプルデータ (2026-07) を投入
npm run dev        # http://localhost:5173
```

`.dev.vars` の `DEV_AUTH_EMAIL` が未設定だと API は 401 を返す。認証が未実装のため、
この値は絶対に `wrangler.jsonc` の `vars` に書かないこと(deploy でそのまま本番に載る)。

`npm run db:reset` でスキーマ再作成 + 初期データ再投入。

### 初期データの作り直し

手元の実データから作り直す場合:

```bash
python3 scripts/extract-seed.py reference/<既存の日報>.xlsx "<取引先名>" > db/seed.sql
```

出力には取引先名・報告者名・稼働実績がそのまま入るため、コミットしないこと。

## 主なコマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | Vite + Workers ランタイムの開発サーバ |
| `npm run build` | 本番ビルド |
| `npm run typecheck` | クライアント / Worker 双方の型チェック |
| `npm run db:reset` | ローカル D1 の初期化 |

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

## 入力補助

- 時刻は `9` / `930` / `9:3` / `2400` / `翌1:00` などを解釈して `HH:MM` に正規化
- 業務内容・備考は過去実績からの候補 (datalist)
- よく使う時間帯をワンクリックで適用、直近明細のコピー、行の複製
- 追加すると日付が自動で翌日へ送られる
- 月カレンダーで入力済みの日と日別稼働時間を一覧
- 取引先の新規追加では、報告者氏名にログイン中のアカウント名が初期値として入る(後から変更可)

## ドキュメント

- [docs/design.md](docs/design.md) — データモデル、帳票生成の仕組み、認証の実装方針
