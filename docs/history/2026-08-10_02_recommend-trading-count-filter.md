# 추천물건 상세 필터: "N개년 실거래 개수" 필터 추가

## 배경
사용자 요청(2026-08-10): "국토부실거래가를 기반으로 3개년치 내용을
보여주고 있는데 상세필터에서 1개년 2개년 3개년치 실거래 개수 지정을
해서 필터할 수 있는 기능을 넣어줘. 예를 들면 1개년 10개이상 고르면
최신년도 거래건수 10개이상인물건만 보여준다거나 이런식으로".

"핵심 가격 요약"의 "주변 실거래 표본" 막대그래프(연도별 건수)는
`auctions.tradingCount` 컬럼(문자열, 예: "2026 5건, 2025 4건, 2024
2건")을 프론트에서 파싱해 만든다 — 이 값 자체는 국토부 실거래가를
탱크옥션이 표시한 텍스트를 파싱해 저장한 것(`trading-count.util.ts`의
`parseTradingCountFromDetail`). 저장 형식이 이미 연도별로 구분돼
있어, 새 필터도 이 컬럼을 그대로 재사용했다(별도 마이그레이션/재수집
불필요).

## 구현
- `auction-api/src/auctions/trading-count.util.ts`: 저장 문자열을
  다시 파싱하는 `parseTradingCountByYear()`, "최근 N개년" 합계를
  구하는 `sumRecentYearsTradingCount(tradingCount, years)` 추가.
  프론트 `AuctionDetailModal.tsx`의 `parseTradingCountSeries`와 동일한
  "올해 포함 직전 N개년 고정, 데이터 없는 연도는 0건" 규칙을 따른다
  (사용자 예시대로 1개년=올해만, 2개년=올해+작년, 3개년=올해+작년+
  재작년).
- `RecommendationEngineService`: `RecommendationFilters`에
  `tradingYears`/`tradingMinCount` 추가, 필터 체인 마지막에
  `sumRecentYearsTradingCount(item.tradingCount, tradingYears) <
  tradingMinCount`면 제외. 두 값이 모두 있어야 필터가 적용된다(하나만
  있으면 무시).
- `RecommendationController`: 쿼리 파라미터 `tradingYears`/
  `tradingMinCount` 추가.
- 프론트 `auction/src/app/page.tsx`(추천물건 "상세 필터" 모달):
  "주변 실거래 개수" 항목 추가 — 드롭박스(전체/1개년/2개년/3개년) +
  숫자 입력("N건 이상"), 연도를 안 고르면 숫자 입력 비활성화. 초기화/
  적용/필터 개수 배지에도 반영.
- `auction/src/lib/api.ts`: `RecommendationFilters` 타입과
  `fetchRecommendations()`의 쿼리 파라미터에 두 필드 추가.

## 범위 안내
"전체검색"(`/search`) 페이지는 별도의(테이블 컬럼형) 필터 UI를 쓰고
있어 이번 작업에 포함하지 않았다 — 추천물건("/", 상세 필터 모달)에만
적용. 필요하면 별도로 검색 페이지에도 추가 가능.

## 검증
백엔드/프론트 각각 `npx tsc --noEmit` 통과.
