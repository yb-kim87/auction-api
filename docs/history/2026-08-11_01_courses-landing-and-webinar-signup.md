# 강의실 메인/수강신청/무료웨비나 페이지 재현 + 이미지 관리 + 카카오·이메일 로그인

## 배경

사용자 요청(2026-08-10~11, 여러 차례 이어짐): `young/auction`(Next.js
프론트, 포트 3000) + `young/auction-api`(NestJS 백엔드, 포트 3001)로
구성된 "코치픽" 경매 서비스에 강의실 마케팅 페이지 3종을 새로 만들고,
이미지를 관리자 페이지에서 교체 가능하게 하고, 자사 무료 세미나 유입
페이지(`https://auctioncoachp.imweb.me/`)와 동일한 카카오/이메일 로그인
신청 기능을 붙여달라는 연속 요청.

핵심 제약: **참고 사이트 레이아웃/구조/애니메이션을 최대한 그대로
재현하되 색상만 보라 톤(`#5244d4` 계열, 기존 `/courses/my` 팔레트)으로
바꿀 것.** 참고한 사이트는 두 곳:
1. `barojp.com`(제휴사, "바로일본어" 조각 일본어 클래스 — 강의실 소개
   페이지 `/`와 수강신청 페이지 `/courses/7` 재현 대상)
2. `auctioncoachp.imweb.me`(자사 소유 아임웹 사이트 — 무료 웨비나 신청
   페이지 및 카카오싱크 로그인 참고 대상)

## 최종 라우팅 구조

| 경로 | 역할 | 로그인 필요 |
|---|---|---|
| `/courses` | 강의실 소개(마케팅 랜딩) — barojp.com `/` 재현 | 필요 |
| `/courses/apply` | 수강신청 — barojp.com `/courses/7` 재현 | 필요 |
| `/courses/webinar` | 무료 웨비나 소개 — imweb 사이트 본문 재현 | **불필요**(예외 처리) |
| `/courses/webinar/join` | 카카오 vs ID/PW 선택 화면 | 불필요 |
| `/courses/webinar/join/form` | ID/PW 회원가입 폼 | 불필요 |
| `/courses/webinar/join/complete` | 이메일 가입 완료 화면 | 불필요 |
| `/courses/my` | 기존 "수강 중인 강의" 목록(원래 `/courses`였던 것, 경로만 이동) | 필요 |
| `/auth/kakao/callback` | 카카오 OAuth 콜백 처리 | 불필요 |

**중요 버그와 수정**: `middleware.ts`가 `/courses/:path*` 전체를 로그인
필수로 막고 있어서, 무료 웨비나 신청(비로그인 방문자가 처음 가입하는
시나리오)이 실제로는 접근 자체가 안 되는 상태였다(테스트한 사용자가
이미 로그인돼 있어서 발견이 늦었음). `/courses/webinar` 계열만 예외로
비로그인 허용하도록 수정(`src/middleware.ts`).

## 1. 강의실 소개 페이지 (`/courses`) — barojp.com 재현

### 조사 방법
`barojp.com`의 React 프로덕션 번들(`assets/index-DefAQ-XP.js`)을
`fetch`로 직접 받아 텍스트 검색하는 방식으로 실제 컴포넌트 소스(Tailwind
클래스, state 로직, 애니메이션 타이밍)를 확인했다. 눈짐작 대신 정확한
수치(px, ms, hex 색상)를 뽑아 그대로 반영하는 방식으로 진행 — 이 방법이
스크린샷 비교보다 훨씬 정확했다.

### 구현된 섹션 (원본과 1:1 대응, 순서대로)
1. 히어로 — PC/모바일 배경 이미지 + 캡션 오버레이
2. "우리에게 필요한건" — 강조 문구 + 영상 placeholder
3. 고민 카드 2x2 그리드 — **1초마다 카드가 순서대로 강조색으로
   전환되는 자동 애니메이션**(원본 `setInterval` 로직 그대로: `(s+1)%4`)
