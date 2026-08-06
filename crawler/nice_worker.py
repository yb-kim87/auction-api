"""나이스옥션 작업창 워커 — 1차(파일럿) 버전.

지금은 관리자 UI의 시작/중지 버튼을 폴링하는 상시 데몬이 아니라,
**objId를 직접 지정해서 소수 건만 수동으로 검증**하는 스크립트다
(사용자 요청, 2026-08-07: "문제가 안 나올 때까지 점검하면서 점점
나이스로 옮겨갈 것" — 대량 자동화 전에 먼저 이 단계로 안전하게 검증).

사용:
    python nice_worker.py --dry-run <objId> [<objId> ...]   # 저장 안 하고 매핑 결과만 출력
    python nice_worker.py <objId> [<objId> ...]              # 실제로 운영 DB에 저장

전체 폴링 데몬(관리자 UI 시작/중지 버튼과 연동, 사이트맵 자동 수집)은
이 파일럿이 검증된 뒤 다음 단계로 만든다.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import sys

import httpx

from nice_client import fetch_obj_detail, make_client
from nice_map_to_raw import nice_obj_to_raw

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

API_BASE = os.environ.get("PRODUCTION_API_URL", "https://auction-production-2c72.up.railway.app")
CRAWLER_SECRET = os.environ.get("CRAWLER_SECRET", "local-crawler-secret")
REQUEST_DELAY_SEC = 0.8


async def process_one(client: httpx.AsyncClient, obj_id: str, dry_run: bool) -> dict:
    obj = await fetch_obj_detail(client, obj_id)
    raw = nice_obj_to_raw(obj)

    if dry_run:
        return {"objId": obj_id, "raw": raw}

    api_client = httpx.Client(timeout=30.0)
    resp = api_client.post(
        f"{API_BASE}/nice-crawler/import-item",
        json=raw,
        headers={"x-crawler-secret": CRAWLER_SECRET},
    )
    resp.raise_for_status()
    return {"objId": obj_id, "raw": raw, "result": resp.json()}


async def main() -> None:
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    obj_ids = [a for a in args if a != "--dry-run"]

    if not obj_ids:
        print("사용법: python nice_worker.py [--dry-run] <objId> [<objId> ...]")
        sys.exit(1)

    print(f"대상 {len(obj_ids)}건, dry_run={dry_run}")
    print(f"API_BASE={API_BASE}")

    results = []
    async with make_client() as client:
        for i, obj_id in enumerate(obj_ids, start=1):
            try:
                result = await process_one(client, obj_id, dry_run)
                status = "OK"
            except Exception as e:  # noqa: BLE001
                result = {"objId": obj_id, "error": str(e)}
                status = f"ERROR: {e}"
            results.append(result)
            label = result.get("raw", {}).get("auctionNo") or obj_id
            print(f"  [{i}/{len(obj_ids)}] {label} — {status}")
            if i < len(obj_ids):
                await asyncio.sleep(REQUEST_DELAY_SEC)

    out_path = "nice_worker_pilot_result.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n결과 저장: {out_path}")

    errors = [r for r in results if "error" in r]
    if errors:
        print(f"실패 {len(errors)}건 있음 — {out_path} 확인 필요")


if __name__ == "__main__":
    asyncio.run(main())
