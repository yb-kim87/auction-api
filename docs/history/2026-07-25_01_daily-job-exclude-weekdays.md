# 매일 작업(크롤러 예약 실행) 제외 요일 설정 추가

날짜: 2026-07-25
관련 레포: auction-api, auction

## 요청 원문 (요약)
"그리고 매일 작업에서 매일반복을 하고 있는데 요일 제외를 넣어야할꺼같은데
이 부분 추가해줘" → "해당 요일엔 동작하지 않게"

관리자 화면 크롤링 작업 > 매일 작업 탭에서 지정 시간에 관심조건 목록을
순서대로 자동 수집·조회하는 스케줄러가 있는데, 지금까지는 "매일 반복"
켜짐/꺼짐만 있고 특정 요일만 건너뛰는 설정이 없었음.

## 변경 내용

### 백엔드 (auction-api)
- `src/common/kst-time.util.ts`: `nowPartsInKst()` 반환값에 `weekday`
  (0=일~6=토, KST 기준) 필드 추가. `Intl.DateTimeFormat`의
  `weekday: "short"` 결과를 매핑해 서버 실행 환경의 로컬 타임존과
  무관하게 항상 한국시간 기준 요일을 얻는다(기존 hour/minute과 동일한
  방식).
- `src/crawler/crawler.types.ts`: `CrawlerScheduleConfig`에
  `excludeWeekdays?: number[]` 추가(기본값 `[]` — 비어 있으면 기존과
  동일하게 매일 실행, 하위호환 유지).
- `src/crawler/crawler.service.ts`의 `tickScheduler()`: 예약 시각이
  된 시점에 `schedule.excludeWeekdays`에 오늘 요일이 포함되어 있으면
  실행하지 않고 반환. 이때도 "왜 안 도는지" 알 수 있어야 하므로
  `appendLog`로 건너뛴 사유를 남긴다 — 단, 이 로그 패널은
  `entry.scheduler` 플래그로만 필터링하므로(`CrawlerDailyJobTab.tsx`),
  이 지점에서 `schedulerRunning`을 잠깐 true로 세웠다가 로그 남긴 뒤
  바로 false로 되돌리는 방식으로 "매일 작업 실행 로그"에도 정상 노출.
- `updateConfig()`는 기존에 스프레드 병합(`{...prevSchedule,
  ...partial.schedule}`)이라 `excludeWeekdays` 필드 추가에 별도 수정
  불필요.

### 프론트 (auction)
- `src/lib/api.ts`: `CrawlerScheduleConfig` 타입에
  `excludeWeekdays?: number[]` 추가(백엔드 타입과 동일).
- `src/app/admin/CrawlerDailyJobTab.tsx`:
  - "실행 시간 / 매일 반복" 영역 아래에 "제외 요일" 섹션 신설 — 일~토
    7개 토글 버튼, 선택된 요일은 destructive 색상으로 강조.
    `schedule.enabled`가 꺼져 있으면 비활성화(다른 입력 필드와 동일한
    UX 패턴).
  - "매일 작업 작동 중" 상단 배너 문구에 제외 요일이 있으면
    "(화, 목요일 제외)" 형태로 함께 표시.
  - "변경된 내용이 있습니다" 감지 로직에 `repeatDaily`,
    `excludeWeekdays`(정렬 후 JSON 비교) 조건 추가 — 기존엔
    `enabled`/`time`만 비교해 요일만 바꿔도 저장 안내가 안 뜨는
    누락이 있었음(이번에 같이 보완).

### 검증
- `npx tsc --noEmit -p .` 백엔드/프론트 모두 통과.
- UI 동작(Playwright 등 브라우저 검증)은 별도로 하지 않음 — 사용자
  요청이 코드 반영 중심이었고, 스타일/구조상 위험이 낮은 변경.

## 追記 (2026-07-25) — 매일 작업 실행 로그 DB 영속화

### 요청 원문 (요약)
"매일작업 실행 로그에서 일별로 로그가 잘 진행되었는지 남았으면 좋겠는데
작업이 됐어도 리셋이 되니 볼 수가 없는데 이거 확인할 방법이 없을까??"

### 원인
`CrawlerService.logs`가 인메모리 배열(`private readonly logs:
CrawlerLogEntry[] = []`)이었음. Railway는 재배포·재시작마다 컨테이너가
통째로 새로 뜨는데, `CrawlerConfigRow`(설정)는 이미 DB로 옮겨져
재배포와 무관하게 유지되지만 로그는 여전히 메모리에만 있어 재배포/재시작
시점에 전부 사라짐. `maxLogs=500` 제한도 있어 하루 실행량이 많으면
당일 안에도 앞부분이 밀려나감.

### 변경 내용
`CrawlerConfigRow`와 동일한 패턴으로 DB 영속화:
- `src/crawler/crawler-log.entity.ts` 신설: `crawler_log` 테이블
  엔티티(`id`(uuid), `at`, `level`, `message`, `scheduler`).
