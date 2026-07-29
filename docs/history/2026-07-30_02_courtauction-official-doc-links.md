# 대법원 법원경매정보(courtauction.go.kr) 매각물건명세서 등 원본 문서 링크 확보 조사

날짜: 2026-07-30
관련 레포: auction-api (crawler/)
상태: 조사 완료, 실제 연동(백엔드 API/버그 수정) 미착수

## 배경

탱크옥션 물건 상세 화면 우측의 "파일자료"(사건내역/기일내역/현황조사서/
감정평가서/매각물건명세서/건물등기/세대열람 등)가 탱크옥션 자체 제작
자료인지, 대법원 법원경매정보(courtauction.go.kr)에서 가져오는 원본인지
사용자가 질문하며 조사가 시작됐다.

## 1. 결론 요약

1. **탱크옥션의 파일자료는 전부 법원경매정보 원본이다.** 우리 DB에 이미
   저장 중인 `fileInfo.items[0].content` 필드 안에 법원경매정보 공식
   API 응답(`dma_csBasInf`, `dlt_rletCsIntrpsLst` 등 `dma_`/`dlt_` 접두사
   — 법원 시스템 특유의 네이밍)이 그대로 캐싱돼 있다.
2. **매각물건명세서(PDF) 링크는 법원경매정보 API 2회 호출만으로 우리가
   직접 생성할 수 있다** — 로그인 불필요, Selenium 불필요.
3. **크롤러가 계산하는 `extraData`(fileInfo 포함)가 실제로는 한 번도
   DB에 저장되지 않고 있었다** — Python↔TypeScript 간 페이로드 형태
   불일치 버그 발견(§4).
4. **나이스옥션이 탱크옥션보다 매각물건명세서·등기·세대열람 커버리지가
   더 넓고, 자체 크롤러로 독립적으로 데이터를 쌓고 있다**(탱크옥션이
   나이스옥션에 데이터를 공급하는 관계 아님, §5).

---

## 2. 매각물건명세서 링크 생성 — API 체인 실측

### 2.1 조사 방법
자동 클릭(Selenium 선택자 매칭)이 WebSquare 커스텀 위젯에서 반복
실패해(`element not interactable`, 엉뚱한 요소 클릭 등), 최종적으로는
브라우저 창을 띄워두고 **사용자가 직접 검색→사건 클릭→매각물건명세서
클릭**을 진행하는 동안 CDP(Chrome DevTools Protocol)로 전체 네트워크
요청/응답을 캡처하는 방식(`crawler/diagnose_courtauction_msmt_manual.py`)
으로 성공했다.

### 2.2 확인된 최종 링크 형태
사용자가 실제로 클릭해 도달한 URL:
```
https://ecfs.scourt.go.kr/sgvo/websquare/websquare.html?w2xPath=/sgvo/ui/sgvo200/SGVO201M01.xml?paramData=<base64>
```
`paramData`를 base64 디코드하면:
```json
{"encParam": "<url-encoded 암호화 블롭>", "pspTkn": "NA", "pspSid": "NA"}
```
`encParam`은 로컬에서 만들 수 없는 값(서버 발급) — 아래 API 체인으로만
얻을 수 있다.

### 2.3 API 체인 (둘 다 로그인 불필요, httpx로 이미 검증된 패턴과 동일)

**1단계 — 상세 조회** (기존에 이미 쓰고 있던 API, `crawler/courtauction_client.py`):
```
POST https://www.courtauction.go.kr/pgj/pgj15B/selectAuctnCsSrchRslt.on
{
  "dma_srchGdsDtlSrch": {
    "csNo": "<사건번호>", "cortOfcCd": "<법원코드>",
    "dspslGdsSeq": "<물건순번>", "pgmId": "PGJ151F01", "srchInfo": {...}
  }
}
```
응답의 `dma_result.dspslGdsDxdyInfo` 안에 이미
`dspslGdsSpcfcEcdocId`(문서ID)와 `orvParam`(토큰)이 들어있다 — **별도
호출 없이 지금 쓰는 API 응답에 이미 존재**.

