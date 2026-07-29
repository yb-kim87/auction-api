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

## 追記 — 복합 dstbId(임차권 양도) 케이스 추가 수정

실제 2025타경8596을 재크롤링해 검증하던 중, 1차 수정(`dstbId="leas-
{idx}"` 문자열 조합으로 매칭)이 **임차권 양도가 있는 사건**에서는
동작하지 않는 걸 발견했다. 이 사건의 overlay는 다음처럼 `dstbId`가
콜론으로 여러 leas row를 합친 복합 키였다:

```json
{ "dstbId": "leas-2688769:leas-2685675",
  "sourceRefs": [{ "type": "leas", "idx": 2688769, "assignmentRole": "successor" }],
  "opwr": "인수조건변경", "analyLines": ["순위배당 있음"] }
```

`"leas-2688769"` 문자열은 이 dstbId와 정확히 일치하지 않아 매칭
실패 → 2명의 임차인 중 승계인(양수인) 쪽만 채워지고, 원 임차인
(주택도시보증공사) 쪽은 여전히 빈 값으로 남았다.

**최종 수정**: dstbId 문자열이 아니라 overlay의 `sourceRefs[].idx`로
매칭하도록 변경(`_build_dstb_leas_overlay_map`이 이제 `dict[int, dict]`
를 반환, 키는 dstbId가 아니라 leas row의 idx). dstbId 문자열 형태가
단순/복합 어느 쪽이든 항상 정확히 매칭된다.

## 검증 (최종)
2025타경8596(tid=2378382)을 실제로 재크롤링해 확인 — 두 임차인 모두
탱크옥션 원본 화면과 정확히 일치:
- 주택도시보증공사: 대항력 "인수조건변경", 분석 "순위배당 있음"
- 주택도시보증공사(최윤정의 승계인): 대항력 "없음", 분석 "임차권
  양도인(양수인 주○○○○○○○)"

## 追記 (2026-07-30) — 전체 백필(2833건) 실행

사용자가 "백필 진행해줘"라고 요청, 대상은 `status='approved'`이면서
`tenantDetail`에 "임차인:" 항목은 있는데 "대항력:" 줄이 아예 없는
2833건(운영 DB 직접 카운트로 확인, 거의 전수).

처음엔 기존 `crawl_one_item_full_httpx`(상세+네이버 시세 전부 조회)를
그대로 재사용해 백필 스크립트를 만들었는데, 사용자가 "네이버 시세
조회는 왜 하는거야?"라고 지적 — 이번 백필은 임차인 정보만 갱신하면
되는데 불필요하게 네이버 API까지 매번 호출하고 있었음(120/2833건
진행 시점에 발견). 원인은 단순히 기존 "전체 크롤" 함수를 그대로
재사용했기 때문 — 임차인만 갱신하는 좁은 함수가 없었음.

진행 중이던 백필을 중단하고, `crawl_one_item_detail_only_httpx`
(네이버 조회 생략, 상세만 조회)를 `full_httpx_worker.py`에 신설해
재시작. `auction-builder.ts`의 병합 로직이 `preserveExistingIfEmpty`
로 동작해 네이버 관련 필드가 비어 있으면 기존 값을 그대로 보존하는
걸 코드로 확인한 뒤 적용 — 네이버 시세 데이터가 실수로 지워질
위험 없음. 속도는 초당 약 1.3건(20건/15초)으로, 기존 대비 수 배
빨라짐(전체 2833건 약 30~40분 예상).

## 다음 단계
백필 진행 상황은 `crawler/tenant_backfill_stdout.log`(진행률)/
`crawler/tenant_backfill_log.jsonl`(건별 상세 로그)에 기록됨. 완료
후 운영 DB에서 대항력/분석 필드가 실제로 갱신됐는지 표본 확인
필요.
