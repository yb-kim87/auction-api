# 나이스옥션(niceauction.co.kr) 연동 조사 — 탱크옥션 대체 가능성

날짜: 2026-07-26
관련 레포: auction-api (crawler/)
상태: 조사 완료, 실제 연동 미착수 (사용자 승인 후 개발 착수 예정)

## 배경 / 목적

현재 크롤러(`crawler/`)는 탱크옥션(tankauction.com)에서 물건 상세 정보를
가져온다. 사용자가 **"탱크옥션을 나중에 나이스옥션으로 대체할 생각"**이라고
밝혀, 나이스옥션이 탱크옥션과 동등하거나 그 이상의 데이터를 비로그인
상태로 자동 수집 가능한지 조사했다.

## 조사 계기 — 미납관리비(체납금액) 출처 추적에서 시작

원래 조사는 "탱크옥션의 미납관리비(체납금액) 데이터를 어디서 가져오는지"
에서 시작됐다(별도 문서: [2026-07-16_03_crawler-httpx-migration.md](./history/2026-07-16_03_crawler-httpx-migration.md)
追記 참고). 조사 중 "이런 데이터를 배급해주는 업체가 있지 않을까"라는
가설을 검증하는 과정에서, 등기부등본·전입세대열람처럼 공식 발급 절차가
있는 데이터(대법원 인터넷등기소 등)와 미납관리비처럼 공식 API가 없는
데이터(각 경매정보 업체가 자체 조사)를 구분하게 됐고, 이 구분을
실증하기 위해 나이스옥션에서 **같은 물건**을 조회해 탱크옥션과
비교하는 실험을 진행했다.

## 결론 요약 (TL;DR)

1. **나이스옥션은 물건 상세 API(`GET /api/v1/obj/{objId}`)가 로그인
   여부와 무관하게 완전히 동일한 데이터를 반환한다** (151개 필드 중
   `viewTotal`/`dailyViewList`(조회수 카운터)만 차이나고 나머지는 100%
   동일 — 실측 확인, 2026-07-26).
2. **objId를 사건번호 없이도 대량 확보하는 방법이 있다**: 비로그인
   sitemap API(`/api/v1/site/sitemap`)가 전체 물건의 objId 목록을
   페이지네이션해서 제공한다. 로그인/검색 UI 없이도 objId 전수를 가져올
   수 있다.
3. **탱크옥션이 제공하는 정보 중 미납관리비(체납금액) 단 하나만 나이스
   옥션에 없다.** 나머지(감정가·최저가·소유자·채무자·등기부등본·매각물건
   명세서·배당요구·임차인현황 등)는 전부 무료·비로그인으로 동등하게
   확보 가능하며, 실거래가·지역시세통계·K-apt 단지정보는 오히려 탱크
   옥션보다 풍부하다.

---

## 1. API 구조

### 1.1 베이스 URL
```
https://niceauction.co.kr
```

### 1.2 핵심 엔드포인트

| 엔드포인트 | 용도 | 로그인 필요 여부 |
|---|---|---|
| `GET /api/v1/obj/{objId}?privacy=true` | 물건 상세 전체 데이터 | **불필요** (실측 확인) |
| `GET /api/v1/site/sitemap` | sitemap index (objType별 하위 페이지 목록) | 불필요 |
| `GET /api/v1/site/sitemap/{objType}/{page}` | objId 목록(각 페이지 최대 3만 건) | 불필요 |
| `GET /auction/list`, `GET /api/v1/auction/list` | 목록/검색(회원 대상) | **필요** ("로그인을 해주세요" 응답) |
| `GET /search?keyword=...` | AI 통합검색(상단 검색창) | 필요 추정(미검증), UI 자동화로도 결과 카드 렌더링에 어려움 있었음 |
| `POST /login`(추정, 실제 폼 제출 경로는 SPA 내부 처리) | 로그인 | - |

