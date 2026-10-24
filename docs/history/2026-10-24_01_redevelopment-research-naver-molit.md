# 재개발 구역 매물 조사 — 네이버 매매 매물(samsam 방식) + 국토부 빌라 실거래(최근 1년)

날짜: 2026-10-24

## 배경 / 요청

"대림동 680 매물 분석" 엑셀처럼, 관심(★) 경매물건이 속한 **같은 재개발 구역 안**의 ①네이버 매매 호가
②국토부 실거래를 자동으로 모아 공시가 → 전세가(공시가 × 126%) → 호가/실매도 대비 갭까지 한 표로 보고 싶다.

사용자 지시(요약):
1. 네이버 구조는 **samsam 프로젝트를 최대한 그대로** 따라 만들 것 (samsam에서 잘 운영 중이므로). 앞으로도 이 규칙 유지.
2. **서버(Railway, auction-api)에서** 진행.
3. 같은 재개발 구역 안 매물은 **전부** 가져오고 **정보도 전부** 수집.
4. 실거래는 **최근 1년**만, 정보도 전부 수집.

## 구성 (`src/redevelopment-research/`)

| 파일 | 역할 |
|---|---|
| `naver-land.service.ts` | samsam `naver-land.service.ts` 이식. curl_cffi 브릿지(`scripts/naver_curl_bridge.py`, samsam 파일을 그대로 복사), 토큰 워밍업, 직렬 큐 + **3.5~5.5초 랜덤 간격**, 429 처리(15초 대기 1회), 동 코드(`/api/cortars`), 동 단위 빌라 목록(`/api/articles`, `realEstateType=VL`(빌라만), 매매 `A1`), 매물 상세(`/api/articles/{no}`: 주소·방 수·관리비·입주일·소개글·사진 등). 응답 원본(raw)은 저장 |
| `kakao-geocode.service.ts` | 서버에서 카카오 로컬 API(`KAKAO_REST_API_KEY`, 로그인에 이미 쓰는 키)로 지번 → 좌표, 좌표 → 법정동/지번. Railway는 VWorld에 못 붙어서(기존 문서 참고) 카카오를 쓴다. 확정된 결과는 `address_geocode_cache`에 캐시 |
| `redevelopment-research.service.ts` | 조사 오케스트레이션 + 결과 조회 + 공시가 추정 |
| `redevelopment-research.controller.ts` | `POST /redevelopment-research/auctions/:id/start`, `GET /redevelopment-research/auctions/:id?toleranceM=`, `GET /redevelopment-research/zones/:id/status` (관리자 전용) |
| `entities/*` + 마이그레이션 `1784301000000` | `redevelopment_naver_listings`, `redevelopment_trades`, `redevelopment_research_runs`, `address_geocode_cache` |

## 동작

1. 경매물건 좌표 → 가장 가까운 재개발 구역(경계 오차 포함, 같은 구) 결정.
2. 구역 경계 샘플 점이 걸치는 법정동을 카카오로 확인(구역이 두 동에 걸칠 수 있음 — 예: 대림동 680 = 대림동+신길동).
3. **실거래**: 국토부 연립다세대 API(`MolitTradeClientService.fetchVillaTrades`)로 최근 12개월 × 시군구 → 해당 동만 → 지번별 카카오 좌표 → 구역 경계 거리 ≤ 100m만 저장(해제 거래는 `isCancelled`로 표시, 원본은 `rawJson`).
4. **네이버**: 동 코드별 목록 페이지(최대 30쪽) → 매물 좌표로 구역 경계 거리 ≤ 100m만 저장(목록 원본 `rawListJson`). 이어서 가까운 순으로 **상세 최대 40건/회**(`naverDetailRemaining`이 남으면 같은 버튼 "이어서 수집"). 상세 3회 연속 실패 시 중단(차단 의심).
5. 화면의 경계 오차범위(0~100m)는 **저장된 원본을 다시 거르기만** 한다(네이버 재호출 없음).
6. **공시가**: `housing_official_price`에서 법정동코드+본번/부번(4자리·비패딩 모두) → 호수 일치 > 층+면적(±0.6㎡) > 면적 순으로 추정. 근거를 화면에 표시.

## samsam 규칙 준수 (네이버 rate-limit)