**2단계 — 매각물건명세서 링크 생성** (신규 발견 API):
```
POST https://www.courtauction.go.kr/pgj/pgj15B/insertDspslGdsSpecArtcWdrwInf.on
{
  "dma_dspslGdsSpecLog": {
    "cortOfcCd": "B000210", "csNo": "20080130025092", "dspslGdsSeq": 1,
    "orvParam": "<1단계에서 받은 값>",
    "dspslGdsSpcfcEcdocId": "<1단계에서 받은 값>",
    "cortAuctnMbrsId": "NONUSER",
    "docFlag": "1", "dspslDxdyPbancEcdocId": ""
  }
}
```
응답:
```json
{"status":200,"data":{"dma_dspslSpcfcInfo":{
  "url":"https://ecfs.scourt.go.kr/sgvo/websquare/websquare.html?w2xPath=/sgvo/ui/sgvo200/SGVO201M01.xml",
  "scsYn":1,
  "encParam":"<url-encoded 값>"
}}}
```
`cortAuctnMbrsId: "NONUSER"`(비회원)로 성공 — **로그인 세션 없이 매각
물건명세서 링크를 발급받을 수 있음을 실측 확인**.

최종 링크는 `url` + `?paramData=` + base64(`{"encParam":..., "pspTkn":"NA", "pspSid":"NA"}`)로 조립.

### 2.4 필요 입력값 3개와 확보 방법
`selectAuctnCsSrchRslt.on` 호출에 필요한 `cortOfcCd`/`csNo`/`dspslGdsSeq`는
**탱크옥션 원본(`fileInfo.items[0].content` → `dma_csBasInf`)에 이미 그대로
들어있다** — 별도 변환/추정 로직 불필요:

```json
{"cortOfcCd": "B000414", "csNo": "20240130110655", "dspslGdsSeq": 1}
```

**csNo 패턴 검증**: 표본 3건(탱크옥션 2건 + 나이스옥션 1건)에서 전부
`연도 + "0130" + 사건번호를 6자리로 0채움` 규칙과 일치함을 확인
(`2024타경110655` → `20240130110655`, `2008타경25092` → `20080130025092`,
나이스옥션 `2024타경79330` → `20240130079330`). "타경" 사건유형에
한정해 이 패턴이 상당히 신뢰할 만하다고 판단되나, "타기" 등 다른
사건유형은 검증 못 함.

---

## 3. 법원경매정보 접근 시 준수 사항

`crawler/save_courtauction_json.py`에 기존 세션의 사용자 지침이 남아있음:
> "사용자 지침(2026-07-23): 접근은 최소한으로."

이번 조사 중 확인되지 않은 엔드포인트를 추측해서 5회 호출한 적이
있었는데(전부 실패, 404/미존재), 이 지침을 뒤늦게 발견하고 즉시
추측성 호출을 중단했다. **앞으로 법원경매정보 관련 작업 시 이
지침을 최우선으로 따를 것** — 엔드포인트를 추측해서 여러 번 찔러보지
말고, 확실한 근거(기존 캡처 데이터, 사용자와 함께하는 1회성 캡처)
로만 진행한다.

---

## 4. 버그 발견 — `extraData`(fileInfo 포함)가 실제로는 저장된 적이 없음

### 4.1 원인
- `crawler/repository.py`의 `build_extra_data()`는 `fileInfo`/`img`/
  `rcaseInfo` 등을 **`{"extraData": {...}}` 형태로 감싸서** 반환하고,
  Python 크롤러는 이 값을 `item["extraData"]`에 넣어 백엔드로 전송한다.
- 그런데 백엔드 TypeScript 매퍼(`src/crawler/crawler-item.mapper.ts`의
  `extractExtraData()`)는 `raw["fileInfo"]`처럼 **최상위 키에서 직접**
  찾도록 구현돼 있다 — Python이 감싸서 보낸 `raw["extraData"]["fileInfo"]`
  구조를 못 찾고 항상 `null`을 반환한다.
- 운영 DB 직접 조회로 확인: **`extraData IS NOT NULL`인 물건 0건**
  (전체 4천여 건 중).

### 4.2 영향
`fileInfo`(→ courtOfcCd/csNo/dspslGdsSeq 포함)뿐 아니라 `img`/
`rcaseInfo`/`hit`/`x`/`y`/`histCnt`까지 전부 크롤러가 계산은 하지만
DB엔 한 번도 반영되지 않고 있었다.

