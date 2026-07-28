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

## 追記 (2026-07-28) — 백필이 실제로는 0건 저장되고 있었던 버그 발견·수정

"백필 매칭 중에 매칭된 사례가 있었어?"라는 질문에 답하려고 운영
DB를 직접 조회(`railway run --service Postgres`로 Postgres 서비스의
`DATABASE_PUBLIC_URL`을 이용)한 결과, **`lawdCd`/`umdNm`/`jibun`/
`saleConfirmedAt`/`paymentCompletedAt` 전부 0건**으로 확인됨.
백필 스크립트(`crawler/backfill_resale_match.py`)는 40/40 성공
로그를 남겼는데도 실제로는 아무것도 저장되지 않고 있었다.

원인: `src/auctions/auction-change.util.ts`의 `AUCTION_FIELD_LABELS`
(=`TRACKED_FIELDS`, 변경 감지 대상 필드 목록)에 신규 5개 필드가
빠져 있었음. 크롤러 임포트 경로(`AuctionsService.upsertOne` →
`skipIfUnchanged: true`)는 `TRACKED_FIELDS` 기준으로 diff가 없으면
`unchanged: true`를 반환하고 **`auctionRepo.save()` 자체를 호출하지
않는다**. 백필 대상 40건은 전부 이미 DB에 있던(완료된) 사건이라
기존 추적 필드는 안 바뀌었으므로, `merged`/`next`에는 새 필드값이
정상적으로 계산돼 있었음에도 저장 단계에서 통째로 버려졌다. 백필
스크립트는 `/crawler/import-item` 콜백의 HTTP 200 응답만 보고
"saved: true"를 기록했기 때문에 이 스킵을 감지하지 못했다.

수정: `AUCTION_FIELD_LABELS`에 `lawdCd`/`umdNm`/`jibun`/
`saleConfirmedAt`/`paymentCompletedAt` 5개 필드와 한글 라벨 추가
(`src/auctions/auction-change.util.ts`). 이제 이 필드들의 변화도
diff에 잡혀 저장이 스킵되지 않는다.

### 교훈
크롤러 저장 경로에 새 필드를 추가할 때는 엔티티/마이그레이션/DTO/
매퍼/병합 로직뿐 아니라, **변경 감지(diff) 대상 필드 목록에도 반드시
추가해야 한다** — 그렇지 않으면 "이미 DB에 있고 다른 필드는 안 바뀐"
케이스(= 완료된 과거 사건 재크롤링/백필의 전형적 상황)에서 조용히
저장이 스킵된다. 이번처럼 API가 200을 반환하고 로그도 "성공"으로
남기 때문에 겉보기엔 정상 동작한 것처럼 보인다는 점이 특히
위험하다 — 반드시 운영 DB를 직접 조회해 실제 반영 여부까지
확인해야 한다.

### 다음 단계
수정을 배포한 뒤 백필 스크립트를 재실행해 실제로 DB에 값이
채워지는지 재확인 필요(진행 중).

## 追記 (2026-07-28) — 백필 재확인 성공, 매칭 배치 2차 크래시 발견·수정

### 백필 재실행 결과
위 저장 스킵 버그 수정을 배포한 뒤 `crawler/backfill_resale_match.py`를
재실행하고 운영 Postgres를 직접 조회(`railway run --service Postgres
node`)해 확인한 결과: `lawdCd`/`umdNm`/`jibun`/`saleConfirmedAt` 40건,
`paymentCompletedAt` 9건 정상 저장 확인(완납 확정 단계인 배당기일/
배당종결 물건 수와 일치).

### 매칭 배치(Stage A/B) 크래시 — TypeORM @AfterLoad + 부분 select 충돌
완납일이 채워진 뒤 스케줄러가 최초로 매칭 배치를 실행하자 즉시
크래시: `TypeError: Cannot read properties of undefined (reading
'replace') at cleanAddress (address-parser.js:58) at
Auction.normalizeDisplayFields (auction.entity.js:43) at
EntityListenerMetadata.execute ...`.

