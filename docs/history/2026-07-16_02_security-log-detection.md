# 로그 감지 시스템 — 이상행위(대량요청/크롤링/자동화) 알림

날짜: 2026-07-16
관련 레포: auction, auction-api

## 요청 원문

```
2. 로그 감지시스템 - 알림
2-1) 대량요청, 크롤링 혹은 자동화 스크립트가 의심되는 경우에 알림이 오는 기능을 구현할 것.
=> 로그 파일을 만들어서 AI가 읽어서 판단하게할 것
```

## 설계 결정 (사전 확인)

1. **로깅 범위**: 인증 포함 모든 API 요청(IP, 경로, 시각, 사용자, 상태코드, 처리시간,
   User-Agent). 특정 엔드포인트만 보는 대신 전체를 남겨야 크롤링처럼 여러 경로를
   순차적으로 훑는 패턴을 잡을 수 있음
2. **판단 주기/알림 채널**: 10분 간격 배치 분석 + 텔레그램 알림(기존
   `kakao-notify/telegram-alert.service.ts` 재사용). 관리자가 수동으로 누르는
   방식이 아니라 자동 스케줄러로 상시 감시

## 구조

```
모든 요청 → RequestLogMiddleware → logs/requests.log (JSON Lines)
                                          ↓ (10분마다)
                          SecurityLogAnalyzerService
                          - 최근 10분 로그만 필터
                          - IP별 통계로 압축(요청수/최소간격/경로수/로그인여부/오류율/UA)
                          - OpenAI에 판단 요청(suspicious 여부 + 요약 + 의심 IP)
                                          ↓ suspicious=true면
                          TelegramAlertService → 관리자 텔레그램 알림
```

## 변경 내용 (auction-api)

- `src/security-log/request-log-writer.service.ts`: 로그 파일 append(JSON Lines),
  20MB 초과 시 회전(rotate), 전체 읽기. 기록 실패해도 요청 처리는 막지 않음
- `src/security-log/request-log.middleware.ts`: 전역 미들웨어. `res.on("finish")`
  시점에 비동기로 로그 기록(응답 지연 없음). `AUTH_TOKEN_COOKIE`에서 access 토큰을
  검증해 로그인 사용자명도 함께 기록
- `src/security-log/security-log-analyzer.service.ts`:
  - 10분마다 로그 파일을 파싱해 최근 10분 구간만 필터
  - IP별로 묶어 요청수·최소 요청간격(자동화 스크립트는 간격이 일정하고 짧은 경향)·
    접근 경로 수(크롤링은 여러 경로를 순회)·로그인 여부·4xx 오류율·User-Agent를 집계,
    상위 20개 IP만 프롬프트에 포함(토큰 절약)
  - `OpenAiService.answerFreeform()`으로 시스템 프롬프트에 판단 기준(대량요청/짧고
    일정한 간격/비로그인 다중경로 순회/높은 오류율/의심스러운 User-Agent)을 제시하고
    JSON으로 `{suspicious, summary, suspiciousIps}` 응답받음
  - suspicious=true면 텔레그램 발송
  - OPENAI_API_KEY 또는 TELEGRAM 설정이 없으면 스케줄러 자체가 비활성화(조용히 스킵)
- `src/security-log/security-log.controller.ts`: 관리자 전용
  `POST /security-log/analyze-now`(즉시 분석), `GET /security-log/recent`(최근 로그
  200줄 조회)
- `src/app.module.ts`: `NestModule` 구현, `RequestLogMiddleware`를 모든 라우트(`*`)에
  전역 적용
- `AiModule`/`KakaoNotifyModule`에서 `OpenAiService`/`TelegramAlertService`를
  export하도록 추가(다른 모듈에서 재사용 가능하게)

## 변경 내용 (auction)

- `src/lib/api.ts`: `analyzeSecurityLogNow()`, `fetchRecentSecurityLog()` 추가
- `src/app/admin/SecurityLogTab.tsx` 신규: 최근 요청 로그 테이블(IP/경로/사용자/
  상태코드/처리시간), "지금 바로 분석 실행" 버튼
- 관리자 콘솔에 "보안 로그" 탭 추가

## 참고사항 / 향후 고려

- Railway 컨테이너는 재배포 시 파일시스템이 초기화될 수 있어, `logs/requests.log`도
  배포 때마다 비워진다. 장기 보관이 필요해지면 DB 테이블이나 외부 로그 서비스로
  옮기는 것을 검토할 것(지금은 요청대로 "로그 파일" 방식을 우선 구현)
- 판단은 규칙 기반이 아니라 매번 AI(OpenAI)에게 맡기므로, 관리자가 정상 트래픽 패턴을
  보고 시스템 프롬프트의 판단 기준을 조정하고 싶을 수 있음 — 현재는 코드에 하드코딩,
  필요시 관리자 화면에서 프롬프트를 수정 가능하게 확장할 수 있음
