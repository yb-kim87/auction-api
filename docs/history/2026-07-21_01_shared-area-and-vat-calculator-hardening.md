# 2026-07-21 공용면적(sharedArea) 수집 및 부가세계산기 고도화

## 배경

부가세계산기(85㎡ 초과 아파트 대상)가 건물기준시가를 계산할 때 전용면적만 쓰고 있어
정확도가 떨어졌다. 탱크옥션 물건상세 페이지의 "건축물정보" 탭에는 공용면적이 표시되지만,
크롤러가 이 값을 저장하지 않고 있었다.

## 실행한 작업(요약)

1. **탱크옥션 공용면적 조사**: `AuctView.php` 응답의 `bldgInfo.tot_shr_sqm`은 항상 0으로
   비어있음을 실측 확인. 대신 탱크옥션 내부 API `POST /ca/res/getEnvBldg.php`
   (파라미터: `baseInfo.apiBldgTitle_Pk`, `apiBldgRecap_Pk`, `landInfo.items[0].pnu`)가
   공용면적(`dfInfo`의 `totPbArea`)을 제공함을 확인. 이 데이터의 원본은 공공데이터포털
   건축물대장(`getBrExposPubuseAreaInfo`)과 동일.

2. **크롤러 반영**: `crawler/tank_detail.py`에 `fetch_env_bldg`/`parse_exclusive_area_from_env_bldg`
   추가(Selenium), `crawler/http_client.py`에 동일 기능의 httpx 버전 추가(`full_httpx_worker.py`,
   `parsers.py`에도 반영). `item_crawl.py`에서 `raw_detail` 확보 직후 `sharedArea`를 채워 최종
   payload에 포함.

3. **DB/백엔드**: `auctions.sharedArea` 컬럼 추가(마이그레이션
   `1784233000000-AddAuctionSharedArea.ts`), 엔티티/DTO/매퍼/빌더 전체 연결.
   **버그 발견 및 수정**: `AUCTION_FIELD_LABELS`(auction-change.util.ts)에 `sharedArea`를
   빠뜨려 `buildFieldChanges`가 변경을 감지 못해 저장이 조용히 스킵되는 문제 — 필드를
   추가하는 신규 마이그레이션 시 이 목록 등록을 잊으면 저장 자체가 안 되니 주의.

4. **기존 물건 재크롤 없는 보정**: 전체 재크롤 대신 `/crawler/missing-shared-area`
   (대상 조회, 85㎡ 초과 아파트 중 sharedArea 비어있는 물건),
   `/crawler/import-shared-area`(단일 필드 patch) API를 신설하고
   `crawler/backfill_shared_area.py` 스크립트로 245건 중 213건 채움(32건은 탱크옥션 자체에
   건축물대장 데이터 없음).

5. **부가세계산기 성능 개선**: DB에 `sharedArea`+`builtYear`가 이미 있으면 건축물대장 API
   (`fetchVatBuildingRegister`, 간헐적 빈 응답으로 최대 3회×2 재시도하던 가장 느린 구간)
   조회를 생략하고 DB 값으로 바로 계산하도록 `ProfitCalculatorPanel.tsx` 수정.

6. **계산식 노출 방지**: 부가세 계산 로직(`vat-calc.ts`, 국세청 고시 지수표·잔가율 산식·
   안분 공식)이 클라이언트 JS 번들에 그대로 포함되어 개발자도구로 열람 가능한 문제 발견
   (프로덕션 빌드로 실측 확인). 계산을 `/api/vat/calc` 서버 라우트로 이전하고 클라이언트는
   원자재 값(landArea, landPricePerM2, buildingArea, builtYear, salePrice)만 보내 결과만
   받도록 변경. `/search` 페이지 청크에서 계산 상수가 완전히 사라짐을 재확인.
   (참고: 관리자 전용 `CrawlerVatTab.tsx`는 계산 과정을 화면에 보여주는 게 의도된 기능이라
   그대로 유지 — admin만 접근 가능해 노출 위험 낮음)

7. **부가세 표시 방식 변경**: 기본값을 최저가 → 정상가(시가)로 변경, "부가세 최저가로 표시"
   체크박스 추가.

