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

## 追記 (2026-08-02) — 새 카테고리 Enter 미동작 버그 수정 + "관심물건" 전용 페이지 신설

사용자 피드백: "카테고리를 추가하고 저장하면 카테고리 리스트에 안뜨지??
그리고 카테고리로 추가한 물건은 카테고리별로 어떻게 관심물건을 구분해서
보지?"

**버그 원인**: 새 카테고리 입력창(`<input>`)이 `<form>`으로 감싸여
있지 않고 Enter 키 핸들러도 없어서, 사용자가 이름을 입력하고 Enter를
눌러도 아무 일도 일어나지 않았다(등록되려면 "추가" 버튼을 직접 클릭
해야 했음). 사용자가 등록됐다고 착각하고 다이얼로그를 닫으면 실제로는
저장이 안 돼 있어 "카테고리가 안 뜬다"는 문제로 이어졌다. `onKeyDown`
핸들러를 추가해 Enter로도 `confirmAddFavorite()`가 호출되도록 수정
(`AuctionDetailModal.tsx`).

**"카테고리별 관심물건 보기" 신설**: 지금까지는 카테고리를 저장은
하면서도 조회/필터링하는 화면이 전혀 없었다(이전 追記에서 이미 지적한
한계). AskUserQuestion으로 "별도 페이지로 새로 만들기"를 선택받아
`src/app/favorites/page.tsx`를 신규 제작:
- `fetchAuctions()`(전체 물건, 기존 search 페이지와 동일하게 클라이언트
  필터링 방식 재사용) + `fetchFavorites()`(카테고리 포함)를 조합해
  카테고리별로 그룹화.
- 상단에 "전체"/각 카테고리 칩 버튼으로 필터링, 카드 그리드로 물건
  표시(주소/유형/사건상태뱃지/최저가/입찰기일 + 카테고리 뱃지).
- 카드 클릭 시 기존 `AuctionDetailModal`을 그대로 재사용해 상세 확인 +
  관심해제/카테고리 재등록 가능.
- `middleware.ts`에 `/favorites` matcher 추가 — `/`, `/search`와 동일하게
  로그인 + `canAccessSearch(role)` 요구(물건 검색 권한이 없는 회원은
  접근 불가, 기존 정책과 일관).
- 홈(`/`)과 전체검색(`/search`) 헤더 nav에 "관심물건" 링크 추가.

### 변경 파일(추가분)
**auction**: `src/app/favorites/page.tsx`(신규),
`src/components/AuctionDetailModal.tsx`(Enter 키 수정),
`src/middleware.ts`, `src/app/page.tsx`, `src/app/search/page.tsx`
(헤더 nav 링크 추가).

### 테스트 결과
`tsc --noEmit` + `npm run build` 클린. 배포 후 실제 브라우저에서
Enter로 카테고리가 등록되는지, `/favorites` 페이지가 정상 렌더링되는지
직접 확인하지 못함 — 배포 확인 후 사용자 확인 필요.

## 追記 (2026-08-02) — /favorites 페이지 로딩 속도 문제(전체 물건 목록을 다 받던 버그)

사용자 피드백: "관심물건 불러오는 속도가 너무 느린데??" (스크린샷: 관심
0건인데도 "불러오는 중..."이 오래 유지됨).

**원인**: `/favorites` 페이지가 `fetchAuctions()`(승인된 전체 물건
목록, `GET /auctions`)를 그대로 재사용해 관심물건이 몇 건 안 되는데도
매번 DB의 전체 물건을 다 내려받고 있었다. `search` 페이지는 검색/필터
용도라 전체 목록이 필요하지만, 관심물건 페이지는 사용자가 찜한 소수
건만 있으면 되므로 불필요한 낭비였다.

**해결**: id 목록으로만 좁혀 조회하는 새 엔드포인트를 추가.
- `AuctionsService.findByIds(ids, isStaff, isAdmin)`(신규): `In(ids)`로
  좁혀 조회 후 기존 `findApproved()`와 동일한 role별 필드 스트립 로직
  재사용(`stripResaleMatchFields`/`stripStaffOnlyAuctionFields`).