`objType` 코드(sitemap에서 확인):
- `76000001`: 경매 (9페이지, 페이지당 약 3만 건 → 약 27만 건 규모)
- `76000002`: 공매로 추정 (3페이지)
- `76000003`: 기타로 추정 (2페이지)

### 1.3 상세 API 응답 포맷
```json
{
  "code": 0,
  "msg": "Ok",
  "data": {
    "isMemberShip": false,
    "isPaid": false,
    "obj": { ... 151개 필드 ... }
  }
}
```
`isMemberShip`/`isPaid`가 `false`인 채로 전체 데이터가 내려온다는 것이
핵심 — 서버가 비회원 요청임을 인지하고도 게이트를 걸지 않는다.

---

## 2. objId 확보 방법 (사건번호 없이 비로그인으로 전수 수집)

### 2.1 sitemap index
```
GET https://niceauction.co.kr/api/v1/site/sitemap
```
응답: `sitemapindex`(XML), 하위 sitemap URL 14개 나열
(76000001/1~9, 76000002/1~3, 76000003/1~2).

### 2.2 개별 sitemap 페이지
```
GET https://niceauction.co.kr/api/v1/site/sitemap/76000001/1
```
응답: `urlset`(XML), `<url><loc>https://niceauction.co.kr/auction/detail/{objId}</loc>...`
형태로 페이지당 약 3만 건의 objId를 포함(실측: 1페이지 30,002건, 각
페이지 파일 크기 약 5MB).

**활용 방안**: 이 sitemap 전체(14개 페이지)를 주기적으로 다운로드해
objId 목록을 확보 → 각 objId를 `GET /api/v1/obj/{objId}`로 순회 조회
→ 응답의 `saYear`+`saNo`(사건번호)로 우리 DB의 `auctionNo`와 매칭.

### 2.3 검증 완료 사항
- objId `2064094504968782008`(2024타경79330, 남양주 진접신도브래뉴아파트
  2208동 403호)가 sitemap 1페이지 내 실제로 존재함을 grep으로 확인.
- 동일 objId를 로그인 상태/비로그인 상태 양쪽으로 상세 API 호출해
  151개 필드 중 149개가 완전히 동일함을 확인(나머지 2개는 조회수
  카운터 차이일 뿐, 조회 시점 차이로 인한 자연 증가).

### 2.4 미해결 — 검색 UI 자동화
사용자가 로그인 상태에서 브라우저로 상단 "AI 통합검색"에 사건번호를
입력해 검색 결과 카드 목록을 얻는 것은 확인했으나(스크린샷 제공),
Selenium으로 이 흐름을 자동화하려는 시도는 여러 차례 실패했다:
- 검색창(`id="topSearchBox"`)이 `backdrop show` 오버레이에 가려 클릭
  인터셉트 발생
- `Keys.ENTER`, 검색 버튼 클릭 모두 실제 검색 결과 페이지로 전이되지
  않음(URL이 `/home`에 머무름)
- 자동완성 드롭다운은 렌더링되나(`dropdown items found: 10`) 텍스트가
  비어 있어 항목 식별 실패

**결론**: 검색 UI 자동화는 막혔지만, **sitemap 방식이 검색 UI보다
훨씬 안정적이고 완전히 비로그인이므로 실제 연동 시 이 방식을 채택하는
것을 권장**한다. 검색 UI 자동화는 더 이상 추구할 필요가 없다.

---

## 3. 데이터 필드 비교 — 탱크옥션 vs 나이스옥션

표본 물건: **2024타경79330** (경기도 남양주시 진접읍 금곡리 1115
진접신도브래뉴아파트 2208동 4층 403호, 아파트, 감정가 847,000,000원)
- 탱크옥션 tid: `2311460`
- 나이스옥션 objId: `2064094504968782008`

### 3.1 우리 크롤러(`parsers.py: parse_detail_page()`)가 저장하는 필드 기준 대조

