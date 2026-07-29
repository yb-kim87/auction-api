# 2026-07-29_04 임차인 대항력/분석 필드 항상 비어있던 버그 수정

날짜: 2026-07-29
관련 레포: auction-api (crawler)

## 문제
사용자가 2025타경8596 물건 상세의 "임차인·점유 현황" 표에서 대항력/분석
컬럼이 항상 "-"로 비어있는데, 탱크옥션 원본 화면에는 "인수조건변경"
배지, "주의 순위배당 있음", "임차권 양도인" 등 값이 채워져 있는 걸
발견하고 왜 크롤링이 안 됐는지 질문.

## 원인
`crawler/tank_detail.py`의 `_lease_item_to_row()`가 대항력/분석을
`leasInfo.items[]`의 각 임차인 항목 **내부**에서 `dstbOpwr`/`opwr`/
`dstbAnaly`/`analy` 등의 키로 찾고 있었는데, 실제 탱크옥션 API 응답
샘플(`crawler/samples/tank_auctview_sample.json`)을 직접 뜯어본 결과
이 값들은 그 안에 없고, 완전히 별도의 최상위 필드인
**`dstbInfo.dstbLeas.leasStatusOverlays[]`**에 `dstbId`
(`"leas-" + 원본 임차인행의 idx`) 기준으로 매칭해서 찾아야 하는
구조였다:

```json
{
  "dstbId": "leas-2565889",
  "opwr": "있음",
  "analyLines": ["미배당 보증금 매수인 인수", "순위배당 있음"]
}
```

기존 파서는 이 필드를 전혀 참조하지 않아서, 어떤 물건이든 대항력/
분석이 항상 빈 문자열/빈 배열로만 채워지고 있었다.

## 수정
`_build_dstb_leas_overlay_map(detail)` 신규 — `dstbId → overlay` 맵을
만든다. `_lease_item_to_row()`에서 각 임차인 항목의 `dstbId`
(`_leas_dstb_id()`로 `rawRow.idx`에서 계산)로 이 맵을 조회해
`opwr`(대항력)/`analyLines`(분석, 이미 줄 단위 배열)를 채우도록 수정.
overlay가 없는 경우(예: 과거 크롤링 스냅샷 등)를 대비해 기존
item-내부 필드 탐색을 폴백으로 유지.

Selenium(v1, `item_crawl.py`)과 httpx(v3, `full_httpx_worker.py`)
양쪽 다 `tank_detail.py`의 `collect_lease_status()` → 
`_parse_lease_status_rows_from_detail()`를 공유해서 쓰므로, 이
파일 하나만 고치면 두 크롤링 경로 모두에 반영된다.

## 검증
`samples/tank_auctview_sample.json`(2341347 사례)로 직접 파싱 실행해
확인:
```
"opposability": "있음",
"analysis": ["미배당 보증금 매수인 인수", "순위배당 있음"]
```
수정 전에는 두 필드 모두 항상 빈 값이었음.

## 다음 단계
기존에 이미 크롤링된 물건들은 이 필드가 비어있는 채로 저장돼 있으므로,
필요하면 재크롤링/백필이 필요하다(이번 세션에서는 미실행 — 사용자
요청 시 진행).
