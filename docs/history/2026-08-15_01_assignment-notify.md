# 2026-08-15_01 과제 등록/코치 피드백 알림톡

## 배경

사용자 요청: "과제 등록되면 알림톡으로 오게 만들고 싶은데 기본 우리
알림톡 시스템을 활용하면 될꺼같아(경매코치에서 코치 폰번호 입력해둔것으로
과제 등록 알림 알리고), 그리고 코치피드백이 되면 작성한 수강생한테
카톡갈 수 있게 해주면 되는데 수강생이 전화번호 입력하니까 그쪽으로
기존 경매코치 알림톡으로 보내주면 될꺼같아. 해당 기능은 관리자 페이지에서
과제검토안에 탭을 하나 생성해서 토글버튼으로 기능 동작하고 안하고 할 수
있게 관리할 수 있게 해주면 될꺼같고 일단 처음엔 토글이 꺼진상태로
해줘. 그리고 카톡을 보내는건 알림톡 시스템이 있는 경매코치가 기본값으로
해주게하고 나중에 변경할 수 있게도 만들어줘."

## 설계 판단

- **발신 계정**: 새 발신 계정/채널을 따로 만들지 않고 기존 솔라피(경매코치)
  계정(`SolapiService`, env `SOLAPI_API_KEY`/`SOLAPI_API_SECRET`/
  `SOLAPI_SENDER`/`SOLAPI_PFID`)을 그대로 재사용한다. "나중에 변경 가능"
  요구는 발신 계정 자체를 바꾸는 게 아니라, **알림톡 템플릿을 관리자가
  나중에 골라 넣을 수 있게** 하는 것으로 해석했다 — 알림톡은 카카오/솔라피
  쪽 사전 승인이 필요한 템플릿 코드가 있어야 발송되는데, 이번 요청 시점엔
  "과제 등록 알림"/"코치 피드백 알림"용으로 승인된 템플릿이 없다.
- **템플릿 없을 때의 대체 발송**: 알림톡 템플릿 코드가 비어 있으면(초기
  상태) 승인 절차가 필요 없는 문자(SMS, `SolapiService.sendSms`)로
  자동 대체 발송한다. 나중에 템플릿이 승인되면 관리자 화면 드롭다운에서
  템플릿을 고르기만 하면 알림톡으로 전환된다(코드 변경/재배포 불필요).
  드롭다운은 기존 `GET /kakao-notify/templates`(`SolapiService.listTemplates()`,
  APPROVED 템플릿만 필터링)를 그대로 재사용.
- **토글 저장 위치**: 이미 있는 `site-settings`(`app_settings` 싱글톤
  행) 패턴을 그대로 확장 — `assignmentNotifyEnabled`(boolean, 기본
  `false`, 요청대로 초기 꺼짐), `assignmentNotifyCoachPhone`(text),
  `assignmentCreatedTemplateCode`/`coachFeedbackTemplateCode`(text,
  각각 비어있으면 SMS 대체).

## 변경 사항

### 백엔드
- `site-settings.entity.ts`/`.service.ts`/`.controller.ts`: 위 4개 컬럼
  추가, `PATCH /settings` body·`update()` patch 타입에 반영(관리자만
  수정 가능한 기존 권한 그대로).
- 마이그레이션 `1784294000000-AddAssignmentNotifySettings.ts`: `app_settings`
  테이블에 4개 컬럼 추가(IF NOT EXISTS, 안전).
- `learning-board.module.ts`: `KakaoNotifyModule`(→`SolapiService`),
  `UsersModule`(→ 학생 phone 조회), `SiteSettingsModule`(→ 토글/코치
  폰번호/템플릿 조회)을 imports에 추가.
- `learning-board.service.ts`:
  - `saveAssignment()` — 기존 제출(`existing`)이 없을 때만(=최초 제출,
    재제출/수정은 제외) 저장 후 `notifyCoachOfNewAssignment()`를
    fire-and-forget으로 호출(실패해도 과제 제출 응답 자체는 절대 막지
    않도록 `.catch()`로 흡수 + 로그만 남김).
  - `coachUpdateAssignment()` — `coachFeedback`이 새로 채워지거나
    바뀌었을 때만(빈 값 저장이나 값이 그대로인 경우는 제외)
    `notifyStudentOfCoachFeedback()`를 마찬가지로 fire-and-forget 호출.
  - 두 알림 다 `siteSettings.get().assignmentNotifyEnabled`가 꺼져 있으면
    바로 return — 껐을 땐 완전히 무동작.
  - `sendAssignmentNotify()` 헬퍼가 템플릿 코드 유무에 따라
    `sendAlimtalk()`/`sendSms()`를 자동 분기.

### 프론트
- `lib/api.ts`: `SiteSettings` 타입/`updateSiteSettings()` patch 타입에
  4개 필드 추가(기존 `fetchKakaoTemplates()`/`SolapiTemplate` 재사용).
- `app/admin/AssignmentNotifySettingsPanel.tsx`(신규): 토글, 코치
  폰번호 입력+저장, 과제등록/코치피드백 각각의 템플릿 드롭다운(빈 값 =
  "문자(SMS)로 발송").
