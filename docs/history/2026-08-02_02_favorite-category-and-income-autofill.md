# 관심물건 카테고리 태깅 + 수익계산기 기존소득 자동입력

## 배경
사용자 요청 두 가지(같은 대화에서 이어짐):
1. "강의 상세에서 관심등록할때 카테고리 지정해서 등록할 수 있게
   적용해줘" — 스크린샷을 보니 실제로는 강의가 아니라 매물(경매물건)
   상세의 "관심물건 해제/관심등록" 기능이었음(AskUserQuestion으로
   확인). 카테고리는 고정 목록이 아니라 자유 텍스트 직접 입력, 관심
   등록 시점에 바로 선택하는 방식으로 확정.
2. "여기에 내 소득을 입력하는데 수익계산기 기존소득에 이 값이
   자동으로 들어가서 계산되게 해줘" — 회원 투자정보(연순소득)가 물건
   상세 수익계산기의 "기존소득(연간)" 입력값에 자동 반영되지 않고
   항상 0으로 시작하던 문제.

## 구현

### 1) 관심물건 카테고리
- `AuctionFavorite` 엔티티에 `category: string | null`(nullable)
  추가 — 마이그레이션 `1784266000000-AddAuctionFavoriteCategory.ts`.
- `FavoritesService.add(username, auctionId, category?)`: 신규 등록
  시 category 저장, 이미 등록된 물건이면 category가 새로 주어진
  경우에만 갱신(빈 값이면 기존 값 유지).
- `FavoritesService.list(username)`(신규): `{auctionId, category}[]`
  반환. 기존 `listAuctionIds()`는 하위호환을 위해 그대로 유지.
- `FavoritesController GET /favorites` 응답에 `items`(category 포함)
  필드 추가(`auctionIds`는 기존 그대로 유지).
- `FavoritesController POST /favorites/:auctionId`가 body로
  `{category?}`를 받도록 확장.
- 프론트 `AuctionDetailModal.tsx`: "관심등록" 클릭 시(이미 등록된
  걸 해제할 때는 묻지 않음) `window.prompt()`로 카테고리를 직접
  입력받아 `onToggleFavorite(true, category)`로 전달(취소하면 등록
  안 함, 비워두면 미분류로 등록). 기존에 이 코드베이스에
  `window.prompt` 사용 전례가 있어(`KakaoNotifyPanel.tsx`) 같은
  패턴을 재사용.
- `onToggleFavorite` 콜백 시그니처를 `(next, category?)`로 확장하고
  `src/app/page.tsx`/`src/app/search/page.tsx`의
  `handleToggleFavorite`가 category를 받아 `addFavorite(auctionId,
  category)`로 전달하도록 수정.
- `src/lib/api.ts`: `addFavorite(auctionId, category?)` 확장,
  `fetchFavorites(): FavoriteItem[]`(신규, category 포함 목록) 추가.
  기존 `fetchFavoriteIds()`는 그대로 유지.

### 2) 수익계산기 기존소득 자동입력
- `ProfitCalculatorPanel`에 `annualNetIncomeWon?: number | null` prop
  추가 — `useState(annualNetIncomeWon ?? 0)`으로 `existingIncome`
  초기값을 설정(기존엔 무조건 0). 저장된 입찰계획이 있으면 기존
  로직 그대로 그 값이 우선 적용됨(변경 없음).
- `AuctionDetailModal.tsx`가 이미 갖고 있던 `annualNetIncome`(문자열,
  예: "4,000만원") prop을 기존 `parseIncomeToWon()`
  유틸(`lib/investment-money.ts`, 추천기준 파싱에 이미 쓰이던 함수)로
  파싱해 `ProfitCalculatorPanel`에 넘김.
- `src/app/search/page.tsx`의 `<AuctionDetailModal>` 호출에
  `annualNetIncome={profile?.annualNetIncome ?? null}`이 아예
  빠져있었던 것도 이번에 추가(`src/app/page.tsx` 쪽은 이미 전달하고
  있었음).

## 변경 파일
**auction-api**: `src/favorites/auction-favorite.entity.ts`,
`src/favorites/favorites.service.ts`,
`src/favorites/favorites.controller.ts`,
`src/migrations/1784266000000-AddAuctionFavoriteCategory.ts`(신규).

**auction**: `src/lib/api.ts`, `src/components/AuctionDetailModal.tsx`,
`src/components/ProfitCalculatorPanel.tsx`, `src/app/page.tsx`,
`src/app/search/page.tsx`.

## 테스트 결과
`auction`/`auction-api` 모두 `npx tsc --noEmit` + `npm run build`
클린 확인. 실제 브라우저에서 관심등록 시 prompt가 뜨고 카테고리가
저장되는지, 수익계산기 기존소득이 자동으로 채워지는지는 이 세션에서
직접 확인하지 못함 — 배포 후 확인 권장. 배포 후 `railway
status`/헬스체크, `npx vercel inspect`로 정상 기동 확인 예정(이
문서에 追記).
