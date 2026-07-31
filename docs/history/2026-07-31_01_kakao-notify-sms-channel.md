# 알림톡/문자(SMS) 채널 선택 발송 기능 추가

## 배경
`src/kakao-notify/`(리드 알림 발송 도메인)는 지금까지 카카오 알림톡
발송만 지원했다. 솔라피(Solapi) `/messages/v4/send` API는 알림톡뿐 아니라
SMS/LMS도 동일 엔드포인트로 지원하고, 이미 발신번호(`SOLAPI_SENDER`) 등
필요한 설정이 다 갖춰져 있어 신규 SDK/계정 없이 확장 가능하다고 판단해
추가 구현했다(사용자 요청, 2026-07-31: "알림톡과 문자 중 선택해서 발송
하게 할 수 있었으면 좋겠어 전체 기능에 모두다 (예약기능까지 포함해서)").

## 변경 내용

### 백엔드 (`auction-api`)
- `solapi.service.ts`: `sendSms()` 추가. 90바이트 초과 시 자동으로 LMS로
  전환(`type: "LMS"` + 기본 subject). `isConfigured()`는 SMS 발송에
  필요한 최소 조건(apiKey/apiSecret/senderPhone)만 검사하도록 완화하고,
  기존 알림톡 전용 조건(pfId 포함)은 `isKakaoConfigured()`로 분리.
- `message-template.util.ts`(신규): 문자 본문의 `#{변수명}` 자리표시자를
  알림톡과 동일한 표기 규칙으로 치환하는 `renderSmsTemplate()`.
- 엔티티 3곳에 `channel: "alimtalk" | "sms"` 컬럼 추가:
  - `kakao_dispatch_logs` — `messageText`(SMS 발송 시 실제 본문) 컬럼도 추가
  - `kakao_notify_settings`(신규 리드 자동발송 기본값) — `smsText` 컬럼 추가
  - `kakao_scheduled_dispatches`(예약건) — `smsText` 컬럼 추가,
    `templateCode`를 SMS 전용 예약도 가능하도록 기본값 `''`로 완화
  - 마이그레이션: `1784258000000-AddKakaoNotifySmsChannel.ts`
- `kakao-notify.service.ts`: `dispatchToLead`/`testSend`/`dispatchBulk`
  전부 `channel` 옵션을 받아 `sendAlimtalk`/`sendSms`로 분기.
- `kakao-scheduled-dispatch.service.ts`: `createBulkSchedule`/
  `createTestSchedule`가 채널별 필수값(템플릿 vs 문자 내용)을 검증하고,
  `processOne`(always-on 30초 틱)도 채널에 따라 분기 발송.
- 컨트롤러: `POST test-send`/`POST leads/bulk-send`/`POST settings`가
  `channel`/`smsText` 파라미터를 그대로 서비스에 전달.

### 프론트엔드 (`auction`)
- `src/lib/api.ts`: `KakaoDispatchChannel` 타입 추가, `KakaoDispatchLog`/
  `KakaoScheduledDispatch`/`KakaoNotifySetting`에 `channel`/`smsText`/
  `messageText` 필드 반영, 관련 발송 함수 입력 타입에 `channel`/`smsText`
  추가.
- `src/app/admin/KakaoNotifyPanel.tsx`: 새 `ChannelToggle` 컴포넌트를
  "테스트 발송"(`TestSendCard`), "선택 발송"(`BulkSendModal`, 예약 포함),
  "자동발송 기본 설정"(`TemplateSettingsCard`) 세 곳 모두에 배치. 문자
  채널 선택 시 템플릿 드롭다운 대신 자유 텍스트 입력창(바이트 수 표시,
  `#{변수}` 지원 + 리드 필드 참조 UI 재사용)이 나타남. 예약 목록/상세,
  발송 이력 상세에도 채널 구분 표시를 반영.

## 검증
- `auction-api`: `npx tsc --noEmit`, `npm run build` 통과.
- `auction`: `npx tsc --noEmit` 통과.
- 배포 후 Railway 상태/헬스체크, Vercel 배포 상태 확인 예정(별도 기록).
