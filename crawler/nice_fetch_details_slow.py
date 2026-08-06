"""나이스옥션 상세 API가 짧은 간격으로 12건쯤 몰아치면 즉시 차단되는
걸 실측 확인(2026-07-30, 배치10+배치2=12건에서 막힘). 이번엔 완전히
1건씩, 요청 사이 2~3초 랜덤 간격만 두고 아주 천천히 수집한다(사용자
요청, 2026-07-30). 실패하면 그 자리에서 멈추고 사람이 다시 판단하도록
한다(자동 재시도/쿨다운 없음 — 재시도 자체가 차단 윈도우를 계속
갱신시킬 수 있다는 가설 때문에 자동으로 계속 두드리지 않음).
"""

from __future__ import annotations

import asyncio
import io
import json
import random
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
OUT_PATH = BASE / "detail_results.json"
MIN_DELAY = 2.0
MAX_DELAY = 3.0


def parse_obj(obj: dict, auction_id: str, obj_id: str) -> dict:
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


def save(results: list[dict]) -> None:
    OUT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


async def main() -> None:
    match_result = json.loads((BASE / "match_result.json").read_text(encoding="utf-8"))
    seen: dict[str, dict] = {}
    for m in match_result["matched"]:
        seen[m["auctionId"]] = m

    results: list[dict] = []
    if OUT_PATH.exists():
        prev = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        results = [r for r in prev if "error" not in r]
        print(f"이전에 이미 성공한 {len(results)}건 재사용", flush=True)

    done_ids = {r["auctionId"] for r in results}
    remaining = [(aid, m) for aid, m in seen.items() if aid not in done_ids]
    print(f"남은 대상: {len(remaining)}건 — 1건씩, {MIN_DELAY}~{MAX_DELAY}초 랜덤 간격", flush=True)

    async with make_client() as client:
        for i, (aid, m) in enumerate(remaining, start=1):
            try:
                obj = await fetch_obj_detail(client, m["objId"])
            except Exception as e:  # noqa: BLE001
                print(f"[{i}/{len(remaining)}] 실패: {str(e)[:80]}", flush=True)
                print("실패 발생 — 여기서 멈춥니다. 자동 재시도하지 않음.", flush=True)
                save(results)
                return

            results.append(parse_obj(obj, aid, m["objId"]))
            if i % 20 == 0:
                print(f"[{i}/{len(remaining)}] 누적 성공 {len(results)}건", flush=True)
                save(results)

            await asyncio.sleep(random.uniform(MIN_DELAY, MAX_DELAY))

    print(f"\n[전체 완료] 총 성공 {len(results)}건", flush=True)
    save(results)


if __name__ == "__main__":
    asyncio.run(main())
