# 계정당 동시 로그인 1개 제한(수강생 대상)

## 배경
사용자 요청(2026-07-31): "수강생이 로그인을 했을때 1계정으로 1명만
사용할 수 있게 하려면 어떻게 해야할까??" — 계정 공유로 인한 중복
접속을 막기 위해 계정당 동시 로그인을 1개로 제한.

정책 확정(AskUserQuestion):
- 이미 로그인된 계정으로 새 로그인을 시도하면 **새 로그인을 차단**
  (기존 세션을 강제로 밀어내지 않음).
- "이미 로그인된 상태"의 기준은 **2시간 유휴(활동 없음) 시 자동 만료**
  — 브라우저를 닫고 로그아웃을 안 눌러도 영구히 계정이 잠기지 않게 함.

## 구현
기존 인증은 완전히 stateless JWT(서버 세션 저장 없음)였는데, 이 기능을
위해 최소한의 상태를 `users` 테이블에 추가했다.

- 마이그레이션 `1784259000000-AddUserSingleSession.ts`: `users`에
  `currentSessionId`(text, nullable), `sessionLastActiveAt`(timestamptz,
  nullable) 추가.
- `jwt.util.ts`: access/refresh 토큰 payload에 선택적 `sid` 클레임 추가.
- `auth.service.ts`:
  - `SINGLE_SESSION_ROLES` = STUDENT/CONSULTING_STUDENT/MEMBER만 적용
    (ADMIN/CONSULTANT는 업무상 여러 기기 필요해 제외).
  - `SESSION_IDLE_TIMEOUT_MS` = 2시간.
  - `login()`: 대상 역할이면 `currentSessionId`+`sessionLastActiveAt`이
    2시간 이내인 경우 `ConflictException`으로 차단. 통과 시 새
    `sid`(UUID) 발급해 DB에 저장하고 토큰에 포함.
  - `refresh()`: 대상 역할이면 refresh 토큰의 `sid`가 DB의
    `currentSessionId`와 다르면(다른 기기가 이미 로그인해 세션을
    가져간 경우) 거부. 일치하면 `sessionLastActiveAt`을 갱신(유휴 타이머
    리셋) — 프론트 미들웨어가 탭이 열려있는 동안 주기적으로
    `/auth/refresh`를 호출하는 것이 자연스러운 활동 신호(heartbeat)
    역할을 한다.
  - `logout()`(신규): 현재 access 토큰의 `sid`가 DB와 일치할 때만 세션을
    비워 즉시 다른 기기 로그인을 허용. 이미 다른 기기가 세션을 가져간
    뒤의 예전 로그아웃 요청은 그 세션을 건드리지 않는다.
- `auth.controller.ts`: `POST /auth/logout`이 access 토큰 쿠키를 읽어
  `authService.logout()`을 호출하도록 변경(기존엔 쿠키 삭제만 함).
- `users.service.ts`: `setSession`/`touchSession`/`clearSession` 추가.

## 검증
- `npx tsc --noEmit`, `npm run build` 통과.
- 매 요청(access 토큰 검증, `getAuthContext`)마다 DB를 조회하지 않고
  기존처럼 stateless로 유지 — 세션 검증은 로그인/리프레시 시점에만
  일어나므로 성능 영향 없음.
