# 관리자 페이지 "부동산수집" 탭 (한방/karhanbang.com 중개업소 수집)

## 배경
사용자 요청(2026-08-10): 기존 데스크톱 프로그램(`e:\OneDrive\
PythonWorkspace\pyside6\hanbang.py`, PySide6+httpx+BeautifulSoup)이
한방(카한방, karhanbang.com)에서 지역별 부동산 중개업소 상호/담당자/
휴대폰 번호를 수집해 엑셀로 저장하는 기능인데, 이걸 경매코치 사이트
관리자 페이지 "부동산수집" 탭으로 이식하고, DB에 쌓인 데이터를 기존
폼과 동일한 시/도-시/군/구-읍/면/동 3단 드롭박스로 검색/필터하고
엑셀로도 저장할 수 있게 해달라는 요청.

## 설계 결정 — Python 워커 없이 순수 Node/TypeScript로 구현
이 저장소의 기존 크롤러들(탱크옥션, 나이스옥션)은 전부 Python(httpx/
Selenium) 워커를 Node가 spawn/HTTP로 orchestrate하는 구조다. 하지만
한방 사이트를 실측해보니:
- 목록 페이지(`office_list.asp`)·상세 페이지(`office_detail.asp`)는
  User-Agent 헤더만으로 정상 응답(브라우저/Selenium 불필요).
- 지역 콤보박스 API(`ajax_combo_search.asp`)만 WAF(dotDefender)가
  `Referer`+`X-Requested-With` 헤더를 요구(실측: 헤더 없이 호출하면
  "dotDefender Blocked Your Request" HTML 반환, 헤더 추가 시 정상
  JSON 응답).
- HTML 구조가 단순하고 안정적이라 정규식만으로도 안전하게 파싱 가능
  (실측: 목록 행 정규식, 상세 페이지 `tel:` 링크 정규식 모두 실제
  응답으로 검증 완료).

즉 이 사이트 하나만을 위해 탱크옥션 수준의 워커/콜백 인프라를 새로
만들 이유가 없어, `RealtorCollectService`(NestJS) 안에서 Node
`fetch` + 정규식으로 직접 스크래핑하도록 구현했다 — 새 Python
의존성도, 새 워커 프로세스도 필요 없다.

## 구현

### 백엔드 (auction-api)
- `src/realtor-collect/entities/realtor-office.entity.ts` +
  마이그레이션 `1784291000000-CreateRealtorOffices.ts`: `memNo`(원본
  사이트 회원번호)를 고유키로 upsert — 같은 지역을 다시 수집해도
  중복 적재되지 않는다.
- `RealtorCollectService`:
  - `SIDO_LIST`: hanbang.py의 시/도 옵션값을 그대로 이식(12번 결번
    포함).
  - `fetchSubOptions(flag, sidoCode, gugunCode)`: 시/군/구(S)·읍/면/동
    (G) 목록을 `ajax_combo_search.asp`에서 직접 조회.
  - `start()`: 목록 페이지를 5개씩 동시 요청(빈 페이지 나오면 즉시
    중단, hanbang.py와 동일 알고리즘) → 상세 페이지를 15개씩 동시
    요청해 010 모바일 번호 추출 → DB upsert. 진행 상황은 메모리 내
    `JobState`(running/logs/total/done/saved)로 추적, `GET /status`로
    폴링한다(탱크옥션 크롤러 관리자 탭과 동일한 UX 패턴이지만, 별도
    워커 프로세스 없이 이 서비스 인스턴스 안에서 비동기로 실행).
  - `list()`/`exportExcel()`: 시/도·시/군/구·읍/면/동 코드 + 자유
    검색어(상호/담당자/번호/주소, ILIKE)로 필터. 엑셀은 기존
    `xlsx` 패키지(`auctions.service.ts`와 동일 라이브러리)로 생성.
