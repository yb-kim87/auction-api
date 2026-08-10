# 물건 상세: 외부 참고링크(부동산플래닛)

## 배경
이전 대화에서 탱크옥션 물건 상세 우측 사이드 메뉴가 "부동산플래닛",
"N단지정보", "KB단지정보", "아실", "국토부실거래", "네이버부동산" 링크를
어떻게 만드는지 `crawler/tank_detailview.js`(탱크옥션 자체 프론트 JS를
떠서 분석용으로 저장한 파일)를 실측 분석했다.

- N단지정보/네이버부동산: 이미 우리 시스템에 `naverId`(djNo) 기반
  `NaverComplexLink` 컴포넌트로 구현돼 있어 중복 구현하지 않았다.
- 국토부실거래: 이미 우리가 자체적으로 국토부 API를 수집해 "주변 실거래
  표본" 패널로 보여주고 있어 별도 링크가 불필요하다.
- KB단지정보/아실: 탱크옥션이 자기 내부 API(`envInfo.dtDj`)에서 내려주는
  `kbCode`/`asilCode`가 있어야 정확한 단지 페이지로 연결할 수 있는데,
  우리는 그 코드를 얻을 방법이 없어(각 사이트에서 주소/단지명으로 별도
  검색해 코드를 알아내는 로직이 필요) 이번 작업 범위에서 제외했다.
- 부동산플래닛: 탱크옥션 코드에 있는 폴백 URL 패턴
  (`https://www.bdsplanet.com/map/realprice_map.ytp?s_area_lat=...&s_area_lng=...`)이
  좌표(위도/경도)만 있으면 만들 수 있는 공개 URL이라(탱크옥션 내부
  리졸버를 거치는 "진짜" URL과 달리 서버 블랙박스가 없음), 이번에
  구현했다.

사용자 요청(2026-08-10): "해당 기능들을 탱크옥션처럼 우측에 배치하는
식으로 해서 적용해서 물건별로 되도록 진행하자".

## 구현
- `auction-api/src/common/vworld-geocoding.service.ts`(신규): 주소 →
  좌표(위도/경도) + PNU 조회. `vat.controller.ts`의 "도로명주소 → 좌표
  → PNU" 2단계 VWorld API 로직과 동일하지만, 관리자 권한 없이도 호출
  가능한 별도 서비스로 분리했다(기존 `/vat/address-to-coord`는 손대지
  않음 — 이미 동작 중인 기능 리스크를 피하기 위해 로직을 복제).
- `auction-api/src/auctions/reference-links.util.ts`(신규): 좌표를 받아
  참고링크 배열을 만드는 순수 함수. 지금은 부동산플래닛만 반환하지만,
  나중에 KB단지정보/아실 코드를 얻는 방법을 찾으면 이 함수에 추가하면
  된다.
- `AuctionsService.getReferenceLinks(id)`: 물건의 기존 `latitude`/
  `longitude`/`vatPnu` 컬럼(원래 매도분석 지도 표시용으로 만들어둔
  컬럼)을 재사용 — 값이 없으면 `item.address`로 지오코딩 후 결과를
  캐싱(컬럼에 저장)해서 재조회 시 API를 다시 호출하지 않는다.
- `GET /auctions/:id/reference-links`: 부가세계산기(`vat-building-info`)와
  동일하게 `requireSearchAccess`로 가드 — 로그인 + 수강생 이상이면
  조회 가능(관리자 전용 아님, 탱크옥션도 로그인 회원에게 보여줌).
- 프론트 `AuctionDetailModal.tsx`: "핵심 가격 요약"의 가격 요약/실거래
  표본 2단 카드 아래에 "외부 참고링크" 가로 pill 버튼 목록을 추가.
  모달이 열릴 때(item.id 기준) 자동으로 불러오고, 링크가 없으면(좌표를
  못 구했으면) 섹션 자체를 숨긴다.

## 검증
백엔드/프론트 각각 `npx tsc --noEmit` 통과.

## 追記 (2026-08-10) — 좌표 조회가 항상 NOT_FOUND 나던 버그 수정