| 우리 DB 필드 | 탱크옥션 소스 | 나이스옥션 대응 필드(무료/비로그인) | 커버리지 |
|---|---|---|---|
| `address` | `baseInfo` | `addrNoPrivacy`, `roadAddrNoPrivacy`, `bldgNm` | ✅ 동일 |
| `appraisal_price` | `baseInfo.apsl_amt` | `gamjungAmt`(총), `tojiGamjungAmt`(토지), `bldgGamjungAmt`(건물) | ✅ 동일(오히려 토지/건물 분리돼 더 상세) |
| `min_price` | `baseInfo.minb_amt` | `minAmt` | ✅ 동일 |
| `sale_price` | `baseInfo.sucb_amt` | `maegakAmt` | ✅ 동일 |
| `bidDate` | `baseInfo` | `dspslDxdyYmd` | ✅ 동일 |
| `court` | `baseInfo` | `court`(dict, 9 keys), `jdbnNm`("경매4계") | ✅ 동일 |
| `owner`/`appraiser` | `baseInfo` | `soyujaNm`(소유자), 감정원 정보는 `gamjungPdfLst`/`gamjungDescGrpLst` 안에 | ✅ 대응 가능 |
| `buildingRegistry`(등기부등본 텍스트) | `rgBldgInfo` | `deunggiLst[].dataList`(구조화된 등기 원장 항목 배열), `deunggiPdfLst`(PDF 원문) | ✅ **오히려 더 구조화됨** |
| `tenantDetail`/`lease_info` | `leasInfo` | `imchainLst`(임차인 목록, 이 표본은 빈 배열이나 필드 존재), `maegakMyungse.imchaDesc` | ✅ 대응 가능 |
| `education_setup` | `EnvViewData.php` | 미확인(이번 조사 범위 밖) | ❓ 별도 확인 필요 |
| `bidInfo`(유찰 이력) | `baseInfo` 텍스트 | `dspslDxdyLst`(회차별 배열), `dspslDxdySaleLst` | ✅ 오히려 구조화 |
| `special_note` | `baseInfo.spCdtn` | `specialObjCdList`, `dspslGdsRmk`, `objEtc` | ✅ 대응 가능 |
| **`unpaid_fee_amount`(체납금액)** | `arersInfo.items[].amt` | `gwanribi` 필드는 존재하나 **이 표본은 빈 문자열** | ❌ **미확인/없음** |
| `sharedArea`/`area`(면적) | `bldgInfo` | `tojiArea`, `bldgArea`(전용면적) | ✅ 동일 |
| `naver_lowest_price`(우리 자체 크롤링) | 네이버 SPA 별도 크롤링 | `naverUrls`(네이버 부동산 링크만 제공, 시세 데이터 자체는 없음) | ➖ 무관(우리가 이미 자체 수집) |
| (미보유) 실거래가 상세 | 크롤러가 텍스트로 별도 파싱 | `aptTradePriceLst`(142건, 계약일·층·평형·보증금까지 완전 구조화) | ✅ **나이스옥션이 압도적으로 풍부** |
| (미보유) 지역 시세 통계 | 없음 | `aptTradeStaticSidoGu`, `aptTradeStaticUmd`(시/군/구 및 읍/면/동 단위 월별 평균가·거래량 시계열, 최근 13개월) | ✅ **나이스옥션에만 있음** |
| (미보유) K-apt 단지정보 | `EnvViewData.php`(dtDj) | `kapt`(62개 필드 — 관리사무소 전화번호·팩스, 관리업체 위탁 여부, 승강기 대수, 경비/청소 위탁, 전기차 충전소 지상/지하 구분 등) | ✅ 나이스옥션이 더 세분화 |
| (미보유) 매각물건명세서 구조화 | 텍스트 블록 | `maegakMyungse`(최선순위설정일자, 배당요구종기일, 임차/매각/지상권 특이사항이 필드로 분리) | ✅ 나이스옥션이 더 구조화 |

### 3.2 유일한 공백: 미납관리비(체납금액)

