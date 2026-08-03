# DB 저장소 용량 진단 및 보관기간 정리 도입 (2026-08-04)

## 배경
Postgres 볼륨(500MB)이 꽉 차 "No space left on device"로 크래시하는
장애가 있었음(대응은 볼륨 리사이즈로 완료, 별도 기록 없음 — Railway
대시보드에서 1000MB로 Live resize). 재발 방지를 위해 사용자가 DB 용량을
직접 진단해달라고 7개 항목으로 요청(2026-08-02):
1. 가장 용량을 많이 차지하는 테이블
2. row 수
3. 인덱스/테이블 크기
4. Dead Tuple
5. VACUUM/VACUUM FULL 필요 여부
6. Railway Postgres에서 안전하게 실행할 수 있는 정리 방법
7. 경매 크롤링 프로젝트에서 흔히 불필요하게 쌓이는 데이터

`railway run --service Postgres node <script>.mjs`로 `pg_total_relation_size`,
`pg_stat_user_tables`(dead tuple), `pg_stat_user_indexes` 등을 직접 조회해
분석. 결론: 로그성 테이블(auction_change_logs, kakao_dispatch_logs,
user_item_actions, crawler_log)과 매도분석용 실거래 원본(actual_trade)이
무기한 누적되는 구조였고, 이 중 request_logs만 이미 30일 보관 정리가
있었음(`RequestLogWriterService.purgeOld`). 사용자 승인: "그렇게 하자".

## 구현
`src/db-maintenance/` 신규 모듈 — `security-log-analyzer.service.ts`의
기존 `purgeOld` 스케줄링 패턴(OnModuleInit에서 setInterval, 실행마다
DB 정리)을 그대로 재사용.

- `DbRetentionService`: 6시간 간격으로 다음을 정리
  - `actual_trade`: `contractDate` 기준 36개월(3년) 초과 삭제 — 오래된
    실거래는 더 이상 최근 낙찰물건과 매칭될 일이 없음.
  - `auction_change_logs` / `kakao_dispatch_logs` / `user_item_actions` /
    `crawler_log`: 각각의 시각 컬럼(changedAt/sentAt/createdAt/at) 기준
    90일 초과 삭제.
  - `request_logs`는 기존 `RequestLogWriterService.purgeOld()`(30일)가
    이미 처리 중이라 이 서비스에서는 다루지 않음.
- `DbMaintenanceModule`을 `app.module.ts`에 등록(5개 엔티티는 이미
  `typeorm.config.ts` 전역 entities 배열에 등록돼 있어 추가 마이그레이션
  불필요 — 순수 삭제 쿼리만 추가).

## 운영 DB 1회성 정리(즉시 실행)
새로 배포된 스케줄러가 다음 정리 주기(6시간)까지 기다리지 않도록,
`railway run --service Postgres node <임시스크립트>.mjs`로 동일 커트라인
기준 1회성 삭제를 직접 실행(스크립트는 실행 후 삭제, 세션 관례대로
git에 커밋하지 않음):

- actual_trade: 116건 삭제(contractDate < 2023-08-03)
- auction_change_logs / kakao_dispatch_logs / user_item_actions /
  crawler_log: 0건(90일 이내 데이터만 존재 — 아직 누적 기간이 짧아
  해당 없음)
- `VACUUM ANALYZE actual_trade` 실행 후 DB 전체 크기 279MB 확인
  (1000MB 볼륨 대비 여유 충분).

## 변경 파일
`src/db-maintenance/db-retention.service.ts`(신규),
`src/db-maintenance/db-maintenance.module.ts`(신규), `src/app.module.ts`.

## 테스트 결과
`tsc --noEmit` + `npm run build`(nest build) 클린. 운영 DB에 1회성
정리 스크립트를 직접 실행해 실제 삭제 동작 확인 완료. 스케줄러가
6시간 주기로 계속 동작하는지는 장기 관찰 필요(다음 정리 주기까지
`crawler_log`에 "DB 보관기간 정리 완료" 로그가 남는지로 확인 가능,
단 정리 대상이 0건이면 로그를 남기지 않도록 설계했으므로 실제로 삭제될
데이터가 쌓인 뒤에야 로그로 확인 가능 — 미확인).