- 모든 호출은 직렬 큐 + 랜덤 간격, 장시간 규칙적 패턴 회피를 위해 **1회 실행 상세 40건 상한**.
- 한 번 가져온 원본 저장 → 재필터. 오차범위 변경·화면 열기는 네이버를 호출하지 않는다.
- 수집 완료된 실행에서만 `missCount` 증가(실패한 실행이 정상 매물을 "사라짐"으로 만들지 않음).
- 진행 로그/상태(`redevelopment_research_runs.phase`)를 남긴다. 재배포로 끊겨도 자동 재개하지 않는다.
- 동시에 한 구역만 조사.
- 로컬 시험용으로만 `REDEV_RESEARCH_MAX_LIST_PAGES`, `REDEV_RESEARCH_DETAIL_LIMIT` 환경변수로 상한을 더 낮출 수 있다(운영은 기본값).

## 검증

- tsc 통과, Nest DI 부팅 확인(sqljs), 흐름 시험(sqljs): 구역→동 판별(대림동+신길동), 경계 거리 필터(먼 매물/지번 제외), 해제 거래 표시, 공시가 추정(대림동 680-6 503호 = 21,500만원, 엑셀 값과 일치).
- **네이버 실응답 확인(2026-10-24, 총 7건 호출: 토큰 1·동 코드 1·목록 2·상세 3)**: 이식 코드가 토큰 워밍업 → 동 코드(대림동 `1156013300`, 카카오 b_code와 동일) → 빌라 매매 목록(20건/쪽, `isMoreData`) → 상세까지 정상 동작. 확인된 실제 구조와 그에 맞춰 고친 점:
  - 목록: 20건 모두 `latitude/longitude`(문자열), `tagList`(방 수·연식 배지), `floorInfo`("중/7"처럼 숫자가 아닐 수 있음), 면적 `area1/area2`는 **정수로 반올림**. 한 동 목록에 단독/다가구(11)와 빌라(9)가 섞여 나옴 → 화면에 유형 필터 추가.
  - 상세: `articleDetail.pnu`(19자리 = 법정동코드10+대지구분1+본번4+부번4)로 지번/법정동코드를 정확히 얻음(카카오 역변환보다 우선), `exposureAddress`는 빌라는 지번까지·단독/다가구는 동까지, `roomCount/bathroomCount/householdCount/parkingCount`, **사용승인일은 `articleFacility.buildingUseAprvYmd`**(기존 코드는 `articleDetail`만 봐서 항상 null이었음 → 수정, 준공연도는 앞 4자리), **정확한 면적은 `articleSpace.exclusiveSpace/supplySpace`**(공시가 면적 매칭에 사용), **현 전세 보증금은 `articlePrice.allWarrantPrice`**(매물 설명의 "갭 1.3억"과 일치 → 실제 갭 계산에 사용). 마이그레이션 `1784302000000`으로 컬럼 8개 추가.
  - 저장해 둔 실제 응답으로 파서 재검증(네이버 재호출 없음): 사용승인일→준공연도, 면적, PNU, 전세보증금, 사진 URL, 입주일 모두 정상.
- **국토부**: 시험 시점에 12개월 모두 429(키 호출 한도 소진 추정, 부가세 계산기·매도분석과 키 공유)라 실응답 대신 모의 응답으로 로직만 검증했다. 서버에서 한도 오류가 나면 "일부 개월 실패"로 표시하고 다시 실행하면 보충된다(2개월 연속 429면 나머지는 시도하지 않고 중단).

## 수집 범위 변경(2026-10-24, 사용자 요청: "기본 수집 범위를 빌라만으로")

- 네이버: samsam은 `VL:DDDGG`(빌라+단독/다가구)를 받지만 이 기능은 `VL`만 요청한다. 실제 호출 1건으로 20/20건 모두 `VL:빌라`로 확인. 응답에 다른 유형이 섞여도 저장하지 않도록 `realEstateTypeCode`로 한 번 더 거른다. (이 동 `VL:DDDGG` 목록은 20건 중 단독/다가구가 11건이라 호출·저장량도 줄어든다.)
- 국토부: 연립다세대(RH)만 수집 중이라 변경 없음(빌라 = 연립·다세대·도시형생활주택).

## 알려진 한계

- 실거래는 연립다세대(RH)만. 단독/다가구·오피스텔은 포함하지 않음.
- 실거래에는 호수가 없어 공시가는 면적·층 기반 추정(호수 일치는 경매물건 본인 한정).
- 방 수는 네이버에만 있음(국토부 없음).
- 구역이 여러 개 겹치면 가장 가까운 한 구역만 조사.