탱크옥션 `arersInfo.items[0]`:
```json
{
  "amt": 1056360,
  "period": "3개월",
  "note": "- 전기, 수도 포함/도시가스 별도",
  "wdt": "2026-06-04",
  "staff": "tankson"
}
```
나이스옥션 대응 필드 `gwanribi`: `""` (빈 값, 이 표본 한정)

`staff`(조사 담당자), `wdt`(조사일자) 필드가 있는 걸 보아 탱크옥션은
직원이 관리사무소에 개별 문의해 수기로 입력하는 자체 조사 데이터로
추정된다(각 경매정보 업체가 독립적으로 조사하는 영역 — 공식 API가
없음, [별도 조사](./history/2026-07-16_03_crawler-httpx-migration.md)
참고). 나이스옥션도 `gwanribi` 필드 자체는 마련해뒀으나 이 표본
물건에는 값이 없어, 조사 자체를 안 했거나 탱크옥션만큼 적극적으로
채우지 않는 것으로 보인다. **다른 물건 표본에서 `gwanribi`가 채워진
사례가 있는지는 추가 확인 필요(미검증).**

---

## 4. 나이스옥션 상세 API 필드 레퍼런스 (표본 1건 기준, 151개 필드)

표본: objId `2064094504968782008` (2024타경79330)

```
objId, objType, objKind, sagunId, sagun(dict 41), objNo, saYear, saNo,
courtCd, jdbnCd, jdbnNm, court(dict 9), pictures(list 17),
maegakdaesangCd, initRegYmd, dspslDxdyYmd, dspslDxdyLst(list 3),
dspslDxdySaleLst(list 2), prevDspslDxdyYmd, dspslPlcNm, soyujaNm,
chamujaNm, chaeonjaNm, dstrtDemnLst(list 1), yongdoCd, yongdoCd1,
yongdoCd2, yejungYongdoNm, auctnLstDvsCd, auctnGdsUsgCd, gamjungAmt,
minAmt, maegakAmt, gamjungAmtRate, maegakAmtRate, dspslGdsRmk,
bidDpslPrc, bidDpslRate, objEtc, prevObjEtc, addr, tojiAddr, roadAddr,
addrNoPrivacy, tojiAddrNoPrivacy, roadAddrNoPrivacy, postcode,
storagePlace, bldgNm, kaptCode, pnuCd, pnuArea1/2/3, lat, lng, x, y,
tojiArea, tojiAreaJiboon, tojiJesioeArea*(4종), bldgArea,
bldgAreaJiboon, bldgJesioeArea*(4종), tojiGamjungAmt,
tojiJesioeGamjungIn/OutAmt, bldgGamjungAmt, bldgJesioeGamjungIn/OutAmt,
totalGamjungAmt, jeonipSedae, etcGamjungAmt, gwanribi,
juminCenterInfo, uchalCnt, objProgStatusCd, objStatusCd,
auctnGdsStatCd, auctnDxdyGdsStatCd, specialObjCdList(list 3),
bidDvsCd, bidBgngYmd, bidEndYmd, realMulKindCd, useLawAs(list 0),
useLawBs(list 17), gamjungDescGrpLst(list 1), gamjungDesc,
objList(list 2), imchainLst(list 0), maegakMyungse(dict 9),
maegakMyungseCrawler(dict 9), aroundDspslStats(list 0),
saedaePdfLst(list 1), gamjungPdfLst(list 1), maegakPdfLst(list 2),
geonchukmulPdfLst(list 1), tojidaejangPdfLst(list 0),
deunggiPdfLst(list 1), deunggiLst(list 1), naverUrls(list 1),
asilCode, malsoFirstDt, taskStatusCd, viewTotal, dailyViewList,
isFavorite, isAlarm, isPartnerObj, favoriteRate,
userObjFavoriteCategoryId, favoriteCategory, favoriteMemo,
favoriteMsg, deunggiStatus, roi1~4, kapt(dict 62), tags,
landTradePriceLst, aptTradePriceLst(list 142), shouseTradePriceLst,
rhouseTradePriceLst, officetelTradePriceLst, nplCompany, npl,
metadata(dict 8), isScrap, aptSidoGuNm, aptTradeStaticSidoGu(dict 9),
aptTradeRankSidoGu(dict 6), aptUmdNm, aptTradeStaticUmd(dict 9),
aptTradeRankUmd(dict 6), isNiceAnalysis, noteIdLite, noteIdPro,
isMemberShip, isPaid, housePrice(dict 24), updatedAt, createdAt
```

