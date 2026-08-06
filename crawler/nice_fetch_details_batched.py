"""나이스옥션 상세 API(/api/v1/obj/{objId})가 "12건 정도 성공하면 그
이후 즉시 차단"되는 건수 기반 레이트리밋을 갖고 있음을 실측 확인
(2026-07-30, 200건 테스트: 1~12번 성공, 13번부터 200번까지 전부 즉시
실패). 시간 지연만으로는 해결이 안 돼, 배치(10건, 안전마진) + 배치
사이 쿨다운을 두고, 쿨다운 후 프로브(1건) 성공을 확인한 뒤에만 다음
배치를 진행하는 적응형 스크립트.

쿨다운 길이는 모르는 상태로 시작해 지수 백오프로 늘려가며 찾는다.
한 번 성공한 쿨다운 길이는 계속 재사용한다(같은 값으로 반복 성공하면
그게 실제 리셋 주기라고 보고 그대로 유지).
"""

from __future__ import annotations

import asyncio
import io
import json
import sys
import time
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

BATCH_SIZE = 10  # 실측된 한계(12건)보다 여유를 둔 안전 배치 크기
INTRA_BATCH_DELAY = 0.5
INITIAL_COOLDOWN_SEC = 180  # 3분부터 시작
MAX_COOLDOWN_SEC = 1800  # 30분 상한
COOLDOWN_BACKOFF_MULT = 1.8


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


async def try_fetch(client, auction_id: str, obj_id: str) -> dict | None:
    """성공 시 파싱된 dict, 실패 시 None."""
    try:
        obj = await fetch_obj_detail(client, obj_id)
    except Exception:  # noqa: BLE001
        return None
    return parse_obj(obj, auction_id, obj_id)


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
    print(f"남은 대상: {len(remaining)}건", flush=True)

    cooldown = INITIAL_COOLDOWN_SEC
    batch_no = 0
    start_time = time.time()

    async with make_client() as client:
        idx = 0
        while idx < len(remaining):
            batch_no += 1
            batch = remaining[idx : idx + BATCH_SIZE]
            batch_ok = 0
            batch_fail = 0
            for aid, m in batch:
                parsed = await try_fetch(client, aid, m["objId"])
                if parsed is not None:
                    results.append(parsed)
                    batch_ok += 1
                else:
                    batch_fail += 1
                await asyncio.sleep(INTRA_BATCH_DELAY)

            idx += len(batch)
            elapsed_min = (time.time() - start_time) / 60
            print(
                f"[배치 {batch_no}] 이번 배치 성공 {batch_ok}/{len(batch)} | "
                f"전체 진행 {idx}/{len(remaining)} (누적 성공 {len(results)}) | "
                f"경과 {elapsed_min:.1f}분",
                flush=True,
            )
            save(results)

            if idx >= len(remaining):
                break

            if batch_fail > 0:
                # 배치 중간에 막히기 시작했다는 뜻 — 쿨다운을 늘리고 쉰다.
                print(f"  이번 배치에서 실패 발생 — {cooldown}초 쿨다운 후 프로브 확인", flush=True)
                while True:
                    await asyncio.sleep(cooldown)
                    probe_aid, probe_m = remaining[idx] if idx < len(remaining) else remaining[idx - 1]
                    probe = await try_fetch(client, probe_aid, probe_m["objId"])
                    if probe is not None:
                        # 프로브 성공 — 이 쿨다운 값이 유효하다고 보고 유지.
                        if probe_aid == (remaining[idx][0] if idx < len(remaining) else None):
                            results.append(probe)
                            idx += 1
                            save(results)
                        print(f"  프로브 성공 — 쿨다운 {cooldown}초로 계속 진행", flush=True)
                        break
                    cooldown = min(int(cooldown * COOLDOWN_BACKOFF_MULT), MAX_COOLDOWN_SEC)
                    print(f"  프로브 실패 — 쿨다운을 {cooldown}초로 늘려서 재시도", flush=True)
            else:
                # 배치 전체가 성공했으면 굳이 오래 쉬지 않고 짧게만 쉬고 이어간다.
                await asyncio.sleep(5)

    elapsed_min = (time.time() - start_time) / 60
    print(f"\n[전체 완료] 총 성공 {len(results)}건, 총 소요 {elapsed_min:.1f}분", flush=True)
    save(results)


if __name__ == "__main__":
    asyncio.run(main())
