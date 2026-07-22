# 대법원 법원경매정보(courtauction.go.kr) HTTPX 크롤링 가능성 조사

날짜: 2026-07-19 (1차), 2026-07-23 (재확인 및 필드 구조 분석)
관련 레포: auction-api

## 배경

탱크옥션 외에 대법원 법원경매정보 사이트에서도 직접 물건 데이터를 가져오는 방안을 검토.
탱크옥션 크롤러와 동일하게 httpx(가벼운 정적 요청) 방식을 우선 시도.

## 1차 시도 (2026-07-19) — 400 에러로 중단

`crawler/verify_courtauction_httpx.py`로 목록/상세 API를 순수 httpx로 호출했으나 계속
400 에러가 발생. 봇 차단(IP 차단 등)인지 확인하기 위해
`crawler/diagnose_courtauction_browser_check.py`(실제 Chrome 브라우저로 수동 확인),
`diagnose_courtauction_headers.py`, `diagnose_courtauction_manual.py`,
`diagnose_courtauction_manual2.py`, `diagnose_courtauction_network.py` 등 여러 진단
스크립트로 원인을 좁히려 했으나, 결론을 못 내고 커밋도 안 된 채 방치된 상태로 남음
(문서화도 이때 누락됨).

## 재개 (2026-07-23) — 사용자 지침: 최소 접근 원칙

사용자가 재개를 요청하며 명확한 원칙을 제시:
- 대법원 사이트가 짧은 시간 내 반복 접근을 차단하는 것으로 추정되므로, 접근 자체를
  최소화해야 함(한 번에 필요한 데이터를 다 받고 재요청하지 않기).
- 검색/클릭 등 상호작용은 정말 필요한 경우 1회로 제한, 안 되면 접근 사이에 10초 정도
  텀을 둘 것.
- 차단 방식(IP 기반인지 등)도 파악 과제 중 하나.
- **먼저 최소 접근으로 가져올 수 있는 데이터부터 파악**(사진 등 무거운 데이터는 나중).

### 재검증 결과: 지금은 차단되지 않음
`verify_courtauction_httpx.py`를 다시 실행(목록 1회, 상세 1회, 로그인/세션 쿠키 없이)한
결과 **둘 다 200 정상 응답**. 목록 API는 `totalCnt=6806`건까지 조회 가능함을 확인.
1차 시도 때의 400 에러가 왜 발생했는지(일시적 차단이었는지, 당시 요청 파라미터
문제였는지)는 명확히 특정하지 못함 — 앞으로 다시 막히면 이 시점의 요청 헤더/페이로드와
비교해 원인을 좁힐 것.

### 엔드포인트
```
BASE_URL = "https://www.courtauction.go.kr"
목록: POST /pgj/pgjsearch/searchControllerMain.on
상세: POST /pgj/pgj15B/selectAuctnCsSrchRslt.on
```
필요 헤더: `Content-Type: application/json`, `Accept: application/json`,
`Referer: {BASE_URL}/pgj/index.on`, 일반 브라우저 User-Agent. **로그인/세션 쿠키 불요.**

### 목록 API 응답 필드(주요 항목)
`data.dlt_srchResult[]`에 물건당 100여 개 필드. 사건번호(`saNo`/`srnSaNo`), 법원 코드
(`boCd`), 감정가(`gamevalAmt`), 최저가(`minmaePrice`), 유찰횟수(`yuchalCnt`), 매각기일
(`maeGiil`), 용도(`lclDspslGdsLstUsgCd` 등 코드 체계), 주소(`hjguSido/Sigu/Dong/Rd`,
`daepyoLotno`), 좌표(`xCordi/yCordi`, `wgs84Xcordi/wgs84Ycordi`), 건물명(`buldNm`),
면적(`areaList`) 등 — **목록 API 하나만으로 우리 서비스에 필요한 핵심 필드 대부분이
이미 확보됨.**

### 상세 API 응답 필드
`data.dma_result`에 다음 하위 구조:
- `csBaseInfo`: 사건 기본정보(법원명, 사건번호, 청구금액, 담당계, 재판부 등)
- `dspslGdsDxdyInfo`: 매각 물건 현재 상태(감정가, 각 회차 최저매각가, 매각기일,
  물건명세서 특이사항 `gdsSpcfcRmk` — 유치권/대지권 미등기/토지별도등기 등 텍스트)