### 4.1 주요 하위 구조 상세

**`kapt`(62 keys)** — K-apt 단지정보:
```
lat, lng, pnuCd, hoCnt, bjdCode, codeMgr, codeNet, codeSec, codeStr,
kaptFax, kaptTel, kaptUrl, zipcode, codeEcon, codeElev, codeEmgr,
doroJuso, kaptAddr, kaptCode, kaptName, privArea, codeAptNm,
codeClean, codeMgrNm, kaptMarea, kaptTarea, kaptdDcnt, kaptdEcnt,
kaptdPcnt, kaptdaCnt, codeDisinf, codeFalarm, codeHallNm, codeHeatNm,
codeSaleNm, kaptMgrCnt, kaptdCccnt, kaptdClcnt, kaptdEcapa, kaptdEcntp,
kaptdPcntu, ktownFlrNo, codeGarbage, codeWsupply, kaptDongCnt,
kaptUsedate, kaptdSecCom, disposalType, kaptAcompany, kaptBcompany,
kaptCcompany, kaptTopFloor, kaptBaseFloor, kaptMparea_60,
kaptMparea_85, kaptdWtimebus, kaptdWtimesub, kaptMparea_135,
kaptMparea_136, welfareFacility, groundElChargerCnt,
undergroundElChargerCnt
```
실측 예시: `kaptTel: "0315280795"`(관리사무소 전화번호),
`codeMgr: "위탁관리"`, `kaptName: "진접신도브래뉴"`

**`aptTradePriceLst`(list, 142건, 개별 실거래 계약 1건 예시)**:
```json
{
  "aptNm": "신도브래뉴", "aptSeq": "41360-2692", "buildYear": "2009",
  "contractTerm": "26.08~28.08", "contractType": "갱신",
  "dealDay": "11", "dealMonth": "7", "dealYear": "2026",
  "deposit": "41,000", "excluUseAr": "134.6133", "floor": "10",
  "jibun": "1115", "lat": "37.7216031", "lng": "127.2057959",
  "monthlyRent": "0", "preDeposit": "40,000", "preMonthlyRent": " ",
  "roadnm": "해밀예당1로236번길 3", "type": "임대", "umdNm": "진접읍 금곡리",
  "useRRRight": "사용"
}
```

**`aptTradeStaticSidoGu`(구/군 단위 월별 시세 통계, 최근 13개월)**:
```json
{
  "areaType": "gu", "lawdCd": "41360", "avgPrice": "465010935",
  "pyungPerPrice": "19293342", "tradeCnt": 2267,
  "data": [
    {"date": "26.07", "avgPrice": "495000000", "maxPrice": "1185000000",
     "minPrice": "155000000", "tradeCnt": "32", ...},
    ... (12개월 추가)
  ]
}
```

**`maegakMyungse`(매각물건명세서 구조화)**:
```json
{
  "myungsePeopleLst": [], "myungsePeopleLstOrg": [],
  "choeSeonSungWi": "2015.9.25. 근저당권",
  "writeYmd": "2026-05-08", "dstrtDemnYmd": "2024. 9. 23.",
  "imchaDesc": "", "magakDesc": "", "jisangDesc": "", "myungseDesc": ""
}
```

