# 프론트엔드(auction) 아키텍처 리팩터 — 컴포넌트화 + zustand 전역 상태 + axios/TanStack Query 전환

## 배경

사용자 요청(2026-08-20): `young/auction`(Next.js 14 App Router 프론트) 코드
효율화를 위해 3가지를 순서대로 진행해달라는 요청.

1. `src/app`은 라우팅만 담당하고, 각 `page.tsx`는 컴포넌트를 호출만 할 것.
2. zustand 같은 전역 상태 관리 라이브러리로 유저 프로필을 전역 관리해서,
   컴포넌트마다 `useEffect`로 무분별하게 중복 요청되는 `fetchMyProfile()`을
   없앨 것.
3. API 요청을 fetch 대신 axios + TanStack Query로 전환할 것.

사용자가 "하나하나씩" 진행을 원해서 각 단계를 순서대로, 단계마다 데모
1개 → 검토 승인 → 나머지 전체 적용의 흐름으로 진행했다(1단계는
`search/page.tsx` 1개로 시범을 보이고 승인받은 뒤 나머지 21개 파일 진행,
3단계는 인프라+홈페이지 1개로 시범을 보이고 승인받은 뒤 나머지 19개
페이지 진행).

## 1단계 — 컴포넌트화 (src/app은 라우팅만)

`src/app/**/page.tsx` 22개(순수 리다이렉트 2개 제외) 전부를
`src/components/<route>/<Name>PageClient.tsx`로 이동하고, `page.tsx`는
5줄 안팎의 래퍼로 축소:

```tsx
import { XPageClient } from "@/components/x/XPageClient";
export default function XPage() {
  return <XPageClient />;
}
```

**명명 규칙**: `src/components/<kebab-case-route-name>/<PascalCaseName>PageClient.tsx`,
named export(`export function XPageClient()`), `page.tsx` 래퍼는 서버
컴포넌트로 두고(`"use client"` 없음) 내부 컴포넌트에만 `"use client"`.

**예외 처리**:
- `src/app/assignments/page.tsx`, `src/app/lecture/[token]/page.tsx`는
  순수 리다이렉트라 추출할 UI가 없어 그대로 둠.
- `useSearchParams()`를 쓰는 두 곳(`auth/kakao/callback`, `account`)은
  정적 export를 위한 `Suspense` 경계를 그대로 유지.
- `src/app/admin/*.tsx`에 있던 기존 하위 패널 컴포넌트들(`CrawlerWorkPanel`,
  `KakaoNotifyPanel`, `AssignmentReviewTab` 등 39개)은 페이지가 아니라서
  옮기지 않고 제자리에 둠 — `AdminPageClient.tsx`가 `@/app/admin/...`
  경로로 그대로 import.
- 상대경로 import(`./AuctionFormModal` 등)는 컴포넌트가 `src/app/*` 밖으로
  이동하면서 절대경로(`@/app/admin/AuctionFormModal`)로 교정.

가장 큰 4개: 홈 `page.tsx`(1591줄), `admin/page.tsx`(1287줄),
`courses/page.tsx`(953줄), `courses/apply/page.tsx`(813줄)까지 전부 동일
패턴으로 처리.

## 2단계 — zustand 전역 유저 프로필 스토어

1단계 검토 중 실측 확인: `useHeaderAuth`/`HeaderBell`/`HeaderAuthArea`/
`BellIcon`이 `courses`/`courses/apply`/`courses/webinar` 3개 파일에 토씨
하나 안 틀리고 복붙돼 있었고, `fetchMyProfile()`을 컴포넌트 15곳이 각자
`useEffect`로 따로 호출하고 있었다(사용자가 원래 지적한 문제 그대로).

- `src/store/useProfileStore.ts` 신설: `profile`/`status`/`fetchProfile`/
  `setProfile`/`patchProfile`/`clearProfile`. `fetchProfile()`은 이미
  로드됐거나 요청이 진행 중이면 그 결과/Promise를 재사용해, 여러 페이지가
  동시에 마운트돼도 `/users/me` 요청이 한 번만 나가게 함.
- `src/components/course-site/CourseSiteHeaderAuth.tsx` 신설: 위 3개
  파일에 중복됐던 헤더 인증 로직을 한 곳으로 통합, 스토어 기반으로 재작성.
- `fetchMyProfile()`을 직접 호출하던 15개 지점(홈, admin, search, account,
  favorites, favorites/calendar, consultant, courses/my, login, pending,
  reports, courses/[courseId], ProfitCalculatorPanel 등) 전부를 스토어
  경유로 교체. 로그아웃 시 `clearProfile()`, 프로필 수정 시
  `setProfile`/`patchProfile`로 스토어도 함께 갱신.

## 3단계 — axios + TanStack Query 전환

`src/lib/api.ts`가 5297줄에 fetch 호출 214곳, 함수 280개로 매우 커서,
전체를 한 번에 손으로 바꾸는 대신 두 단계로 나눠 진행(사용자에게 범위를
먼저 물어보고 "인프라+데모 1개" 승인받음).

### axios 도입 방식 — `apiFetch` 어댑터