8. **UI 개선**:
   - 물건 상세 "토지지분"에 ㎡ 단위 표시, `sharedArea` 있으면 "(공용 N㎡)" 병기 —
     단, **공용면적 병기는 관리자 전용**(`isAdmin` 체크, 일반 사용자에게는 미노출).
   - 부가세 입력/자동계산 블록을 주황 계열 배경+테두리로 하이라이트 처리(눈에 잘 띄도록).

## 공시가격/특이사항(공시가 구간) httpx 경로 누락 수정 (2026-07-22 追記)

물건 상세 "상세 정보" 카드의 공시가격이 "-"로 비어있는 사례를 사용자가 스크린샷으로
제보(2025타경21860 등). 조사 결과 `officialLandPrice`는 Selenium 경로만 DOM
(`Btbl_list`, "주택공시가격") 파싱으로 채우고, httpx 전용 경로(`parsers.py`)는 항상
0으로 하드코딩되어 있었음. `EnvViewData.php`의 `pubAmt.items[0].pubAmt`(최신 연도
공동주택공시가격)에 동일한 값이 있음을 실측으로 확인, 두 경로 모두에서 채우도록 수정.

또한 사용자가 "특이사항에 공시가 1억이하/1~2억 같은 구간 정보가 빠진 것 같다"고
지적 — `docs/history/2026-07-16_03_crawler-httpx-migration.md`를 확인해보니 애초에
"sp_cdtn 코드값 매핑표를 아직 못 만들어서 미완성으로 이월"된 상태였음(빼달라는 요청이
아니라 원래 구현이 안 된 것). `AuctView.php`의 `baseInfo.spCdtn`이 "임차권등기/공시가
1~2억/HUG 임차권 인수조건변경"처럼 `/`로 구분된 라벨 원문을 직접 제공함을 실측 확인
(코드→라벨 매핑표 자체가 필요 없었음).

- `crawler/tank_detail.py`: `parse_official_land_price_from_env_payload()`,
  `parse_special_note_from_detail()` 신규(baseInfo.spCdtn + 유치권 존재 여부 병기).
- `crawler/parsers.py`(httpx 전용): 두 필드 모두 신규 파서로 채우도록 수정.
- `crawler/item_crawl.py`(Selenium): 기존 DOM 파싱이 비어있을 때만 API로 보강(DOM 정상
  렌더 시 기존 동작 그대로 유지, 회귀 위험 최소화).
- 기존 물건 3286건(진행중 상태만, `CLOSED_CASE_STATES` 제외) 재크롤 없이 보정:
  `/crawler/missing-official-land-price`, `/crawler/import-official-land-price` API +
  `crawler/backfill_official_land_price.py` 스크립트. 결과: 3165건 업데이트, 121건
  스킵(탱크옥션 자체에 데이터 없음), 실패 0건.

## 오피스텔 취득세/부가세 특례 반영 (2026-07-23 追記)

사용자 요청: 오피스텔은 취득세가 주택 취득세 체계(무주택/다주택 중과 등)와 무관하게
건물분 4%+지방교육세 0.4%+농특세 0.2%=4.6% 단일세율이고, 부가세도 면적(85㎡)과
무관하게 항상 부담이 발생하는데 수익계산기가 이를 반영 안 하고 있다는 지적.

- `src/lib/profit-calculator.ts`: `isOfficetel(usage)`(usage 문자열이 "오피스텔"로
  시작하는지 판정) 신규. `acquisitionTaxRate()`에 `usage` 파라미터 추가 — 오피스텔이면
  무주택/다주택 로직을 건너뛰고 `OFFICETEL_ACQUISITION_TAX_RATE = 0.046`을 바로 반환.
  `acquisitionTaxBracketLabel()`도 오피스텔이면 "오피스텔(4.6% 고정)" 표시.
- 부가세 대상 판정(`over85`)도 `isOver85Sqm(area) || isOfficetel(usage)`로 OR 조건
  확장 — 오피스텔은 면적과 무관하게 항상 부가세계산기 UI(자동계산 버튼 등)가 노출됨.