4. "왜 열심히 해도 안 될까" 비교 섹션 — 다크 배경, 좌(독학)/우(실전
   강의) 타임라인 형태, 우측 카드는 별도 헤더 바 + 점선 타임라인
5. "조각 1개로 무한 확장" — solution 이미지 3장(세로 나열) + 단어 조각
   결합 애니메이션(4.2초 주기, `phase` 상태로 조합→결과 전환)
6. "조각 3개" 캐러셀 — 가운데 카드 강조 + 자동 슬라이드(4초), 좌우 카드
   클릭 시 전환
7. "60일의 기적" — 무한 가로 스크롤 마퀴(카드 배열을 2배로 이어붙여
   `translateX(-50%)` 무한 반복, hover 시 일시정지)
8. 커리큘럼 로드맵(`id="curriculum"`) — 세로 인포그래픽 이미지 3장,
   각각 개별 스크롤 리빌
9. 후기 — 무한 가로 스크롤 마퀴(60일의 기적과 동일 패턴)
10. 최종 CTA — `/courses/apply`로 연결
11. 푸터 — 원본과 동일한 구조(로고, 회사 정보 블록, 이용약관 등 링크,
    저작권)
12. 하단 고정 CTA 바(`StickyApplyBar`, `scrollY > 600`에서 슬라이드 인)
13. 플로팅 버튼 2종(`FloatingButtons`, `scrollY > 500`에서 표시) — 카카오
    상담 버튼 + 맨 위로 버튼

### 겪었던 버그와 원인
- **`useInView` 훅의 IntersectionObserver가 영영 안 붙는 버그**: 처음엔
  `useRef` 객체 + `useEffect` 조합으로 구현했는데, 조건부 렌더링(`if
  (!url) return null`)으로 최초 렌더에 DOM이 없으면 이후 DOM이 생겨도
  `useEffect`가 재실행되지 않아 옵저버가 셋업되지 않았다. **콜백 ref
  방식**(`useCallback`으로 `ref` prop 자체를 함수로 만들어, DOM이 실제로
  마운트되는 시점에 항상 옵저버를 붙임)으로 교체해 해결. 지금 이
  프로젝트에서 스크롤 리빌 훅을 새로 만들 때는 이 패턴을 따를 것.
- **styled-jsx 스코프 클래스 누락 버그**: 문자열로 동적 조합한
  className(`` `reveal ${inView?'in-view':''} ${className}` ``)에는
  styled-jsx의 자동 스코프 해시가 안 붙어 스타일이 통째로 무시되는
  경우가 있었다. `:global()`로 감싸거나(이번 프로젝트에서는 결국 이
  방식을 다 걷어내고), **인라인 style 객체 위주로 재작성**하는 쪽이 더
  안전했다 — 현재 `/courses`, `/courses/apply`, `/courses/webinar`는 전부
  `<style jsx>` 없이 순수 인라인 `style={{...}}`로 작성되어 있다.

## 2. 수강신청 페이지 (`/courses/apply`) — barojp.com `/courses/7` 재현

서브에이전트로 원본 페이지 전체 HTML(112,925자)을 섹션별로 정밀 분석
(가격, 71개 레슨 커리큘럼 원문, 후기, 환불규정까지 전부 원문 인용받음).

### 구성 (좌 70% / 우 30% 사이드바 레이아웃)
- 히어로 영상(Vimeo 배경 자동재생 iframe, 소리 켜기/끄기 버튼)
- 모바일 전용 정보 카드(패키지 선택 포함)
- sticky 탭 네비게이션(강의소개/커리큘럼/후기/환불규정)
- 무료 OT 강의 2개
- `id="intro"` 강의소개(원본은 상세 이미지 23장 나열 — 지금은 텍스트
  카드로 대체, 아래 3번 참고)