- `RealtorCollectController`: 전부 `requireAdmin` — `/sido`,
  `/sub-options`, `/status`, `POST /start`, `GET /`(목록),
  `GET /export`(엑셀 다운로드).
- `app.module.ts`/`typeorm.config.ts`에 모듈/엔티티 등록.

### 프론트엔드 (auction)
- `auction/src/lib/api.ts`: `fetchRealtorSidoList`,
  `fetchRealtorSubOptions`, `fetchRealtorCollectStatus`,
  `startRealtorCollect`, `fetchRealtorOffices`,
  `realtorExportExcelUrl`.
- `auction/src/app/admin/RealtorCollectTab.tsx`(신규): 관리자 탭
  "부동산수집" 추가(`page.tsx`). 상단은 수집 실행 폼(3단 드롭박스 +
  실행 버튼 + 진행 로그, 2초 간격 폴링), 하단은 DB 조회
  섹션(별도 3단 드롭박스 필터 + 검색어 입력 + 페이지네이션 테이블 +
  "엑셀로 저장" 링크). 지역 드롭박스 로직(`useRegionCascade`)은 실행용/
  조회용 둘 다 같은 훅으로 재사용.

## 검증
- 정규식 파싱 로직을 실제 한방 사이트 응답(서울 강남구 목록 페이지,
  상세 페이지)에 직접 돌려 필드 추출 정확도 확인.
- 세종특별자치시 전체(관할 무관, gugun/dong 미지정) 기준 전체
  파이프라인(페이지네이션 → 상세 조회)을 실제로 끝까지 실행 —
  1084개 중개업소 정상 수집, 페이지네이션이 빈 페이지(109페이지째
  4건, 110페이지째 0건)에서 정확히 멈추는 것 확인, 상세 010 번호
  추출도 표본 10건 모두 정상.
- 로컬 백엔드(`npm run start:dev`)를 기동해 모든 `/realtor-collect/*`
  라우트가 크래시 없이 정상 등록됨을 확인(엔티티 미등록 시 발생하는
  `EntityMetadataNotFoundError` 없음).
- 백엔드/프론트 각각 `npx tsc --noEmit` 통과.
- 배포 후 실제 프로덕션(Railway/Vercel)에서 소규모 지역으로 실제
  수집 1회 실행 + DB 저장 + 목록 조회 + 엑셀 다운로드까지 재검증 예정
  (아래 배포 확인 절 참고).

## 追記 (2026-08-10) — 배포 후 실측: Railway가 karhanbang.com에도 연결 못 함, Vercel 프록시로 우회

배포 후 실제 관리자 페이지에서 "실행"을 눌러보니 시/군/구 드롭박스도,
수집 시작도 전부 실패했다. Railway 로그 확인 결과 `ConnectTimeoutError`
/`fetch failed` — VWorld API에서 이미 두 번(부가세계산기, 매도분석
지도) 겪었던 "Railway(sfo, 해외 리전)가 국내 사이트에 연결 못 하는"
문제가 세 번째로 재현됐다. 이번엔 사전에 이 선례를 알고 있었음에도
"이 사이트는 브라우저 없이 fetch로 잘 되더라"는 로컬 실측만 믿고
Railway에서도 똑같이 될 거라 가정한 채 배포한 게 원인 — 로컬 PC와
Railway 컨테이너의 아웃바운드 네트워크 경로가 다르다는 걸 다시 한 번
놓쳤다.

### 수정
VWorld 때와 동일한 패턴으로 우회했다:
- `auction/src/app/api/realtor-collect/proxy/route.ts`(신규,
  `preferredRegion="icn1"`): karhanbang.com URL만 허용하는 서버 간
  프록시. 브라우저 세션이 아니라 백엔드가 직접 호출하므로 쿠키 대신
  공유 시크릿 헤더(`x-realtor-proxy-secret`, env `REALTOR_PROXY_
  SECRET`)로 인증한다. `ajax=1` 쿼리가 있으면 WAF가 요구하는
  Referer/X-Requested-With도 함께 붙인다.
