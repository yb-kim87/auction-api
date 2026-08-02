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
