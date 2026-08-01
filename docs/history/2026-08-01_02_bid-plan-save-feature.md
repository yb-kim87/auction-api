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
