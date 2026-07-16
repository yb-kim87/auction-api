# JWT access/refresh 토큰 이중화

날짜: 2026-07-16
관련 레포: auction, auction-api

## 배경

기존 인증은 단일 JWT(`auc-token`)만 발급해 로그인 시 `remember` 여부에 따라
만료시간을 1일 또는 30일로 다르게 서명하는 구조였다. 토큰 하나가 오래 살아있으면
탈취됐을 때 위험 노출 기간이 길어지므로, 짧게 사는 access 토큰과 길게 사는 refresh
토큰으로 분리해달라는 요청.

## 요청 원문

```
jwt토큰을 accessToken / refreshToken 으로 이중화 하고, accessToken의 유효기간을
30분으로 하고, refreshToken의 유효기간을 30일로 잡을것..
```

## 설계

- **accessToken**: 30분, `auc-token` 쿠키(기존 이름 유지, path `/`), 매 요청 인증에 사용
- **refreshToken**: 30일, `auc-refresh-token` 쿠키(path를 `/auth/refresh`로 제한해
  다른 API 요청에는 아예 전송되지 않도록 탈취 노출면 최소화)
- refreshToken payload에 `type: "refresh"` 마커를 넣어, accessToken 검증 함수가
  refreshToken을 받아도 거부하고 반대도 마찬가지로 차단(용도 혼용 방지)
- `POST /auth/refresh`: refreshToken 검증 → 회원이 여전히 존재하는지 재확인(탈퇴
  등 방지) → access/refresh 토큰 모두 새로 발급(로테이션)

## 변경 내용 (auction-api)

- `src/auth/jwt.util.ts`: `signAuthToken`/`verifyAuthToken`/`setAuthTokenCookie`/
  `clearAuthTokenCookie`(단일 토큰) → `signAccessToken`/`signRefreshToken`/
  `verifyAccessToken`/`verifyRefreshToken`/`setAccessTokenCookie`/
  `setRefreshTokenCookie`/`clearAuthCookies`(이중 토큰)로 전면 교체
- `src/auth/auth.service.ts`: `login()`에서 `persistent` 파라미터 제거, 항상
  access+refresh 두 토큰을 함께 발급. `refresh()` 신규 추가
- `src/auth/auth.controller.ts`: `POST /auth/refresh` 신규(refresh 쿠키 파싱 →
  서비스 호출 → 새 쿠키 2개 설정). `login`에서 `remember` 필드 제거
- `src/common/auth-context.ts`: `verifyAuthToken` → `verifyAccessToken` 참조로 변경

## 변경 내용 (auction)

- `src/lib/api.ts`: `loginUser`에서 `remember` 파라미터 제거. `refreshAuthToken()`
  추가(`POST /auth/refresh` 호출)
- `src/app/login/page.tsx`: "로그인 상태 유지" 체크박스 제거(이제 항상 refresh
  토큰이 30일 발급되므로 개념 자체가 불필요)
- `src/lib/auth-fetch-interceptor.ts` 신규: 전역 `window.fetch`를 감싸서, `/api`
  요청이 401을 받으면 자동으로 `/auth/refresh`를 호출하고 성공 시 원요청을 1회
  재시도. `api.ts`의 방대한 개별 fetch 호출부(2500줄+)를 하나도 건드리지 않고
  모든 API 요청에 일괄 적용하기 위해 이 방식을 선택
- `src/components/AuthInit.tsx` + `src/app/layout.tsx`: 앱 최초 마운트 시 위
  인터셉터를 1회 설치하는 클라이언트 컴포넌트

## 확인한 하위 호환 지점

- `src/lib/session.ts`(Next.js 미들웨어, Edge Runtime에서 `jose`로 토큰 검증)는
  쿠키명(`auc-token`, 변경 없음)과 payload의 `sub`/`role` 필드만 읽으므로 accessToken
  구조 변경에 영향받지 않음(수정 불필요, 확인만 함)
- `/api/[...path]` 프록시 라우트(`route.ts`)는 `Set-Cookie` 헤더를 배열로 모두
  전달하는 구조라 access+refresh 두 쿠키가 동시에 설정돼도 정상 동작

## 결과
- accessToken이 30분마다 만료돼도 사용자는 강제 로그아웃되지 않고, 인터셉터가
  자동으로 refresh 후 요청을 이어감
- 실제로 로그인 세션이 끝나는 시점은 refreshToken이 만료되는 30일 뒤(또는 로그아웃
  시 두 쿠키 모두 삭제)
- 토큰 탈취 시 노출 위험 기간이 기존 최대 30일에서 accessToken 기준 최대 30분으로
  단축(refreshToken은 경로 제한으로 일반 API 요청 도중에는 전송되지 않음)
