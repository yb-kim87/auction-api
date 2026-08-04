# 강의 다시보기 (Bunny Stream 연동) MVP

## 배경
사용자 요청(2026-08-02): 경매코치 웹사이트에 Bunny Stream 영상을 보여주는
간단한 강의 다시보기 페이지를 만들어달라는 요청. 회원가입/결제/수강권
기능은 아직 없으므로, 지금은 **링크 토큰을 받은 사람만** 영상을 볼 수
있으면 되고, 추후 회원별 수강권 기능을 붙일 예정.

작업 전 기존 컨벤션을 먼저 조사(Explore 서브에이전트)해서 다음을 확인:
- TypeORM 수동 마이그레이션(synchronize:false), entity는
  `forFeature()`와 `typeorm.config.ts`(런타임)/`data-source.ts`(CLI)
  양쪽에 등록 필요.
- 인증은 JWT HttpOnly 쿠키 + `getAuthContext`/`requireAdmin`.
- 공개(비로그인) API는 `public/` prefix 컨트롤러 패턴이 이미 존재
  (`kakao-landing-visit.controller.ts`).
- 관리자 탭은 `page.tsx`의 `ADMIN_TABS` 배열 + `XxxTab.tsx` 컴포넌트
  패턴.
- 프론트 `/api/[...path]` catch-all이 모든 백엔드 경로를 서버사이드로
  프록시하므로, 공개 페이지에서 백엔드를 호출해도 별도 CORS 설정이
  불필요(브라우저는 항상 같은 오리진만 호출).
- 프론트 미들웨어(`matcher`)는 명시된 경로만 가로채므로, `/lecture/:path*`는
  자동으로 로그인 리다이렉트 대상에서 제외됨(수정 불필요).

## 구현

### 백엔드 (`src/lecture-replay/`, 신규 모듈)
- Entity 4개(스펙 그대로): `Course`(`courses`), `CourseSection`
  (`course_sections`), `CourseVideo`(`course_videos`),
  `LectureAccessLink`(`lecture_access_links`).
- 마이그레이션 `1784262000000-CreateLectureReplay.ts` — 기존 프로젝트가
  `migration:generate` CLI의 `data-source.ts` entities 배열을 이미
  일부 최신화하지 않은 상태였음을 확인해, 다른 최근 마이그레이션들처럼
  **원시 SQL을 직접 작성**하는 방식을 따름(`CreateAuctionBidPlans`
  마이그레이션과 동일한 스타일).
- `LectureReplayService`: 관리자용 강의/섹션/영상/링크 CRUD +
  공개용 `getAccessInfo(token)`/`getPlayUrl(token, videoId)`.
- `LectureReplayController`(`/lecture-replay/...`, `requireAdmin`):
  강의/섹션/영상/링크 CRUD.
