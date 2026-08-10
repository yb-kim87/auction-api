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