- `app/admin/AssignmentReviewTab.tsx`: 기존 단일 화면을 "제출
  현황"/"알림톡 설정" 2개 서브탭으로 분리(다른 관리자 탭의
  overflow-x-auto 서브탭 패턴과 동일하게 구현). 물건 상세 모달은
  서브탭과 무관하게 항상 마운트.

## 결과
- 백엔드/프론트 모두 타입체크·빌드 통과.
- Railway 배포 후 상태 확인, Vercel 배포 후 상태 확인(각 섹션 하단 참고).
- 기본값이 꺼짐이라 배포 직후에는 아무 알림도 나가지 않는다 — 관리자가
  과제 검토 > 알림톡 설정에서 코치 폰번호를 넣고 토글을 켜야 실제로
  동작 시작.

## 追記 (2026-08-19) — 코치 알림을 텔레그램으로도 보냄(코치 폰번호 없이도 동작)

사용자 요청: "과제제출 관련하여 알림톡 기능을 넣어둔게 있는데... 생각해보니
관리자는 인스타로 받을 수 있겠더라고, 일단 수강생들은 아직 적용이
어려우니 관리자만 수강생들이 과제등록을 하면 인스타로 과제 등록정보를
받아 볼 수 있도록 해줘". 대화 중 "인스타"는 "텔레그램"의 착오였음을
사용자가 직접 정정("아 인스타가 아니라 텔레그램이다") — 실제로 이
프로젝트에 이미 있는 건 인스타그램 발신 API가 아니라 보안 로그 알림에
쓰던 `TelegramAlertService`(텔레그램 봇, `TELEGRAM_BOT_TOKEN`/
`TELEGRAM_CHAT_ID`는 Railway에 이미 설정돼 있어 별도 설정 불필요)였다.
(참고: 조사해보니 이 코드베이스엔 Instagram Graph API로 실제 DM을
보내는 기능 자체가 없다 — `instagram-sync.service.ts`는 구글시트로
들어온 인스타 리드를 읽어와 카카오 알림톡을 보내는 수신 전용 로직이라
이름만 인스타일 뿐 발신 방향이 아니다.)

### 변경
`learning-board.service.ts`의 `notifyCoachOfNewAssignment()`(과제 최초
제출 시 코치에게 알리는 함수)를 수정 — 기존엔 `assignmentNotifyCoachPhone`이
비어 있으면 아무것도 안 보냈는데, 이제 `assignmentNotifyEnabled` 토글만
켜져 있으면 코치 폰번호와 무관하게 항상 `TelegramAlertService.send()`로
텔레그램 알림을 먼저 보내고, 코치 폰번호가 등록돼 있으면 기존 카카오
알림톡/문자도 추가로 보낸다(둘 다 갈 수 있음). 텔레그램 메시지에는
학생 이름/사건번호/주소에 더해 과제 메모(문의사항, 2026-08-18에 필수
입력으로 바뀐 항목)도 있으면 함께 넣는다. `coachUpdateAssignment()`
(코치 피드백 → 수강생 알림)는 이번 요청 범위 밖이라 그대로 카카오
알림톡/문자만 사용.

`LearningBoardModule`에 이미 있던 `KakaoNotifyModule` import에서
`TelegramAlertService`를 그대로 주입(추가 모듈 등록 불필요 — 이미
export돼 있었음).

`AssignmentNotifySettingsPanel.tsx`(프론트) 안내 문구를 "코치 폰번호를
등록해야만 알림이 감" → "텔레그램은 폰번호 없이 바로 동작, 폰번호를
등록하면 알림톡/문자가 추가로 감"으로 갱신.

### 결과
- 타입체크·빌드 통과.
- Railway/Vercel 배포 후 상태 확인(아래 섹션 참고).
- 실제 텔레그램 발송 테스트(과제 진짜로 제출해보기)는 진행하지 않음 —
  `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`가 이미 보안 알림으로 검증된
  값이라 별도 검증 없이도 동작할 것으로 판단.

## 追記 (2026-08-19, 같은 날 즉시 수정) — 코치 텔레그램을 토글에서 완전히 분리

위 변경 직후 사용자가 "토글을 키면 관리자만 되는거야? 아니면
수강생한테도 가는거야?" → "관리자만 텔레그램으로 하고 싶은데"라고
확인해왔다. 그런데 직전 구현은 `notifyCoachOfNewAssignment()` 안에서
텔레그램 발송도 `assignmentNotifyEnabled` 토글로 같이 묶어놨었다 —
그 토글을 켜면 `notifyStudentOfCoachFeedback()`(코치 피드백 →
수강생 폰번호 알림)도 같이 켜지는 문제가 있었다("일단 수강생들은
아직 적용이 어려우니"라는 원래 요청과 충돌).

**수정**: `notifyCoachOfNewAssignment()`에서 텔레그램 발송을
`siteSettings.get()`/토글 체크보다 먼저, 토글과 완전히 무관하게 항상
실행하도록 순서를 바꿨다. 토글은 이제 (1) 코치 폰번호가 등록됐을 때의
추가 카카오 알림톡/문자, (2) 코치 피드백 → 수강생 알림, 이 두 가지
"수강생과 연결될 수 있는" 채널만 켜고 끈다. 프론트
`AssignmentNotifySettingsPanel.tsx` 문구도 "텔레그램은 토글과 무관하게
항상 켜짐 / 토글은 수강생 대상 알림 전용"으로 다시 갱신.