- `id="curriculum"` 아코디언 — **9개 섹션 71개 레슨 전체를 원본과 정확히
  동일한 개수/순서/보너스 항목 위치**로 재현(문구만 코치픽 실전 강의
  맥락으로 자연스럽게 치환, 예: "히라가나 암기"→"기초 개념 암기",
  "전화일본어 티켓"→"1:1 코칭 세션 티켓")
- `id="reviews"` 후기 + 페이지네이션
- `id="refund"` 환불규정 4개 항목
- 우측 sticky 구매 사이드바 — 스탠다드(₩2,490,000→₩239,000, 90% 할인,
  월19,917원) / 프리미엄(₩3,190,000→₩399,000, 87% 할인, 월33,250원) —
  **정확한 원본 가격 그대로**
- 모바일 전용 하단 고정바(깜빡이는 "마감 임박" 배지)

파일: `young/auction/src/app/courses/apply/page.tsx`

## 3. 이미지 관리 시스템 (백엔드 landing-images 모듈)

강의실 소개/수강신청 페이지의 모든 이미지를 admin에서 URL 입력 또는
파일 업로드로 교체 가능하게 만든 시스템.

### 백엔드 (`auction-api/src/landing-images/`)
- `landing-image.entity.ts` — key-value 구조(`id`=슬롯 키,
  `imageUrl`)의 단순 테이블 `landing_images`
- `landing-images.constants.ts` — 슬롯 정의 배열(`LANDING_IMAGE_SLOTS`).
  슬롯 추가는 이 배열에 원소를 추가하기만 하면 된다(key, label,
  recommendedSize, defaultUrl). 현재 등록된 슬롯:
  - 로고 2종(`logo-light`, `logo-dark`)
  - 히어로 배너(`hero-main`), 마스코트(`mascot`)
  - solution 이미지 3종(`solution-1~3`)
  - 효과 카드 4종(`effect-travel/content/career/package`)
  - 커리큘럼 로드맵 3종(`curriculum-1~3`)
  - **수강신청 상세 이미지 23종(`detail-1~23`)** — barojp 원본 파일명
    패턴(`detail-01.gif`~`detail-22.webp` 홀짝 교차, `detail-23v2.webp`)을
    그대로 반영해 자동 생성
- `landing-images.service.ts` — 슬롯 정의 + DB 커스텀 URL을 합쳐 반환.
  관리자가 아직 안 바꾼 슬롯은 `defaultUrl`(barojp/imweb 원본 이미지)이
  자동으로 보임
- `landing-images.controller.ts` — `GET /landing-images`(공개, 페이지
  렌더링용), `POST /:key`·`DELETE /:key`·`POST /upload-image`(전부
  `requireAdmin`). 업로드된 파일은 `auction/public/landing-images/uploads/`에
  직접 저장(기존 `lecture-materials` 업로드와 동일 패턴, 별도 스토리지
  서비스 없음)

### 프론트
- `lib/api.ts`: `fetchLandingImages`, `updateLandingImage`,
  `resetLandingImage`, `uploadLandingImageFile`
- `app/admin/LandingImagesPanel.tsx`: 슬롯별 미리보기 + URL 입력 + 파일
  업로드 + "기본값으로" 초기화 버튼

**⚠️ 알려진 이슈(다음 세션에서 처리 예정)**: `LandingImagesPanel`을
admin 탭 목록에 등록하는 코드(`app/admin/page.tsx`의 import + ADMIN_TABS
등록 + 렌더링 분기)가 이후 다른 작업(`realtor-collect` 추가 등) 중에
**사라졌다**. 백엔드 API와 컴포넌트 파일 자체는 살아있으므로, admin
탭에 다시 등록하기만 하면 복구된다(`WebinarLeadsPanel`을 등록한 것과
동일한 패턴 참고). 사용자가 "이건 나중에 한꺼번에 배포할 때 처리하자"고
명시적으로 보류함(2026-08-11).

## 4. 무료 웨비나 페이지 (`/courses/webinar`) — imweb 사이트 재현

