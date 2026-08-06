-- ============================================================
-- DB 용량 진단 스크립트 (Railway Postgres, 볼륨 부족 조사용)
-- 2026-08-03
--
-- 사용법: railway run --service Postgres psql "$DATABASE_PUBLIC_URL" -f scripts/diagnose-db-space.sql
-- 또는 각 쿼리를 개별적으로 railway run ... psql -c "..." 로 실행해도 됨.
-- ============================================================

-- 1) 테이블별 전체 용량(테이블 본체 + 인덱스 + TOAST) 큰 순서로.
--    pg_total_relation_size가 "이 테이블 하나가 디스크에서 실제로 차지하는
--    총량"이라 범인을 찾는 데 가장 먼저 봐야 할 지표.
SELECT
  schemaname,
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_size_pretty(pg_relation_size(relid)) AS table_only_size,
  pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS indexes_and_toast_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 30;

-- 2) 테이블별 row 수(정확한 COUNT(*)는 큰 테이블에서 느릴 수 있어,
--    통계상 추정치(n_live_tup/n_dead_tup)를 먼저 본다 — ANALYZE가 최근에
--    돌았다면 충분히 정확함.
SELECT
  schemaname,
  relname AS table_name,
  n_live_tup AS estimated_live_rows,
  n_dead_tup AS estimated_dead_rows,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC
LIMIT 30;

-- 3) 인덱스 크기만 따로(테이블별로 인덱스가 본체보다 커진 경우를 잡아내기 위함 —
--    자주 갱신되는 컬럼에 인덱스가 많으면 이런 일이 흔함).
SELECT
  schemaname,
  relname AS table_name,
  indexrelname AS index_name,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 30;

-- 4) Dead tuple 비율이 높은 테이블(오토바큠이 못 따라간 테이블) — dead_ratio가
--    높으면 VACUUM(FULL 아님, 일반 VACUUM)만으로도 공간 반환 가능성 있음.
SELECT
  schemaname,
  relname AS table_name,
  n_live_tup,
  n_dead_tup,
  CASE WHEN n_live_tup + n_dead_tup = 0 THEN 0
       ELSE round(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 1)
  END AS dead_ratio_pct,
  last_autovacuum,
  autovacuum_count
FROM pg_stat_user_tables
WHERE n_dead_tup > 0
ORDER BY n_dead_tup DESC
LIMIT 20;

-- 5) DB 전체 크기 + 이 DB가 속한 서버(클러스터) 전체 크기.
SELECT pg_size_pretty(pg_database_size(current_database())) AS this_database_size;

-- 6) WAL(pg_wal) 자체가 얼마나 쌓였는지 — 지금 크래시 원인이 WAL 임시파일
--    쓰기 실패였으므로, WAL 보관량이 비정상적으로 큰지도 확인.
--    (슈퍼유저 권한이 없으면 pg_ls_waldir()가 막힐 수 있음 — 안 되면 생략)
SELECT count(*) AS wal_file_count, pg_size_pretty(sum(size)) AS wal_total_size
FROM pg_ls_waldir();

-- 7) 삭제해도 되는 로그성 데이터 후보 — 이 프로젝트에서 무한정 쌓이기 쉬운
--    감사/로그 테이블들을 명시적으로 체크(테이블명은 실제 스키마에 맞게 존재하는
--    것만 결과가 나옴, 없는 테이블은 그냥 스킵됨).
SELECT 'crawler_log' AS table_name, count(*) AS row_count, pg_size_pretty(pg_total_relation_size('crawler_log')) AS size
FROM crawler_log
UNION ALL
SELECT 'user_action_log', count(*), pg_size_pretty(pg_total_relation_size('user_action_log'))
FROM user_action_log
UNION ALL
SELECT 'auction_change_log', count(*), pg_size_pretty(pg_total_relation_size('auction_change_log'))
FROM auction_change_log
UNION ALL
SELECT 'actual_trade', count(*), pg_size_pretty(pg_total_relation_size('actual_trade'))
FROM actual_trade;
