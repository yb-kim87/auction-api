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
