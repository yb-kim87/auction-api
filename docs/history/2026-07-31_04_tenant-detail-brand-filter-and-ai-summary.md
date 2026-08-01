# 임차인 점유현황: 출처 브랜딩 안전장치 + AI 핵심요약

## 배경
사용자 요청(2026-08-01): "임차인 점유현황에서 분석 부분이 탱크옥션
전용일 수도 있으려나???" → 조사 결과 현재 문구에 "탱크옥션" 노출은
없으나, 원문 자유서술 텍스트를 가공 없이 저장/노출하는 구조라
방어적으로 필터가 필요하다는 결론. 이어서 "원문 내용도 필요한
내용으로 가공이 가능할까"라는 요청으로 AI 핵심요약 기능을 3~4건
실제 데이터로 테스트해본 뒤 도입 결정.

## 1. 출처 브랜딩 안전장치
`src/auctions/address-parser.ts`에 `stripSourceBrandMentions()` 추가 —
"탱크옥션"/"tankauction" 패턴을 정규식으로 치환. `cleanBuildingRegistry`/
`cleanTenantDetail`(둘 다 `Auction` 엔티티의 `@AfterLoad` 훅
`normalizeDisplayFields()`에서 호출됨) 안에서 적용해, 엔티티가 로드되는
모든 경로(검색 목록/추천 목록/관리자 화면/AI 분석 프롬프트 등)에
일괄 적용되도록 함. 별도 엔드포인트마다 필터를 챙길 필요 없이 중앙
한 곳에서 방어.

## 2. AI 핵심요약 (`tenantSummary`)
- 마이그레이션 `1784260000000-AddAuctionTenantSummary.ts`: `auctions`에
  `tenantSummary`(text, nullable) 추가.
- `ai-analysis.service.ts`의 `getOrCreateTenantSummary(auctionId, role)`:
  이미 `tenantSummary`가 있으면 캐시 반환(OpenAI 미호출), 없으면
  `tenantDetail` 원문을 `OpenAiService.answerFreeform()`으로 1~2문장
  요약해 저장 후 반환 — **물건당 1회만 호출, 이후 무제한 캐시 재사용**
  (사용자가 "AI 요약 넣으면 매번 호출해야 하는거 아니냐"고 비용을
  우려해 캐싱 설계를 명확히 함).
- `ai.controller.ts`: `POST /ai/auctions/:auctionId/tenant-summary`
  (`requireSearchAccess`).
- 사전 검증: 실제 프로덕션 데이터 4건(대항력 여지 있음/조사불가/HUG
  인수조건변경/임차인 없음)으로 로컬 스크립트를 돌려 결과를 사용자에게
  직접 보여주고 승인받은 뒤 구현.

### 프론트엔드
- `lib/api.ts`: `fetchTenantSummary(auctionId)` 추가.
- `TenantStatusPanel.tsx`: 새 `TenantSummaryBanner` 컴포넌트 — 모달을
  열면(compact 모드 제외) 자동으로 요약을 불러와 상단에 배너로 표시.
  **원문(표/기타사항)은 그대로 아래에 유지**(사용자 요청: "원문도
  보여줘야지" — 요약이 원문을 대체하지 않고 헤드라인 역할만 함).

## 검증
- 양쪽 저장소 `npx tsc --noEmit`, `npm run build` 통과.

## 追記 (2026-08-01) — AI 핵심요약 기능 제거

사용자 요청("ai 핵심요약은 없애자 어차피 권리분석에 나오니까 전에껄로
바꾸자")으로 `tenant-summary` 엔드포인트/서비스 메서드/프론트 배너를
전부 제거했다. AI 권리분석 탭에서 이미 같은 정보(대항력 판단 등)를
다루고 있어 중복이라는 판단. `tenantSummary` DB 컬럼은 남겨뒀지만
더 이상 채워지지 않는다(제거하려면 별도 마이그레이션 필요, 당장은
불필요 판단).

같은 작업 도중 별도로, 표의 "대항력" 컬럼도 탱크옥션 원본 값을 그대로
믿지 않고 전입일/말소기준등기일을 직접 비교해 판단하도록 변경했고
(원본 값이 같은 임차인의 양도인/승계인 행마다 서로 달라 혼동을 준
사례 실측), 보증기관(HUG 등) 승계+보증금반환채권 포기 문구가 있으면
임차인명 옆에 "임차권 포기" 배지를 추가했다 — 이 두 가지는 유지.