`auctioncoachp.imweb.me`의 헤더 아래 본문을 그대로 가져오되, 헤더는
코치픽 강의실 공통 헤더를 그대로 사용.

### 구성 (원본 DOM 순서 그대로, 실측 필요)
1. 최상단 히어로 이미지(`5565febf4fb70.png`, 1920x1080 — 원본에서
   `hover_overlay`가 걸려있던 이미지, 최초 누락됐다가 재조사로 추가함)
2. 히어로 문구 30px(처음엔 18px로 잘못 넣었다가 재실측 후 수정)
3. 가격 정보 — 원본과 동일한 **좌측 라벨/우측 값 2행 구조**(카드형
   아님). "무료"는 빨간색(`#C11212`) 30px
4. 유튜브 소개 영상 임베드(`q2XlKRjna7s`)
5. 영상 바로 아래 이미지 2장(`5b9f21c259ee7.gif`, `a7f5d5bd0a45e.gif` —
   이것도 최초 누락됐다가 재조사로 추가)
6. 상세 소개 이미지 **40장 전부**(imweb CDN 원본 URL 그대로, 순서 유지 —
   이 이미지들은 admin의 landing-images와는 별개로 페이지 컴포넌트
   안에 하드코딩된 배열 `DETAIL_IMAGES`)
7. CTA 버튼 → `/courses/webinar/join`(선택 화면)으로 연결
8. 하단 고정 CTA 바(강의실 소개 페이지와 동일 컴포넌트 구조, 버튼
   텍스트만 "무료 웨비나 신청"으로 변경)

파일: `young/auction/src/app/courses/webinar/page.tsx`

### 겪었던 버그: `.env` 변경 후 서버가 낡은 응답을 주던 문제
카카오 로그인 관련 `.env` 값을 추가한 뒤 재시작했는데도 새 코드/설정이
반영되지 않았던 원인이 두 가지 겹쳐 있었다:
1. **오래된 프로덕션 빌드 프로세스**(`node dist/main.js`, `npm run
   start`로 뜬 것)가 포트 3001을 먼저 점유하고 있어서, `npm run
   start:dev`(watch 모드)가 `EADDRINUSE`로 죽거나 새로 못 뜨는 상태였다.
   `netstat -ano | grep :3001`로 실제 PID의 커맨드라인을 확인해(`wmic
   process where "ProcessId=..." get CommandLine`) 프로덕션 빌드였음을
   확인 후 kill하고 dev 서버를 다시 띄워야 했다.
2. **`app.module.ts`/`typeorm.config.ts`의 모듈·엔티티 등록이 다른
   작업 중 통째로 사라진 적**이 있었다(`LandingImagesModule` 사례).
   새 기능이 404를 낸다면 라우트 매핑 로그(`[RoutesResolver]`)가 실제로
   찍히는지부터 확인할 것.

## 5. 카카오 로그인 + ID/PW 회원가입 (무료 웨비나 신청)

### 설계 결정: 자체 도메인에서 카카오 OAuth 직접 구현
처음엔 "imweb 사이트가 이미 카카오싱크 로그인을 제공하고
`imweb-sync.service.ts`가 그 회원 DB를 동기화하는 기존 구조가 있으니
그걸 그대로 쓰면 되지 않나" 하는 대안이 있었으나, 사용자가 **코치픽
자체 도메인에서 카카오 OAuth를 직접 구현**하는 쪽을 선택함
(2026-08-11). 즉 `kakao-notify` 모듈(아임웹/인스타 리드 동기화 전용,
로그인과 무관)과는 완전히 무관한 새 기능.

### 환경변수 (실제 값은 `.env`/`.env.local`에만 있음, 여기 문서에는 미기재)
- `auction-api/.env`: `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`(비어
  있어도 됨), `KAKAO_REDIRECT_URI`
- `auction/.env.local`: `NEXT_PUBLIC_KAKAO_REST_API_KEY`,
  `NEXT_PUBLIC_KAKAO_REDIRECT_URI`(백엔드와 동일한 값이어야 함)