### 4.3 조치 (미착수)
- 백엔드 매퍼를 `raw["extraData"]?.[key]`를 먼저 보고 없으면
  최상위 폴백하도록 수정 필요(Python 쪽 감싸는 방식은 유지, 하위호환
  위해 최상위 폴백도 남겨둠).
- 수정 후에도 **기존에 이미 크롤링된 물건은 재크롤링해야** `fileInfo`가
  채워진다(재크롤링 없이 백필 불가 — 원본이 애초에 저장 안 됐으므로).
  가벼운 크롤 함수 `crawl_one_item_detail_only_httpx`(네이버 조회
  생략, 2026-07-29 신설)로 재크롤링 시간 단축 가능.

---

## 5. 나이스옥션 재확인 — 탱크옥션이 나이스옥션에 데이터를 공급하는가?

기존 조사 문서([docs/niceauction-integration-research.md](../niceauction-integration-research.md))
에 이미 필드 커버리지 비교가 상세히 있어, 이번엔 **"둘이 서로 데이터를
주고받는 관계인지, 각자 독립적으로 쌓는지"**만 추가로 확인했다.

### 5.1 결론: 각자 독립적으로 크롤링·축적 — 탱크→나이스 데이터 공급 아님

근거:
1. 나이스옥션 API 응답 필드명에 `metadata.crawlerSagunAuctionDtLst`,
   `isCrawlerObjItemLst`, `isEditedDtList`처럼 **"crawler"라는 단어가
   그대로 노출**돼 있음 — 나이스옥션이 자체 크롤러로 사건/기일 정보를
   수집해 쌓고 있다는 직접적 증거.
2. 나이스옥션은 `sgis`(통계청 SGIS 지역통계), `kapt`(K-apt 단지정보 62
   필드), `aptTradePriceLst`(실거래가 142건 구조화) 등 **탱크옥션에
   없는 완전히 별도의 데이터 소스**까지 통합돼 있음 — 탱크에서 받아온
   것이라면 존재할 이유가 없음.
3. PDF/미디어 저장 방식이 서로 다름 — 탱크는 `tankauction.com/FILE/...`,
   나이스는 자체 `mediaId` 기반 미디어 시스템. 한쪽이 다른 쪽 파일을
   그대로 미러링하는 구조가 아님.
4. 필드 네이밍 체계가 완전히 다름(탱크: `dstbOpwr`/`leasInfo` 등, 나이스:
   `myungseDesc`/`sagunId` 등) — 공통 코드베이스/공급 관계라면 이렇게
   다를 이유가 없음. 다만 둘 다 `dma_`/`dlt_`류 법원 API 필드명 대신
   각자 재가공한 자체 네이밍을 쓰는 걸 보면, **원본(법원경매정보)에서
   각자 독립적으로 받아 각자 파싱·저장**하는 구조로 보인다.

**정리**: 탱크옥션·나이스옥션은 경쟁 관계의 개별 사업자로, 둘 다 (아마)
법원경매정보를 원천으로 각자 크롤링 인프라를 운영해 자체 DB를 쌓고
있다. 한쪽이 다른 쪽에 도매 공급하는 구조가 아니다. (참고: 국내
경매정보 시장엔 지지옥션·굿옥션 등 여러 사업자가 있고, 다들 비슷하게
독자 수집 체계를 갖추는 게 일반적 — 이번 조사로 탱크·나이스 2곳
한정으로 확인된 사실이며 나머지 업체는 미조사.)

---

## 6. 다음 단계 후보 (미착수, 우선순위 미정)

1. `extraData` 매퍼 버그 수정(§4.3) — 가장 먼저 해야 향후 크롤링분부터
   `fileInfo` 자동 확보 가능.
2. 매각물건명세서 링크 생성 API(§2.3)를 백엔드에 구현 — 물건 상세
   화면에 "매각물건명세서 원문 보기" 버튼 추가.
3. 기존 크롤링 물건 재크롤링 백필(§4.3) — courtOfcCd/csNo/dspslGdsSeq
   확보용.
4. csNo 패턴(§2.4)을 더 많은 표본으로 검증(다른 사건유형 포함).
5. 나이스옥션의 `maegakMyungse`(구조화 매각물건명세)/`deunggiLst`(구조화
   등기)까지 활용할지는 별도 연동 착수 여부(niceauction-integration
   -research.md §6 미해결 목록)와 함께 판단.
