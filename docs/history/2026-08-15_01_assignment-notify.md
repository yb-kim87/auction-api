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
