# 매도분석: 필터별 매도 통계 탭

## 배경
사용자 요청(2026-08-01): "원래 우리가 물건작업 필터에서 물건 주소들을
가져와서 리스트업을 했자나 근데 진행되는 물건들만 햇었는데 이제는
낙찰된 물건들을 물건작업 필터와 동일하게 활용해서 필터된 주소들이
실제로 매도로 얼마나 연결되었는지 확인해보는걸 해보고 싶은데" → 매도분석
(구 재판매 매칭) 탭 안에 서브탭으로 구성하기로 확정.

기존 "물건작업 필터"(검색 페이지의 지역/물건종류 필터)는 진행 중인
물건에만 쓰였는데, 이번엔 같은 필터를 **이미 낙찰된 물건**(`salePrice`
확정)에 적용해서, 그 필터에 걸리는 주소들 중 매도분석 로직상 몇 건이
매도로 이어진 것으로 추정되는지 비율/통계를 보여준다.

## 구현

### 백엔드 (`auction-api`)
- `src/resale-match/property-type.util.ts`(신규): 프론트 전용 모듈
  (`young/auction/src/data/property-type-options.ts`)의
  `matchesPropertyType` 규칙을 백엔드용으로 이식(프론트 `@/data`는
  서버에서 import 불가하므로 로직 복제 — 한쪽이 바뀌면 다른 쪽도
  같이 갱신 필요).
- `resale-match.service.ts`의 `getFilteredResaleStats(filters)`:
  - 낙찰 판정은 `salePrice IS NOT NULL AND salePrice > 0`(caseState보다
    신뢰도 높은 기존 확립 신호).
  - 지역(city/district)은 SQL `IN`, 물건종류는 `matchesPropertyType`으로
    JS 후필터.
  - `Auction.resaleMatchTier`는 "표시 대상(70점+·비애매)"만 캐싱되어
    있어 그것만 보면 과소집계되므로, `auction_trade_match`에서
    `candidateRank=1`인 최상위 후보를 별도 조회해 55점 이상(QA 후보
    있음)과 70점+ 표시 대상을 각각 집계.
  - 반환: `{ total, withCandidate, displayed, items[] }`.
- `resale-match.controller.ts`: `GET /resale-match/sold-stats?city=&
  district=&propType=`(콤마 구분 다중값) 추가, `requireAdmin`.

### 프론트엔드 (`auction`)
- `lib/api.ts`: `ResaleSoldStats`/`ResaleSoldStatItem` 타입,
  `fetchResaleSoldStats()` 추가.
- `ResaleMatchTab.tsx`: 탭을 "QA 목록"/"필터별 매도 통계" 둘로 나누고,
  새 `SoldFilterStatsPanel` 컴포넌트에서 시/도·구/군 드롭다운(검색
  페이지와 동일한 `korea-regions.ts` 데이터 재사용) + 물건종류
  다중선택 칩 + 조회 버튼을 제공. 결과는 요약 카드 3개(전체/QA후보
  있음/매도확정 표시, 각각 건수+비율)와 물건별 상세 표(사건번호·주소·
  용도·낙찰가·점수·등급·노출여부)로 보여준다.

## 검증
- 양쪽 저장소 `npx tsc --noEmit`, `npm run build` 통과.

## 追記 (2026-08-01) — 설계 변경: 별도 필터 화면 대신 검색 페이지 재사용

사용자가 UI를 보고 "필터 선택할 수 있는게 너무 적은데"라고 지적한 뒤,
"검색페이지와 동일한 전체 필터 이식"으로 확장하려던 차에 사용자가 더
나은 방향을 제안: "차라리 물건 작업창에서 매각 선택하고 하면 분석하게
하는건 어때? 굳이 나누지 않고?" — 매도분석 탭 안에 필터 UI를 통째로
복제하는 대신, **검색 페이지(물건작업 화면)가 이미 계산해 둔 필터
결과를 그대로 재사용**하는 방식으로 설계를 바꿨다.

### 변경 내용
- 매도분석 탭의 "필터별 매도 통계" 서브탭(및 `SoldFilterStatsPanel`,
  지역/물건종류 필터 UI 복제)을 **되돌림**.
- 백엔드: `GET /resale-match/sold-stats?city=&district=&propType=`
  (지역/물건종류 SQL 필터 + `property-type.util.ts` 이식 로직)를
  **`POST /resale-match/sold-stats` (body: `{ auctionIds: string[] }`)**
  로 교체. 필터 로직을 백엔드에 중복 구현하지 않고, 프론트가 이미
  필터링해 둔 auctionId 목록만 받아 그중 낙찰(`salePrice` 확정)된
  것만 골라 매도분석 결과를 붙여 반환. `property-type.util.ts`는
  더 이상 필요 없어져 삭제.
- 프론트: 검색 페이지(`search/page.tsx`)의 "검색 결과" 영역에 관리자
  전용 **"이 필터로 매도분석 (N건)"** 버튼을 추가 — 클릭하면 현재
  적용된 필터 결과(`filtered` 배열, recommend 모드와 무관하게 실제
  검색 필터 기준)의 auctionId들을 그대로 API에 넘겨 통계(전체/QA후보/
  매도확정 표시 건수·비율)와 물건별 표를 인라인으로 보여준다.

이 방식의 장점: 필터 UI/로직을 두 군데서 유지보수할 필요가 없고,
관리자가 이미 확인한 검색 결과를 그대로 분석 대상으로 삼으므로
필터 조건이 어긋날 위험이 없다.

## 追記 (2026-08-01) — 재설계: 물건작업창(CrawlerWorkPanel)에 통합

