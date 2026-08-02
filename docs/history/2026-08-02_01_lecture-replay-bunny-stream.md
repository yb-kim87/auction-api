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