**`deunggiLst`(등기부등본, 1건 예시 — 필드 일부)**:
```json
{
  "objDeunggiId": "839210", "keyNo": "2064094526259069112",
  "bldGbn": "집합", "addr": "...", "issuedAt": "2026-05-09",
  "bojonAt": "2009-12-30", "status": 9, "statusMsg": "발급완료",
  "mediaId": "2064151233056210987", "dataList": [ ... 등기 원장 항목별 배열 ... ]
}
```

---

## 5. 실무 활용 아이디어 (우선순위)

1. **지역 시세 통계(`aptTradeStaticSidoGu`/`aptTradeStaticUmd`)** —
   현재 우리 시스템엔 "이 물건 개별 시세"만 있고 "이 지역 최근 시세
   트렌드"가 없음. 추천 로직/수익계산기에 결합 시 가치 큼(예: 최근
   3개월 평균가 대비 낙찰 예상가 괴리율 자동 계산).
2. **실거래가 구조화(`aptTradePriceLst`)** — 지금 탱크옥션 텍스트
   블록(`tradingDetail`)을 정규식으로 파싱하는 대신, 이미 구조화된
   데이터로 대체하면 파싱 오류 리스크가 사라짐. 특히 층수별 매칭
   로직(`naver-floor-price.util.ts`와 유사한 개념)을 더 안정적으로
   구현 가능.
3. **K-apt 관리사무소 연락처(`kapt.kaptTel`)** — 사용자가 결국 미납
   관리비를 직접 확인해야 하는 경우, 관리사무소 전화번호를 물건
   상세에 바로 노출하면 실용적.
4. **등기부등본 구조화(`deunggiLst[].dataList`)** — 말소기준권리
   자동 판별 등 권리분석 로직을 텍스트 파싱보다 안정적으로 구현
   가능.
5. **미납관리비는 나이스옥션으로 대체 불가** — 이 항목만큼은 탱크
   옥션(또는 별도 수단)을 계속 병행해야 함.

---

## 6. 미해결 사항 / 다음 단계

- [ ] `gwanribi` 필드가 채워진 물건 표본이 있는지 추가 확인(현재
      1건 표본만 확인, 빈 값이었음 — 일반화하기엔 표본 부족)
- [ ] sitemap 전체(14개 페이지, 약 27만+ 건) 다운로드 및 objId →
      상세 API 순회 조회 파이프라인 설계(요청 빈도/동시성 제한 정책
      미정 — 탱크옥션 크롤러의 `CRAWL_CONCURRENCY` 패턴 참고 가능)
- [ ] 우리 DB `auctionNo`(사건번호)와 나이스옥션 `saYear`+`saNo`
      매칭 로직 구현
- [ ] 아파트 외 물건 유형(빌라, 상가, 토지)에서도 필드 커버리지가
      동일한지 표본 확대 검증(이번 조사는 아파트 1건, 토지 1건만
      확인)
- [ ] robots.txt에 `Sitemap: /api/v1/site/sitemap` 명시되어 있고
      비로그인 접근이 사실상 공개 데이터 취급되는 정황이나, 이용약관
      상 대량 크롤링이 허용되는지는 별도 확인 필요(법적/약관 검토는
      이번 조사 범위 밖)
- [ ] 실제 전환(탱크옥션 → 나이스옥션) 착수 여부는 사용자 승인 후
      진행

## 追記 (2026-07-30) — 탱크옥션이 나이스옥션에 데이터를 공급하는가?

사용자 질문으로 재확인: **아니다, 공급 관계가 아니라 각자 독립적으로
크롤링·축적하는 경쟁 관계**로 판단된다.

- 나이스옥션 응답 필드명에 `metadata.crawlerSagunAuctionDtLst`,
  `isCrawlerObjItemLst`처럼 "crawler"가 그대로 노출돼 있어, 자체
  크롤러로 수집하고 있음을 시사.
- `sgis`(통계청 지역통계)/`kapt`(K-apt 단지정보)/`aptTradePriceLst`
  (실거래가 구조화) 등 탱크옥션에 없는 완전히 별도 소스가 통합돼
  있음 — 탱크에서 받은 데이터라면 있을 이유가 없음.
