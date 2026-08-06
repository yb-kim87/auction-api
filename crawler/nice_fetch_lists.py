"""나이스옥션 비로그인 검색 API(/api/v1/search/advanced/offset)로
아파트/연립주택/다세대주택/오피스텔/도시형생활주택 5개 용도의 "진행중"
물건 목록을 전량 확보해 로컬 JSON으로 저장한다.

이 단계는 물건별 상세 호출(/api/v1/obj/{objId})을 전혀 하지 않는다 —
목록 응답 자체에 objId/courtCd/csNo/주소/감정가/최저가 등 기본 정보가
이미 포함돼 있어, 페이지네이션만으로 충분하다(2026-07-30 실측 확인,
docs/history 참고).

pageSize는 100이 최대(그 이상 요청해도 100건만 반환됨, 실측 확인).
"""

from __future__ import annotations

import asyncio
import io
import json
import sys
from pathlib import Path

from nice_client import make_client

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

OUT_DIR = Path(__file__).resolve().parent / "nice_lists"

YONGDO_CODES = {
    "2020104": "아파트",
    "2020105": "연립주택",
    "2020106": "다세대주택",
    "2020110": "오피스텔",
    "2020114": "도시형생활주택",
}

# objProgStatusCd 전체 코드(2026-07-30, /api/v1/code/list 확인):
#   9000001 미정, 9000002 예정물건, 9000003 신건, 9000004 유찰,
#   9000005 변경, 9000006 재진행, 9000007 정지, 9000008 수수료부족,
#   9000009 미진행, 9000010 기타, 9000011 미납, 9000012 재매각,
#   9000013 이송, 9000014 연기, 9000015 병합, 9000016 불허,
#   9000017 각하, 9000018 항고, 9000019 취소, 9000020 취하,
#   9000021 기각, 9000022 매각, 9000023 잔금납부, 9000024 배당종결
# "진행중"으로 볼 수 있는 상태만 골랐다(매각/취하/기각/배당종결 등
# 종결류는 제외) — 처음엔 사용자가 검색 UI에서 클릭한 5개만 썼다가
# "변경"(9000005) 누락을 발견해 추가했고, 이어서 "예정물건"(9000002)/
# "미진행"(9000009)도 빠진 걸 추가로 발견해 보강했다(실측, 2026-07-30).
PROG_STATUS_CD = "9000002,9000003,9000004,9000005,9000006,9000009,9000011,9000012"
PAGE_SIZE = 100

BASE_PARAMS = {
    "searchType": "advanced",
    "objTypes": "경매",
    "tojiAreaUnit": "m2",
    "bldgAreaUnit": "m2",
    "objProgStatusCd": PROG_STATUS_CD,
    "courtCdPnuCdMode": "pnuCd",
    "specialObjCdMode": "include",
    "isUpdatePicker": "false",
    "pageSortOrder": "objType_asc,dspslDxdyYmd_desc,saYear_desc,saNo_desc,objNo2_asc",
    "pageSize": str(PAGE_SIZE),
}


async def fetch_all_for_yongdo(client, yongdo_cd: str) -> list[dict]:
    items: list[dict] = []
    page_no = 1
    while True:
        params = {**BASE_PARAMS, "yongdoCd": yongdo_cd, "pageNo": str(page_no)}
        resp = await client.get("/api/v1/search/advanced/offset", params=params)
        body = resp.json()
        if body.get("code") != 0:
            print(f"  [경고] yongdoCd={yongdo_cd} page={page_no} 오류: {body.get('msg')}", flush=True)
            break
        data = body["data"]
        page_items = data.get("list", [])
        items.extend(page_items)
        total = data["paging"]["totalRecords"]
        print(
            f"  yongdoCd={yongdo_cd}({YONGDO_CODES[yongdo_cd]}) page={page_no} "
            f"누적={len(items)}/{total}",
            flush=True,
        )
        if not page_items or len(items) >= total:
            break
        page_no += 1
        await asyncio.sleep(0.3)
    return items


async def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    async with make_client() as client:
        all_items: list[dict] = []
        for yongdo_cd, name in YONGDO_CODES.items():
            print(f"[시작] {name}({yongdo_cd})", flush=True)
            items = await fetch_all_for_yongdo(client, yongdo_cd)
            out_path = OUT_DIR / f"{yongdo_cd}_{name}.json"
            out_path.write_text(
                json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            print(f"[완료] {name} {len(items)}건 저장: {out_path}", flush=True)
            all_items.extend(items)
            await asyncio.sleep(1.0)

        combined_path = OUT_DIR / "_all_combined.json"
        combined_path.write_text(
            json.dumps(all_items, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n[전체 완료] 총 {len(all_items)}건, 통합 저장: {combined_path}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