- `RealtorCollectService`: 목록/상세/지역콤보 3곳의 직접 `fetch()`를
  전부 `proxyFetch()`(신규 private 메서드)로 교체 — Vercel 프록시
  URL(`FRONTEND_URL` env, 없으면 프로덕션 도메인 기본값)에 대상
  URL을 쿼리로 실어 호출한다.
- `REALTOR_PROXY_SECRET`을 Railway(`railway variables --set`)와
  Vercel(`vercel env add ... production`) 양쪽에 동일한 값으로
  등록.

### 교훈
- 이 세션에서만 벌써 세 번째(VWorld 2건 + 이번 karhanbang.com)
  같은 "Railway 해외 리전" 문제를 겪었다 — Railway 백엔드에서
  **새로운 외부(특히 국내) 사이트로 나가는 요청을 추가할 때는,
  로컬에서 fetch가 잘 된다는 것만으로 안심하지 말고 처음부터
  Vercel(icn1) 프록시를 거치는 걸 기본값으로 잡아야 한다** — 매번
  "일단 Railway에서 직접 호출 → 배포 후 실패 확인 → Vercel 우회로
  재작업"을 반복하는 건 비효율적이다.

### 검증
`REALTOR_PROXY_SECRET` 배포 후 실제 프로덕션에서 시/군/구 드롭박스
조회, 소규모 지역 수집 실행 → DB 저장 → 목록 조회 → 엑셀 다운로드까지
재검증(아래 별도 검증 기록 참고).

## 追記 (2026-08-11) — 동시성 완화(WAF 레이트리밋 재현·완화)

Vercel 프록시 우회 배포 후 실제 세종 전체 수집을 실행하니, 처음
20건(2페이지)까지는 정상 저장됐지만 이후 요청부터 한방 WAF가
일시적으로 모든 응답을 503으로 막는 현상이 재현됐다(몇 분 뒤 자연히
풀림 — IP 영구차단이 아니라 짧은 구간 레이트리밋으로 추정). 사용자
요청("다시 한번 해보고 주기를 좀만 줄여보자")에 따라 동시성을
낮췄다: `LIST_CONCURRENCY` 5→3, `DETAIL_CONCURRENCY` 15→5, 배치
사이 400ms 대기(`BATCH_DELAY_MS`) 추가.

### 검증
배포 후 세종 전체 재수집으로 재검증 예정.

## 追記 (2026-08-11) — 페이지 요청 실패를 "목록 끝"으로 오인해 세종 1084건 중 10건만 수집되던 버그

동시성 완화 배포 후에도 세종 전체 수집 실행 결과 10건만 저장되고
끝났다. 원인은 `fetchListPage`가 요청 실패(WAF 일시 차단 등으로
`res.ok`가 false)와 "진짜로 이 페이지엔 매물이 없음"(정상 응답,
0건 파싱)을 구분하지 않고 둘 다 빈 배열을 반환했던 것 — 페이지네이션
로직이 빈 배열을 보면 무조건 "목록 끝"으로 판단해 멈추므로, 같은
배치 안의 다른 페이지가 일시적으로 실패하기만 해도 전체 수집이
조기 종료됐다(페이지 1은 성공, 페이지 2/3이 실패 → "페이지 2부터
없다"고 오판).

`fetchListPage`가 요청 실패 시 예외를 던지도록 바꾸고, 페이지네이션
루프에서 실패한 페이지는 최대 3회 재시도(`fetchListPageWithRetry`,
재시도 간격 점증) 후에도 실패하면 "그 페이지만 건너뛰고 계속 진행"
하도록 수정 — 더 이상 실패를 "목록 끝"으로 오인하지 않는다.

### 검증
배포 후 세종 전체 재수집으로 전체 건수(1084건 근처)가 정상적으로
수집되는지 재확인 예정.