- `GET /auctions/by-ids?ids=id1,id2,...`(신규) 컨트롤러 — 기존
  `@Get(":id/changes")`류와 경로 충돌 없음(바로 아래 리터럴 경로).
- 프론트 `fetchAuctionsByIds(ids)`(신규, `lib/api.ts`) — `/favorites`
  페이지가 `fetchFavorites()`로 즐겨찾기 id를 먼저 받은 뒤, 그 id들만
  `fetchAuctionsByIds()`로 조회하도록 교체(`fetchAuctions()` 호출 제거).

### 변경 파일(추가분)
**auction-api**: `src/auctions/auctions.service.ts`(`findByIds`),
`src/auctions/auctions.controller.ts`(`GET /auctions/by-ids`).

**auction**: `src/lib/api.ts`(`fetchAuctionsByIds`),
`src/app/favorites/page.tsx`(전체 목록 대신 by-ids 사용).

### 테스트 결과
`tsc --noEmit` + `npm run build` 클린(양쪽 모두). 배포 후 실제 로딩
속도 개선 여부는 이 세션에서 직접 측정하지 못함 — 사용자 확인 필요.

## 追記 (2026-08-04) — 관심등록 유지 상태에서 카테고리 변경 및 카테고리 영속화

사용자 피드백: 관심물건의 카테고리를 바꾸려면 관심등록을 해제한 뒤 다시
등록해야 했고, 새 카테고리를 여러 개 만들어도 실제 물건에 배정되지 않은
카테고리는 목록에서 사라져 하나만 보였다.

**원인**: 카테고리를 독립 데이터로 저장하지 않고 `auction_favorites`에서
현재 사용 중인 category 값만 `DISTINCT` 조회했다. 관심물건이 한 개라면
그 물건의 분류를 바꾸는 순간 이전 분류의 사용 건수가 0이 되어 목록에서
사라지는 구조였다.

**해결**:
- `favorite_categories` 테이블과 `FavoriteCategory` 엔티티를 추가해 회원별
  카테고리 이름을 관심물건 배정 상태와 독립적으로 보존한다.
- `POST /favorites/categories`로 카테고리만 먼저 생성할 수 있게 했고,
  `GET /favorites/categories`는 저장된 카테고리와 기존 관심물건에 사용 중인
  카테고리를 합쳐 반환한다. 마이그레이션 시 기존 분류도 자동 이관한다.
- 관심등록된 상태에서 상단 버튼을 누르면 해제하지 않고 `카테고리 변경`
  창이 열린다. 기존 카테고리 칩을 누르면 등록 상태를 유지한 채 분류만
  즉시 갱신한다.
- 새 카테고리의 `추가`는 카테고리 목록만 늘리고 창을 닫거나 현재 물건을
  자동 이동시키지 않는다. 여러 분류를 연속으로 만든 뒤 원하는 칩을 골라
  배정할 수 있다.
- `미분류로 변경`과 `관심 해제`를 별도 동작으로 분리했다.

### 운영 API 구버전 응답 호환

프론트가 신규 `GET /favorites` 응답의 `items`만 읽는 동안 운영 API가
기존 `auctionIds` 형식을 반환해, 추천 화면에는 관심물건 7건이 보이지만
`내 물건`에는 0건으로 표시되는 배포 시차 문제가 있었다. `fetchFavorites()`가
두 형식을 모두 지원하도록 수정했고, `items`가 없는 구버전 응답은
`auctionIds`를 미분류 관심물건으로 변환한다.

### 변경 파일 및 커밋
- `auction-api`: `src/favorites/favorite-category.entity.ts`, favorites
  controller/module/service, TypeORM 설정, 마이그레이션
  `1784276000000-CreateFavoriteCategories.ts` — `662e1a8`.
- `auction`: `src/components/AuctionDetailModal.tsx`, `src/lib/api.ts`,
  `src/app/favorites/page.tsx` — 주요 UX `9dcf486`, 구버전 응답 호환
  `7eb1f12`.