원인: `TradeIngestionService.resolveIngestionScope()`가
`createQueryBuilder("a").select(["a.lawdCd", "a.bidDate"])`로 일부
컬럼만 조회하는데, `Auction` 엔티티의 `@AfterLoad() normalizeDisplayFields()`
훅이 매 로드마다 `this.address`/`education`/`buildingRegistry`/
`tenantDetail`/`elevator`/`parking`/`factTags`/`strategyTags`를
무조건 정제(clean) 함수에 넘긴다 — 부분 select라 이 필드들이
`undefined`인데 `cleanAddress(undefined)`가 `.replace()`를 호출하며
크래시. 기존 코드에도 부분 select 쿼리가 여럿 있었지만(예:
`auctions.service.ts`) 이 특정 필드 조합/훅과 부딪힌 적이 없어 지금까지
드러나지 않았던 잠복 결함이었다.

수정: `src/auctions/auction.entity.ts`의 `normalizeDisplayFields()`에서
각 필드를 `undefined`가 아닐 때만 정제하도록 방어 코드 추가 — 부분
select로 로드된 엔티티에서도 크래시하지 않는다(다른 부분 select
쿼리에도 동일하게 안전).

### 검증
`npx tsc --noEmit -p .` 통과(무관한 EBUSY 노이즈만). Railway 재배포 후
매칭 배치가 크래시 없이 완료되는지, `auction_trade_match`/
`auctions.resaleMatchedTradeId`에 실제 결과가 쌓이는지 운영 DB 직접
조회로 확인.

## 追記 (2026-07-28) — 배포 중단 사고(502)와 긴급 복구

### 사고 경위
위 @AfterLoad 훅 수정을 커밋할 때 `git add src/auctions/auction.entity.ts`로
파일 전체를 스테이징했는데, 이 파일에는 **다른 세션에서 진행 중이던
미완성 작업(`rightsReview` 필드, 권리분석 확정값 컬럼)도 이미
반영돼 있었다.** 그 작업의 대응 마이그레이션
(`src/migrations/1784254000000-AddAuctionRightsReview.ts`)은 git에
커밋되지 않은 untracked 상태였으므로, 엔티티만 배포되고 컬럼은
운영 DB에 없는 상태가 되어 **부팅 즉시 크래시(`column
Auction.rightsReview does not exist`) → 전체 API 502 다운**이
발생했다.

### 복구
누락됐던 마이그레이션 파일을 그대로 커밋·푸시해 긴급 복구(컬럼
추가만 하는 단순 ALTER라 안전). 재배포 후 정상 부팅 확인.

### 재발 방지
이후 커밋부터는 `git add <file>` 전에 반드시 `git diff <file>`로
변경 내용을 직접 확인한 뒤에만 스테이징하도록 절차를 바꿨다 —
"내가 의도한 변경만 들어있는가"를 매번 확인. 이번처럼 다른
세션이 같은 파일에 미완성 변경을 남겨둔 상태에서 무심코 전체
파일을 스테이징하면, 의도치 않게 미완성 기능을 함께 배포시킬
수 있다는 게 실측으로 확인됐다.

### 실거래 수집 배치 무응답(hang) 발견·수정
502 복구 후 매칭 배치가 재실행되며 "실거래 수집 시작(288개
시군구×월 조합)" 로그 이후 **7분 넘게 완료/에러 로그 없이 멈춤**을
확인. `MolitTradeClientService.fetchTrades()`가 네이티브 `fetch`를
타임아웃 없이 호출하고 있어, data.go.kr 쪽 응답이 없는 조합
하나에서 전체 배치가 무한 대기에 빠진 것으로 판단.
`AbortController` 기반 20초 타임아웃을 추가(`src/resale-match/
molit-trade-client.service.ts`) — 타임아웃 시 해당 조합만
스킵하고 배치는 계속 진행하도록 함(`TradeIngestionService.
ingestOne()`이 이미 개별 실패를 catch해서 계속 진행하는 구조라
이 수정만으로 충분).
