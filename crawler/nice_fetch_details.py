"""매칭된(crawler/nice_lists/match_result.json) objId 전부의 상세를
조회해 nice_parsers.py로 파싱한 결과를 로컬에 저장한다. 아직 운영 DB에는
반영하지 않는다(검증 전 단계).

2026-07-30: 동시성 8+무지연으로 돌렸다가 3453건 중 3355건이 "시스템
오류가 발생했습니다" 응답으로 실패(레이트리밋/일시 차단으로 추정),
동시성 3+0.4초 지연으로 재시도해도 여전히 대부분 실패 — 약 2시간 후
자연 복구됨을 확인. 이번엔 완전 순차(동시성 1)+요청마다 지연을 두고,
연속 실패가 일정 횟수 이상 나오면 더 두드리지 않고 즉시 중단하는
회로차단기를 넣는다(같은 실수 재발 방지).
"""

from __future__ import annotations

import asyncio
import io
import json
import sys
from pathlib import Path

from nice_client import make_client, fetch_obj_detail
from nice_parsers import (
    build_building_registry_text,
    build_rights_structured,
    build_tenant_detail_text,
)

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parent / "nice_lists"
REQUEST_DELAY_SEC = 0.8
CONSECUTIVE_FAILURE_LIMIT = 8


async def fetch_one(client, auction_id: str, obj_id: str) -> dict:
    try:
        obj = await fetch_obj_detail(client, obj_id)
    except Exception as e:  # noqa: BLE001
        return {"auctionId": auction_id, "objId": obj_id, "error": str(e)}
    return {
        "auctionId": auction_id,
        "objId": obj_id,
        "buildingRegistry": build_building_registry_text(obj),
        "tenantDetail": build_tenant_detail_text(obj),
        "rightsStructured": build_rights_structured(obj),
        "addr": obj.get("addrNoPrivacy"),
        "gamjungAmt": obj.get("gamjungAmt"),
        "minAmt": obj.get("minAmt"),
        "objEtc": obj.get("objEtc"),
    }


async def main() -> None:
    match_result = json.loads((BASE / "match_result.json").read_text(encoding="utf-8"))
    matched = match_result["matched"]
    seen: dict[str, dict] = {}
    for m in matched:
        seen[m["auctionId"]] = m

    out_path = BASE / "detail_results.json"
    existing_ok: dict[str, dict] = {}
    if out_path.exists():
        prev = json.loads(out_path.read_text(encoding="utf-8"))
        for r in prev:
            if "error" not in r:
                existing_ok[r["auctionId"]] = r
        print(f"이전 실행에서 이미 성공한 {len(existing_ok)}건은 재조회하지 않음", flush=True)

    pairs = [(aid, m) for aid, m in seen.items() if aid not in existing_ok]
    print(f"상세조회 대상(재시도分): {len(pairs)}건 — 순차 처리, 요청마다 {REQUEST_DELAY_SEC}초 지연", flush=True)

    results: list[dict] = list(existing_ok.values())
    consecutive_failures = 0
    stopped_early = False

    async with make_client() as client:
        for i, (aid, m) in enumerate(pairs, start=1):
            result = await fetch_one(client, aid, m["objId"])
            results.append(result)

            if "error" in result:
                consecutive_failures += 1
            else:
                consecutive_failures = 0

            if i % 50 == 0:
                ok_so_far = sum(1 for r in results if "error" not in r)
                print(f"  진행 {i}/{len(pairs)} (누적 성공 {ok_so_far}건)", flush=True)

            if consecutive_failures >= CONSECUTIVE_FAILURE_LIMIT:
                print(
                    f"\n[중단] 연속 실패 {consecutive_failures}건 감지 — "
                    "레이트리밋/차단 가능성이 높아 더 진행하지 않고 멈춥니다.",
                    flush=True,
                )
                stopped_early = True
                break

            await asyncio.sleep(REQUEST_DELAY_SEC)

    errors = [r for r in results if "error" in r]
    ok = [r for r in results if "error" not in r]
    print(f"완료: 성공 {len(ok)}건, 실패 {len(errors)}건, 조기중단={stopped_early}", flush=True)

    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"저장: {out_path}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
