# 강의실 프론트엔드를 별도 Vercel 프로젝트로 분리 (Next.js Multi-Zones)

## 배경

기존에는 "경매물건"(검색/추천/관심물건/관리자 등 업무 도구)과 "강의실"(수강
판매·시청)이 `young/auction` 한 Next.js 앱, 한 Vercel 프로젝트에 같이
배포되어 있었다. 사용자가 운영 관점에서 두 가지 이유로 분리를 요청함:

1. **장애 격리** — 경매물건 쪽 업데이트 중 오류가 나도 강의실은 그대로
   살아있게 하고 싶음.
2. **장기적으로 완전히 별개 서비스처럼 운영**할 가능성을 열어두고 싶음.

제약 조건(사용자 확정):
- 백엔드(NestJS, `young/auction-api`)·PostgreSQL DB는 그대로 하나 공유.
- 회원 로그인 계정도 기존 계정 그대로 공유(별도 SSO 구현 없이).
- 프론트엔드만 분리 — 백엔드 코드 변경 없음.
- 공용 코드는 처음부터 패키지화(모노레포/공용 npm 패키지)하지 말고, 꼭
  필요한 최소한만 각 프로젝트에 복제.
- 한쪽 앱의 middleware/layout/provider 오류가 다른 쪽까지 전염되지 않는
  완전 독립 배포 구조.
- 기존 URL(`/courses/*`)이 최대한 깨지지 않게 이관.
- 단계별로 진행해서 매 단계 정상 동작 확인 후 다음 단계로.

## 채택 아키텍처: Next.js Multi-Zones

`young/auction`(outer, 도메인의 대문)을 그대로 두고, `/courses/*` 경로만
새로 만든 `young/auction-courses`(inner, 강의실 전용 앱)의 별도 Vercel
배포로 `next.config.mjs`의 `rewrites()`가 전달한다. 브라우저에는 계속 같은
도메인 하나만 보인다.

- **쿠키 공유가 자동으로 됨**: 백엔드가 굽는 `auc-token`/`auc-refresh-token`
  쿠키에는 `Domain` 속성이 없어(브라우저가 응답을 받은 origin에 자동
  스코프), 두 앱 모두 자기 자신의 `/api/[...path]/route.ts` 프록시를 거쳐
  같은 origin에서 응답을 받기만 하면 저절로 같은 쿠키를 공유한다. 이게
  "백엔드/쿠키 코드 변경 없이 계정 공유"를 만족하는 사실상 유일한 방법.
- **URL이 안 바뀜**: `/courses/apply` 같은 경로가 겉보기엔 그대로 유지됨.
- **완전 독립 배포**: 강의실 앱은 별도 Git 저장소·별도 Vercel 프로젝트·별도
  빌드/런타임이라, 그쪽 버그가 나도 경매물건 앱 빌드/런타임에는 영향 없음.

트레이드오프:
- outer 앱의 기존 `middleware.ts` 로그인 가드는 그대로 두고 수정하지
  않았다 — rewrite보다 먼저 실행되므로 계속 게이트 역할을 한다. 이 자체는
  두 서비스가 공유하는 자원이라 여기 버그가 나면 둘 다 영향받지만, 이건
  어느 멀티존 구조를 택해도 피할 수 없는 구조적 특성.
- inner 앱 자체 Vercel URL(`auction-courses.vercel.app`)이 outer 리라이트를
  거치지 않고 직접 열릴 수 있어서, courses 앱에도 자체 `middleware.ts`
  (로그인 가드)를 하나 더 뒀다.
- 강의실 ↔ 경매물건 페이지 이동은 서로 다른 배포를 넘나드는 것이라 풀
  페이지 리로드가 된다(기능 동일, 체감 전환 속도만 약간 느려짐).

`/auth/kakao/callback`, `/lecture/[token]`은 `/courses/*` 서브트리가 아니고
카카오 Redirect URI 재등록·기존 공유 링크 파손 위험이 있어 outer 앱에 그대로
남겨뒀다(사용자 확인 완료).

## 새 프로젝트: `young/auction-courses`

- GitHub: `https://github.com/yb-kim87/auction-courses` (Private)
- Vercel 프로젝트: `auction-courses` (Production: `auction-courses.vercel.app`)
- `next.config.js`에 `basePath: "/courses"` 설정 — 이 앱 자신의 라우트/정적
  자산이 항상 `/courses/...` 아래에 있게 해서 outer 리라이트와 경로가
  맞물리게 함.
- 이동(원본 삭제 후 이관)한 컴포넌트: `courses-landing`, `courses-apply`,
  `courses-webinar`, `courses-my`, `webinar-join/*`, `course-site/
  CourseSiteHeaderAuth`, `[courseId]/MyCourseClient`.
- 그대로 복제(수정 없음)한 최소 공통 코드: `lib/http.ts`, `lib/auth.ts`,
  `lib/roles.ts`, `lib/session.ts`, `lib/kakao-webinar-auth.ts`,
  `lib/bunny-playerjs.ts`, `store/useProfileStore.ts`, `app/providers.tsx`,
  `components/AuthInit.tsx`, `lib/auth-fetch-interceptor.ts`,
  `types/auction.ts`, 스타일/설정 파일들.
