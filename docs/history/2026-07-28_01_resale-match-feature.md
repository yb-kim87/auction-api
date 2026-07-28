# 낙찰물건 매도 추정(재판매 매칭) 기능 — 설계·조사·1단계 구현

날짜: 2026-07-28
관련 레포: auction-api

## 요청 원문 (요약)
"낙찰된 물건이 실제로 얼마에 매도되었는지 추정하는 기능"을 만들고
싶다는 요청으로 시작. 오탐(False Positive) 최소화를 최우선으로,
매각대금완납일을 실거래 매칭의 기준일로 삼아달라는 구체적 요구사항과
함께 알고리즘·DB·아키텍처 전체 설계를 먼저 요청받음(코드 작성 전
설계부터).

## 진행 순서
1. **설계**: [docs/auction-resale-matching-design.md](../auction-resale-matching-design.md)
   — 하드필터·스코어링 알고리즘(0~100점)·신뢰도 등급·DB 스키마·NestJS
   배치 아키텍처 전체 설계.
2. **실측 검증**: [docs/auction-resale-matching-data-findings.md](../auction-resale-matching-data-findings.md)
   — 실제 아파트 물건을 v3(httpx)로 크롤링해 탱크옥션 `histInfo` 상태
   코드(sta=1216=완납일 신규 발견), 네이버 실거래/매물 API의 버려지던
   필드, **국토교통부 공식 실거래가 API**(data.go.kr, 기존
   `BUILDING_REGISTER_API_KEY` 재사용) 직접 연동 성공까지 확인.
3. **설계 검토·수정**: 단지 매칭 키를 단지명 텍스트(`aptNm`)에서
   지번(`LAWD_CD+umdNm+jibun`)으로 변경 — 동명이인 단지 오매칭 방지
   (사용자 제안).
4. **1단계 구현**: 아래 "변경 내용" 참고.

## 변경 내용
- `auctions` 테이블에 `saleConfirmedAt`/`paymentCompletedAt`(완납일,
  매칭 anchor date)/`paymentCompletedAtIsEstimated`/`lawdCd`/`umdNm`/
  `jibun`(국토부 API 조회용 지번 식별자)/`resaleMatchedTradeId`/
  `resaleMatchScore`/`resaleMatchTier`(비정규화 결과) 추가(마이그레이션
  4개).
- `actual_trade`(정규화된 실거래, 국토부 API 주 소스), `auction_trade_match`
  (매칭 결과 — 평가된 후보 전부 저장) 테이블 신설.
- `crawler/parsers.py`, `crawler/item_crawl.py`: `_parse_lawd_jibun`
  (baseInfo의 si_cd/gu_cd/m_adrs_no/s_adrs_no/regn_adrs에서 지번 식별자
  추출), `_parse_resale_match_dates`(histInfo의 sta=1211/1216에서
  매각허가결정일/완납일 추출) 신규 — v3(HTTPX)·Selenium 양쪽 경로 모두
  반영, TS 매퍼(`crawler-item.mapper.ts`)·DTO·병합 로직(`auction-builder.ts`)
  까지 연결.
- `src/resale-match/` 모듈 신설:
  - `molit-trade-client.service.ts` — 국토부 API 호출(네이티브
    `fetch`, 경량 정규식 XML 파서, 신규 npm 의존성 없음).
  - `trade-ingestion.service.ts` — Stage A(완납일 확보된 미매칭 물건의
    `LAWD_CD×월` 조합만 조회, data.go.kr 트래픽 통제).
  - `match-scoring.util.ts` — Stage B 스코어링(설계 문서 4장 알고리즘
    그대로, 순수 함수 위주로 구현해 유닛 테스트 용이).
  - `resale-match.service.ts` — Stage A/B 오케스트레이션 + 스케줄러
    (`CrawlerService`와 동일한 setInterval 1일 1회 패턴).
  - `resale-match.controller.ts` — 관리자 QA 화면(2단계, 아직 미구현)
    이전 단계의 최소 조회 API.
- `typeorm.config.ts` 전역 `entities` 배열에 신규 엔티티 등록(직전
  세션의 `CrawlerLogRow` 미등록 크래시 사고 재발 방지 차원에서 이번엔
  엔티티 작성과 동시에 등록).