- `LectureReplayPublicController`(`/public/lecture-replay/...`, 인증
  없음): `GET access/:token`(강의+섹션+영상 메타 반환, 비공개 영상은
  재생정보 없이 "준비중" 플래그만), `GET
  access/:token/videos/:videoId/play`(공개된 영상만 재생 URL 발급).
  두 엔드포인트 모두 토큰의 존재/`isActive`/`expiresAt` 만료 여부를
  서버에서 검증하고, 실패 시 스펙에 명시된 문구("접근할 수 없는
  강의입니다. 링크가 만료되었거나 유효하지 않습니다.")로
  `NotFoundException`을 던짐.
- Bunny embed URL 조립(`buildEmbedUrl`): `BUNNY_STREAM_LIBRARY_ID` +
  video ID로 iframe URL을 만들고, `BUNNY_STREAM_TOKEN_KEY`가 설정돼
  있으면 Bunny의 Token Authentication 규격
  (`SHA256(security_key + video_id + expires)`)으로 서명해 만료 6시간의
  단기 서명 URL을 발급. API Key/Token Key는 **항상 서버에만 존재**하고
  프론트에는 완성된 embed URL만 내려감(요청사항 "API Key와 Token Key는
  절대 프론트에 노출하지 말 것" 준수). Token Key 미설정 시(라이브러리가
  공개 모드인 경우) 서명 없는 기본 URL로 폴백.
- `app.module.ts`/`typeorm.config.ts`에 신규 모듈·entity 등록.
  `data-source.ts`는 이미 여러 entity가 누락된 상태(레거시)라 이번에도
  마이그레이션은 raw SQL로 작성해 CLI 의존을 피함.
- `.env.example`에 `BUNNY_STREAM_LIBRARY_ID`/`BUNNY_STREAM_API_KEY`
  (MVP 미사용, 추후 Bunny API 연동용 예약)/`BUNNY_STREAM_TOKEN_KEY`
  섹션 추가.

### 프론트
- `src/app/lecture/[token]/page.tsx` + `LectureReplayClient.tsx` —
  공개 시청 페이지. 로딩/에러(만료·유효하지 않은 링크)/빈 화면
  처리, PC는 좌(플레이어)/우(강의 목록) 분할, 모바일은 세로 스택
  (`grid-cols-1 lg:grid-cols-[1fr_360px]`). 강의 목록 클릭 시 선택
  영상 강조 + 재생 URL을 그때그때 새로 요청(iframe src 교체). 비공개
  영상은 "준비 중" 표시 + 클릭 비활성화.
- `src/app/admin/LectureReplayTab.tsx` — 관리자 탭(강의 생성/공개토글/
  삭제, 섹션 생성/삭제, 영상 생성/공개토글/순서변경(▲▼)/삭제, 접근
  링크 생성/만료일 설정/활성화 토글/링크 복사/삭제). `page.tsx`의
  `ADMIN_TABS`에 "영상업로드" 탭으로 등록.
- `src/lib/api.ts`에 타입 8종 + fetch 함수 20종 추가(공개용 2개,
  관리자용 18개).

## 변경 파일
**auction-api**
- `src/lecture-replay/entities/{course,course-section,course-video,lecture-access-link}.entity.ts` (신규)
- `src/lecture-replay/lecture-replay.service.ts` (신규)
- `src/lecture-replay/lecture-replay.controller.ts` (신규, 관리자용)
- `src/lecture-replay/lecture-replay-public.controller.ts` (신규, 공개용)
- `src/lecture-replay/lecture-replay.module.ts` (신규)
- `src/migrations/1784262000000-CreateLectureReplay.ts` (신규)
- `src/app.module.ts`, `src/typeorm.config.ts` (등록)
- `.env.example` (Bunny 환경변수 섹션 추가)

**auction**
- `src/app/lecture/[token]/page.tsx`, `LectureReplayClient.tsx` (신규)
- `src/app/admin/LectureReplayTab.tsx` (신규)
- `src/app/admin/page.tsx` (탭 등록)
- `src/lib/api.ts` (타입/fetch 함수 추가)

## 환경변수 (auction-api)
```
BUNNY_STREAM_LIBRARY_ID=   # Bunny Stream 라이브러리 ID (필수)
BUNNY_STREAM_API_KEY=      # MVP 미사용, 추후 Bunny API 연동 예약
BUNNY_STREAM_TOKEN_KEY=    # 라이브러리에 Token Authentication을 켠 경우에만 설정
```
Railway 환경변수에 위 3개를 추가해야 실제 재생이 동작한다(로컬 `.env`도 동일).

## 실행 방법
1. `auction-api`: `npm run migration:run`으로 마이그레이션 적용(운영은
   Railway 배포 시 `migrationsRun: true`로 자동 적용됨).
2. Railway/로컬 `.env`에 `BUNNY_STREAM_LIBRARY_ID`(+선택적으로
   `BUNNY_STREAM_TOKEN_KEY`) 설정.
3. 관리자 페이지 → "영상업로드" 탭에서 강의 생성 → 섹션 생성 → 영상
   추가(Bunny 대시보드에서 미리 업로드한 영상의 GUID를 "Bunny video
   ID"에 입력) → 영상을 "공개"로 전환 → 접근 링크 생성.
4. 생성된 링크(`/lecture/{token}`)를 수강생에게 전달하면 로그인 없이
   시청 가능.

## 확인한 것 / 확인 못한 것
- 백엔드/프론트 모두 `npx tsc --noEmit`과 `npm run build` 클린 확인.
- **Bunny Stream 실제 연동은 미검증** — 이 세션에는 실제 Bunny
  라이브러리/영상 ID가 없어 브라우저에서 실제 재생까지는 확인하지
  못했다. `BUNNY_STREAM_LIBRARY_ID`/영상 ID를 넣고 관리자가 직접
  테스트 링크로 재생 확인 필요.
- 배포 후 `railway status`/`curl` 헬스체크와 `npx vercel ls`로 정상
  기동 확인 예정(이 문서에 추가 追記).

## 추후 확장 예정 (이번 범위 아님)
- 회원가입/로그인 연동, 회원별 90일 수강권, 진도율 저장/이어보기,
  동시 접속 제한, 사용자 워터마크.

## 追記 (2026-08-02) — 토큰 방식 → 회원 로그인 + 수강권(enrollment) 방식 전환

사용자 요청: "OT수강생 등급"을 만들어 OT영상만 보게 하고, 일반 수강생은
기본 강의를 보게 하고 싶다는 요청에서 출발 → 상세 스펙으로 "기존
토큰 방식을 회원 로그인 + 회원별 수강권 방식으로 전면 교체"를 요청.
작업 전 기존 인증 구조를 Explore 서브에이전트로 조사 후 계획을
먼저 보고, 사용자 확인 후 진행(사용자 지시사항 준수).

### 결정 사항 (사용자 확인)
- "OT수강생" 구분은 **UserRole에 새 값을 추가하지 않고 enrollment
  기반으로만 처리** — "OT강의"라는 course를 만들어 그 course에만
  enrollment를 부여하면 그 회원은 `/courses`에 OT강의만 보이고,
  나중에 기본 강의 enrollment를 추가하면 그만큼 더 보이는 방식.
  기존 UserRole 체계(admin/consultant/consulting_student/student/
  member)와 충돌하지 않음.
- 관리자 "수강권 관리" UI는 별도 라우트가 아니라 **기존 "영상업로드"
  탭 안에 섹션으로 추가**(이 프로젝트의 관리자 화면은 `/admin` 단일
  페이지 + 탭 전환 구조이기 때문).

### 조사 결과 중 설계에 반영한 것
- 이 프로젝트는 FK를 uuid가 아니라 **User.username 문자열**로 참조하는
  컨벤션(예: `AuctionBidPlan`)이라, `lecture_enrollments.user_id`를
  스펙 그대로 uuid로 쓰지 않고 **`username` 컬럼**으로 구현.
- User 엔티티에 email 컬럼이 없어(username/name/phone만 존재), 관리자
  회원 검색은 이름/아이디/전화번호 기준으로 구현(`GET /users/search?q=`).
- Bunny API Key/Token Key는 기존에도 프론트에 노출되지 않고 있었음(재조사로
  재확인) — 검증 통과 후 서버가 조립한 embedUrl만 프론트에 내려가는
  구조를 그대로 재사용.

### 구현
**백엔드**
- 신규 entity `LectureEnrollment`(`lecture_enrollments`, username+courseId
  unique, status: ACTIVE/EXPIRED/REVOKED) — 마이그레이션
  `1784263000000-CreateLectureEnrollments.ts`.
- `LectureReplayService`: status 컬럼은 관리자가 명시적으로 REVOKED로
  바꾸는 경우만 저장값 의미가 있고, ACTIVE/시작전/만료는 배치 없이
  조회 시점마다 `startsAt`/`expiresAt`을 현재 시각과 비교해 실시간
  계산(`computeEffectiveStatus`)하도록 구현 — 별도 배치 작업 불필요.
  관리자용 `listEnrollments/grantEnrollment/grantEnrollmentQuick90(90일
  빠른 버튼)/updateEnrollment/revokeEnrollment`와 회원용
  `listMyCourses/getMyCourseAccessInfo/getMyPlayUrl` 추가. 회원용 접근
  검증은 스펙 5번 그대로 로그인→enrollment 존재→상태별 메시지("수강
  권한이 없는 강의입니다."/"아직 수강 기간이 시작되지 않았습니다."/
  "수강 기간이 종료되었습니다."/"강의 접근 권한이 종료되었습니다.")
  순으로 `ForbiddenException`을 던짐. 실패 시 bunny_video_id/embed
  URL을 전혀 응답하지 않음(검증 통과 후에만 `buildEmbedUrl` 호출).
- 신규 컨트롤러 `LectureCoursesController`(`/courses`, `requireAuth`,
  role 무관 — 로그인만 요구, 실제 강의별 접근은 enrollment로 판정):
  `GET /courses`(내 강의), `GET /courses/:courseId`(시청 정보),
  `GET /courses/:courseId/videos/:videoId/play`(재생 URL).
- `UsersService.searchUsers()`/`UsersController GET /users/search?q=`
  신규 추가(이름/아이디/전화번호 ILIKE, admin 전용).
- 기존 토큰 방식(`LectureAccessLink`, `LectureReplayPublicController`,
  `resolveActiveLink/getAccessInfo/getPlayUrl`)은 **삭제하지 않고
  "deprecated" 주석만 추가**해 그대로 유지 — 이미 공유된 링크가 있을 수
  있어 안전하게 남겨둠.

**프론트**
- 신규 `/courses`(내 강의 카드: 제목/기간/남은 일수/상태뱃지/강의보기
  버튼, 수강권 0건이면 "현재 수강 가능한 강의가 없습니다."),
  `/courses/[courseId]`(기존 `LectureReplayClient.tsx`의 플레이어/목록
  UI를 재사용한 `MyCourseClient.tsx`).
- `middleware.ts`에 `/courses/:path*` matcher 추가(로그인만 요구,
  role 제한 없음 — `/account`와 동일 패턴). 기존 분기는 손대지 않음.
- `/lecture/[token]/page.tsx`는 기존 `LectureReplayClient` 렌더 대신
  `/courses`로 서버 리다이렉트하도록 축소(컴포넌트 파일 자체는 삭제
  안 함).
- `LectureReplayTab.tsx`에 `EnrollmentsBlock`(회원 검색→선택→시작일/
  만료일 지정 또는 "90일 권한 부여" 버튼→목록에서 회수) 추가. 기존
  `LinksBlock`(토큰 링크 발급 UI)은 `<details>`로 접어서 "예전 링크
  방식(사용 중단)"이라는 라벨로 필요시에만 펼쳐 쓰도록 남김(삭제 안 함).

### 변경 파일
**auction-api**: `src/lecture-replay/entities/lecture-enrollment.entity.ts`(신규),
`src/lecture-replay/lecture-courses.controller.ts`(신규),
`src/lecture-replay/lecture-replay.service.ts`(enrollment 메서드 추가),
`src/lecture-replay/lecture-replay.controller.ts`(enrollment 관리자
엔드포인트 추가), `src/lecture-replay/lecture-replay.module.ts`(엔티티/
컨트롤러 등록), `src/typeorm.config.ts`(엔티티 등록),
`src/users/users.service.ts`/`users.controller.ts`(검색 API 추가),
`src/migrations/1784263000000-CreateLectureEnrollments.ts`(신규).

**auction**: `src/app/courses/page.tsx`(신규), `src/app/courses/[courseId]/
page.tsx`+`MyCourseClient.tsx`(신규), `src/middleware.ts`(matcher 추가),
`src/app/lecture/[token]/page.tsx`(리다이렉트로 축소),
`src/app/admin/LectureReplayTab.tsx`(EnrollmentsBlock 추가, LinksBlock
접기), `src/lib/api.ts`(enrollment/회원용 courses API 타입·함수 추가).

### 추가된 API
- 회원(로그인 필요, role 무관): `GET /courses`, `GET /courses/:courseId`,
  `GET /courses/:courseId/videos/:videoId/play`
- 관리자: `GET /users/search?q=`, `GET /lecture-replay/enrollments`,
  `POST /lecture-replay/enrollments`, `POST
  /lecture-replay/enrollments/quick-90`, `PATCH
  /lecture-replay/enrollments/:id`, `POST
  /lecture-replay/enrollments/:id/revoke`

### 관리자 권한 부여 방법
`/admin` → "영상업로드" 탭 → 강의 선택 → "회원 수강권" 섹션에서 회원
검색(이름/아이디/전화번호) → 선택 → 시작일/만료일 지정 후 "수강권
부여", 또는 별도 날짜 지정 없이 "90일 권한 부여" 버튼으로 즉시
시작일=오늘/만료일=+90일 부여. 같은 회원+같은 강의 조합은 unique
제약이 있어 다시 부여하면 기존 행이 갱신됨(중복 생성 안 됨). 회수는
목록에서 "회수" 버튼(status=REVOKED로 전환, 행은 삭제 안 됨).

### 수강생 이용 방법
로그인 후 `/courses`에서 본인에게 부여된 강의 카드 확인(기간/남은
일수/상태) → "수강 중" 상태인 강의만 "강의 보기" 클릭 가능 →
`/courses/[courseId]`에서 섹션/영상 목록 보고 클릭해 시청. 수강권이
없거나 시작 전/만료/회수 상태면 스펙에 명시된 안내 문구가 그대로
표시됨.

### 환경변수 변경 사항
없음(기존 `BUNNY_STREAM_*` 3종 그대로 사용).

### 테스트 결과
- 백엔드/프론트 모두 `npx tsc --noEmit`, `npm run build`(ESLint 포함)
  클린 확인.
- **실제 브라우저 E2E(회원가입→관리자 수강권 부여→로그인→시청)는
  이 세션에서 수행하지 못함** — 로컬에 테스트 계정/실제 Bunny 영상이
  없어 코드 정적 검증(빌드)까지만 완료. 배포 후 관리자가 직접
  회원 하나에 수강권을 부여하고 그 계정으로 로그인해 `/courses`→
  `/courses/[courseId]` 흐름을 한 번 테스트해보는 것을 권장.
- 배포 후 `railway status`/헬스체크와 `npx vercel ls`로 정상 기동
  확인 예정(이 문서에 追記).

## 追記 (2026-08-02) — "OT수강생" 등급 추가

사용자가 다시 요청: 기존 "회원 권한 관리"의 권한 변경 드롭다운에
"OT수강생" 등급을 직접 추가해서, 그 등급이면 OT강의를 (개별 수강권
부여 없이) 자동으로 볼 수 있게 해달라는 명시적 요청 — 앞서 "역할을
새로 추가하지 않고 enrollment만으로 처리"를 추천했었지만, 사용자가
기존 권한 관리 화면에 직접 노출되는 형태를 원해 이번엔 그대로 구현.

- `UserRole.OT_STUDENT = "ot_student"` 추가(백엔드 `constants.ts` +
  프론트 `types/auction.ts`/`lib/auth.ts`/`lib/roles.ts` 3곳,
  `ROLE_LABELS`에 "OT수강생" 라벨).
- `Course` 엔티티에 `isOtCourse: boolean`(default false) 추가 —
  마이그레이션 `1784264000000-AddCourseIsOtCourse.ts`(컬럼 추가만,
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
- `LectureReplayService`:
  - `listMyCourses()`가 로그인한 회원의 role이 OT_STUDENT면, 개별
    enrollment 목록에 더해 `isOtCourse && isPublished`인 강의를
    가상 항목(자동 ACTIVE, 무제한 기간)으로 추가 표시(이미 개별
    수강권이 있는 강의는 중복 표시 안 함).
  - `requireActiveEnrollment()` 진입 전에 `hasOtCourseAccess()`로
    OT수강생+OT강의 조합이면 enrollment 조회 없이 즉시 통과시킴.
  - `updateCourse()`가 `isOtCourse` 필드도 받도록 확장.
- 프론트: `admin/page.tsx`의 "회원 권한 관리" 드롭다운에 `<option
  value="ot_student">OT수강생</option>` 추가. `LectureReplayTab.tsx`
  강의 목록 각 행에 "OT강의"/"일반강의" 뱃지 + "OT강의로 지정"/
  "OT강의 해제" 토글 버튼 추가. `middleware.ts`/`lib/roles.ts`의
  `getLoginRedirect()`가 OT수강생을 `/pending` 대신 `/courses`로
  보내도록 수정(로그인 목적이 강의 시청이므로).
- `SEARCH_ACCESS_ROLES`(물건 검색/AI분석 권한)에는 OT_STUDENT를
  추가하지 않음 — OT수강생은 강의만 볼 수 있고 물건 검색은 여전히
  막혀 있음(의도된 동작).

### 변경 파일(추가분)
**auction-api**: `src/common/constants.ts`, `src/lecture-replay/entities/course.entity.ts`,
`src/lecture-replay/lecture-replay.service.ts`, `src/lecture-replay/lecture-replay.controller.ts`,
`src/migrations/1784264000000-AddCourseIsOtCourse.ts`(신규).

**auction**: `src/types/auction.ts`, `src/lib/auth.ts`, `src/lib/roles.ts`,
`src/middleware.ts`, `src/app/admin/page.tsx`, `src/app/admin/LectureReplayTab.tsx`,
`src/lib/api.ts`.

### 관리자 사용 방법
1. 영상업로드 탭에서 원하는 강의 옆 "OT강의로 지정" 클릭
2. 회원권한 관리 탭에서 대상 회원의 권한을 "OT수강생"으로 변경
3. 그 회원이 로그인하면 자동으로 `/courses`로 이동하고, OT강의가
   수강권 부여 없이 바로 보임(추후 "수강생"으로 등급을 올리면 그때
   개별 강의에 대해 회원 수강권을 정식으로 부여하면 됨)

### 테스트 결과
백엔드/프론트 모두 `tsc --noEmit` + `npm run build` 클린 확인. 실제
OT수강생 계정으로 로그인해 `/courses`에 OT강의가 자동으로 뜨는지는
이 세션에서 직접 확인하지 못함 — 배포 후 관리자가 테스트 계정으로
확인 권장.

## 追記 (2026-08-02) — 관리자는 모든 강의를 수강권 없이 자동 열람

사용자 요청: "관리자는 모든 강의를 볼 수 있게 해줘". OT수강생 자동
접근 로직(`hasOtCourseAccess`)을 `hasAutoAccess`로 일반화해서, role이
ADMIN이면 강의별 enrollment/OT플래그와 무관하게 항상 통과하도록 수정.

- `listMyCourses()`: role이 ADMIN이면 (공개 여부 무관) 전체 강의를
  자동 항목으로 `/courses` 목록에 포함.
- `requireActiveEnrollment()` → `hasAutoAccess()`가 ADMIN이면 무조건
  true 반환(OT수강생 조건보다 먼저 체크).
- `getMyCourseAccessInfo()`: 기존엔 `!course.isPublished`면 무조건
  404였는데, 요청자가 ADMIN이면 비공개 강의도 미리보기 가능하도록
  예외 처리(영상 자체의 공개 여부는 기존과 동일하게 유지 — 비공개
  영상은 관리자에게도 재생 URL을 안 줌, 이 부분은 이번 요청 범위
  밖이라 건드리지 않음).

## 追記 (2026-08-02) — 강의/영상 등록 시 기본 공개로 변경

사용자 지적: "앞으로 영상 등록은 직원이 할 수도 있는데 이런식으로
계속 처리해야하는거야?" → "그냥 관리자페이지에서 영상등록하면
바로바로 보여지게 해야지". 지금까지 `createCourse`/`createVideo`가
`isPublished: false`로 생성돼, 등록 후 별도로 "공개로"를 한 번 더
눌러야 했던 것을 **기본값 true로 변경** — 등록과 동시에 바로
보이도록 함. 숨기고 싶은 경우에만 목록에서 "비공개로" 토글하면 됨.
프론트 안내문도 이 흐름에 맞춰 갱신.

같은 대화에서 확인된 별개 이슈: 사이드바에 영상이 "중복"으로 보인
문제는 실제 DB 중복이 아니라 섹션명과 영상명을 동일하게 지어서 생긴
착시였음(직접 운영 DB 조회로 확인, 코드 수정 없음).

## 追記 (2026-08-02) — 강의 재구성(OT 전용 코스 분리) + 영상 단위 OT 지정

**운영 DB 직접 재구성**: 사용자가 OT수강생 테스트 중 "OT강의로
지정"이 강의(코스) 전체 단위라는 걸 이해하고, 기존 "경매코치
밀착코칭반" 코스 안에 앞으로 1강/2강/3강 섹션도 함께 넣을 계획이라
전체를 OT로 열어두면 안 된다고 판단 → "OT 오리엔테이션"이라는 새
코스를 만들어 기존 OT 섹션/영상을 그쪽으로 옮기고, "경매코치
밀착코칭반"의 OT강의 지정은 해제해달라고 요청. `railway run
--service Postgres`로 운영 DB에 직접 접속해 (1) 새 코스 INSERT,
(2) 기존 섹션의 courseId를 새 코스로 UPDATE, (3) 기존 코스의
isOtCourse를 false로 UPDATE — 스크립트는 작업 후 삭제.

**영상 단위 OT 지정 추가**: 이후 사용자가 "영상 하나하나씩 선택할 수
있게" 요청 — 강의 전체를 OT로 여는 것 말고, 같은 강의 안에서 특정
영상만 OT수강생에게 공개할 수 있어야 한다는 요구.

- `CourseVideo`에 `isOtVideo: boolean`(default false) 추가 —
  마이그레이션 `1784265000000-AddCourseVideoIsOtVideo.ts`.
- `LectureReplayService`에 `getAccessMode(username, courseId):
  "full" | "ot-videos-only"` 도입:
  - ADMIN → "full"
  - OT_STUDENT + course.isOtCourse(전체 지정) → "full"
  - OT_STUDENT + 강의 안에 공개된 isOtVideo 영상이 하나라도 있으면
    → "ot-videos-only"(그 영상들만 재생 가능, 나머지는 실제 공개
    여부와 무관하게 "준비 중"으로 표시)
  - 그 외에는 기존 enrollment 상태 판정 로직(REVOKED/NOT_STARTED/
    EXPIRED) 그대로 유지 후 "full"
  - 아무 조건도 안 맞으면 "수강 권한이 없는 강의입니다." 예외
- `buildSectionsWithVideos(courseId, restrictToOtVideos)`: mode가
  "ot-videos-only"일 때 `isOtVideo`가 아닌 영상의 `isPublished`를
  응답에서 강제로 false로 덮어써서(실제 DB 값은 안 건드림) 프론트가
  그 영상을 "준비 중"으로 렌더링하게 함.
- `getMyPlayUrl`도 mode가 "ot-videos-only"인데 요청한 videoId가
  `isOtVideo`가 아니면 재생 URL을 내주지 않고 Forbidden.
- `listMyCourses`: OT수강생에게 자동 표시되는 강의 목록을
  "isOtCourse인 강의" 뿐 아니라 "공개 상태이고 isOtVideo 영상이
  하나라도 있는 강의"까지 포함하도록 확장.
- 프론트: 영상 목록 각 행에 "OT영상"/"일반영상" 토글 버튼 추가
  (`isPublished`/`수정` 버튼 옆), `updateLectureVideo` body에
  `isOtVideo` 추가.

### 변경 파일(추가분)
**auction-api**: `src/lecture-replay/entities/course-video.entity.ts`,
`src/lecture-replay/lecture-replay.service.ts`,
`src/lecture-replay/lecture-replay.controller.ts`,
`src/migrations/1784265000000-AddCourseVideoIsOtVideo.ts`(신규).

**auction**: `src/lib/api.ts`, `src/app/admin/LectureReplayTab.tsx`.

### 테스트 결과
백엔드/프론트 `tsc --noEmit` + `npm build` 클린. 운영 DB 재구성은
쿼리 후 재조회로 결과 확인(새 코스/섹션 이동/OT지정 해제 모두 반영
확인). 영상 단위 OT 지정 기능은 배포 후 실제 UI 클릭 테스트는
아직 못함.

## 追記 (2026-08-02) — 자동접근 강의 카드의 무의미한 기간 숨김

관리자/OT수강생 자동접근 항목은 `startsAt`/`expiresAt`을 1970~2999
같은 의미없는 값으로 채워 넣고 있었는데, `/courses` 카드에 그대로
"수강 기간: 1970. 1. 1. ~ 2999. 12. 31." / "남은 일수:
9007199254740991일" 처럼 노출되는 문제 발견. `listMyCourses()` 응답에
`isAuto: boolean` 필드 추가(개별 enrollment 항목은 false, 자동접근
항목은 true), 프론트 `/courses` 카드에서 `isAuto`면 기간/남은일수
섹션 자체를 렌더링하지 않도록 수정.

## 追記 (2026-08-02) — 특정 명단 자동 OT수강생 등업(임시 조치)

사용자 요청: "현영근/권오상/김동우/정혜원/김수진 이 이름으로
회원가입하는 사람들은 자동으로 OT수강생으로 등업" — 관리자가 매번
수동으로 등급을 바꿔줄 필요 없이, 회원가입 시점에 이름이 일치하면
자동으로 `UserRole.OT_STUDENT`를 부여하도록 `UsersService
.createMember()`에 임시 분기 추가(`OT_AUTO_UPGRADE_NAMES` Set,
정확히 일치하는 이름만 대상). 배포 전 운영 DB에서 해당 5명이 이미
가입돼 있는지 먼저 확인했으나 전원 미가입 상태라 신규가입 시점
로직만으로 충분함(기존회원 소급 처리 불필요). 이 조치는 임시용이라
주석에 "대상자 가입 완료 후 목록/분기를 지워도 됨" 명시 —
회원권한 관리 화면에서 수동으로도 언제든 등급 변경 가능하므로
영구히 남겨둬도 무해하지만, 코드 정리 관점에서 추후 제거 권장.

### 변경 파일(추가분)
`src/lecture-replay/lecture-replay.service.ts`(isAuto 필드),
`src/users/users.service.ts`(OT_AUTO_UPGRADE_NAMES 자동등업),
프론트 `src/lib/api.ts`/`src/app/courses/page.tsx`(isAuto 반영).

## 追記 (2026-08-02) — 헤더 "강의실" 메뉴 + 시청 페이지 디자인 개편

**헤더 메뉴**: `/courses`로 갈 방법이 주소 직접 입력밖에 없다는
지적 → 홈(`/`)/검색(`/search`)/관리자(`/admin`)/컨설턴트
(`/consultant`) 헤더에 "강의실" 링크 추가.

**시청 페이지 디자인**: 사용자가 피그마에서 만든 강의상세 디자인
("바로일본어" 스타일, Vite+React 코드로 내보낸 프로젝트)을
`C:\Users\young\Downloads\내 강의실 디자인`에 저장 → 직접 파일로
읽어 확인 후, 백엔드 지원 범위(Q&A/후기/노트/강사정보/진도율 저장
전부 미구현)를 먼저 짚고 사용자에게 이번 범위를 확인(AskUserQuestion)
→ "커리큘럼 탭 + 레이아웃만" 선택.

- `src/app/courses/[courseId]/MyCourseClient.tsx`를 피그마 디자인
  팔레트(#5244d4 액센트 등)와 레이아웃(헤더+진행표시/영상+제목배지
  오버레이/이전·다음 강의 이동바/통계 카드+섹션 리스트/우측 사이드바
  아코디언)로 전면 재구성.
- Bunny iframe 위에 커스텀 재생 컨트롤을 얹을 수 없어(외부 iframe이라
  내부 클릭 이벤트를 가로챌 수 없음), 디자인의 커스텀 시크바/재생버튼은
  구현하지 않고 제목 배지(pointerEvents:none, 클릭 통과)만 오버레이.
- "완료/재생중" 상태(초록 체크)는 진도 저장 기능이 없어 구현 불가 →
  단순히 "선택됨(재생중)" 강조 + "공개/준비중(잠김)" 2가지 상태만
  표시.
- 강사 정보 바, Q&A/후기/노트 탭은 이번 범위에서 제외(백엔드 데이터
  없음) — 추후 별도 요청 시 진행.

## 追記 (2026-08-02) — Bunny 플레이어 강조색은 URL 파라미터로 불가

사용자가 재생 화면 스크린샷을 보내며 Bunny 플레이어 자체(재생버튼/
시크바)의 주황색을 사이트 보라 톤(#5244d4)으로 바꿔달라고 요청.

- 1차 시도: embed URL에 `&color=5244d4` 쿼리 파라미터 추가 후 배포 →
  사용자가 "색상이 그대로"라고 재확인.
- WebFetch로 bunny.net 공식 문서(`stream-embedding-videos`,
  `stream/player-settings`)를 직접 확인한 결과, **embed URL에는
  `color` 파라미터가 존재하지 않음**(지원 파라미터는 autoplay/
  captions/preload/t/chromecast/muted/loop 등). 플레이어 색상은
  **Bunny 대시보드 > Stream > 해당 라이브러리 > Player 설정에서
  라이브러리 단위로만 지정 가능**.
- 잘못 추가했던 `&color=` 파라미터를 제거(`buildEmbedUrl()`)하고,
  사용자에게 대시보드에서 직접 설정하는 방법 안내로 전환.

## 追記 (2026-08-02) — 사이드바 정렬 버그(원인: sticky+overflow-y-auto 이중 오프셋) + 재생시간 자동조회

**사이드바 상단 정렬 버그의 진짜 원인**: 사용자가 5차례 넘게 "사이드바
상단이 영상 상단과 안 맞는다"고 재현 스크린샷을 보내와 flex→grid
전환 등 여러 시도를 했지만 해결이 안 됐음. 최종 원인은
`aside`(강의 목록 사이드바)가 `position: sticky; top: 76px`와
`overflow-y: auto`를 동시에 갖고 있었던 것 — `aside`의 sticky는
가장 가까운 "스크롤 컨테이너"(`overflow-y: auto` div, 여기선 body
전체를 감싸는 바깥 div)를 기준으로 계산되는데, 그 스크롤 컨테이너
자체가 이미 헤더 아래에서 시작하고 있어 `top: 76px`이 오프셋을
중복 적용해 빈 여백을 만들고 있었다. 이번엔 프론트 배포는 정상이었
음을 `npx vercel inspect <프로덕션 도메인>`으로 매번 직접 확인해서
"배포가 안 됐다"는 오해는 배제한 뒤 코드 자체를 정독해서 찾음.
`sticky`/`overflow-y-auto`를 제거해 일반 문서 흐름에 맡기는 것으로
해결(스크롤 시 목록이 화면에 고정되는 기능은 이번엔 희생 — 강의가
많아져 다시 필요해지면 스크롤 컨테이너 구조를 다시 설계해야 함).

**교훈**: `npx vercel ls`의 "Ready" 상태만으로는 실제 서비스 도메인
(`auction-seven-tan.vercel.app`)에 반영됐는지 보장 못 함 — 반드시
`npx vercel inspect <실제 도메인>`으로 alias가 최신 배포를 가리키는지
확인해야 한다(이 프로젝트는 Git 연동으로 자동 aliasing되고 있었음이
이번에 확인됨, 별도 수동 aliasing은 불필요했음 — 그럼에도 매번 직접
확인하는 습관이 필요).

**영상 재생시간 자동조회**: 관리자가 "총 재생시간"이 "-"로 나오는
것을 보고 Bunny에서 자동으로 가져와 달라고 요청. `LectureReplayService`
에 `fetchBunnyVideoDurationSeconds()` 추가(Bunny Video API,
`GET https://video.bunnycdn.com/library/{id}/videos/{videoId}`,
`AccessKey` 헤더로 `BUNNY_STREAM_API_KEY` 사용) — 영상 생성 시
자동 조회해 채우고, 기존 영상도 재생시간이 비어있으면 아무 필드나
수정 저장할 때 자동으로 채워지도록 함. **`BUNNY_STREAM_API_KEY`가
Railway에 아직 설정되어 있지 않아(확인함, `BUNNY_STREAM_LIBRARY_ID`만
있음) 실제로 채워지려면 사용자가 Bunny 대시보드에서 Video API 키를
발급해 등록해야 함** — 키가 없으면 조용히 null 반환하고 등록/수정
자체는 막지 않음.

## 追記 (2026-08-02) — 회원 삭제, 관리자 UI 정리, 로고 통일

**회원 삭제 기능**: "회원 권한 관리에서 필요없는 회원은 지우고
싶은데 삭제 가능하게 해줘" + "삭제할때 쉽게 삭제 못되게 여러분
누르게 구조를 만들어주고" — 단순 브라우저 confirm()이 아니라 2단계
클릭 확인 UX로 구현.
- 백엔드: `UsersService.deleteUser(id)`(admin 계정은 삭제 불가,
  `ConflictException`) + `DELETE /users/:id`(`requireAdmin`) 컨트롤러
  추가.
- 프론트: `src/lib/api.ts`에 `deleteUser()` 추가. `admin/page.tsx`
  "회원 권한 관리" 테이블에 "삭제" 컬럼 추가 — 첫 클릭 시
  `confirmingDeleteUserId` state로 "정말 삭제?"/"취소" 버튼으로
  전환, 같은 행을 다시 클릭해야 실제 `DELETE` 요청 발생. admin
  role 행은 삭제 버튼 자체를 숨김(백엔드 보호와 일치).

**관리자 UI 정리(명시적 요청, 모두 즉시 반영)**:
- "매도분석 탭은 없애도 될꺼같아 어차피 물건작업에 들어가있으니까"
  → `admin/page.tsx`의 `ADMIN_TABS` 배열에서 해당 항목 제거(타입/
  렌더 분기는 기존 컨벤션대로 유지, 완전 삭제 안 함).
- "강의 이름도 수정할 수 있게 해줘" → `LectureReplayTab.tsx` 강의
  목록에 인라인 제목 수정(수정/저장/취소 버튼) 추가.
- "일반강의 이부분도 필요없고 섹션에서 선택하면 되니까" → 강의
  레벨 "OT강의로 지정" 토글 UI를 `LectureReplayTab.tsx`에서 제거
  (백엔드 `isOtCourse` 필드/로직 자체는 유지 — 이미 지정된 기존
  데이터와 API는 그대로 두고 UI만 정리, 영상 단위 OT 지정으로
  대체 완료된 상태이므로 UI 노출만 없앰).

**로고 "강" 아이콘 → "코치픽" 단일 배지 통일**: 여러 라운드에
걸쳐 "강 지우고 코치픽으로", "검은색글씨 코치픽은 지워줘" 등 반복
지적 → 최종적으로 아이콘+텍스트 조합을 없애고 보라 그라데이션
배지 하나에 "코치픽" 텍스트만 넣는 형태로 3개 페이지 모두 통일:
- `src/app/courses/page.tsx`(강의실 목록) — 기존에 이미 배지 형태로
  돼 있었음(변경 없음, `homeHref` 링크 유지).
- `src/app/courses/[courseId]/MyCourseClient.tsx`(강의상세) — "코치픽
  저 버튼을 누르면 코치픽 추천물건페이지로 넘어가는게 못넘어가게
  해줘" 요청에 따라 `<Link href="/">` 래퍼를 제거하고 클릭 불가능한
  `<div>`로 변경(OT수강생은 "/"에 접근 권한이 없어 링크가 있으면
  안 됐음).
- `src/app/account/page.tsx`(내 정보) — 기존엔 "강" 아이콘 박스 +
  별도 검은 글씨 "코치픽" 텍스트가 나란히 있던 것을 다른 페이지와
  동일한 단일 배지로 교체(`Link href={homeHref}`는 유지 — 이 페이지는
  OT수강생 접근 제한과 무관).

### 변경 파일
**auction-api**: `src/users/users.service.ts`(`deleteUser`),
`src/users/users.controller.ts`(`DELETE /users/:id`).

**auction**: `src/lib/api.ts`(`deleteUser`), `src/app/admin/page.tsx`
(삭제 컬럼/2단계 확인 핸들러, 매도분석 탭 제거),
`src/app/admin/LectureReplayTab.tsx`(강의명 인라인 수정, 강의레벨
OT토글 UI 제거 — 이 파일은 이전 세션에서 이미 수정, 이번엔 그
상태 그대로 커밋에 포함되지 않음, 별도 커밋 이력 확인 필요),
`src/app/courses/[courseId]/MyCourseClient.tsx`(로고 비클릭화),
`src/app/account/page.tsx`(로고 단일 배지화).

### 테스트 결과
`auction`/`auction-api` 모두 `npx tsc --noEmit` + `npm run build`
클린 확인. 배포 후 `npx vercel inspect https://auction-seven-tan.vercel.app`
로 alias가 최신 배포를 가리키는지 확인 예정(이 문서에 追記).

## 追記 (2026-08-02) — 강의/영상 등록 기본값을 다시 "비공개"로 되돌림

앞서(§"강의/영상 등록 시 기본 공개로 변경") 직원 편의를 위해 기본값을
공개로 바꿨었는데, 사용자가 다시 "새로운 강의를 추가하면 기본적으로
비공개로 해줘"라고 요청 — `createCourse()`/`createVideo()`의
`isPublished` 기본값을 `true`→`false`로 재변경. 영상도 같이 비공개로
할지 확인(AskUserQuestion)한 결과 "영상도 비공개로 변경" 선택 —
`createVideo()`도 동일하게 기본 비공개로 변경. 등록 후 관리자가
목록에서 "공개로"를 눌러야 노출된다(강의/영상 둘 다).

같은 대화에서 확인된 사실: `CourseSection` 엔티티에는 공개/비공개
컬럼이 아예 없다(제목+정렬순서만 있는 순수 그룹). 접근 판정은 강의
단위(`course.isPublished`)에서 먼저 막히므로, **강의가 비공개면
그 안 섹션/영상이 전부 공개 상태여도 수강생에게는 안 보인다**
(관리자만 비공개 강의도 미리보기 가능한 예외 유지).

### 변경 파일
`src/lecture-replay/lecture-replay.service.ts`(`createCourse`/
`createVideo`의 `isPublished` 기본값).

### 테스트 결과
`npx tsc --noEmit` + `npm run build` 클린 확인. 배포 후 `railway
status`/헬스체크로 정상 기동 확인 예정(이 문서에 追記).

## 追記 (2026-08-04) — OT수강생 자동승급을 이름당 1회만 적용

`OT_AUTO_UPGRADE_NAMES` 명단(현영근/권오상/김동우/정혜원/김수진) 대상 5명 중
3명이 가입 완료된 시점에 사용자가 확인 요청 → 아직 유효하게 동작 중임을
확인. 이어서 "저 5명이 가입하면 그다음부턴 등급부여가 자동으로 안되게
할 수 있어?" → "계속 누군가 저이름으로 가입하게되면 자동으로 될 수도
있으니까 한번만"이라고 구체화 — 즉 명단 인원이 전부 가입을 마친 뒤에도
같은 이름으로 또 가입하는 사람(동명이인 또는 이름 도용)에게까지 자동
등급이 부여되는 것을 막아달라는 요청.

`UsersService.createMember()`에서, 자동 부여 대상 이름이어도 동일한
이름을 가진 회원이 이미 DB에 존재하면(`userRepo.exists({ where: { name }
})`) 자동 부여를 건너뛰고 일반 `MEMBER`로 가입시키도록 변경 — 이름당
정확히 1회만 자동 승급되게 함. 명단 자체(`OT_AUTO_UPGRADE_NAMES`)는
그대로 두되, 재사용 방지 로직만 추가.

### 변경 파일
`src/users/users.service.ts`(`createMember`).

### 테스트 결과
`tsc --noEmit` + `npm run build` 클린. 배포 후 헬스체크(401) 확인
완료. 실제로 이미 가입한 3명과 같은 이름으로 재가입을 시도했을 때
자동 승급이 안 되는지는 실사용 시나리오라 직접 재현 테스트는
안 함(로직상 보장됨).

## 追記 (2026-08-04) — 영상 1개를 타임스탬프로 나눠 여러 섹션처럼 보여주는 "챕터" 기능

사용자 요청: "영상 1개를 올리면 시간을 알려주면 알려준 시간으로 섹션을
구분해서 나눠서 영상이 보이도록 해줄 수 있어?" → "시간시작 종료시작은
입력하면 영상 1개가 여러개로 쪼개져서 보이게 하는거지"로 의도 확정 —
실제 파일(Bunny Stream 영상)은 하나 그대로 두고, 관리자가 타임스탬프
목록만 입력하면 강의 화면에서 여러 강의처럼 나뉘어 보이고 클릭 시 그
지점부터 재생되게 하는 기능.

### 설계
영상마다 별도 챕터 테이블을 만들지 않고, `CourseVideo`에 `chapters`
(simple-json, `{title, startSeconds}[]`) 컬럼 하나만 추가 — 가벼운
메타데이터라 별도 엔티티/FK가 과함. 종료 시각은 별도로 안 받고 "다음
챕터의 시작 시각"(마지막 챕터는 영상 전체 길이)으로 자동 계산.

재생은 Bunny Stream iframe embed의 `t=`(초 단위 시작 지점) 쿼리
파라미터를 붙이는 방식 — 서명 토큰은 `SHA256(security_key+video_id+
expires)`로만 계산되므로 `t` 파라미터를 추가해도 서명이 깨지지 않는다
(2026-08-02 기록의 "color 파라미터는 지원 안 됨"과 달리 `t`는 Bunny
공식 지원 파라미터).

### 구현
**백엔드**
- `CourseVideo.chapters`(신규 컬럼, 마이그레이션
  `1784269000000-AddCourseVideoChapters`).
- `LectureReplayService.normalizeChapters()`: 제목 없는 항목 제외,
  startSeconds 오름차순 정렬.
- `createVideo`/`updateVideo`가 `chapters` 필드를 받아 저장.
- `buildEmbedUrl(bunnyVideoId, startSeconds?)`: `startSeconds`가 있으면
  `&t=초` 추가.
- `getMyPlayUrl`/`getPlayUrl`(로그인 수강생용/공개 링크용 둘 다)이
  `startSeconds`를 받아 `buildEmbedUrl`에 전달. 컨트롤러
  (`lecture-courses.controller.ts`, `lecture-replay-public.controller.ts`)
  에 `?t=` 쿼리 파라미터 추가.
- `buildSectionsWithVideos()`가 반환하는 영상 목록에 `chapters` 필드
  포함(관리자/수강생 화면 모두 이 목록을 씀).

**프론트 — 관리자**(`LectureReplayTab.tsx`)
- 영상 등록/수정 화면에 챕터 입력 textarea 추가 — "12:34 제목" 형식
  한 줄당 하나(`parseChaptersText`로 파싱, `H:MM:SS`/`MM:SS`/`SS` 모두
  허용).
- 영상 목록 행에 "챕터 N개" 표시 + "챕터" 버튼으로 인라인 편집(기존
  챕터를 다시 텍스트로 보여주는 `chaptersToText`로 역변환).

**프론트 — 수강생 화면**(`MyCourseClient.tsx`, `LectureReplayClient.tsx`)
- `expandVideoRows()`: 영상에 챕터가 있으면 챕터별로, 없으면 영상
  그대로 사이드바 행을 만든다. 각 챕터 행의 재생시간은 "다음 챕터
  시작 - 이 챕터 시작"(마지막 챕터는 "영상 전체 길이 - 시작")으로 계산.
- 선택 상태를 `(videoId, startSeconds)` 쌍으로 관리해, 같은 영상의
  다른 챕터를 구분해서 활성 표시.
- "이전/다음 강의" 이동도 챕터 단위로 펼친 목록(`publishedRows`)
  기준으로 동작하도록 변경(기존엔 영상 단위였음).

### 변경 파일
`src/lecture-replay/entities/course-video.entity.ts`,
`src/lecture-replay/lecture-replay.service.ts`,
`src/lecture-replay/lecture-replay.controller.ts`,
`src/lecture-replay/lecture-courses.controller.ts`,
`src/lecture-replay/lecture-replay-public.controller.ts`,
`src/migrations/1784269000000-AddCourseVideoChapters.ts` (auction-api),
`src/lib/api.ts`, `src/app/admin/LectureReplayTab.tsx`,
`src/app/courses/[courseId]/MyCourseClient.tsx`,
`src/app/lecture/[token]/LectureReplayClient.tsx` (auction).

### 테스트 결과
양쪽 `tsc --noEmit` 클린, `auction-api`는 `npm run build`(nest build),
`auction`은 `npm run build`(next build) 모두 클린. 배포 후 실제
Bunny Stream 영상에 챕터를 등록해 재생 화면에서 시간 이동이 되는지는
관리자가 직접 영상을 올린 뒤 확인 필요(미확인).

## 追記 (2026-08-04) — 챕터 자동 정지(다음 챕터 시작 전에 끊기) + 종료시간 직접 입력

챕터 기능 적용 직후 사용자 질문: "적용은 잘되는데 영상이 시작시간을
정해주면 다음 시작시간전에 끝나는걸로 하게는 못하나?" → "종료시간을
입력해도 되고"로 대안 제시. 즉 지금까지는 `t=`로 시작 지점만 이동할
뿐 재생은 영상 끝까지 계속돼서, 챕터 구분이 목록에서만 보이고 실제
재생은 안 끊긴다는 문제.

Bunny Stream이 Player.js(postMessage 기반 재생 제어/이벤트 API)를
공식 지원한다는 걸 WebFetch/WebSearch로 확인
([Bunny Stream Playback control API](https://docs.bunny.net/stream/playback-api),
[Player.js 지원 발표](https://bunny.net/blog/introducing-player-js-support-for-bunny-stream-advanced-player-control-and-monitoring-api/))
— `assets.mediadelivery.net/playerjs/playerjs-latest.min.js`를 로드해
`new playerjs.Player(iframeId)`로 감싼 뒤 `on("timeupdate", cb)`로 현재
재생 초를 받아 `pause()`를 호출하는 방식.

### 구현
- **백엔드**: `CourseVideo.chapters`에 `endSeconds?: number`(선택) 추가.
  관리자가 종료시간을 직접 안 주면 프론트에서 "다음 챕터의 시작 시각"을
  종료 시각으로 자동 계산(기존 `durationSeconds` 표시 계산 로직과
  동일한 fallback을 재활용). `normalizeChapters()`가 `endSeconds >
  startSeconds`인 경우만 유효값으로 받아들인다.
- **프론트 — 신규 파일** `src/lib/bunny-playerjs.ts`: Player.js 스크립트
  1회 로드(모듈 스코프 프라미스 캐시) + `attachChapterAutoPause(iframeId,
  endSeconds)` — `endSeconds`가 없으면(챕터 없거나 마지막 챕터) 아무 동작
  안 함, 있으면 `timeupdate`를 구독해 도달 시 `pause()`.
- `MyCourseClient.tsx`/`LectureReplayClient.tsx`: iframe에 고정 `id` 부여,
  `embedUrl`이 바뀔 때(챕터/영상 전환 시 iframe이 새로 마운트될 때)마다
  `attachChapterAutoPause` 재호출. `expandVideoRows()`가 반환하는 각 행에
  `endSeconds`(자동 정지 지점, 명시 지정 또는 다음 챕터 시작일 때만 값 존재
  — 마지막 챕터는 억지로 추정하지 않고 그냥 끝까지 재생)를 추가.
- **관리자 화면**(`LectureReplayTab.tsx`): 챕터 입력 형식에
  "시작시간-종료시간 제목"(하이픈으로 종료시간 추가 지정) 지원 추가.
  종료시간 생략 시 기존처럼 다음 챕터 시작에서 자동 정지.

### 변경 파일
`src/lecture-replay/entities/course-video.entity.ts`,
`src/lecture-replay/lecture-replay.service.ts`,
`src/lecture-replay/lecture-replay.controller.ts` (auction-api);
`src/lib/bunny-playerjs.ts`(신규), `src/lib/api.ts`,
`src/app/admin/LectureReplayTab.tsx`,
`src/app/courses/[courseId]/MyCourseClient.tsx`,
`src/app/lecture/[token]/LectureReplayClient.tsx` (auction).

### 테스트 결과
양쪽 `tsc --noEmit` + `npm run build` 클린. Player.js를 통한 실제
자동 정지 동작은 CSP상 Artifact가 아닌 일반 Next.js 페이지라 외부
스크립트 로드 자체는 제약이 없지만, 실제 브라우저에서 타임업데이트
이벤트가 기대대로 오는지는 관리자가 챕터를 등록한 뒤 직접 재생해
확인 필요(미확인 — Bunny 공식 문서 예시 코드를 그대로 따랐음).

## 追記 (2026-08-04) — 챕터를 "완전히 별도 영상처럼" 보이게(자체 진행바로 교체)

Player.js 자동정지 적용 직후 사용자가 스크린샷과 함께 지적: "종료되는게
아니라 아예 그때까지 빨간박스 영상재생길이가 딱 저기까지만 나오고
다음영상도 게이지가 다시 처음부터 시작하게 이런식으로는 안될까?" →
"아예 영상이 따로따로 올라간거처럼" → "보이게". 즉 자동 정지만으론
부족하고, **재생바(스크러버) 자체가 챕터 길이 기준으로 0부터 시작해서
그 챕터 길이에서 끝나야** 진짜 "따로 업로드한 영상"처럼 보인다는 요구.

Bunny 공식 문서/블로그를 WebFetch로 확인한 결과, Bunny Stream엔 이미
"Chapters" 기능이 있지만
([Chapters and Moments 소개](https://bunny.net/blog/introducing-bunny-stream-chapters-and-moments/))
이건 YouTube 챕터처럼 **영상 전체 재생바 위에 구간 마커만 얹는 방식**이라
(공식 문구: "Each Chapter is shown in the video timeline and highlights
the current section and title") 사용자가 원하는 "0부터 시작하는 별도
게이지"와는 다름. 또한 iframe embed 쿼리 파라미터 목록
([embedding 문서](https://bunny.net/docs/stream-embedding-videos))에
네이티브 컨트롤을 숨기는 파라미터(`controls=false` 등)가 공식적으로
없어, 기본 재생바를 진짜로 챕터 길이만 반영하게 바꿀 방법이 없음을 확인.

### 해결 방식
Bunny의 기본 하단 컨트롤(재생바/시간)을 불투명 오버레이로 완전히
가리고, 그 위에 챕터 전용 자체 컨트롤(재생/일시정지 버튼 + 진행바 +
시간 표시)을 새로 그린다 — 진행률은 `Player.js`의 `timeupdate`로 받은
`currentTime`에서 챕터 `startSeconds`를 뺀 값 기준으로 계산해 항상
0부터 시작하고, `endSeconds`(다음 챕터 시작 또는 관리자가 직접 지정한
값)에서 100%가 되도록 만든다. 클릭 seek도 이 상대 좌표를 실제 영상
시각으로 환산해 `player.setCurrentTime()`으로 이동시킨다.

- 신규 컴포넌트 `src/components/BunnyChapterPlayer.tsx`: iframe +
  하단 오버레이(검은 바 h-12) + 자체 진행바/재생버튼/시간(mm:ss 형식).
- `src/lib/bunny-playerjs.ts`: 기존 `attachChapterAutoPause`(단순
  자동정지용)를 제거하고, `PlayerJsPlayer` 타입에 `play`/`pause`/
  `setCurrentTime`을 추가해 `BunnyChapterPlayer`가 직접 제어하도록 정리.
- `MyCourseClient.tsx`/`LectureReplayClient.tsx`: 선택된 행이 챕터면
  (`selectedRow.startSeconds != null`) `BunnyChapterPlayer`를, 챕터
  없는 일반 영상이면 기존 그대로 순정 `<iframe>`(네이티브 컨트롤 유지 —
  화질/자막/속도 등 고급 기능 보존)을 렌더링하도록 분기.

### 트레이드오프(사용자에게 공유 필요)
자체 컨트롤은 재생/일시정지/탐색만 지원 — Bunny 네이티브 컨트롤의
화질 선택, 자막, 배속, 전체화면 버튼(iframe allowFullScreen 자체는
살아있어 iframe 더블클릭/네이티브 버튼이 남아있다면 동작 가능성은
있으나 검증 안 됨) 등은 챕터 영상에서는 제공되지 않는다. 이 부분은
"보기엔 별도 영상처럼" 요구사항 달성을 위해 의도적으로 포기한 기능.

### 변경 파일
`src/lib/bunny-playerjs.ts`, `src/components/BunnyChapterPlayer.tsx`
(신규), `src/app/courses/[courseId]/MyCourseClient.tsx`,
`src/app/lecture/[token]/LectureReplayClient.tsx` (auction).

### 테스트 결과
`tsc --noEmit` + `npm run build` 클린. Vercel 자동배포(GitHub 웹훅)가
이번엔 몇 분간 트리거되지 않아 `vercel --prod --yes`로 직접 배포해
`auction-seven-tan.vercel.app`에 alias 반영 확인(HTTP 307, 로그인
리다이렉트로 정상). 실제 브라우저에서 커스텀 진행바가 정확히 챕터
길이만큼만 채워지는지, 하단 오버레이가 Bunny 컨트롤을 빈틈없이
가리는지는 관리자가 직접 확인 필요(미확인).

## 追記 (2026-08-04) — 마지막 챕터에서 진행바/탐색이 아예 안 되던 버그

사용자 보고(2강 "2주차 손품시세조사" 실사용, 스크린샷 첨부): "첫번째
섹션 빌라 시세조사 방법은 게이지 조절이 되는데 두번째 섹션
전화조사방법은 게이지 조절이 아예 안돼". 운영 DB `course_videos`를
직접 조회해 원인 확인 — 실제로 두 챕터 제목("빌라 시세조사 방법",
"전화조사 방법")은 영상 1개(`bunnyVideoId=f92254d6...`, 전체
2813초=46:53)의 챕터 2개였고(`startSeconds` 0 / 2195), 두 번째가
마지막 챕터라 `endSeconds`가 없는 상태(자동 정지 안 하도록 의도한
설계 그대로).

문제는 `BunnyChapterPlayer`의 진행바 계산이 `chapterDuration = endSeconds
!= null ? ... : null`로 되어 있어서, `endSeconds`가 없는 마지막
챕터는 `chapterDuration`이 통째로 `null`이 되고, 그 결과 진행바가
0%에 고정되고(`progressPct`가 항상 0) `seekAt()`의 가드
(`chapterDuration == null → return`)에 걸려 클릭 탐색도 완전히
막혀 있었다. "자동 정지 안 함"과 "진행바/탐색 비활성화"가 같은
조건(`endSeconds` 유무)에 실수로 묶여 있던 게 원인.

### 수정
`BunnyChapterPlayer`에 `videoDurationSeconds`(영상 전체 길이) prop을
추가해, 진행바/탐색 계산 전용 `displayEndSeconds = endSeconds ??
videoDurationSeconds`를 따로 두었다. 자동 정지(`timeupdate`에서
`pause()` 호출)는 여전히 원래의 `endSeconds`만 보고 판단하므로 마지막
챕터는 그대로 끝까지 자연 재생되고, 진행바/탐색은 영상 전체 길이를
"이 챕터의 끝"으로 대신 써서 정상적으로 채워지고 클릭 탐색도 된다.

### 변경 파일
`src/components/BunnyChapterPlayer.tsx`,
`src/app/courses/[courseId]/MyCourseClient.tsx`,
`src/app/lecture/[token]/LectureReplayClient.tsx` (auction).

### 테스트 결과
`tsc --noEmit` + `npm run build` 클린. `vercel --prod --yes`로 직접
배포(GitHub 자동배포가 이번에도 즉시 트리거 안 됨) 후
`auction-seven-tan.vercel.app` 정상 응답(307) 확인. 실제로 두 번째
챕터에서 진행바가 채워지고 탐색이 되는지는 사용자가 재확인 필요.

## 追記 (2026-08-04) — Bunny 네이티브 재생바가 커스텀 진행바 위로 겹쳐 보이던 문제

사용자 보고(스크린샷): "게이지가 버니스트리밍꺼도 같이 보이는데 만약
우리 게이지가 있으면 버니스트리밍 게이지 안나오게 못해?". 커스텀
컨트롤을 가리는 오버레이가 `h-12`(48px)였는데, Bunny 기본 컨트롤 바의
실제 높이가 이보다 커서 재생바 라인 일부가 위로 삐져나와 커스텀
진행바와 겹쳐 보임.

가리는 오버레이만 `h-20`(80px)으로 키우고, 그 위에 커스텀 컨트롤
행(재생버튼/진행바/시간)은 기존처럼 하단 `h-12` 영역에만 배치 —
Bunny 쿼리 파라미터에 컨트롤을 완전히 숨기는 공식 옵션이 없어(이전
追記 참고), 마스크 크기를 넉넉히 키우는 방식으로 대응.

### 변경 파일
`src/components/BunnyChapterPlayer.tsx` (auction).

### 테스트 결과
`tsc --noEmit` + `npm run build` 클린, `vercel --prod --yes` 배포 후
정상 응답 확인. 실제로 겹침이 완전히 사라졌는지는 사용자 재확인 필요.

## 追記 (2026-08-04) — 자체 진행바 되돌림: Bunny 기본 재생바 + 구간 자동 정지만 유지

사용자가 Vimeo의 `controls=0` 예시를 들며 "버니도 이런게 가능하지
않을까? 이렇게 해놓고 우리 게이지를 올려두면 되지 않을까?"라고 제안.
WebSearch/WebFetch로 Bunny 공식 문서를 재확인한 결과:
- iframe embed 쿼리 파라미터에는 `controls`/`chromeless`/`hideControls`류가
  없음(전체 파라미터 목록 재확인, `t`/`autoplay`/`muted`/`loop`/
  `compactControls` 등만 존재).
- 대신 **Update Video Library API**([참고](https://bunny.net/docs/reference/videolibrarypublic_update))에
  `Controls`(표시할 컨트롤 목록), `CustomHTML`(플레이어에 커스텀 CSS 주입)
  필드가 있어, 새 플레이어(media-chrome 기반, `bunny-media-time-range`
  등 선택자)에서는 재생바를 포함한 컨트롤을 라이브러리 설정에서 끌 수
  있다는 것도 확인
  ([새 플레이어 소개](https://bunny.net/blog/introducing-the-new-bunny-stream-video-player/),
  [Custom head HTML 마이그레이션 가이드](https://bunny.net/docs/stream/custom-head-html-migration-guide)).

다만 이 설정은 **URL 파라미터가 아니라 라이브러리 전체 설정**이라
챕터 없는 일반 영상까지 Bunny 기본 컨트롤이 사라지는 트레이드오프가
있음을 사용자에게 안내(AskUserQuestion) → 사용자가 "우리꺼 집어
넣으니까 복잡하게 보이네"라며 커스텀 진행바 자체를 없애고, 처음
버니스트리밍 그대로 쓰되 "구간이 나눠져있고 섹션별로 정지되는
정도로만" 하자고 최종 결정.

### 되돌린 내용
- `src/components/BunnyChapterPlayer.tsx` 삭제.
- `src/lib/bunny-playerjs.ts`: `attachChapterAutoPause()`(Player.js
  timeupdate로 endSeconds 도달 시 pause만 호출하는 단순 버전)로 복귀,
  `PlayerJsPlayer` 타입에서 `play`/`setCurrentTime` 등 진행바용 API 제거.
- `MyCourseClient.tsx`/`LectureReplayClient.tsx`: 챕터 여부와 무관하게
  항상 순정 `<iframe>`(Bunny 기본 컨트롤 그대로) 렌더링 + `embedUrl`
  변경 시 `attachChapterAutoPause` 재연결.
- 최종 동작: 목록에서는 챕터별로 나뉘어 보이고(섹션 분리 유지), 클릭하면
  해당 시작 시각(`t=`)부터 재생되며, 다음 챕터 시작 지점(또는 관리자가
  지정한 종료 시각)에서 자동으로 멈춘다 — 단, 재생바 자체는 Bunny
  기본(영상 전체 길이 기준) 그대로.

### 변경 파일
`src/lib/bunny-playerjs.ts`, `src/app/courses/[courseId]/MyCourseClient.tsx`,
`src/app/lecture/[token]/LectureReplayClient.tsx` (auction). 삭제:
`src/components/BunnyChapterPlayer.tsx`.

### 테스트 결과
`tsc --noEmit` + `npm run build` 클린. `vercel --prod --yes` 배포 후
정상 응답(307) 확인.

## 追記 (2026-08-04) — 섹션(강의) 순서 변경 버튼 추가

사용자 지적: "강의 나오는 순서를 바꿀 수 있으면 좋겠는데 관리자
페이지에서 위아래 저 화살표가 그 기능 같기는한데 동작을 안하네" —
스크린샷 확인 결과 기존 ▲▼는 `SectionBlock` 내부 `handleMove`로 같은
섹션 안 영상끼리만 sortOrder를 바꾸는 기능이었다. 그런데 섹션마다
영상이 1개뿐이라 바꿀 대상이 없어 사실상 항상 비활성 상태였던 것 —
사용자가 실제로 원한 건 "2강/1강/3강..."처럼 순서가 뒤죽박죽인 섹션
자체의 노출 순서 변경이었는데, 그 기능은 애초에 없었다(백엔드
`updateSection`은 `sortOrder`를 이미 받을 수 있었지만 이 화면에서
호출하는 곳이 없었음).

`CourseDetail`(섹션 목록을 들고 있는 부모 컴포넌트)에
`handleMoveSection()`을 추가해 섹션 헤더에 별도 ▲▼ 버튼을 배치 —
클릭 시 인접 섹션과 `sortOrder`를 서로 바꿔 `updateLectureSection()`
2번 호출. 섹션 목록은 항상 `sortOrder` 오름차순으로 정렬해서 렌더링
(`sortedSections`).

### 변경 파일
`src/app/admin/LectureReplayTab.tsx` (auction).

### 테스트 결과
`tsc --noEmit` + `npm run build` 클린. `vercel --prod --yes` 배포 후
정상 응답(307) 확인.

## 追記 (2026-08-04) — 0:00 챕터가 이전 시청 위치에서 재생되던 버그

사용자 보고: "1강에 챕터를 넣었는데... 경매기본지식이 근데 00:00부터
시작을 안해... 누르면 33:07부터 시작해". 원인은 `buildEmbedUrl()`의
`startSeconds > 0` 조건 — 0을 "값 없음"으로 취급해 `t=` 파라미터
자체를 생략시켰다. Bunny 플레이어는 `t` 파라미터가 없으면 자체
"이어보기"(마지막 시청 위치, localStorage 기반 추정) 기능으로 재생을
시작해버려, 0:00부터 시작해야 할 첫 챕터가 이전에 보던 위치(33:07)에서
시작되는 것처럼 보였다.

`startSeconds > 0` → `startSeconds >= 0`으로 수정해 0초여도 명시적으로
`t=0`을 붙이도록 함. 프론트(`src/lib/api.ts`)의 `fetchMyCoursePlayUrl`/
`fetchLecturePlayUrl`에도 같은 패턴의 버그(`startSeconds ? ... : ""`)가
있어 같이 수정(`startSeconds != null` 체크로 변경) — 이쪽은 프론트→
백엔드로 `t` 쿼리 파라미터 자체를 안 보내는 문제였음(0이 아닌 값일 때는
정상 동작해 지금까지 발견 안 됐던 케이스).

### 변경 파일
`src/lecture-replay/lecture-replay.service.ts`(auction-api, `buildEmbedUrl`);
`src/lib/api.ts`(auction, `fetchMyCoursePlayUrl`/`fetchLecturePlayUrl`).

### 테스트 결과
양쪽 `tsc --noEmit` 클린. 프론트 `npm run build`는 로컬에서 동시에
돌고 있던 `npm run dev` 프로세스가 `.next` 디렉토리 파일을 잠그고
있어(OneDrive 동기화 환경, EINVAL readlink) 로컬 확인은 실패했지만
타입체크가 클린해 코드 자체의 문제는 아님 — 배포 파이프라인(Vercel)
빌드에서는 별도 환경이라 문제없이 빌드될 것으로 예상, 배포 후 확인 필요.

## 追記 (2026-08-04) — 강의실 학습 흐름, 진도 저장, Q&A와 노트 연결

초기 피그마 참조 작업에서 범위 밖으로 남겼던 진도율, Q&A, 노트 기능을
후속 작업으로 실제 데이터와 연결했다.

- `LectureProgress`와 `lecture_progress` 테이블을 추가해 회원·강의 영상별
  마지막 시청 위치, 완료 여부와 갱신 시각을 저장한다. 강의실 목록과
  시청 페이지는 저장된 진도를 이용해 이어보기와 전체 진행률을 표시한다.
- 강의 재생 화면 하단을 `커리큘럼`, `Q&A`, `수강후기`, `노트` 탭 구조로
  정리하고 기존 디자인의 헤더·강사 정보·이전/다음 강의 이동 흐름과
  일관되게 배치했다.
- `LectureQuestion`/`LectureNote` 엔티티와
  `lecture_questions`/`lecture_notes` 테이블을 추가했다. 수강생은 현재
  강의에서 질문을 등록하고 질문 목록을 확인할 수 있으며, 개인 노트는
  회원·강의 단위로 저장하고 다시 불러온다.
- 수강후기는 현재 별도 저장 API가 없어 탭과 안내 상태까지만 제공하며,
  데이터가 없는 기능을 실제 후기처럼 임의 생성하지 않는다.

### 변경 파일 및 커밋
- `auction-api`: lecture progress/question/note 엔티티·서비스·컨트롤러,
  마이그레이션 `1784272000000-CreateLectureProgress.ts`,
  `1784273000000-CreateLectureQuestionsAndNotes.ts` — `b62e971`, `ecb872c`.
- `auction`: `src/app/courses/[courseId]/MyCourseClient.tsx`,
  `src/app/courses/page.tsx`, `src/lib/api.ts`, `src/lib/bunny-playerjs.ts` —
  `4873ee6`, `685e5fd`.

### 검증
각 구현 시 프론트와 API 타입 검사를 통과했고 관련 커밋을 양쪽 `main`에
반영했다.