- 카카오 개발자센터에 등록된 Redirect URI: `http://localhost:3000/auth/kakao/callback`(로컬 개발용. 운영 도메인이
  생기면 그 콜백 URL도 개발자센터에 추가 등록 + env 값도 추가/교체
  필요)

### 백엔드 (`auction-api/src/webinar-auth/`)
- `WebinarKakaoLead` 엔티티(`webinar_kakao_leads` 테이블) — 카카오 ID,
  닉네임, 이메일, 전화번호, 프로필 이미지, rawPayload. `kakaoId` 유니크
  — 같은 계정으로 재신청하면 upsert
- `WebinarEmailLead` 엔티티(`webinar_email_leads` 테이블) — 이메일,
  passwordHash, 이름, 성별, 연락처, 홈페이지, 주소, 상세주소,
  추천인코드. `email` 유니크
- `password.util.ts` — 비밀번호 해싱. **bcrypt 등 외부 패키지를 새로
  설치하지 않고 Node 내장 `crypto.scryptSync` + `timingSafeEqual`로
  구현**(salt:hash 형식 문자열로 저장). 기존 `auth.service.ts`(메인
  로그인)는 여전히 평문 비교 방식이라는 점과는 별개로, 이 새 리드
  테이블만이라도 안전하게 처리
- `webinar-auth.service.ts` — 카카오: 인가 코드 → 토큰 교환
  (`kauth.kakao.com/oauth/token`) → 사용자 정보 조회
  (`kapi.kakao.com/v2/user/me`) → DB upsert. 클라이언트 시크릿은 서버
  안에서만 사용
- `webinar-email-auth.service.ts` — 이메일 가입 검증(이메일 형식, 필수
  필드, 비밀번호 4자 이상 + 확인 일치, 이메일 중복) 후 저장
- `webinar-auth.controller.ts`:
  - `POST /webinar-auth/kakao/callback` — 공개, 프론트 콜백 페이지가
    호출
  - `GET /webinar-auth/kakao/leads` — `requireAdmin`
  - `POST /webinar-auth/email/join` — 공개
  - `GET /webinar-auth/email/leads` — `requireAdmin`
- `app.module.ts`/`typeorm.config.ts`에 `WebinarAuthModule`,
  `WebinarKakaoLead`, `WebinarEmailLead` 등록 완료

### 프론트
- `lib/kakao-webinar-auth.ts` — `getKakaoAuthUrl()` (client_id/redirect_uri로 카카오 인가 URL 생성, `NEXT_PUBLIC_KAKAO_*` env 사용)
- `app/auth/kakao/callback/page.tsx` — 인가 코드를 받아
  `/api/webinar-auth/kakao/callback`(NestJS 프록시 경유)로 POST, 성공 시
  닉네임과 함께 완료 화면, 실패 시 재시도 링크. **`useSearchParams`를
  쓰는 클라이언트 컴포넌트라 `<Suspense>`로 감싸야 Next.js 빌드
  경고/에러가 안 남**(이미 이 구조로 되어 있음, 걷어내지 말 것)
- `app/courses/webinar/join/page.tsx` — "카카오로 시작하기"(카카오 인가
  URL로 직접 이동) vs "ID/PW 회원가입"(`/courses/webinar/join/form`으로
  이동) 선택 화면. imweb 원본
  `site_join_type_choice`(`kakao_sync`) 화면을 참고
- `app/courses/webinar/join/form/page.tsx` — 이메일 가입 폼. 원본
  imweb `site_join` 폼과 동일한 필드 구성(이메일/비밀번호/비밀번호확인
  필수, 이름/연락처 필수, 성별/홈페이지/주소/상세주소/추천인코드 선택)
- `app/courses/webinar/join/complete/page.tsx` — 이메일 가입 완료 화면