- `src/lib/api.ts`는 원본(5000줄+)을 통째로 복제하지 않고, courses 앱이
  실제 쓰는 함수만 담은 축소판을 새로 작성했다. 이후 두 앱의 `api.ts`는
  서로 별개 파일이라 백엔드 응답 스키마가 바뀌면 양쪽 다 손대야 한다는 점은
  의도적으로 감수(공용 패키지를 안 만들기로 했으므로).
- Vercel 환경변수: `API_ORIGIN`(운영 백엔드,
  `https://auction-production-2c72.up.railway.app`),
  `NEXT_PUBLIC_KAKAO_REST_API_KEY`, `NEXT_PUBLIC_KAKAO_REDIRECT_URI`(운영
  도메인 기준 `https://auction-seven-tan.vercel.app/auth/kakao/callback`).
  `JWT_SECRET`은 outer 앱도 Vercel에 별도로 설정해두지 않고 코드 내
  fallback 값에 의존하고 있어서(기존 동작과의 parity 유지 목적으로) 이
  프로젝트에서도 동일하게 비워뒀다 — 필요시 추후 별도로 점검.

## outer(`young/auction`) 앱 변경

`next.config.mjs`에 guard된 rewrite 추가:

```js
async rewrites() {
  const coursesAppUrl = process.env.COURSES_APP_URL;
  if (!coursesAppUrl) return [];
  return [
    { source: "/courses", destination: `${coursesAppUrl}/courses` },
    { source: "/courses/:path*", destination: `${coursesAppUrl}/courses/:path*` },
  ];
},
```

`COURSES_APP_URL=https://auction-courses.vercel.app`를 outer 프로젝트의
Vercel 환경변수(Production/Preview)에 등록.

이후 outer 저장소에서 이관 완료된 파일들을 삭제(Step 4, 실제 컷오버):
`src/app/courses/**`, `src/components/courses*/`, `webinar-join/`,
`course-site/`. `middleware.ts`는 기존 `/courses/*` 가드 로직을 그대로 두어
수정하지 않았다(rewrite 이전에 실행되므로 그대로 작동).

## 단계별 실행 및 검증

1. **로컬 통합 테스트** — outer(:3000)·courses(:3002)를 로컬에서 각각
   구동하고 outer의 rewrite를 courses로 연결, outer의 `src/app/courses`를
   임시로 옮겨 파일 라우트가 rewrite를 가리지 않게 한 뒤 검증. 로그인 세션
   공유, `/courses/my` 실데이터 표시, 크로스존 링크(`<Link>` vs `<a>`)
   동작을 Playwright로 확인 후 원상복구.
2. **courses 앱 단독 Vercel 배포** — `vercel link` + `vercel env add` +
   `vercel --prod`. basePath 라우팅(`/courses`, `/courses/webinar`,
   `/courses/apply`)과 정적 자산(`/courses/_next/static/...`) 서빙을 curl로
   확인.
3. **outer 앱에 rewrite 연결** — `COURSES_APP_URL` 환경변수 추가 후 배포.
   이 시점엔 outer 자신의 `src/app/courses/**` 파일이 아직 남아있어
   rewrite가 가려짐(파일 기반 라우트가 항상 rewrite보다 우선) — 즉
   사용자에게는 아무 변화 없는 안전한 중간 상태.
4. **정리(진짜 컷오버)** — outer의 `src/app/courses/**` 등 이관 완료된
   파일을 삭제하고 재배포. 이 시점부터 실제 프로덕션 도메인에서
   `/courses/*`가 새 `auction-courses` 배포로 서빙된다.

## 결과

- 프로덕션(`https://auction-seven-tan.vercel.app`)에서 `/courses`,
  `/courses/my`, `/courses/webinar`, `/courses/[courseId]` 모두 새
  `auction-courses` 배포가 정상 서빙하는 것을 확인.
- 기존 로그인 세션(쿠키)이 별도 처리 없이 자동 공유됨 — outer에서 로그인한
  세션 그대로 `/courses/my` 진입 시 실제 수강 강의/진도율(`관리자님`,
  33%/21% 등 실데이터) 표시됨. 강의 재생 페이지(영상 플레이어, 강의목록,
  강의정보/자료/Q&A/노트 탭)까지 정상 작동.
- 경매물건 쪽(`/`, `/search` 등) outer 앱 자체 기능은 이번 변경으로 전혀
  영향받지 않음.

### 버그 발견 및 수정

컷오버 직후 `/courses/my`의 "이어서 학습하기" 링크가
`/courses/courses/{courseId}`로 basePath가 이중으로 붙는 문제를 발견.
원인: 원본 코드의 `href={\`/courses/${courseId}\`}` 템플릿 리터럴이 이관
당시 정적 문자열 치환(sed)으로는 안 잡혔던 것 — courses 앱은 이미
`basePath: "/courses"`가 설정돼 있어 `<Link>`가 자동으로 `/courses`를
앞에 붙이므로 href는 `/${courseId}`여야 정상.

`src/components/courses-my/MyCoursesPageClient.tsx`의 두 곳
(`resumeCourse` 카드, 강의 목록 카드)을 `/${courseId}`로 수정하고
재배포해서 정상화됨. `src/lib/api.ts`의 `/courses/${courseId}` 계열
백엔드 API 경로 문자열들은 프론트 라우팅과 무관한(백엔드 엔드포인트
세그먼트) 것이라 손대지 않음.