- **부가세 용도지수 버그 발견**: `/api/vat/calc`(서버 계산 라우트)가 물건의 실제 usage와
  무관하게 항상 `APARTMENT_USAGE_INDEX = 110`(아파트 지수)으로 고정돼 있었음. 참고
  서비스 atomtax-app(https://atomtax-app.vercel.app/calculator/vat/calc)을 Selenium으로
  실측(주거용/상업용 카테고리 토글 클릭 후 각각의 "용도" 드롭다운 옵션 비교) 결과,
  오피스텔은 두 카테고리 어디에 있든 용도지수가 동일하게 **140**임을 확인(카테고리
  토글은 옵션 목록을 필터링하는 UI 기능일 뿐, 계산 파라미터 자체를 바꾸지 않음) —
  관리자 전용 `CrawlerVatTab.tsx`에는 이미 이 140 값이 있었는데(주석: "시행령상
  업무시설로 분류되나 주거용 임대 편의를 위해 주거 카테고리에 추가, 지수는 동일") 수익
  계산 패널의 서버 라우트에는 반영이 안 돼 있었음. `usage`가 오피스텔이면 자동으로
  140을 쓰도록 수정 — 용도지수는 건물기준시가 계산식에 곱해지는 파라미터라, 110→140
  적용 시 건물기준시가가 약 1.27배 커지고 그에 비례해 건물 안분 부가세도 커진다(즉
  이전까지는 오피스텔 부가세가 실제보다 낮게 계산되고 있었음).
- `fetchVatCalc()`/`ProfitCalculatorPanel.tsx`/`estimateDefaultProfit()`(목록 카드
  "추정 수익" 요약값 계산)까지 전부 `usage`를 전달하도록 연결.
- 프로덕션 빌드로 재검증: 오피스텔 계산 상수(`OFFICETEL_USAGE_INDEX` 등)가 `/search`
  (일반 사용자) 청크에는 없고 `/admin`(관리자, CrawlerVatTab) 청크에만 있음을
  확인 — 기존에 구축해둔 "부가세 계산식 클라이언트 비노출" 방침이 새 로직에도 유지됨.

## 관리자 부가세계산기 상업용 옵션 미작동 + 구조지수 자동 매칭 (2026-07-23 追記)

오피스텔 취득세/부가세 작업 도중 사용자가 관리자 부가세계산기(`CrawlerVatTab.tsx`)의
"상업용" 버튼을 눌러도 아무 반영이 안 된다고 지적 — 확인 결과 `usageType`(주거용/
상업용) state는 있었지만 용도 드롭박스(`USAGE_OPTIONS`, 항상 아파트/기타/오피스텔
3개 고정)가 이 state를 전혀 참조하지 않는 버그였음(구현 자체가 누락된 상태).

atomtax-app.vercel.app(https://atomtax-app.vercel.app/calculator/vat/calc)을
Selenium으로 재실측:
- 상업용 용도 옵션 40개(호텔·백화점·사무소·병원·학교 등) 전체 확보, 확인 완료.
- 구조 드롭박스는 주거용/상업용 공통으로 동일한 목록(24개)임을 확인 — 카테고리별로
  분리할 필요 없음.
- atomtax는 **용도** 옵션 라벨엔 지수를 표시하지만(`오피스텔 (주거용 임대) (140)`),
  **구조** 옵션 라벨엔 지수를 표시하지 않음(`철근콘크리트조 (RC)`만) — 우리 화면은
  구조에도 `(지수)`를 붙이고 있어 atomtax와 동일하게 구조 라벨에서만 지수 표시 제거.

`CrawlerVatTab.tsx` 수정: `RESIDENTIAL_USAGE_OPTIONS`(기존 3개)/`COMMERCIAL_USAGE_
OPTIONS`(신규 40개)로 분리, `usage` state를 문자열 대신 "선택된 인덱스"로 바꿔
카테고리 전환 시 `usageOptions[usageOptionIndex]`로 실제 옵션이 함께 바뀌도록 연결
(`handleUsageTypeChange`가 토글 시 인덱스를 0으로 리셋).

### 구조지수 자동 매칭 (수익계산기 `/api/vat/calc`)
논의 중 "구조가 바뀌면 계산식이 어떻게 달라지냐"는 질문에서, 현재 수익계산기
서버 라우트가 구조지수를 항상 `STRUCTURE_INDEX_RC=100`(철근콘크리트조) 고정으로
계산하고 있음을 재확인. 건축물대장 자동조회 API(`fetchVatBuildingRegister`)가
이미 `structureName`(공공데이터포털 표준 구조코드명, 예: "철근콘크리트구조")을
받아오고 있었지만 그동안 버려지고 있었음(기존 주석: "계산기 구조 select와 표기가
달라 매칭은 안 되지만 참고용으로 표시").

- `src/lib/vat-calc.ts`: `STRUCTURE_TABLE`(국세청 고시 구조지수·잔가율 그룹표,
  `CrawlerVatTab.tsx`의 `STRUCTURE_OPTIONS`와 동일 데이터) + 각 구조별
  `keywords`(strctCdNm 매칭용 부분 문자열, 예: "철근콘크리트", "SRC", "경량철골")
  추가. `matchStructureIndex(structureName)`으로 매칭, 실패 시 null(호출자가
  RC/100/내용연수50으로 폴백).
- `/api/vat/calc`가 `body.structureName`을 받아 매칭 시도, 매칭되면 지수뿐 아니라
  잔가율 그룹(depGroup, 내용연수)도 함께 구조에 맞게 적용.
- 클라이언트(`fetchVatCalc`, `ProfitCalculatorPanel.tsx`)에 `structureName` 전달
  경로 연결 — 단, `skipBuildingRegister`(DB에 이미 sharedArea+builtYear 있어
  건축물대장 API 자체를 생략하는 경로)일 때는 구조명을 못 얻어 `null`(RC 폴백).
- 프로덕션 빌드로 재검증: `STRUCTURE_TABLE`/`matchStructureIndex`가 `/search`
  청크에는 없고 서버 전용으로 유지됨(기존 "계산식 클라이언트 비노출" 방침 유지).

## 동 없는 건물(오피스텔·상가) 건물면적 오조회 버그 (2026-07-23 追記)

사용자가 atomtax-app(https://atomtax-app.vercel.app/calculator/vat/calc)에 같은
주소(경기 안양시 만안구 전파로24번길 32, 201호)를 넣고 자동조회한 결과(건물 면적
80.00㎡, 동 201의 전유 66.69㎡+공용 13.31㎡ 자동 합산)와, 우리 관리자 부가세계산기의
결과(건물 면적 **1178.61㎡**)가 완전히 다르다고 스크린샷으로 지적.

### 원인
`src/app/api/vat/building-register/route.ts`가 `if (dong && ho)`일 때만 전유부
(`getBrExposPubuseAreaInfo`, 정확한 호별 면적) 조회를 시도하고, 동이 비어있으면
무조건 표제부(`getBrTitleInfo`, 단지/건물 전체의 여러 동·부속건물이 순서 보장 없이
섞인 목록)의 **첫 항목**(`rows[0]`)으로 폴백하던 구조. 이 물건은 "동" 개념이 없는
단일 건물(오피스텔/상가류로 추정)이라 사용자가 상세 위치에 "동"을 입력하지 않았고
(스크린샷에도 동 칸이 빈칸), 그래서 매번 이 표제부 폴백 경로를 타 부정확한 값(단지
전체 합산으로 보이는 1178.61㎡)이 나왔음.

### 수정
- 조건을 `dong && ho` → `ho`(호만 있으면 시도)로 완화. 동이 없으면 `dongNm`을 빈
  문자열로 넘겨 전유부 API를 호출 — 공공데이터포털 API가 이를 "동 구분 없음"으로
  해석해 호별 전유부를 정상 반환함(실측 확인).
- `findUseAprDayByDong()`도 동이 없을 때는 `dongNm` 매칭을 시도하지 않고(애초에
  매칭 대상이 없어 항상 실패) 표제부 목록의 첫 항목 사용승인일을 그대로 사용하도록
  수정(동 없는 건물은 표제부 자체가 1건뿐인 경우가 대부분).
- 동+호가 둘 다 있는 기존 케이스(아파트 등)의 동작은 그대로 유지 — 이번 변경은
  "동이 없을 때의 폴백 경로"만 바꾼 것.

## 위치지수표 오류 발견 및 갱신 + 자동채우기 확장 (2026-07-23 追記)

atomtax-app("2025년 국세청 고시 기준"이라 명시)을 다시 실측하다가, 우리 위치지수표
(`LOCATION_INDEX_BRACKETS`)가 실제와 전 구간에서 어긋남을 발견 — 이전에 "2024.1.1.
시행 기준"으로 실측했다고 기록했던 표 자체가 최신 고시를 반영 못 하고 있었던 것.
Selenium으로 15개→90개 공시지가 값을 촘촘히(구간 경계 부근 집중) 입력해 정밀 재실측,
새 브라켓 표를 코드로 전량 검증(90/90 일치) 후 교체. 주요 차이 예: 650,000원대
98→100, 1,200,000원대 105→104, 1,600,000원대 108→106, 2,000,000원대 111→114.
건물신축가격기준액(850,000원/㎡)은 그대로 최신값이었음(오차 없음).

**교훈**: "실측 검증 완료"라고 기록해둔 상수표도 국세청 고시가 매년 갱신되므로
주기적 재검증이 필요하다 — 이번엔 사용자가 참고 사이트와 결과가 다르다고 지적해서
발견됐지만, 그런 지적이 없었다면 계속 구버전 지수로 계산될 뻔했음.

### 건물 정보 자동채우기 확장
사용자가 "주소 자동조회 시 target 사이트는 구조/용도까지 자동으로 채워지는데
우리는 신축연도만 채워진다"고 지적. `fetchVatBuildingRegister`가 이미
`structureName`(예: "철근콘크리트구조")과 `mainPurposeName`(예: "업무시설(오피스텔)")을
받아오고 있었지만 그동안 표시만 하고 드롭박스엔 반영을 안 하고 있었음.

- `vat-calc.ts`에 `USAGE_TABLE`(공공데이터포털 표준 주용도명 → 국세청 47개 용도
  옵션 매칭, `matchUsage()`) 신설. `STRUCTURE_TABLE`(직전 追記 항목)의 `matchStructureIndex()`
  와 함께 `CrawlerVatTab.tsx`의 `handleAutoFetchBuilding()`에서 호출해 구조/용도
  드롭박스를 자동 선택. 매칭 실패 시 기존 선택값 유지 + 안내 메시지("매칭 실패,
  직접 선택 필요").
- 이 김에 `CrawlerVatTab.tsx`가 자체로 중복 정의하고 있던 `calcResidualRate`,
  `BUILDING_BASE_PRICE_PER_M2`, `LOCATION_INDEX_BRACKETS`/`getLocationIndex`를
  `vat-calc.ts`(서버 라우트와 공유하는 단일 소스)로 통합 — 이번처럼 지수표를
  갱신해야 할 때 한 곳만 고치면 되도록.

### 다음 단계 후보 (미착수)
- atomtax-app에는 "PDF 업로드"(건축물대장 PDF를 올리면 자동으로 값을 채우는 기능)
  버튼이 있는데 우리는 없음 — 필요성 판단 후 착수 여부 결정.

## 인프라 이슈(참고)

- Railway 배포가 "Deployment queued due to upstream GitHub issues"로 20분 가까이 멈춘 사례
  발생(GitHub 자체 일시 장애). `railway redeploy --from-source -y`로 수동 재배포하면 해결.

## 관련 결정

- 사용자 요청: "경로 자체를 화이트리스트하지 말고 admin 계정 예외만 유지" — 넓은 경로
  화이트리스트는 로그인 없는 진짜 공격도 놓칠 위험이 있어 배제(별도 문서:
  `2026-07-16_02_security-log-detection.md` 참고, 이번 세션에서 admin 예외 추가는 그 문서에
  追記 예정).