앞선 설계(검색 페이지 재사용)도 사용자가 다시 검토하면서 "물건작업
필터"가 실제로는 검색 페이지(`/search`)가 아니라 **물건작업창**
(`CrawlerWorkPanel.tsx` — 탱크옥션 로그인 → 검색조건(관심조건/직접
설정) → 주소 추가 → 조회 시작으로 이어지는 크롤링 작업 도구)를
가리킨다는 게 드러났다. 검색조건의 `status` 필드가 탱크옥션 자체
상태코드(`stat`, "진행물건"=11/"매각"=12/"유찰"=1111 등,
`presets_httpx.py:241-244`)를 그대로 쓰고 있어, "매각"으로 바꿔서
주소 추가하면 탱크옥션에서 실제 낙찰 물건 목록을 받아온다.

최종 확정 방식(사용자 결정 과정): "물건작업창에 매도분석 체크박스를
하나 만드는건 어때" → "낙찰된게 아니면 매도분석하지 않고 낙찰된것만
분석하도록" → "그전에 했던 로직 적용하면 되니까"(=기존
`getResaleStatsForAuctionIds`가 이미 salePrice 유무로 걸러주므로
그대로 재사용).

### 변경 내용
- 검색 페이지의 "이 필터로 매도분석" 버튼은 **그대로 유지**(별도로
  유효한 기능 — 이미 우리 DB에 반영된 낙찰물건을 검색 필터로 빠르게
  확인하는 용도). 이번 건은 그 위에 물건작업창 전용 경로를 추가로
  만든 것.
- 백엔드: `ResaleMatchService.getResaleStatsForAuctionIds`의 핵심
  로직을 `buildResaleStats(auctions)` 사설 메서드로 추출하고,
  auctionId 대신 **사건번호(auctionNo)로 조회하는**
  `getResaleStatsForAuctionNos(auctionNos)`를 신규 추가(물건작업창은
  "주소 추가" 시점엔 아직 우리 DB의 UUID를 모르고 탱크옥션 사건번호
  문자열만 갖고 있기 때문). `salePrice` 없는(=낙찰 안 된) 물건은
  기존 로직 그대로 자동 제외.
- 컨트롤러: `POST /resale-match/sold-stats-by-case-no`
  (body: `{ auctionNos: string[] }`) 추가.
- 프론트: `CrawlerWorkPanel.tsx`에 "매도분석(진행상태를 '매각'으로
  걸고 주소 추가 시, 낙찰물건만 분석)" 체크박스 추가. 체크된 상태로
  "주소 추가"를 누르면, 응답으로 받은 작업목록(`urls[].label`, 형식
  "{사건번호}_{탱크옥션URL}")에서 사건번호만 파싱해 새 엔드포인트를
  호출하고, 결과(전체/QA후보/매도확정 건수·비율 + 물건별 표)를
  검색조건 아래에 인라인으로 보여준다.

이 방식의 핵심: 탱크옥션에 "매각" 상태로 실제 재검색을 하므로(기존
크롤링 파이프라인 그대로 재사용, 백엔드 신규 크롤 로직 불필요) 최신
낙찰 현황을 정확히 반영하고, 매도분석은 우리 DB에 이미 있는 결과를
사건번호로 조회만 하므로 가볍다.

## 追記 (2026-08-01) — 트리거 시점 조정 + 목록 단계 낙찰정보 노출

두 가지를 추가로 조정했다:

1. **트리거 시점 이동**: "주소 추가" 직후 바로 매도분석을 돌렸더니
   188건 추가했는데 3건만 나오는 문제 발생 — "주소 추가"는 목록만
   가져올 뿐 아직 DB(상세 크롤링)에 저장 전이라, 이미 과거에
   크롤링된 적 있던 3건만 매칭됐던 것(사용자가 직접 원인 진단:
   "DB에 있는것만 해석하는거 아니야??" — 맞음). "조회 시작"(상세
   크롤링 완료, DB 저장)이 끝나는 시점으로 트리거를 옮기고, 체크박스는
   제거해 "조회 시작"을 누르면 자동으로 뒤이어 매도분석이 돌게 함.
2. **목록 단계에서 낙찰정보 노출**: 탱크옥션 목록 API를 "매각" 상태로
   실제 호출해 원본 필드를 확인한 결과(`sucb_amt`=낙찰가,
   `bid_dt`=낙찰일), 상세 크롤링 전 "주소 추가" 시점부터 이미 낙찰가/
   낙찰일을 알 수 있음을 확인. `presets_httpx.py`의
   `list_response_to_url_entries()`가 이 값을 `salePrice`/`saleDate`로
   엔트리에 포함하도록 수정, `CrawlerUrlEntry` 타입(백엔드/프론트
   양쪽)에 반영, 작업목록 화면에 "낙찰 168,000,000원 (2026-07-15)"
   형태로 바로 표시. 매도분석 자체 로직에는 영향 없음(여전히 DB의
   `salePrice`로 최종 판정) — 목록 단계에서 눈으로 먼저 걸러볼 수
   있게 하는 보조 정보.

## 追記 (2026-08-01) — 배치 주기 단축(24시간 → 2시간)

거제시 166건 매도분석이 전부 "후보 없음"으로 나온 걸 사용자가
이상하게 여겨 DB로 직접 원인을 추적했다. 확인 결과:
- `actual_trade`(국토부 실거래) 테이블엔 거제시(lawdCd=48310) 데이터가
  0건 — 비교 대상 자체가 없었음.
- `ResaleMatchService`의 배치는 **하루 1회**만 돌아서, 물건작업창에서
  "매각" 상태로 크롤링해 그날 새로 `paymentCompletedAt`이 채워진
  거제시 150건은 당일 배치 실행 시점 이후에 생긴 데이터라 다음날
  배치까지 매칭 시도 자체가 안 되는 상태였음(로그로 실행 이력 확인:
  13:14 배치가 432개 시군구×월 조합만 처리하고 끝 — 그 이후 늘어난
  거제시분은 반영 안 됨).

