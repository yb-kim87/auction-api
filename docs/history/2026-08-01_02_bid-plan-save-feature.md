# 입찰 계획 저장 기능 (수익계산기)

## 배경
사용자 요청(2026-08-01): "물건을 보고 수익계산기에 내용을 채워넣으면
이렇게 입찰해야겠다라는 생각이 들게 저장하거나 그러고 싶은데 좋은 방법이
있을까??" → AI가 "입찰 계획 저장" 방식(계산기 입력값 스냅샷을 물건+
회원 단위로 저장, 관심물건과 비슷한 패턴)을 제안하고 승인받음.
"회원별로 적용되는거지?" 확인 → 즐겨찾기와 동일하게 로그인 계정
단위로 저장.

## 구현

### 백엔드 (`auction-api`)
- 신규 엔티티 `AuctionBidPlan`(`src/bid-plan/bid-plan.entity.ts`,
  테이블 `auction_bid_plans`): `(username, auctionId)` 유니크 제약으로
  회원+물건당 1개만 저장(재저장은 upsert). 핵심 값(`bidPrice`/
  `salePrice`/`finalProfit`/`requiredEquity`/`memo`)은 별도 컬럼으로
  둬서 목록 조회 시 계산 없이 바로 보여줄 수 있게 하고, 계산기의
  나머지 모든 입력값(보유기간/대출비율/이자율/인테리어비용 등)은
  `inputsJson`에 통째로 직렬화해 저장 — 계산기 항목이 늘어날 때마다
  컬럼을 추가할 필요가 없게 함.
- `bid-plan.service.ts`: `save`(upsert)/`findOne`/`remove`/`findMine`
  (물건 주소·사건번호를 조인해 목록용으로 반환).
- `bid-plan.controller.ts`: `GET /bid-plans`(내 목록), `GET
  /bid-plans/:auctionId`(단건 조회, 계산기 프리필용), `POST
  /bid-plans/:auctionId`(저장), `DELETE /bid-plans/:auctionId`(삭제).
  전부 `requireAuth`만 요구(로그인만 하면 이용 가능, 관심물건과 동일
  수준).
- `bid-plan.module.ts` 신규, `app.module.ts`/`typeorm.config.ts`
  엔티티 배열에 등록(CLAUDE.md 규칙 — forFeature만 등록하고 전역
  entities 배열을 빠뜨리면 배포 직후 크래시하는 사고가 있었던 패턴을
  반복하지 않기 위해 처음부터 같이 등록).
- 마이그레이션 `1784261000000-CreateAuctionBidPlans.ts`.

### 프론트엔드 (`auction`)
- `lib/api.ts`: `BidPlan`/`BidPlanWithAuction` 타입, `fetchBidPlan`/
  `fetchMyBidPlans`/`saveBidPlan`/`deleteBidPlan` 추가.
- `ProfitCalculatorPanel.tsx`: 물건 상세를 열면 저장된 계획이 있는지
  자동 조회해 있으면 계산기 입력값을 그대로 복원(prefill). 상단에
  메모 입력창 + "이 계획 저장하기"/"삭제" 버튼과 마지막 저장 시각
  표시를 추가.

## 남은 것 (의도적으로 범위 밖)
저장한 계획들을 한눈에 모아보는 별도 목록 화면(예: 계정 페이지의
"나의 입찰계획" 탭)은 이번엔 만들지 않았다 — 핵심 요청(저장/재열람)은
물건 상세를 다시 열면 자동 복원되는 것으로 충족되고, 목록 UI는 필요
시 `GET /bid-plans`를 그대로 활용해 추가하면 된다.

## 검증
- 양쪽 저장소 `npx tsc --noEmit`, `npm run build` 통과.

## 追記 (2026-08-04) — 입찰계획 UX 정리 및 "내 물건" 통합 목록

초기 구현에서는 수익계산기 상단의 메모 입력창과 저장 영역이 항상 크게
노출되어 실제 수익 계산보다 저장 UI가 먼저 보였다. 또한 위의 "남은 것"에
기록했던 저장 계획 목록이 없어 사용자가 어느 물건에 어떤 계획을 저장했는지
한눈에 확인할 수 없었다.

- 상세 탭 명칭을 `수익계산기`에서 사용자의 행동 목적이 드러나는
  `입찰계획`으로 변경하고 아이콘도 문서형 아이콘으로 통일했다.
- 계산기 상단 제목을 `나의 입찰 계획`으로 정리하고 `계획 저장` 버튼을
  제목 옆에 배치했다. 메모 입력 영역은 버튼을 누를 때만 펼쳐지므로 초기
  화면에서는 핵심 계산 결과와 입력 항목에 집중할 수 있다.
- 기존 `/favorites` 페이지를 `내 물건` 허브로 확장하고 `관심물건`과
  `입찰계획` 탭을 제공한다. `GET /bid-plans` 결과와 관련 물건을 id로 묶어
  입찰가, 예상 매도가, 실제 준비자금, 예상 수익, 수익률, 메모와 저장일을
  목록에서 확인할 수 있다.
- 관심물건과 입찰계획에 동시에 포함된 물건은 중복 조회하지 않으며,
  `fetchAuctionsByIds()`로 필요한 물건만 조회한다. 헤더 메뉴 명칭도
  `관심물건`에서 `내 물건`으로 통일했다.

따라서 위의 "저장한 계획들을 모아보는 화면은 범위 밖"이라는 설명은
현재 상태에는 더 이상 해당하지 않는다.

### 변경 파일
`auction/src/components/ProfitCalculatorPanel.tsx`,
`auction/src/components/AuctionDetailModal.tsx`,
`auction/src/app/favorites/page.tsx`, `auction/src/app/page.tsx`,
`auction/src/app/search/page.tsx`, `auction/src/lib/api.ts`.

### 검증
프론트엔드 `npx tsc --noEmit` 통과. 관련 프론트 변경은 커밋
`9dcf486`에 포함되어 `main`에 반영했다.

## 追記 (2026-08-05) — 수익 요약 자금 명칭 정리

입찰계획 수익 요약의 `실제 준비자금`은 입찰·낙찰 뒤 실제로 마련해야 하는
현금이라는 의미를 더 직접적으로 전달하도록 `실제 필요자금`으로 변경했다.
상세보기와 최종 합계 라벨도 같은 명칭으로 통일했으며 계산식
(`낙찰가 + 취득·보유 초기비용 - 대출금`)과 저장 데이터는 변경하지 않았다.

### 변경 파일
`auction/src/components/ProfitCalculatorPanel.tsx`,
`auction/src/lib/profit-calculator.ts`.