## 백필(backfill) 필요성 확인
신규 컬럼은 향후 크롤링분부터만 채워지므로, 기존에 이미 매각완료된
물건은 별도 재크롤링이 필요함을 확인. 운영 DB의 `caseState` 실측
분포를 확인한 결과 "매각"이라는 단일 라벨은 존재하지 않고 절차
단계별로 `허가`→`지급기한`→`배당기일`→`배당종결`로 세분화되어
있음(신규 발견) — 완납이 사실상 확정적인 단계(`지급기한`/`배당기일`/
`배당종결`) 아파트·오피스텔 물건이 26건, 완납 여부 불확실한 `허가`
단계까지 포함하면 40건으로 확인. 이 규모라면 백필을 nohup 없이
동기 스크립트(`crawler/backfill_resale_match.py`)로 간단히 처리
가능.

## 검증
`npx tsc --noEmit -p .` 통과(무관한 EBUSY 파일 잠금 노이즈만 있었고
실제 타입 오류 0건, 별도 실행으로 재확인).

## 다음 단계
- 배포 후 서버 정상 작동 확인(CLAUDE.md 규칙) → 백필 스크립트 실행
  → Stage A/B 배치 1회 수동 실행(`POST /resale-match/run-now`)으로
  실제 매칭 결과 확인
- 2단계(관리자 QA 화면), 3단계(사용자 노출), 4단계(네이버 매물 이력)는
  설계 문서 10장 로드맵 참고, 사용자 승인 후 순차 진행

## 追記 (2026-07-28) — 백필 실행 결과 및 완납 코드(sta) 수정

### 백필 실행
`crawler/backfill_resale_match.py`로 완납 확정 단계(`지급기한`/
`배당기일`/`배당종결`) + 불확실 단계(`허가`) 아파트·오피스텔 40건을
재크롤링해 `lawdCd`/`umdNm`/`jibun`/`saleConfirmedAt`/
`paymentCompletedAt`을 채웠다.

### 중요 수정 — 완납일 sta 코드가 사건마다 1216/1217로 다름
백필 1차 실행에서 완납일 확보가 9건에 그쳐(예상보다 적음) 원인을
추적한 결과, **매각대금완납 이벤트의 상태코드(`sta`)가 모든 사건에서
동일하지 않고 1216 또는 1217 둘 중 하나로 갈린다**는 걸 발견(표본
4건: 1216 1건, 1217 3건 — 둘 다 구조적으로 "매각허가결정(1211)
이후, 배당기일(1218) 직전"이라는 동일한 위치에 나타남). 최초 설계
검증 때 표본 1건(tid=2341347)만으로 1216만 완납으로 확정했던 게
과소 일반화였다.

`crawler/parsers.py`의 `_parse_resale_match_dates()`를 1216·1217
둘 다 완납으로 인정하도록 수정. 수정 후 재실행 결과 **완납이
확실한 배당기일·배당종결 상태 물건은 100% 완납일 확보**(9건 →
지급기한 상태 중 아직 진짜로 완납 전인 물건들만 정상적으로 빈 값
유지). 정확한 사건유형별(임의경매/강제경매 등) 구분 규칙까지는
확인 못 했으나, 두 코드를 모두 인정하는 것만으로 실무적으로 충분한
정확도 확보.

### 부수 수정 — actual_trade/auction_trade_match의 jsonb→simple-json
운영 PostgreSQL과 로컬 sql.js(개발용) 양쪽에서 동일하게 동작하도록
`sourceRaw`/`scoreBreakdown` 컬럼을 TypeORM `jsonb`에서
`simple-json`(text 저장)으로 전환. 이미 배포된 두 테이블은 아직
실사용 전(Stage A/B 미실행)이라 데이터 손실 없이
`1784253000000-ConvertResaleMatchJsonbToSimpleJson` 마이그레이션으로
안전하게 타입 변경.

### 검증
`npx tsc --noEmit -p .` 통과. Railway 재배포 후 API 정상 응답 확인
(CLAUDE.md 배포 확인 규칙 준수).