`onModuleInit`의 `RUN_INTERVAL_MS`를 24시간에서 **2시간**으로
단축해, 물건작업창에서 활발히 크롤링하는 동안 생기는 신규
완납 확정 물건도 같은 날 안에 매칭 시도되도록 함.

## 追記 (2026-08-01) — 즉시 매칭(수집 즉시 국토부 API 실행) + 물건작업창 상시 탭

배치 간격을 좁히는 것만으로는(2시간) 근본 해결이 안 된다는 판단 아래,
사용자가 더 나은 아키텍처를 제안: "실행되는건 물건 데이터 수집을하고
거기서 바로 국토부 실거래 api돌려서 매칭시키고 다음꺼 돌리고 이렇게
하면 되는거 아니야?" — 배치를 기다리지 않고 **물건을 하나 수집할
때마다 그 자리에서 바로 매도분석까지 마치는 방식**으로 전환.

### 변경 내용
- `ResaleMatchService.processAuctionForResale(auction)`(신규, public):
  완납일·주소키가 갖춰진 물건 하나를 받아, 그 지역(lawdCd)이 이번
  프로세스에서 아직 실거래 수집 전이면 먼저 수집(`ensureIngestedForLawdCd`,
  36개월치, 인메모리 캐시로 같은 지역 중복 수집 방지)한 뒤 바로
  스코어링(`matchOne`)까지 수행. 배치(`runOnce`, 이제 2시간 간격)는
  이 즉시처리에서 놓친 것을 뒤늦게 잡아주는 안전망으로 유지.
- `CrawlerService.importItem()`: 물건 상세 크롤링 저장 직후
  `processAuctionForResale`을 fire-and-forget으로 호출 — 크롤링 흐름을
  막지 않음.
