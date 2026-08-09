# 물건 상세: 관리자용 "호가 업데이트" 버튼

## 배경
사용자 요청(2026-08-09): "아파트/오피스텔에서 호가를 가져오는데 관리자만
누를 수 있는 N단지정보 옆에 호가업데이트 버튼을 하나 만들어줘. 버튼 기능은
해당 물건에 대한 호가 크롤링을 다시해서 최신정보로 호가를 업데이트해서
물건 가져올때처럼 로직에 적용시켜주면돼".

이 대화 앞부분에서 확인한 내용: 아파트/오피스텔의 호가(네이버 부동산
매물가)는 크롤러가 `isNaverCollectTarget()`(아파트/오피스텔만 대상,
[crawler-url.util.ts](../../src/crawler/crawler-url.util.ts))에 따라
수집하고, 실거래가와는 별개로 국토부 API가 아닌 네이버 부동산 크롤링에서
가져온다.

## 구현
백엔드 변경 없이 기존 `/crawler/start`(POST, `StartCrawlDto.urls` 지원)를
그대로 재사용했다 — 물건을 처음 수집할 때와 동일한 파이프라인(층수 매칭,
`selectFloorAwareNaverPrice` 등)을 그대로 타게 하기 위해 별도의 경량
API를 새로 만들지 않았다.

- `auction/src/lib/api.ts`: `crawlerStart()`에 `urls?: string[]` 파라미터
  추가(기존엔 전체 조회만 가능했음).
- `auction/src/components/AuctionDetailModal.tsx`: "주변 매물 호가" 라벨
  옆 N단지정보 배지 옆에 관리자 전용(`isAdmin`) "호가 업데이트" 버튼
  추가. 클릭 시:
  1. `crawlerStart({ urls: [preview.link], crawlerVersion: "v3" })` 호출
     (이 물건 링크 하나만 재크롤링).
  2. `/crawler/status`를 2초 간격으로 폴링해 `phase`가
     crawling/starting/collecting을 벗어날 때까지(최대 60초) 대기.
  3. `fetchAuctionsByIds([item.id])`로 최신 데이터를 다시 불러와 폼과
     화면에 반영(`onSaved` 콜백으로 부모 목록도 갱신).
  - v3 크롤러는 Railway 서버 컨테이너 안에서 Node(`ensureWorker()`)가
    Python 워커(`runner.py serve`, `PYTHON_PATH=/opt/venv-v3/bin/python`)를
    직접 spawn해서 실행한다 — `CRAWLER_WORKER_URL`이 설정돼 있지 않아
    `isRemoteWorkerMode()`가 false이므로, 관리자 PC를 켜둘 필요 없이
    서버가 알아서 워커를 띄운다(사용자 확인, 2026-08-09: "우리 크롤러
    워커 알아서 되게 했었잖아 — 내가 켜고 끄고 개념이 아니었잖아"). PC
    실행이 필요한 건 브라우저(Selenium) 기반 v1 경로뿐이다.

## 검증
프론트엔드 `npx tsc --noEmit` 통과. 백엔드는 변경 없음(기존 API 재사용).
