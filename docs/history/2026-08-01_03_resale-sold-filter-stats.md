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
