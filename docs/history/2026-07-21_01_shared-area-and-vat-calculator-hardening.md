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

## 인프라 이슈(참고)

- Railway 배포가 "Deployment queued due to upstream GitHub issues"로 20분 가까이 멈춘 사례
  발생(GitHub 자체 일시 장애). `railway redeploy --from-source -y`로 수동 재배포하면 해결.

## 관련 결정

- 사용자 요청: "경로 자체를 화이트리스트하지 말고 admin 계정 예외만 유지" — 넓은 경로
  화이트리스트는 로그인 없는 진짜 공격도 놓칠 위험이 있어 배제(별도 문서:
  `2026-07-16_02_security-log-detection.md` 참고, 이번 세션에서 admin 예외 추가는 그 문서에
  追記 예정).