- `src/migrations/1784247000000-AddCrawlerLogTable.ts` 신설.
- `src/crawler/crawler.module.ts`: `TypeOrmModule.forFeature`에
  `CrawlerLogRow` 추가.
- `crawler.service.ts`:
  - `appendLog()`: 기존 인메모리 push는 유지하고, 추가로
    `logRepo.insert()`를 fire-and-forget으로 호출해 DB에도 기록.
    insert 실패해도 인메모리 로그·크롤링 자체는 영향받지 않도록
    catch로 격리.
  - `getLogs()`: 인메모리 slice 대신 DB에서 `at DESC` 최신순 조회
    (async로 전환, 컨트롤러도 `await` 대응).
  - `clearLogs()`: DB `logRepo.clear()`도 함께 수행(async 전환).
  - `pruneOldLogs()` 신설, `onModuleInit()`에서 1회 호출 — 30일
    지난 로그를 정리해 테이블이 무기한 커지지 않도록 함.
- `crawler.controller.ts`: `clearLogs` 핸들러를 async로 전환.

### 결과
서버가 재배포되거나 재시작되어도 "매일 작업 실행 로그" 패널에서
과거 실행 이력(스케줄러가 며칠 전 정상 실행됐는지, 요일 제외로
건너뛴 날이 언제였는지 등)을 그대로 확인할 수 있다. `npx tsc
--noEmit -p .` 통과. 마이그레이션은 `migrationsRun: true`(운영
설정)에 따라 다음 배포 시 자동 적용.

## 追記 (2026-10-30) — 매일 작업 결과 텔레그램 알림

### 요청 원문 (요약)
"매일 작업과 관련해서도 텔레그램 알림이 올 수 있게 해줘. 기존 코치픽으로 보내던 걸로. 설정한 시간에 업데이트가 제대로 잘됐는지랑, 경매물건 몇 건 정도가 신규로 업데이트됐는지."

### 변경 내용
- **전송 채널**: 기존 크롤러 알고리즘 알림과 같은 `CrawlerTelegramService`(환경변수 `TELEGRAM_BOT_TOKEN`·`TELEGRAM_CHAT_ID`) — 재개발 구역 업데이트용 채널(`REDEVELOPMENT_TELEGRAM_CHAT_ID`)이 아니라 **기존 코치픽 채널**이다. 전송 실패는 작업을 막지 않는다(`notifyDailyJob`).
- `src/crawler/crawler-daily-report.ts` 신설(순수 함수): `buildDailyJobReport`(결과 알림), `buildDailyJobSkipMessage`(설정 시각에 못 돈 경우).
- `crawler.service.ts` `tickScheduler()`:
  - 관심조건마다 조회가 끝난 직후 `localStatus`의 `created`(신규 등록)·`updated`(갱신)·`completed`·수집 URL 수를 `presetResults`에 모은다 — 이 카운터는 다음 관심조건 시작 때 리셋되므로 그 전에 기록해야 한다. 오류 난 관심조건은 사유와 함께 기록. 기존 실행 흐름·로그는 바꾸지 않았다.
  - `waitForCrawlIdle()`이 30분 대기 시간 초과 여부(boolean)를 돌려주도록 변경(호출부는 기존처럼 무시해도 동작, 알림에 "대기 시간 초과" 표시).
  - 예약 작업이 끝나면(`finally`) 결과 알림 전송: ✅ 완료 / ⚠️ 일부 실패 / ❌ 실패 + 설정 시각·시작~종료·소요 시간, 관심조건 수·조회 대상 중 처리 건수, **경매물건 신규 N건 · 갱신 M건**, 관심조건별 신규/갱신(최대 8개), 오류 사유, 대기 시간 초과 안내. 신규·갱신이 0이면 "이번에는 신규·갱신된 물건이 없습니다."
  - **설정 시각에 실행하지 못한 경우도 알린다**: 서버가 재시작 직후라 건너뜀(`schedulerReadyAt` 안전장치) / 다른 조회 작업이 진행 중이라 건너뜀 / 등록된 관심조건이 없음. **요일 제외(의도된 건너뜀)와 같은 분의 중복 tick은 알리지 않는다**(`notifyMissedRun`, `lastSkipNotifyKey`).

### 검증
- `tsc --noEmit` 통과. 알림 문구 생성 함수를 샘플 데이터로 실행해 6가지(정상 완료·일부 실패·전부 실패·예약 작업 전체 오류·변화 없음+대기 시간 초과·못 돈 경우 3종) 문구를 확인했다.
- **`tickScheduler` 전체 흐름(실제 크롤링)을 포함한 통합 검증은 하지 않았다** — 운영에서 설정 시각에 한 번 돌려 텔레그램 수신과 신규/갱신 건수가 맞는지 확인해야 한다. 예약 시각을 지금 몇 분 뒤로 바꿔 저장하면 바로 시험할 수 있다.
- 서버가 크롤링 도중 재시작되면 종료 알림은 오지 않는다(프로세스가 죽기 때문). 이 경우 재시작 직후 로그/화면에서 확인한다.