- PDF/미디어 저장 방식(탱크: `tankauction.com/FILE/...` 자체 도메인,
  나이스: 자체 `mediaId` 미디어 시스템)과 필드 네이밍 체계
  (탱크: `dstbOpwr`/`leasInfo`, 나이스: `myungseDesc`/`sagunId`)가
  완전히 달라 공통 코드베이스/공급 관계로 보기 어려움.

상세: [docs/history/2026-07-30_02_courtauction-official-doc-links.md](./history/2026-07-30_02_courtauction-official-doc-links.md)
§5 참고.

## 追記 (2026-07-31) — 전환 계획 보류: 비로그인 12건 하드 리밋 확인

탱크옥션(로그인) → 나이스옥션(비로그인) 전환을 목표로 리스트 수집
(19,439건) → 기존 DB 매칭(3,453건) → 상세 파서(`nice_parsers.py`)까지
구축했으나, **비로그인 상태의 나이스옥션 상세 API(`/api/v1/obj/{objId}`)에
동일 IP·세션 기준 "12건 성공 후 13번째부터 하드 차단"되는 리밋이
있음을 다각도로 실측 확인**했다:

- httpx 순수 호출(딜레이 0.5초~10초 랜덤 다양하게 테스트) — 전부 12건
  에서 막힘(시간 간격과 무관, count 기반).
- httpx + 브라우저와 동일한 헤더(Referer/sec-ch-ua 등) — 동일하게 막힘.
- Selenium 실브라우저 100건 순차 접근 — **1차 테스트는 HTTP 상태 코드만
  확인해 "안 막힌다"고 오판**했으나, 응답 바디의 `code` 필드까지
  확인하도록 스크립트를 고쳐 재실행한 결과 **셀레니움도 정확히 13번째
  요청부터 `code: 9000`(에러) 응답**으로 막히는 것을 확인. 즉 브라우저
  실행 여부·쿠키(`na_session_auth_v2`) 보유 여부와 무관하게 IP 단위로
  걸리는 진짜 하드 리밋.
- 실브라우저 페이지의 프론트엔드 JS가 1차 실패 시 자동 재시도를
  시도하는 경우가 있어(2차 요청이 성공하면 HTTP 200만 보고 착시가
  생김), 검증 시 반드시 응답 바디의 `code` 값까지 확인해야 한다는
  교훈도 얻음.

**결론(사용자 확정, 2026-07-31)**: 이 리밋 때문에 나이스옥션 비로그인
방식으로는 3,453건 규모의 대량 상세 수집이 현실적으로 불가능 →
**탱크옥션을 메인 크롤 소스로 계속 유지하기로 결정, 나이스옥션 전환은
보류**. 지금까지 작성한 나이스옥션 관련 스크립트(`crawler/nice_client.py`,
`crawler/nice_parsers.py`, `crawler/nice_fetch_lists.py`,
`crawler/nice_match_our_db.py`, `crawler/nice_fetch_details*.py`)와
수집된 로컬 데이터(`crawler/nice_lists/`)는 코드는 삭제하지 않고
보류 상태로 남겨둔다(향후 나이스옥션이 로그인 방식 등으로 대량
접근을 허용하게 되면 재개 가능하도록).

참고로 탱크옥션에만 있고 나이스옥션엔 없는 데이터는 **미납관리비
(체납금액) 단 하나**로 재확인됐다(실제 DB 5건 샘플 대조,
2026-07-31) — owner/appraiser 등은 나이스옥션도 대응 필드가 있고,
naverPrice/education/실거래가/factTags 등은 애초에 탱크옥션이 아닌
우리 자체 enrichment 로직(네이버부동산·SGIS·국토부 실거래가 등)이라
크롤 소스와 무관하다.

## 7. 조사 중 확보한 로컬 산출물 (참고용, git 미포함)