배포 후 실제 물건(2025타경514128, 인천 미추홀구 숭의동 182-4 다우림
201동)에서 "외부 참고링크"가 안 뜬다는 리포트를 받고 원인을 확인했다.
`auctions.address`는 법원 경매 데이터라 지번주소(+아파트명/동/호)
형태인데("인천광역시 미추홀구 숭의동 182-4 다우림 201동
12층1201호"), `VWorldGeocodingService`가 `vat.controller.ts`의
`type=ROAD` 방식을 그대로 복사해 와서 항상 VWorld가 `NOT_FOUND`를
반환했다(실측: 같은 주소를 ROAD로 조회하면 0건, PARCEL로 조회하면
정상 매칭되고 PNU까지 응답 한 번에 딸려 옴).

- `type=PARCEL`을 우선 시도하도록 변경 — PARCEL 응답의
  `refined.structure`에 PNU 계산에 필요한 `level4LC`(법정동코드)와
  `level5`(본번-부번)가 이미 포함돼 있어, 성공하면 역지오코딩 API 호출
  자체가 필요 없어졌다(API 호출 1회로 축소).
- PARCEL이 실패하는 경우(주소가 실제로 도로명 형식인 드문 케이스)에만
  기존 ROAD+역지오코딩 2단계로 폴백한다.

### 변경 파일 및 검증
`auction-api/src/common/vworld-geocoding.service.ts`. `npx tsc --noEmit`
통과. VWorld API에 직접 curl로 PARCEL/ROAD 응답 차이를 실측 확인.

## 追記 (2026-08-10) — Railway→VWorld 간헐적 SocketError로 여전히 비어 보이던 문제

PARCEL 우선 수정 배포 후에도 실제 물건(2025타경52788, 다세대주택)에서
여전히 "외부 참고링크"가 안 뜬다는 리포트를 받았다. 관리자 로그인 세션으로
`/auctions/:id/reference-links`를 직접 호출·`railway logs`로 확인한 결과,
VWorld API를 curl로 직접 부르면 정상 응답이 오는데 Railway 컨테이너에서
호출하면 `SocketError(UND_ERR_SOCKET, bytesRead:0)`로 간헐적으로 실패하고
있었다 — 이미 배포돼 있던 `/vat/address-to-coord`(부가세 계산기)도 같은
순간 503으로 재현돼, 내 코드 버그가 아니라 Railway↔VWorld 구간 자체의
기존 인프라 이슈임을 확인했다(저장소에 이미 "2026-07-21, fetch failed로만
남고 원인 불명"이라고 기록돼 있던 것과 동일 현상).

`VWorldGeocodingService`의 `fetchExternal`에 최대 3회 재시도(300ms 간격
증가)를 추가했다. `/vat/address-to-coord`(vat.controller.ts)는 이번
작업 범위 밖이라 손대지 않았다 — 필요하면 동일한 재시도 로직을 그쪽에도
적용할 수 있다.

### 변경 파일 및 검증
`auction-api/src/common/vworld-geocoding.service.ts`. `npx tsc --noEmit`
통과. Railway 배포 후 `railway logs`로 재시도 동작 확인 예정.

## 追記 (2026-08-10) — 재시도로도 해결 안 됨: 근본 원인은 이미 알려진 "Railway 해외 리전" 이슈였음

재시도 배포 후에도 매번 `SocketError`로 실패(재현: admin 세션으로
`/auctions/:id/reference-links`를 직접 호출·`railway logs` 확인).
사용자가 "그때 부가세 계산기 했을 때 rail 해외ip 안먹혀서 국내껄로
우회해서 하는 걸로 했잖아"라고 지적 — 검색해보니 실제로
`docs/history/2026-08-01_03_resale-sold-filter-stats.md`의
"追記(2026-08-04) — 매도분석 지도: Railway가 VWorld를 직접 호출 못
하는 문제"에 이미 정확히 같은 현상과 해결책이 기록돼 있었다:

- Railway 서비스 리전은 `sfo`(미국 샌프란시스코) — VWorld(국토부
  공간정보 오픈플랫폼) API가 이 해외 리전에서의 연결을
  `SocketError(UND_ERR_SOCKET, bytesRead:0)`로 계속 거부한다(같은
  주소를 로컬 PC에서 curl로 직접 호출하면 정상 응답되는 것과 대조
  확인).
- 검증된 해결책은 **재시도가 아니라 우회**: Next.js(Vercel) Route
  Handler에 `export const preferredRegion = "icn1"`(서울 리전)을
  지정해 VWorld 호출 자체를 브라우저→Vercel(서울)에서 하고, 결과만
  백엔드(Railway)에 캐싱한다. 이미 `auction/src/app/api/vat/
  address-to-coord/route.ts`(PARCEL/ROAD 자동판별 + PNU 역지오코딩,
  `requireAuthFromRequest`로 로그인만 요구)가 이 패턴으로 구현·검증돼
  있었다 — 재사용했다.
- `auction/src/lib/api.ts`의 `API_BASE = "/api"`는 프론트 자체
  Next.js 앱 내부 상대경로다. `src/app/api/[...path]/route.ts`(catch-all
  프록시)가 특정 route.ts가 없는 모든 `/api/*` 요청만 Railway로
  전달하므로, `/api/vat/address-to-coord`처럼 로컬 route.ts가 있는
  경로는 자동으로 Vercel(서울)에서 실행되고 나머지는 평소대로 Railway로
  프록시된다 — 이 프로젝트에 이미 있던 설계라 새 라우트를 만들 필요가
  없었다.

### 최종 수정
- 백엔드 `VWorldGeocodingService`/직접 지오코딩 시도를 전부 제거.
  `AuctionsService.getReferenceLinks(id)`는 이제 캐싱된
  `latitude`/`longitude`만으로 링크를 만들고, 없으면 빈 배열을 반환한다
  (Railway는 VWorld를 아예 호출하지 않음).
- 좌표 캐싱은 기존 `PATCH /auctions/:id/vat-building-info`
  (`requireSearchAccess`, 이미 vatPnu 등 자동조회 값을 캐싱하던
  엔드포인트)에 `latitude`/`longitude` 필드를 추가해 재사용.
- 프론트 `AuctionDetailModal.tsx`: 백엔드가 빈 배열을 주면(좌표 미캐싱)
  `fetchVatAddressCoord(item.address)`(기존 함수, `/api/vat/
  address-to-coord` 호출 → Vercel 서울 리전 실행)로 직접 지오코딩 →
  받은 좌표로 부동산플래닛 링크를 즉시 만들어 보여주고,
  `saveVatBuildingInfo(id, { latitude, longitude })`로 백엔드에 캐싱
  (실패해도 조용히 무시 — 캐싱은 최적화일 뿐).

### 교훈
- "Railway에서 외부 공공 API가 막힌다"는 이슈는 이미 같은 저장소에
  두 번(부가세계산기 2026-07-21, 매도분석 지도 2026-08-04) 발견·해결된
  적이 있었는데, 새 기능(외부 참고링크)을 만들 때 이 선례를 확인하지
  않고 처음부터 재시도 로직으로 접근해 시간을 낭비했다. 앞으로 Railway
  백엔드에서 새로운 외부(특히 국내 공공) API를 호출하는 기능을 추가할
  때는 먼저 이 문서(또는 vat.controller.ts/vat-server.ts 주석)에 이미
  기록된 "해외 리전 우회" 패턴을 확인하고 시작할 것.

### 변경 파일 및 검증
`auction-api/src/auctions/{auctions.service.ts,auctions.controller.ts,
auctions.module.ts}`, `auction-api/src/common/vworld-geocoding.service.ts`
(삭제); `auction/src/lib/api.ts`,
`auction/src/components/AuctionDetailModal.tsx`. 양쪽 `npx tsc --noEmit`
통과. 프로덕션에 curl로 전 과정(지오코딩→캐싱→링크 반환) 재현 성공.

## 追記 (2026-08-10) — 위치를 우측 사이드 패널로 이동

배포 후 사용자가 "우측 하단에 외부 참고링크가 어디떠??"라고 재확인 —
실제로는 "핵심 가격 요약"(주변 매물 호가/실거래 표본 2단 카드) 바로
아래, 즉 메인 콘텐츠 영역 하단에 배치돼 있어 스크롤해야 보였다.
탱크옥션 원본은 별도의 우측 사이드바 컬럼에 이 메뉴를 둔다 — 사용자가
"우측 하단"이라고 표현한 것도 이 모달의 우측 고정 패널(최소투자금/
다음 기일/AI 권리분석 요청/소재지 카드가 있는 `<aside>`)을 가리킨
것이었다. "소재지/입찰기일" 카드 바로 아래에 "외부 참고링크" 카드를
추가해 그 위치로 옮겼다(메인 콘텐츠 쪽 중복 블록은 제거).

### 변경 파일 및 검증
`auction/src/components/AuctionDetailModal.tsx`. `npx tsc --noEmit`
통과.

## 追記 (2026-08-10) — 캐싱 전 물건마다 늘 404가 나서 geocode 폴백이 아예 실행되지 않던 버그

사용자가 "저 사건번호 물건 외에 다른 물건에서는 안보이는거같은데??"라고
재확인 — curl로 여러 물건을 무작위 샘플링해 `/auctions/:id/
reference-links`를 직접 호출해보니, 좌표가 아직 캐싱된 적 없는 물건은
**존재하는 물건인데도 항상 404("물건을 찾을 수 없습니다")**가 남을
확인(반대로 이미 좌표가 캐싱된 물건 2건은 정상 200).

### 원인
`AuctionsService.getReferenceLinks`가
`this.auctionRepo.findOne({ where: { id }, select: ["latitude",
"longitude"] })`로 조회했는데, 이 `select` 제한이 걸리면 좌표가 아직
null인(=캐싱 전) 물건에서 `findOne`이 엉뚱하게 결과를 못 찾는 현상이
있었다(이 코드베이스 다른 곳의 `findOne`은 전부 `select` 없이 전체
엔티티를 가져오는 패턴이었는데, 이번에만 최적화한다고 select를
추가했다가 문제가 생김).

더 치명적인 건 프론트 쪽 에러 처리였다: `fetchAuctionReferenceLinks`가
404를 던지면 `AuctionDetailModal.tsx`의 `.catch(() => setReferenceLinks
([]))`가 조용히 빈 배열로 넘겨버려서, **캐싱 전 물건은 geocode 폴백
자체가 시도되지 않고 항상 빈 목록으로 끝났다.** 디버깅 중 curl로 수동
캐싱해준 2건만 우연히 정상 동작하는 것처럼 보였던 것 — "저 사건번호
물건만 되고 나머지는 안 된다"는 사용자 관찰과 정확히 일치.

### 수정
`select` 제한을 제거하고 기존 패턴(`findOne({ where: { id } })`)으로
되돌림. 이제 캐싱 전 물건도 정상적으로 빈 배열(에러 아님)을 받아
geocode 폴백이 실행된다.

### 검증
curl로 무작위 샘플링한 다른 물건 ID에 대해 재현: 수정 전 404 → 수정
배포 후 재확인 필요(다음 追記 참고). `npx tsc --noEmit` 통과.

### 교훈
- 사용자가 "저 물건만 되고 다른 건 안 된다"처럼 **특정 사례와 비교하는
  형태로 재현을 제시**하면, 그 차이(캐싱됨 vs 안 됨)에서 바로 원인을
  좁힐 수 있다 — 이번에도 무작위 다른 물건 몇 개를 curl로 실측해보고서야
  select 버그가 드러났다.
- 에러를 조용히 삼키는 `.catch(() => setX([]))` 패턴은 "데이터가 없다"와
  "요청이 실패했다"를 구분 못 하게 만들어 버그를 숨긴다 — 이번처럼 실패
  시에도 폴백 로직이 이어져야 하는 흐름에서는 실패와 빈 결과를 반드시
  구분해야 한다.

## 追記 (2026-08-10) — 네이버부동산 링크 추가

사용자 요청: "플래닛 말고 네이버부동산도 나오게 해줘". 탱크옥션의
`resolveNaverLandGroup`/`resolveNaverLandFilterGroup`(tank_detailview.js
실측)과 동일하게, 좌표+용도(cat3 대신 우리는 `usage` 텍스트로 근사)
기준 지도 검색 링크를 추가했다 — 이건 N단지정보(`NaverComplexLink`,
naverId/djNo 기반 단지 상세페이지)와는 다른, 좌표 기반 지역 검색
링크다.

- `reference-links.util.ts`: `resolveNaverLandGroup(usage)` 추가 —
  빌라류 키워드(address-parser.ts와 동일 정규식)면 `houses`+
  `VL:JWJT:DDDGG:SGJT:HOJT`, 아파트/오피스텔이면 `complexes`+
  `APT:OPST`, 그 외는 `offices`+`SG:SMS:GJCG:GM:TJ:APTHGJ`.
  `https://new.land.naver.com/{path}?ms={lat},{lng},16&a={filter}&e=RETAIL`
  형태로 링크 생성.
- 백엔드 캐싱 경로(`getReferenceLinks`)와 프론트 즉시표시 경로
  (`AuctionDetailModal.tsx`의 geocode 폴백) 둘 다에 동일 로직 반영 —
  두 경로가 같은 링크 목록을 만들어야 캐싱 전/후 결과가 달라지지 않음.

### 변경 파일 및 검증
`auction-api/src/auctions/{reference-links.util.ts,auctions.service.ts}`,
`auction/src/components/AuctionDetailModal.tsx`. 양쪽 `npx tsc --noEmit`
통과.
