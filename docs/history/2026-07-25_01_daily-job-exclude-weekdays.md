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