### 관리자 페이지
- `app/admin/WebinarLeadsPanel.tsx` — 카카오(`fetchWebinarLeads`)와
  이메일(`fetchWebinarEmailLeads`) 두 테이블을 프론트에서 하나의
  배열로 합쳐(`createdAt` 내림차순 정렬) "가입방식" 배지(카카오=노랑,
  이메일=파랑)와 함께 표시. ADMIN_TABS에 `webinarLeads` 등록 완료(이건
  사라지지 않고 정상 유지되고 있음 — landing-images 탭과 다른 상태이니
  혼동하지 말 것)

### 실제 검증 완료 사항 (2026-08-11)
- 실제 카카오 계정으로 로그인 → `webinar_kakao_leads`에 닉네임/이메일/
  전화번호 정상 저장 확인(사용자 본인 계정으로 실제 테스트, "김영배"
  님으로 저장됨 확인)
- Playwright로 이메일 가입 폼 자동 입력 제출 → `webinar_email_leads`에
  정상 저장 확인, 완료 페이지 정상 전환 확인
- admin "웨비나 신청자" 탭에서 두 종류 신청자가 함께 표시되는 것 확인

## 追記 (2026-08-20) — 백엔드 모듈 등록 누락 발견 및 수정, admin 탭 재등록 완료

프론트 아키텍처 리팩터([2026-08-20_01](./2026-08-20_01_frontend-architecture-refactor.md) 참고) 검증 중
Playwright로 `/courses`를 열어보니 `GET /api/landing-images`가 404였다.
원인은 `landing-images` 모듈 코드 자체는 있었지만(이 문서에서 만든 것)
**한 번도 `app.module.ts`에 등록되지 않았고, `LandingImageRow` 엔티티도
`typeorm.config.ts`의 전역 entities 배열에 빠져 있었으며, 운영 Postgres용
마이그레이션도 없었던 것** — 즉 로컬에서만 동작 확인하고 커밋/배포는 안
됐던 상태 그대로였다. (아래 체크리스트 1번 "다음에 할 일"로 이미 알려져
있던 문제.)

수정 내용:
- `src/app.module.ts`에 `LandingImagesModule` 등록.
- `src/typeorm.config.ts` 전역 `entities` 배열에 `LandingImageRow` 추가
  (CLAUDE.md에 기록된 "엔티티 미등록 크래시" 재발 방지 규칙 그대로 적용).
- `src/migrations/1784295000000-CreateLandingImages.ts` 신규 — 운영
  Postgres에 `landing_images` 테이블 생성.
- 프론트 `AdminPageClient.tsx`에 아래 체크리스트 1번 항목대로
  `LandingImagesPanel`을 "강의실 이미지" 탭으로 재등록(import + `ADMIN_TABS`
  + 렌더링 분기).
- 로컬(sql.js) 기동 확인 → `GET /landing-images` 200 확인 → Playwright로
  `/courses` 재확인해 이미지 정상 로드(콘솔 에러 0) 확인 후 커밋/배포.

## 다음 세션에서 이어갈 때 체크리스트

1. ~~**`LandingImagesPanel`을 admin 탭에 재등록**할 것(위 3번 섹션의
   "알려진 이슈" 참고). 백엔드/컴포넌트는 살아있으니 `app/admin/page.tsx`에
   import + `ADMIN_TABS` 배열 + 렌더링 분기 3곳만 추가하면 됨.~~ →
   2026-08-20 完了(위 追記 참고).
2. **아직 배포 전, 전부 로컬(`localhost:3000`/`3001`)에서만 동작 중**.
   운영 배포 시 확인해야 할 것:
   - 카카오 개발자센터에 운영 도메인의 콜백 URL 추가 등록 필요
   - `KAKAO_REDIRECT_URI`/`NEXT_PUBLIC_KAKAO_REDIRECT_URI`를 운영
     도메인 값으로 교체 필요
   - `landing-images`/`webinar-auth` 업로드 이미지가
     `auction/public/.../uploads/`에 로컬 파일로 저장되는 방식이라,
     운영 환경(Railway API + Vercel 프론트가 별도 배포되는 구조라면)에서
     실제로 정상 동작하는지 별도 확인 필요(기존 `lecture-materials`
     업로드도 동일한 잠재 이슈를 안고 있음, 새로 발생한 문제 아님)