`src/lib/http.ts`에 `window.fetch`와 동일한 시그니처
(`apiFetch(url, init): Promise<Response>`)의 axios 기반 어댑터를 만들고,
`api.ts` 전체에서 `fetch(` → `apiFetch(` 로 스크립트 치환(209곳, 파이썬
정규식 일괄 치환 후 typecheck로 검증). 각 함수의 에러 파싱/JSON 처리
로직(`parseErrorMessage`, `readJsonResponse` 등)은 전혀 건드리지 않고
네트워크 전송 계층만 axios로 옮기는 방식이라 동작이 100% 동일하게
유지되면서도 전체 API 레이어가 axios 위에서 돈다.

**중요 주의사항(재발 방지용으로 기록)**: 기존에
`src/lib/auth-fetch-interceptor.ts`가 전역 `window.fetch`를 감싸서
accessToken(30분) 만료 시 401 → refreshToken으로 재발급 → 원 요청 재시도
로직을 갖고 있었는데, **axios는 `window.fetch`를 거치지 않으므로 이
로직이 자동으로 적용되지 않는다.** 이걸 놓치면 axios로 전환한 요청들만
30분마다 강제 로그아웃되는 회귀가 생긴다. `apiFetch` 내부와 axios
인스턴스(`http`)의 response interceptor 양쪽에 동일한 401 재발급+재시도
로직을 다시 구현해서 해결했다 — axios로 새 요청을 추가할 때 이 갱신
로직이 빠지지 않았는지 항상 확인할 것.

### TanStack Query 도입

`src/app/providers.tsx`에 `QueryClientProvider` 설정, 루트 레이아웃에
연결. 19개 페이지 클라이언트의 수동 `useEffect`+`useState` 데이터 로딩을
`useQuery`/`useInfiniteQuery`/`useMutation`으로 전환하면서, 같은 데이터를
여러 페이지가 쓰는 경우 쿼리 키를 공유해 캐시도 같이 쓰도록 함:

- `["favorites"]` — 홈페이지, 관심물건 페이지, 캘린더 페이지가 공유.
- `["landing-images"]` — courses/courses-apply/courses-webinar 3개가 공유.
- 관심물건 토글은 `useMutation` + `onMutate`로 낙관적 업데이트, 실패 시
  `onError`에서 이전 캐시로 롤백(기존 로컬 state 낙관적 업데이트 패턴과
  동일한 사용자 경험 유지).
- 관리자 페이지(가장 복잡, 1287줄): 통계/목록(페이지네이션)/승인대기/
  회원 4종 쿼리로 분리, 13곳의 `loadData()` 호출을 `reloadData()`(해당
  쿼리들 `invalidateQueries`)로 교체.
- 검색 페이지: 물건 전체 목록/관심물건ID/대출정책/규제지역/소득배수 5개
  독립 쿼리로 분리 — 기존에 `Promise.allSettled`로 "하나 실패해도 나머지는
  살아있게" 처리하던 패턴이 React Query에서는 쿼리마다 에러 상태가
  독립적이라 자연스럽게 유지됨.

**의도적으로 손대지 않은 부분**:
- `admin`의 하위 패널들(`src/app/admin/*Panel.tsx`, `*Tab.tsx` — 이번
  리팩터 대상인 19개 `PageClient`에는 포함 안 됨)은 여전히 수동 fetch
  패턴. 다음에 필요하면 후속 작업으로 진행.
- `MyCourseClient`(courses/[courseId])의 영상 재생/진도저장 로직은 상태가
  복잡하고 전환 리스크 대비 이득이 낮아 원본 그대로 유지, 노트/질문/자료
  목록만 useQuery/useMutation으로 전환.
- 서버 사이드 라우트 핸들러(`src/app/api/**/route.ts`)와 admin의 로컬
  에이전트 호출(`SwimApplyTab.tsx`)은 애초에 이 리팩터 대상(클라이언트
  `api.ts`)이 아니라서 그대로 둠.

## 검증

- 매 단계마다 `npx tsc --noEmit -p tsconfig.json` + `rm -rf .next && npm run build`
  (33개 라우트 전부 정상 생성) 통과 확인.
- dev 서버 기동 후 `/login` 등 주요 페이지 200 응답·콘솔 크래시 없음 확인.
  이 개발 환경에는 백엔드(auction-api, 3001)가 떠 있지 않아 실제 로그인
  플로우 자체는 이 세션에서 못 돌려봤음 — 로컬에서 이어서 작업할 때는
  `cd auction-api && npm run start:dev`로 백엔드를 띄운 뒤 실사용 흐름을
  한 번 확인할 것.
- 커밋: `2e32596` "Refactor: componentize pages, add zustand profile store,
  migrate to axios + TanStack Query" (59 files changed).

## 앞으로 새 코드를 작성할 때 지킬 규칙

`young/auction/CLAUDE.md`에 규칙으로 정리해뒀다(요약):
1. 새 라우트는 `page.tsx`를 라우팅 전용 래퍼로, UI는
   `src/components/<route>/<Name>PageClient.tsx`에 작성.
2. 로그인한 유저 프로필이 필요하면 직접 `fetchMyProfile()`을 부르지 말고
   `useProfileStore`를 사용.
3. 새 API 함수는 `src/lib/api.ts`에 axios(`apiFetch`/`http`) 기반으로
   추가하고, 컴포넌트에서는 `useQuery`/`useMutation`/`useInfiniteQuery`로
   호출 — 컴포넌트 안에서 직접 `useEffect`+`fetch`로 데이터를 받아오지
   않는다.