`crawler/` 디렉토리에 조사 과정에서 생성된 임시 파일들(git에는
커밋하지 않음, 필요 시 재생성 가능):
- `nice_target_obj.json` / `nice_target_obj_nologin.json` — 표본
  물건 상세 API 응답 원본(로그인/비로그인 각각)
- `nice_sitemap_api.txt`, `nice_sitemap_p1.txt` — sitemap index 및
  1페이지 원본
- `kapt_full.json`, `housePrice_full.json` — 하위 구조 상세 원본

## 追記 (2026-08-06, 3차) — 제휴 확정, 재개 계획

사용자 확인: **나이스옥션과 제휴를 맺어서** 이용약관/대량 크롤링 허용
여부(§6 마지막 미해결 항목)는 더 이상 검토할 필요 없음. 남은 미해결
항목은 순수 기술 검증(장시간·대량 재현성, 물건유형별 편차)뿐이다.

### 지금까지 확인된 것 재정리 — "탱크옥션을 나이스옥션으로 완전히 대체 가능한가"

**결론(2026-07-26 원 조사 기준): 미납관리비 하나만 빼고 가능.**

- 151개 필드 대조 결과 감정가·최저가·소유자·채무자·등기부등본·매각물건
  명세서·배당요구·임차인현황 등 핵심 데이터는 전부 동등 확보 가능(§3.1).
- 오히려 나이스옥션이 더 풍부한 영역: 실거래가 구조화(`aptTradePriceLst`),
  지역 시세 통계(`aptTradeStaticSidoGu`/`Umd`), K-apt 단지정보(`kapt`,
  62필드, 관리사무소 전화번호 포함), 등기부 말소기준권리/인수여부/HUG
  판정을 나이스가 이미 구조화해서 제공(우리 텍스트 정규식 추정보다 신뢰도 높음).
- 유일한 공백은 **미납관리비(체납금액)** — 탱크옥션도 이건 API가 아니라
  직원이 관리사무소에 개별 문의해 수기 입력하는 자체 조사 데이터라
  (`arersInfo.items[].staff`/`wdt` 필드가 조사자·조사일자를 담고 있어
  확인됨), 나이스옥션 전환과 무관하게 어차피 완전 자동화가 안 되는 영역.
  나이스옥션도 `gwanribi` 필드 자체는 마련해뒀으나 표본에서 비어있었음
  (일반화하기엔 표본 부족, §3.2 — 다른 물건에서 채워진 사례가 있는지는
  여전히 미확인).
- 물건유형 커버리지는 아파트 1건·토지 1건만 확인됐고, 빌라·상가 등은
  미검증 상태(§6).

### 2026-07-31에 보류했던 이유(재확인)

기술적 커버리지가 아니라 **접근 제한**(비로그인 12건 하드 리밋)
때문에 보류했다 — 데이터 자체는 이미 그때도 충분하다고 판단했었음.

### 2026-08-06 새 발견으로 이 보류 사유가 흔들림

브라우저 헤더(UA/Referer/Sec-Fetch-*)를 갖추면 100건 연속 성공
(`code=0`, 응답 바디까지 확인) — 12건 리밋이 IP 절대 한도가 아니라
"브라우저처럼 안 보이는 요청" 필터였을 가능성.

### 다음 단계(사용자 승인, 순서대로)

1. **장시간·대량 재검증** — 100건이 아니라 500~1,000건, 시간 간격을 두고
   여러 세션에 걸쳐 재현되는지 확인(아직 미착수).
2. 통과 시 소규모 파일럿(최근 물건 100~200건, 탱크옥션과 필드 대조,
   빌라·상가·토지 등 물건유형 편차 확인).
3. 병행 운영 → 안정성 확인 후 나이스옥션 메인 전환, 탱크옥션은
   미납관리비 보조 수단으로만 유지.
4. ~~이용약관/제휴 조건 검토~~ — 제휴 완료로 해소(2026-08-06).
