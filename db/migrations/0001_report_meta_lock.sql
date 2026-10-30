-- 月締め(ロック)の列を report_meta に追加する。
--
-- schema.sql は DROP -> CREATE のため既存 DB には流せない。データを残したまま
-- 更新するための追加専用マイグレーション。新規に schema.sql から作った DB には
-- 同じ列が既にあるので流す必要はない(流すと duplicate column name で失敗する)。
ALTER TABLE report_meta ADD COLUMN locked_at TEXT;
ALTER TABLE report_meta ADD COLUMN locked_by TEXT NOT NULL DEFAULT '';