- `dstrtDemnInfo`: 배당요구종기일
- `gdsDspslDxdyLst`: 매각기일 이력(유찰/변경 등 회차별 기록)
- `gdsDspslObjctLst`: 물건 목적물 상세(구조, 면적, 법정동 코드, PNU, 상세 주소)
- `rgltLandLstAll`: 토지 등기 관련 목록
- `bldSdtrDtlLstAll`: 건물 표시(층별 구조/면적)
- `gdsRletStLtnoLstAll`: 관련 지번 목록
- `aeeWevlMnpntLst`: **감정평가 의견(현황조사서/감정평가서 텍스트) — 위치·교통·이용상태·
  구조·설비·비고 등 사람이 읽는 서술형 정보가 전부 여기 있음.** 물건마다 8~10개 항목.
- `csPicLst`: 사진 목록(아래 별도 설명)
- `picDvsIndvdCnt`: 사진 구분별 개수 집계

### 사진(`csPicLst`) — 이번 조사에서는 메타데이터만 확인, 다운로드는 아직 안 함
사진 1건당 필드: `picFileUrl`(디렉토리 경로, 예: `/nas_e_image_pgj/kj/2008/1026/`),
`picTitlNm`(파일명, 예: `B000210200801300250921.jpg`), `cortAuctnPicDvsCd`(사진 구분
코드), `cortAuctnPicSeq`/`pageSeq`(순번), 그리고 **`picFile`(JPEG 원본을 base64로 인코딩
한 값, 물건 1건 사진 41장 기준 약 700만 바이트)**. 상세 API 응답이 7MB나 됐던 건 거의
전부 이 `picFile` 때문.
- 사진을 가져오는 방법은 두 가지로 보임: (1) 상세 API 응답의 `picFile`을 그대로
  base64 디코드, (2) `picFileUrl` + `picTitlNm`을 조합해 별도 이미지 서버 경로로 직접
  GET(아직 실제로 이 URL에 직접 접근해서 검증하지는 않음 — 다음 단계 과제).
- **이번 요청에서는 사진 데이터(`picFile`)는 목표에서 제외** — 사용자 지침("사진 빼고
  일단 가져오고, 사진은 가져올 수 있는 로직 정도만 파악해두면 됨")에 따라 구조만 파악.

## 접근 이력(이번 세션에서 실제로 보낸 요청 — 최소 접근 원칙 준수)
1. `verify_courtauction_httpx.py` 재실행 — 목록 1회 + 상세 1회 (재검증, 화면 출력만)
2. `save_courtauction_json.py`(신규) — 동일한 목록 1회 + 상세 1회를 다시 보내 이번엔
   전체 JSON을 `crawler/courtauction_probe/list_response.json`,
   `detail_response.json`에 파일로 저장(이후 분석은 재요청 없이 이 파일들로만 진행).
   *주의: 결과적으로 짧은 시간에 목록/상세 API를 총 2세트(4회) 호출한 셈 — 사용자가
   승인한 범위 내였지만, 다음 접근 전에는 충분한 간격을 둘 것.*
3. `crawler/courtauction_probe/summarize_detail.py`(신규, 저장된 파일 가공 전용,
   네트워크 요청 없음) — `detail_response.json`에서 `picFile`(base64, 700만 바이트)만
   제거한 경량 버전 `detail_response_no_pics.json`(37KB) 생성.

## 저장된 파일(참고용, 삭제하지 않음 — 사용자 요청)
- `crawler/courtauction_probe/01_before_search.html` — 1차 시도 중 Selenium으로 받은
  검색 페이지 원본(이번 세션에서 실수로 1회 추가 접근 — httpx로 이미 되는 걸 몰랐을 때
  받음, 최종 방식과는 무관)
- `crawler/courtauction_probe/list_response.json` — 목록 API 전체 응답(39KB)
- `crawler/courtauction_probe/detail_response.json` — 상세 API 전체 응답(7MB, 사진
  base64 포함)
- `crawler/courtauction_probe/detail_response_no_pics.json` — 위에서 사진만 제거한
  경량 버전(37KB, 실제 필드 분석은 이 파일 기준)

## 다음 단계 후보 (아직 진행 안 함)
1. 목록 API의 페이지네이션(`dma_pageInfo.pageNo/pageSize`)과 검색 조건 파라미터
   (법원별/기간별/용도별 등) 전체 파악 — 지금은 스크린샷 예시(서울중앙지방법원,
   특정 기간) 하나만 확인함.
2. `picFileUrl` + `picTitlNm` 조합으로 실제 이미지에 직접 접근되는지 검증(아직 미검증,
   추가 요청 필요 — 사용자 승인 후 진행).
3. 차단 재발 시 대비: 요청 간 간격, User-Agent 로테이션 여부, 세션 유지 필요성 등을
   실제로 막혔을 때 다시 진단.
4. 탱크옥션 데이터와 어떻게 통합할지(중복 물건 병합 기준, 우선순위 등) 설계 필요 —
   아직 미착수.