## 追記 (2026-08-04) — 관심등록 메모 필드 추가

사용자 요청: "관심물건에 추가할때 메모도 할 수 있게 해줘, 이건 내물건에서도
볼 수 있게 해주고", 이어서 "물건상세보기 상단에 메모 내용이 보이면 좋을꺼같아".

- `auction_favorites`에 `memo`(nullable text) 컬럼 추가(마이그레이션
  `1784277000000-AddAuctionFavoriteMemo` — 같은 시각대에 동시 진행 중이던
  다른 세션의 `1784276000000-CreateFavoriteCategories`와 번호가 겹쳐
  1784277000000으로 조정).
- `FavoritesService.add()`가 category와 함께 memo도 upsert.
- 프론트 관심등록 카테고리 선택 팝업(`AuctionDetailModal.tsx`)에 메모
  textarea를 추가 — 등록/카테고리 변경 시 함께 저장.
- 물건 상세 모달 상단(스티키 헤더 바로 아래)에 관심물건이고 메모가 있으면
  배너로 표시.
- "내 물건" 관심물건 카드에도 메모 미리보기(2줄) 표시.
- 추천 물건(`page.tsx`)도 `fetchFavoriteIds` 대신 `fetchFavorites`로
  전환해 category/memo를 함께 들고 있도록 리팩터링(아래 카테고리 필터
  기능과 공용).

## 追記 (2026-08-04) — 관심물건 카테고리별 필터(추천 물건 페이지)

사용자 요청: "관심물건을 누를때 카테고리별로도 물건을 볼 수 있게 해줘"
(스크린샷 — 추천 물건 페이지에서 "관심물건(1)" 토글 활성화 시 카테고리
구분 없이 전체 목록만 나옴).

- `favorites/page.tsx`(내 물건)에는 이미 카테고리 칩 필터가 있었지만,
  추천 물건 메인 페이지(`page.tsx`)의 "관심물건" 토글에는 없었다.
- `filters.favoritesOnly` 활성 시 그 아래에 카테고리 칩 바(전체/카테고리별/
  미분류)를 추가하고, `favoriteCategoryFilter` 상태로 `filteredItems`를
  클라이언트에서 한 번 더 거른다(서버는 favoritesOnly만 필터링, 카테고리는
  이미 로드된 관심물건 메타로 클라이언트에서 필터).
- 관심물건 토글을 끌 때 카테고리 필터도 함께 초기화.

## 追記 (2026-08-04) — "내 물건"에서 관심물건이 0개로 보이는 버그 수정

사용자 리포트: "현재 관심물건이 7개나 있는데 내물건 관심물건에는 1개도
안나오는데 이거 연결되도록 해줘 확인해서" (스크린샷 — 추천 물건 헤더는
"관심물건 (7)", 내 물건 페이지는 "아직 등록한 관심물건이 없습니다").

**원인**: `favorites/page.tsx`에서 `fetchFavorites()`와
`fetchMyBidPlans()`를 `Promise.all`로 묶고 공용 `.catch`에서 실패 시
`favorites`까지 통째로 `[]`로 리셋했다. 헤더 카운트는 `fetchFavoriteIds()`
단독 호출이라 영향을 안 받았지만, 내 물건 페이지는 입찰계획 조회(또는
뒤이은 `fetchAuctionsByIds`)가 실패하면 관심물건 자체는 정상 조회됐어도
화면에서 전부 사라졌다. 두 데이터소스가 다른 게 아니라 에러 처리 설계
결함이었다(Explore 서브에이전트로 확인).

**해결**: `Promise.all` → `Promise.allSettled`로 바꿔 관심물건/입찰계획
조회를 서로 독립적으로 처리 — 한쪽이 실패해도 다른 쪽 성공 결과는
그대로 반영한다.

### 검증
양쪽 저장소 `npx tsc --noEmit` 통과. 로컬 API 재기동 후 sql.js에
`favorite_categories` 테이블 생성과 프론트/API 포트 응답을 확인했다.
