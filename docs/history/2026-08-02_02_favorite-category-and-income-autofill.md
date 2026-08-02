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

## 追記 (2026-08-02) — 관심물건 카테고리를 자유입력→재사용 목록 선택 방식으로 변경

사용자 피드백: "관심물건 등록하면 카테고리 쓰라고 나오는데... 현재는
카테고리 입력후 어떻게 처리되는지 모르겠어. 생성된 카테고리를
생성해서 추가하는 방식으로 하면 좋을꺼같아" — 매번 `window.prompt`로
새로 타이핑하게 했던 최초 구현을, 이전에 만든 카테고리 목록에서
버튼으로 바로 고르거나 새 이름을 입력해 추가하는 다이얼로그로 교체.

- `FavoritesService.listCategories(username)`(신규): 해당 회원이
  등록한 관심물건들의 `category` 중 null이 아닌 값만 중복 제거해
  가나다순으로 반환(`DISTINCT` 쿼리).
- `GET /favorites/categories`(신규, `requireAuth`) 컨트롤러 추가.
- 프론트 `fetchFavoriteCategories()`(`lib/api.ts`) 추가.
- `AuctionDetailModal.tsx`: "관심등록" 클릭 시 `window.prompt` 대신
  `favoritePickerOpen` 다이얼로그를 띄우고, 열리는 시점에
  `fetchFavoriteCategories()`로 기존 카테고리 목록을 불러와 버튼
  칩(chip) 형태로 표시. 목록에서 클릭하면 바로 등록되고, 하단
  입력창에 새 이름을 넣고 "추가"를 누르면 그 이름으로 신규 등록(다음
  번엔 자동으로 목록에 포함됨 — 별도의 "카테고리 생성" API는 따로
  두지 않고, 관심물건에 실제로 쓰인 category 값 자체가 곧 카테고리
  목록이 되는 구조). "미분류로 등록"/"취소" 버튼도 유지.
- 참고: 카테고리 값 자체는 이전 追記에서 이미 저장되고 있었지만
  ("입력 후 어떻게 처리되는지 모르겠다"는 지적대로) 지금까지는 이를
  보여주거나 필터링하는 UI가 전혀 없었다 — 이번 변경은 저장 로직이
  아니라 입력 UX만 개선한 것이고, 카테고리별로 관심물건을 모아보는
  화면은 아직 없음(추후 요청 시 별도 작업 필요).

### 변경 파일(추가분)
**auction-api**: `src/favorites/favorites.service.ts`,
`src/favorites/favorites.controller.ts`.

**auction**: `src/lib/api.ts`, `src/components/AuctionDetailModal.tsx`.

### 테스트 결과
`tsc --noEmit` + `npm run build` 클린(양쪽 모두). 배포 후 실제 다이얼로그
동작(카테고리 선택→등록, 새 카테고리 추가 후 목록에 반영되는지)은 이
세션에서 직접 확인하지 못함.