3. **수강신청 페이지 커리큘럼(71개 레슨)과 가격은 여전히 barojp
   원본 구조를 그대로 복제한 placeholder**다. 실제 코치픽 강의
   커리큘럼/가격이 확정되면 `app/courses/apply/page.tsx`의 `CURRICULUM`
   배열과 `PackageOption`/`PurchaseSidebar`/`MobileBottomBar`의 가격
   상수를 교체해야 함.
4. **`/courses/webinar`의 상세 이미지 40장은 imweb CDN 원본 URL을 그대로
   하드코딩**해서 쓰고 있다(`DETAIL_IMAGES` 배열, landing-images 슬롯
   시스템과는 무관). 자사 소유 이미지라 저작권 문제는 없지만, 이미지
   교체가 필요해지면 이 배열을 직접 수정하거나 landing-images 슬롯
   시스템으로 편입시키는 리팩터링이 필요.
5. 색상 팔레트는 전 페이지 공통으로 `ACCENT = "#5244d4"`,
   `ACCENT_LIGHT/ACCENT3 = "#8b7cf8"`, `ACCENT_SOFT = "#EFECFF"`
   (barojp 원본 오렌지 `#FF6600`/`#FF6B35`/`#FF8F5A`/`#FFF0EB`에
   대응). 새 섹션을 추가할 때는 이 상수를 재사용할 것 — 페이지마다
   로컬로 재선언되어 있으니(공용 파일로 분리되어 있지 않음) 색을 바꿀
   때는 각 페이지 파일을 다 찾아 고쳐야 한다는 점 주의.

## 追記 (2026-08-15) — webinar-auth 백엔드만 부분 배포

프론트(`WebinarLeadsPanel.tsx`, admin 탭 등)는 이전 세션에 이미
`vercel --prod`로 배포돼 있었는데(작업 디렉터리 전체를 배포하는 방식이라
git 커밋 여부와 무관하게 반영됨), 백엔드 `webinar-auth` 모듈은 한 번도
커밋/배포되지 않아 운영 API에 라우트 자체가 없었다. 그 결과 관리자 화면
"웨비나 신청자" 탭에서 `Cannot GET /webinar-auth/kakao/leads`가 떴다
(사용자 신고, 2026-08-15).

**이번에 배포한 범위**: `src/webinar-auth/` 전체(엔티티 2개/서비스
2개/컨트롤러), `app.module.ts`/`typeorm.config.ts`의 `WebinarAuthModule`
등록, 신규 마이그레이션(`1784293000000-CreateWebinarAuthTables`)으로
`webinar_kakao_leads`/`webinar_email_leads` 테이블 생성. `GET
/webinar-auth/kakao/leads`, `GET /webinar-auth/email/leads`(관리자 목록
조회)와 `POST /webinar-auth/email/join`(이메일 가입)은 env 설정 없이도
바로 동작한다.

**이번에 배포하지 않은 것**: `landing-images` 모듈(위 체크리스트 1번,
아직 admin 탭에 재등록도 안 된 상태)은 이번 배포 범위에서 제외했다 —
이번 요청은 "웨비나 신청자 탭 에러"에 한정된 것이라 무관한 기능까지
같이 올리지 않았다. 또한 `POST /webinar-auth/kakao/callback`(카카오
로그인)은 라우트는 이제 존재하지만, 운영 Railway에 `KAKAO_REST_API_KEY`/
`KAKAO_REDIRECT_URI` env가 설정돼 있는지, 카카오 개발자센터에 운영
도메인 콜백이 등록돼 있는지는 이번에 확인/설정하지 않았다(위 체크리스트
2번 그대로 유효) — 카카오 로그인 자체를 눌러보면 여전히 실패할 수 있다.