- `CrawlerService.collectUrls()`: "주소 추가"로 받은 사건번호 중 **이미
  DB에 있어 재크롤링을 건너뛴 물건**도 놓치지 않도록,
  `AuctionsService.findByAuctionNos()`로 기존 레코드를 찾아 동일하게
  매도분석을 시도(사용자 지적: "주소추가할때 기존에 있던 DB는
  중복으로 건너뛰더라고... 가지고 있는 DB정보를 통해서 국토부
  실거래가를 주소로 돌려서 매칭을 해야할꺼같아").
- `CrawlerModule`이 `ResaleMatchModule`을 import(순환 의존 없음 —
  ResaleMatchModule은 Auction 엔티티만 참조).

### 물건작업창에 "매도분석" 상시 탭 추가
`CrawlerWorkPanel.tsx`의 서브탭(작업창/매일 작업/알고리즘/수익계산/
부가세계산)에 **"매도분석"**을 추가해 기존 `ResaleMatchTab`(QA
목록+승인/반려)을 그대로 렌더링 — 이제 물건을 수집·크롤링할 때마다
즉시 매칭된 결과가 이 탭에 계속 쌓인다(사용자 요청: "낙찰 후 매도가
된걸로 추정되는 물건은 물건작업체 탭을 하나 만들어서... 거기에
리스트가 쌓이도록"). 최상위 관리자 메뉴의 기존 "매도분석" 탭은
그대로 유지(같은 컴포넌트를 공유하므로 중복 유지 비용 없음).

## 검증
- 양쪽 저장소 `npx tsc --noEmit`, `npm run build` 통과.

## 追記 (2026-08-01) — 매칭된 물건 상세에도 결과 노출(관리자 전용)

매도분석에서 매칭된 물건이라도 그 물건 자체의 상세정보 화면에서는
확인할 방법이 없었음(QA 목록에서만 보임) — "매칭된 물건정보에도
해당 정보를 볼 수 있게 해줘" 요청으로 물건 상세 모달에도 노출.
단, 아직 내부 검증 중인 신호라 **관리자만**(컨설턴트도 제외 — 사용자
명시: "해당 정보는 관리자만 볼 수 있게 해줘") 볼 수 있게 함.

- `auction-staff-fields.util.ts`: `stripResaleMatchFields()` 신규 —
  link/미납관리비(`stripStaffOnlyAuctionFields`, 관리자+컨설턴트 열람)
  와 별도로, `resaleMatchTier`/`resaleMatchScore`/`resaleMatchedTradeId`
  는 ADMIN이 아니면(컨설턴트 포함) 항상 제거.
- `AuctionsService.findApproved(isStaff, isAdmin)`,
  `RecommendationController`의 `GET /recommendations` 양쪽에 적용.
- 프론트: `AuctionItem` 타입에 세 필드 추가, `AuctionDetailModal.tsx`
  "핵심 가격 요약" 카드 상단에 "매도분석: 매도(재판매) 추정됨 — 등급
  {tier} (점수 {score})" 배지 표시(값이 있을 때만 렌더링 — API가
  이미 관리자 외에는 필드 자체를 안 내려주므로 프론트에 별도 role
  체크 불필요).

## 검증
- 양쪽 저장소 `npx tsc --noEmit`, `npm run build` 통과.

## 追記 (2026-08-01) — 중복 제외 물건 매도분석을 "조회 시작" 시점으로 이동 + 로그 가시화

처음엔 "주소 추가" 직후 조용히 백그라운드에서 기존 DB 중복 물건의
매도분석을 돌렸는데, 사용자가 "이게 돌아가고 있다고 안내가 있어야할꺼
같은데"라고 지적 — 로그에 안 남아 실제로 되고 있는지 확인이 안 되는
문제가 있었다. 이어서 "아니면 기다리고 있다가 조회시작을 누르면
진행되게하던가"로 타이밍도 재조정.

- `CrawlerService`에 `pendingDuplicateResaleAuctionNos` 필드 추가 —
  "주소 추가"(`collectUrls`) 시점엔 이미 DB에 있어 제외된 사건번호
  목록만 저장해두고, 실제 처리는 **"조회 시작"(`startCrawl`)을 누른
  시점**에 크롤링과 병행해서 실행.
- `runPendingDuplicateResaleAnalysis()`(신규): 저장해둔 사건번호로
  기존 Auction 레코드를 찾아 매도분석을 시도하면서, 실행 로그에
  "[매도분석] 이미 DB에 있던 N건 확인 시작" → "[매도분석] 완료 — 시도
  N건 / 후보 발견 N건 / 매도 확정 표시 N건"을 남겨 진행 상황이 보이게
  함.
- `ResaleMatchService.processAuctionForResale()`의 반환 타입을
  `Promise<void>` → `Promise<{attempted, candidateFound, displayed}>`로
  변경해 위 로그 집계에 사용.
- 실측 확인: 새 로직 배포 전 `auction_trade_match` 총 13건 →
  로직 적용 후 자연 증가하며 44건까지 확인(백그라운드 처리가 실제로
  작동함을 검증).

## 追記 (2026-08-01) — 주소 컬럼 줄바꿈 정리 + 동/등기접수일 추가

- 프론트 QA 목록의 "주소" 컬럼이 너무 길어 세로로 여러 줄 차지하던
  것을 `truncate whitespace-nowrap` + `title` 툴팁으로 정리.
- 사용자 질문("실거래 된거 동 정보는 국토부 실거래에서 못가져와?")에
  확인해보니 이미 `ActualTradeRow.buildingDong`(국토부 aptDong, 2024년
  이후 계약만 부분 채움)으로 수집은 되고 있었으나 QA 목록 화면에
  표시가 안 되고 있었던 것 — 쿼리/타입/표시에 추가.
- 추가로 `registeredAt`(등기접수일 — 있으면 소유권이전 등기까지
  완료됐다는 신뢰도 높은 신호)도 계약일 아래에 작게 표시.

## 追記 (2026-08-01) — QA 표 컬럼 확장(용도/매도차익) + 리사이즈 + 컬럼 너비 개선

- 사건번호 다음에 "용도"(propType) 컬럼, 계약일 다음에 "매도차익"
  (거래금액-낙찰가, 흑자 초록/적자 빨강) 컬럼 추가.
- 사용자 요청("첫줄 라벨줄 길이 조절을 내가 할 수 있도록 해줬으면
  좋겠어")으로 헤더 각 컬럼 오른쪽 끝에 드래그 핸들을 붙여
  마우스로 컬럼 폭을 직접 조절할 수 있게 함(`colgroup` + `<col
  style={{width}}>` + `useState` 기반 폭 상태).
- 처음엔 테이블 `width: max-content`로 뒀더니 브라우저가 셀 내용
  길이만큼 최소 폭을 강제해서 일정 이하로는 안 줄어드는 문제가
  있었음 → 테이블 `width`를 컬럼 폭 합계(px)로 명시적으로 고정하고
  각 셀에 `overflow-hidden`/`truncate`를 추가해서, 내용 길이와 무관하게
  원하는 만큼(최소 16px) 줄일 수 있게 수정.

## 追記 (2026-08-01) — 빌라(연립다세대) 매도분석 확장 조사

사용자 질문: "용도가 아파트인것만 매도분석 했는데 빌라도 가능할까?"
→ "연립주택/다세대/도시형생활주택 이 3개가 빌라야".

**propType 판정 버그 발견/수정**: `address-parser.ts`의 정규식이
"빌라|연립|다세대|다가구"만 검사해서 "도시형생활주택"은 걸리지 않아
지금까지 `propType="아파트"`로 잘못 분류되고 있었음. 정규식에
`도시형생활주택` 추가해 수정.

**빌라 실거래가 API 연동 가능성 실측 확인**: 로컬에서
`BUILDING_REGISTER_API_KEY`로 국토부 API를 직접 호출해 검증.
- `RTMSDataSvcAptTrade`(아파트매매): 200 OK, 정상 데이터 수신.
- `RTMSDataSvcRHTrade`(연립다세대매매): **403 Forbidden**.
- `RTMSDataSvcSHTrade`(단독다가구매매): 403 Forbidden.
- `RTMSDataSvcOffiTrade`(오피스텔매매): 403 Forbidden.

키를 일부러 틀리게 넣었을 때는 401 Unauthorized가 나와, 지금 401이
아닌 403이 뜨는 것은 "키는 유효하지만 해당 API 상품에 대한 활용신청이
아직 미승인"임을 의미한다고 판단. data.go.kr에서는 아파트매매/
연립다세대매매/단독다가구매매/오피스텔매매가 각각 별개 상품이라
개별적으로 활용신청·승인이 필요함(아파트 하나만 승인된 상태로 추정).
사용자에게 data.go.kr 마이페이지에서 "연립다세대매매 실거래자료"
상품의 활용신청 상태를 확인해달라고 요청 — 승인 확인되면 매칭 로직
(주소+층+면적 비교)은 아파트 때와 동일하게 재사용 가능하므로 이어서
구현 예정(아직 미구현, 진행 중).

## 追記 (2026-08-01) — 기존 DB 중복 물건 매도분석을 체크박스로 옵트인

사용자 지적: "조회 시작" 때마다 진행물건 조회처럼 매도분석과 무관한
경우에도 "이미 DB에 있던 3661건 확인 시작"이 자동으로 돌아 불필요한
부하가 발생함. 매번 자동 실행하지 말고, "내가 매도 분석을 요청할
때만" 하자는 요청 → 최종적으로 "주소추가 후 매도 분석 체크박스
선택했을 때만 진행"으로 확정.

- `StartCrawlDto`에 `runResaleAnalysisForExisting?: boolean` 추가.
  `crawler.service.ts`의 `startCrawl()`에서 이 값이 true일 때만
  `runPendingDuplicateResaleAnalysis()`를 실행하고, false면 대기 중이던
  `pendingDuplicateResaleAuctionNos`를 그냥 비움(기존 DB 물건 재매칭
  건너뜀).
- 이번에 새로 크롤링해서 `importItem()`으로 들어오는 물건의 즉시
  매칭(`processAuctionForResale`)은 건당 처리라 부하가 적어 그대로
  자동 유지 — 이번 변경은 "기존 DB에 이미 있던 대량 건"의 일괄
  재매칭에만 해당.
- 프론트(`CrawlerWorkPanel.tsx`)에 "기존 DB 물건도 매도분석" 체크박스
  추가(기본값 꺼짐), "조회 시작" 클릭 시 `crawlerStart()`에
  `runResaleAnalysisForExisting` 값을 함께 전달.

## 追記 (2026-08-03) — 빌라(연립다세대) 실거래 API 승인 확인 + 매도분석 연동 구현

사용자가 data.go.kr에서 "연립다세대매매 실거래자료"(RTMSDataSvcRHTrade)
활용신청을 완료 → 실측 재확인 결과 이전(2026-08-01)엔 403이었던 응답이
`resultCode=000`(정상)으로 바뀌어 승인 완료 확인. 이어서 계획 보고 후
빌라 매도분석 확장 구현.

### 조사 결과
기존 매칭 파이프라인(`resale-match.service.ts`/`match-scoring.util.ts`)은
애초에 propType을 전혀 보지 않고 `lawdCd+umdNm(동)+jibun(지번)+floor+
area`로만 후보를 좁히고 면적/층/시점/가격/고유성으로 스코어링한다 —
**아파트 전용으로 설계된 게 아니라, 유일하게 아파트 전용이었던 지점은
실거래 수집 단계(`molit-trade-client.service.ts`가 RTMSDataSvcAptTrade만
호출)뿐**이었다. 즉 지금까지 빌라 물건도 파이프라인 자체는 통과했지만
빌라 실거래 데이터가 애초에 안 모여 매칭될 수 없었던 것.

### 구현
- `MolitTradeClientService.fetchVillaTrades(lawdCd, dealYm)`(신규):
  `RTMSDataSvcRHTrade` 호출. 응답 필드가 아파트와 달라(`mhouseNm`
  단지명 필드, `aptDong`/`landLeaseholdGbn` 없음, `houseType`/`landAr`/
  `estateAgentSggNm` 추가) 기존 `MolitTradeItem` 형태로 어댑팅
  (`mhouseNm`→`aptNm`, 없는 필드는 빈 문자열)해 반환 — 호출부가
  아파트/빌라를 구분할 필요 없이 동일하게 처리 가능. XML 파싱 로직은
  제네릭(`parseItems<T>`)으로 공용화.
- `ActualTradeRow`에 `houseType: "APT" | "RH" | null`(기본 "APT")
  컬럼 추가 — 마이그레이션
  `1784267000000-AddActualTradeHouseType.ts`. 매칭 조건에는 안 쓰지만
  (지번+층+면적만으로 이미 충분히 좁혀짐) QA에서 실거래 출처 구분용.
- `TradeIngestionService.ingestOne(lawdCd, dealYm)`이 아파트+빌라 두
  API를 항상 함께(Promise.all) 수집하도록 변경 — 이 조합에 어떤
  propType 물건이 걸려있는지 미리 알 수 없고, 같은 지역에 아파트/빌라가
  섞여 있을 수 있어 매번 둘 다 수집하는 게 propType별로 갈라 호출하는
  것보다 단순하고 누락이 없다고 판단. 각 API 개별 실패는 서로 영향을
  주지 않도록 분리 처리(`fetchSafely`). 저장 시 dedup 키에도
  `houseType`을 추가해(기존엔 lawdCd+umdNm+jibun+floor+area+
  contractDate+dealAmount만 봤음) 이론상의 아파트/빌라 동일값 충돌을
  방지.
- 새 환경변수 불필요(`BUILDING_REGISTER_API_KEY` 재사용, 이미 승인).
- 관리자 QA 화면(`resale-match.controller.ts`의 `GET
  /resale-match/matches`)은 원래도 `propType`을 응답에 포함하고
  있어서 프론트 변경 불필요.

### 실측 테스트
- curl로 `RTMSDataSvcRHTrade`에 실제 서비스키로 호출 → `resultCode=000`,
  강남구 일원동/개포동 다세대 실거래 데이터 정상 수신 확인(승인 확인).
- 운영 DB에서 완납일이 찍힌 빌라 물건 5건 조회(`propType='빌라' AND
  paymentCompletedAt IS NOT NULL`) — 거제시 고현동 신원리츠빌라 등 확보.
  이 중 한 건(거제시 고현동 721-14)의 최근 4개월치 빌라 실거래를
  직접 조회했으나 정확히 그 지번의 재거래 기록은 아직 없음(정상 —
  완납 후 며칠 내 재매도는 드묾, 파이프라인 자체의 문제는 아님).
- `npx tsc --noEmit` + `npm run build` 클린.
- **미확인**: 실제 배포 후 2시간 주기 배치가 돌면서 `actual_trade`에
  `houseType='RH'` 행이 실제로 쌓이는지, 빌라 물건이 매칭까지 되는
  실사례는 아직 못 봄(데이터가 쌓일 시간이 필요 — 배포 후 운영 DB로
  주기적 확인 권장).

### 변경 파일
`src/resale-match/molit-trade-client.service.ts`,
`src/resale-match/trade-ingestion.service.ts`,
`src/resale-match/entities/actual-trade.entity.ts`,
`src/migrations/1784267000000-AddActualTradeHouseType.ts`(신규).

## 追記 (2026-08-03) — 빌라 매칭에 대지면적(landAr) 보조 신호 추가

사용자 질문에서 이어짐: "빌라는 동에 대한 정보가 없자나" → 코드 확인
결과 "동 일치" 보너스/탈락 로직(`match-scoring.util.ts`)은 양쪽 다 값이
있을 때만 작동해 빌라는 이 블록이 조용히 스킵될 뿐 문제는 없었음.
이어서 "api에서 더 매칭하기 좋은 데이터는 없었어?"라는 질문에 빌라
API 전용 필드 `landAr`(대지면적)을 제안 — 아파트에는 없는 필드지만
우리 `Auction.landShare`(대지권, 크롤러가 이미 수집 중)와 비교 가능해
"동" 공백을 메울 보조 신호로 쓸 수 있음. 사용자가 "너무 큰 비중은
안둬도 될거같아"라는 조건으로 진행 승인.

### 구현
- `ActualTradeRow.landArea`(numeric, nullable) 추가 — 마이그레이션
  `1784268000000-AddActualTradeLandArea.ts`. 아파트 실거래는 항상
  null(API에 필드 자체가 없음), 빌라만 채워짐.
- `MolitTradeItem`에 선택적 `landAr?: string` 필드 추가,
  `fetchVillaTrades()`가 원본 `landAr`을 그대로 실어 보냄.
  `TradeIngestionService.parseLandArea()`로 숫자 파싱 후 저장.
- `match-scoring.util.ts`에 `parseAuctionLandArea()`(Auction.landShare
  파싱) 추가. `computeScore()`에 "동 일치"(+15%) 블록 바로 아래
  "대지면적 일치"(+3%, 0.5㎡ 이내 일치 시)를 추가 — **동 일치보다
  훨씬 작은 가중치**이고, 불일치는 탈락시키지 않음(동 불일치와 달리
  대지권 값이 크롤링/등기 오차로 살짝 다를 수 있어 확실한 반증으로
  보기 어렵다고 판단, 사용자 요청 반영).
- `resale-match.service.ts`가 매칭 시 `auction.landShare`를 파싱해
  `computeScore()`에 `auctionLandArea`로 전달.
- 관리자 QA 화면 응답(`GET /resale-match/matches`)에 `houseType`,
  `landArea` 컬럼 추가(디버깅/확인용).

### 변경 파일(추가분)
`src/resale-match/molit-trade-client.service.ts`,
`src/resale-match/trade-ingestion.service.ts`,
`src/resale-match/entities/actual-trade.entity.ts`,
`src/resale-match/match-scoring.util.ts`,
`src/resale-match/resale-match.service.ts`,
`src/resale-match/resale-match.controller.ts`,
`src/migrations/1784268000000-AddActualTradeLandArea.ts`(신규).

### 테스트 결과
`npx tsc --noEmit` + `npm run build` 클린. 실제 빌라 재거래 매칭
사례로 이 보너스가 적용되는지는 데이터가 쌓여야 확인 가능(미확인).

## 追記 (2026-08-03) — "기존 DB도 매도분석" 동작 확인 + 후보 희소성 원인 확인

사용자 질문: "241건 중 8건이 DB중복으로 빠졌는데 기존 DB 8건도
조사하나??" → "방금 돌렸는데 234건만 한거같은데?? 기존 db 안한거같아,
후보가 2건뿐이 안나오는데?? 제대로 된거 맞나".

**둘 다 정상 동작으로 확인**(운영 `crawler_log` 테이블 직접 조회):
```
[매도분석] 이미 DB에 있던 28건 확인 시작(재크롤링 없이 기존 정보로 매칭)
[매도분석] 완료 — 시도 0건 / 후보 발견 0건 / 매도 확정 표시 0건
```
- 프론트 "방금 가져온 물건의 매도분석 결과" 패널은 **방금 크롤링한
  배치(233~234건)만** 반영하고, `runResaleAnalysisForExisting`으로
  트리거되는 "기존 DB 중복건" 분석(28건)은 백그라운드에서 별도로
  돌아 이 패널에 안 뜬다 — UI 설계상 원래 그런 것이지 안 돈 게 아님.
  "시도 0건"인 이유는 그 28건 전부 아직 `paymentCompletedAt`(완납일)이
  비어 있었기 때문(`processAuctionForResale`의 첫 가드에서 즉시
  `attempted: false`로 걸러짐).
- 후보가 거의 안 나온 이유: 스크린샷의 실제 물건들을 DB에서 직접
  조회해 확인 — `caseState`가 "지급기한"/"매각결정기일"인 물건은
  `paymentCompletedAt`이 아직 null(대금납부 전이라 당연함), "배당기일"/
  "배당종결"에 도달한 물건만 채워져 있었음. 매도분석은 완납일이 있는
  물건만 대상이 되므로, 방금 낙찰된 234건 대부분이 애초에 분석 대상이
  아니었던 것 — 버그가 아니라 설계대로 동작. 참고로 전체 DB 기준
  "완납일 있고 미매칭"인 물건은 총 307건뿐(주기 배치 로그 기준)이라,
  234건 중 실제 대상이 된 건 소수였을 것으로 추정.

### 확인 방법
`railway logs`(Nest 표준 로거)에는 이 로그가 안 잡힌다 — `appendLog()`가
Nest Logger가 아니라 인메모리 배열 + `crawler_log` 테이블에 직접
`insert`하는 구조라, 실제 확인은 `railway run --service Postgres`로
운영 DB의 `crawler_log` 테이블을 직접 조회해야 한다(`WHERE message
LIKE '%매도분석%'`). 이번에 이 방법으로 확인.

### 변경 파일
없음(조사만, 코드 변경 없음).

## 追記 (2026-08-03) — QA 화면에 실거래 전체 주소 표시

사용자 피드백: "매도된거 보면 경매지주소와 비교해서 보기엔 거래된
주소가 빌라명만 나와있어서 매칭해서 보기가 힘들어 주소가 다 나오게
해줘". `actual_trade`에는 도로명 전체주소가 없고 동(umdNm)+지번(jibun)
+건물명(aptNm)만 있는데, 매칭된 경매물건과 실거래는 항상 같은
lawdCd(=시/군/구)로만 매칭되므로 경매물건의 city/district를 그대로
재사용해 "시/군/구+동+지번+건물명" 형태의 전체 주소를 조합해 표시하도록
`GET /resale-match/matches` 응답에 `city`/`district`/`umdNm`/`jibun`
필드를 추가하고, `ResaleMatchTab.tsx` "실거래(층/면적)" 컬럼에 주소
줄을 추가.

### 변경 파일
`src/resale-match/resale-match.controller.ts`(추가분),
`src/lib/api.ts`, `src/app/admin/ResaleMatchTab.tsx`(프론트).

## 追記 (2026-08-03) — 매도분석을 "요청 전체 건수" 기준 하나로 통합

사용자 요청: "그냥 내생각엔 차라리 매도분석 체크박스를 하나 만드는게
좋을꺼같아... 241건을 요청하면 이미있는것도 순차적으로 241건 다같이
돌리는걸로... 같은 로직으로 돌아가게... 총 결과는 241건 중 몇개가
매도가 되었다 매칭되었다 결과가 나오게".

기존 구조는 (1) "조회 시작" 즉시 발동하는 기존-DB-중복건 매도분석과
(2) 크롤링 완료마다 개별 발동하는 신규/갱신 물건 매도분석이 서로
다른 트리거·다른 판별기준(URL vs 사건번호 텍스트)·다른 표시 위치
(카드 vs 로그)로 완전히 분리돼 있어 혼란을 유발했음(바로 위 追記
참고). 이번엔 이 둘을 "같은 로직, 하나의 결과"로 합쳤다.

### 구현
- `filterCollectedUrls()`가 제외된 항목들의 원본 `CrawlerUrlEntry`
  (`skippedEntries`)도 함께 반환하도록 확장 — 기존엔 개수만 반환.
- `AuctionsService.findByLinks(links)`(신규): URL(정확한 1:1 식별자)
  기준으로 기존 Auction을 찾는다. 기존 `findByAuctionNos`는 사건번호
  텍스트로만 찾아 법원 간 사건번호 충돌(운영 DB 실측 238건) 위험이
  있었음 — 건너뛴 물건 매칭은 이제 이 메서드를 쓴다.
- `CrawlerService`:
  - `pendingDuplicateResaleAuctionNos`(사건번호 문자열 배열) →
    `pendingSkipCrawlResaleLinks`(URL 배열)로 교체.
  - `resaleRunSummary`(신규, 인스턴스 필드): `{totalRequested,
    attempted, candidateFound, displayed, items}` — "조회 시작"
    시점에 `totalRequested = 크롤링대상 + 건너뛴대상`으로 초기화.
  - `recordResaleOutcome(auction, result)`(신규): 크롤링된 물건
    (`importItem` 콜백)과 건너뛴 물건(`runSkipCrawlResaleAnalysis`,
    기존 `runPendingDuplicateResaleAnalysis`를 이름까지 바꿔 URL 기반
    조회로 재작성) 양쪽에서 공통 호출해 같은 카운터에 합산.
  - `importItem`의 기존 무조건 발동 매도분석 호출에 `!options.mirror`
    가드 추가 — mirror 콜백까지 집계되면 중복 카운트가 생김.
  - `getResaleRunSummary()` + `GET /crawler/resale-run-summary`
    (신규 엔드포인트)로 프론트에 노출.
- `ResaleMatchService.processAuctionForResale()` 반환값에
  `score`/`tier`(1위 후보 점수·등급) 추가 — 결과 목록 표시용.
- 프론트 `CrawlerWorkPanel.tsx`:
  - "기존 DB 물건도 매도분석" 체크박스 → "매도분석"으로 라벨/설명 변경.
  - "조회 시작" 클릭 시 이 체크박스가 켜져 있으면 플래그만 남겨두고,
    크롤링이 끝나는 시점(`justFinished`)에 새 `GET
    /crawler/resale-run-summary`를 조회해 하나의 카드로 표시(요청/
    시도/후보/확정 4개 지표 + 물건별 목록).
  - 기존 `fetchResaleSoldStatsByCaseNo` 경로는 더 이상 호출하지
    않음(사건번호 충돌 문제도 있고 두 갈래로 나뉘어 있던 근본 원인이라
    폐기 — 함수/엔드포인트 자체는 당장 지우지 않고 남겨둠, 다른 용도로
    재사용될 수 있어 완전 삭제는 보류).

### 변경 파일
**auction-api**: `src/crawler/crawler-url.util.ts`,
`src/crawler/crawler.service.ts`, `src/crawler/crawler.controller.ts`,
`src/auctions/auctions.service.ts`,
`src/resale-match/resale-match.service.ts`.

**auction**: `src/lib/api.ts`, `src/app/admin/CrawlerWorkPanel.tsx`.

### 테스트 결과
`tsc --noEmit` + `npm run build` 클린(양쪽 모두). 실제 "매도분석"
체크박스로 대량 조회를 돌려 결과 카드에 정확한 합계가 뜨는지는 이
세션에서 직접 확인하지 못함(코드 리뷰 + 빌드까지만) — 배포 후 실사용
확인 권장.

## 追記 (2026-08-03) — 매도분석 완료 시점을 정확히 판정 + 진행 로그 추가

사용자 지적: "1번이미지(24건 누적)와 2번이미지(1건)가 다른 이유가
뭐야??" → "그러면 1건이 나올리가 없는데" → "매도분석이 끝나는 시점을
우리가 알 수는 없어?" → "어차피 api호출보내고 응답받아서 비교하는건
우리가 하는거자나".

**근본 원인(DB 직접 조사로 확인)**: 크롤링 234건은 22:42경 끝났는데,
매도분석(국토부 API 호출 포함)은 물건마다 비동기로 따로 돌아 실제
완료는 22:43~23:02 UTC에 걸쳐 흩어져 있었다(`auction_trade_match.
computedAt` 실측). "크롤링 끝났다" 신호가 뜨는 순간 딱 한 번만 결과를
재조회했던 게 "1건"의 원인 — 대부분 아직 진행 중이었음. 바로 앞
追記에서 "값이 더 안 바뀌면 완료"로 추측하는 폴링을 붙였었는데,
사용자가 "우리가 직접 API 호출하고 비교하는 거니까 정확히 알 수
있지 않냐"고 재차 지적 — 맞는 말이라 추측이 아닌 **정확한 카운터**로
교체.

### 구현
- `resaleRunSummary`에 `processed` 필드 추가 — "요청한 건을 실제로
  검토 완료했는지"를 완납일 없어 스킵된 건까지 포함해 정확히 센다.
  `processed >= totalRequested`가 되는 순간이 곧 100% 완료.
- `markResaleProcessed()`(신규): `processed` 증가 + 20건마다 진행
  로그(`[매도분석] 진행 중 N/총건수...`) + 완료 시 최종 로그
  (`[매도분석] 전체 완료... 매도 건수는 N건입니다`, 사용자가 요청한
  정확한 문구 반영).
- `recordResaleOutcome()`이 내부에서 `markResaleProcessed()`를
  호출하도록 재구성(기존엔 `attempted`인 경우에만 카운트해서, 완납일
  없어 스킵된 건은 영원히 안 세어져 processed가 totalRequested에
  도달 못 하는 문제가 있었음).
- `importItem()`의 "저장 스킵"(잘못된 데이터/변경 없음) 분기에도
  `markResaleProcessed()` 호출 추가 — 매도분석을 시도할 데이터 자체가
  없는 건도 "검토 끝"으로 즉시 표시.
- `runSkipCrawlResaleAnalysis()`: URL로 못 찾은 건(정상적으론 거의
  없음)도 즉시 `markResaleProcessed()` 호출해 누락 방지.
- 프론트 폴링(`CrawlerWorkPanel.tsx`)이 "2번 연속 값 안 바뀜" 추측
  대신 `processed >= totalRequested`를 완료 신호로 사용하도록 변경
  (타임아웃은 15분으로 늘려 안전장치로만 유지). 진행 중 배지에
  `processed/totalRequested` 진행률도 표시.

### 변경 파일
**auction-api**: `src/crawler/crawler.service.ts`.

**auction**: `src/lib/api.ts`(`processed` 필드), `src/app/admin/CrawlerWorkPanel.tsx`.

### 테스트 결과
`tsc --noEmit` + `npm run build` 클린(양쪽 모두). 실제 대량 조회로
`processed`가 정확히 `totalRequested`에 도달해 폴링이 멈추는지는 이
세션에서 직접 확인하지 못함 — 배포 후 실사용 확인 권장.

## 追記 (2026-08-03) — 오피스텔 매도분석 확장

사용자 요청: "작업 다 마무리하면 오피스텔도 매도 분석 할 수 있도록
검토해서 내용 추가해줘". 빌라 때와 동일한 패턴으로 실측 확인 —
`RTMSDataSvcOffiTrade`(오피스텔매매) API를 `BUILDING_REGISTER_API_KEY`로
직접 호출해보니 이미 `resultCode=000`(승인됨), 강남구 대치동
오피스텔 실거래 데이터 정상 수신 확인. `AuctionItem.propType`에
"오피스텔"이 이미 존재하고 매칭 로직 자체는 propType-무관이라(빌라 때
확인한 것과 동일한 구조), 수집 단계만 추가하면 됨.

### 구현
- `MolitTradeClientService.fetchOfficetelTrades(lawdCd, dealYm)`(신규):
  `RTMSDataSvcOffiTrade` 호출. 단지명 필드는 `offiNm`(→`aptNm`으로
  매핑), `landAr`/`houseType` 필드가 없다는 점에서 빌라 응답과 다름 —
  `landArea`는 자연히 null로 남음(빌라만 채워짐, 기존 동작 유지).
- `ActualTradeRow.houseType`/`TradeIngestionService`의 houseType 타입을
  `"APT" | "RH"` → `"APT" | "RH" | "OFFI"`로 확장(컬럼이 `text` 타입이라
  DB 마이그레이션은 불필요, TS 타입만 넓힘).
- `TradeIngestionService.ingestOne()`이 아파트+빌라+오피스텔 세 API를
  항상 함께(Promise.all) 수집하도록 확장 — 이유는 빌라 때와 동일(어떤
  propType이 그 지역에 걸려있는지 미리 알 수 없어 매번 다 수집).

### 변경 파일
`src/resale-match/molit-trade-client.service.ts`,
`src/resale-match/trade-ingestion.service.ts`,
`src/resale-match/entities/actual-trade.entity.ts`.

### 테스트 결과
`tsc --noEmit` + `npm run build` 클린. curl로 API 승인 상태만
실측했고, 실제 배포 후 오피스텔 물건이 매칭되는 사례는 데이터가
쌓여야 확인 가능(미확인).
