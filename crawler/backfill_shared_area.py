"""85㎡ 초과 아파트 중 sharedArea(공용면적)가 비어있는 기존 물건만 보정.

전체 재크롤 대신 AuctView.php + getEnvBldg.php 두 API만 호출해 sharedArea
필드 하나만 채운다(부가세계산기 자동계산 대상만 우선 처리, 2026-07-21).
"""
from __future__ import annotations

import asyncio
import os
import sys

import httpx

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from http_client import fetch_detail, fetch_env_bldg, login, make_client
from tank_detail import parse_exclusive_area_from_env_bldg

API_BASE = os.environ.get("PRODUCTION_API_URL", "https://auction-production-2c72.up.railway.app")
CRAWLER_SECRET = os.environ.get("CRAWLER_SECRET", "local-crawler-secret")

CONCURRENCY = int(os.environ.get("BACKFILL_CONCURRENCY", "4"))


def _tid_from_link(link: str) -> str | None:
    if "tid=" not in link:
        return None
    return link.split("tid=", 1)[1].split("&", 1)[0].strip()


async def _fetch_targets(api_client: httpx.AsyncClient) -> list[dict]:
    resp = await api_client.get(
        f"{API_BASE}/crawler/missing-shared-area",
        headers={"x-crawler-secret": CRAWLER_SECRET},
    )
    resp.raise_for_status()
    return resp.json()


async def _post_shared_area(api_client: httpx.AsyncClient, link: str, shared_area: str) -> dict:
    resp = await api_client.post(
        f"{API_BASE}/crawler/import-shared-area",
        headers={"x-crawler-secret": CRAWLER_SECRET},
        json={"link": link, "sharedArea": shared_area, "submittedBy": "crawler-shared-area-backfill"},
    )
    resp.raise_for_status()
    return resp.json()


async def _process_one(
    tank_client: httpx.AsyncClient,
    api_client: httpx.AsyncClient,
    target: dict,
    semaphore: asyncio.Semaphore,
    stats: dict,
) -> None:
    link = target["link"]
    tid = _tid_from_link(link)
    if not tid:
        stats["skipped"] += 1
        return

    async with semaphore:
        try:
            detail = await fetch_detail(tank_client, tid)
        except Exception as exc:
            print(f"[FAIL detail] tid={tid}: {exc}", flush=True)
            stats["failed"] += 1
            return

        base = (detail or {}).get("baseInfo") or {}
        land_items = ((detail or {}).get("landInfo") or {}).get("items") or []
        title_pk = base.get("apiBldgTitle_Pk")
        recap_pk = base.get("apiBldgRecap_Pk")
        pnu = land_items[0].get("pnu") if land_items else None
        if not (title_pk and recap_pk and pnu):
            print(f"[SKIP no-pk] tid={tid}", flush=True)
            stats["skipped"] += 1
            return

        env_bldg = await fetch_env_bldg(tank_client, tid, title_pk, recap_pk, pnu)
        shared_area = parse_exclusive_area_from_env_bldg(env_bldg).get("shared_area", "")
        if not shared_area:
            print(f"[SKIP no-shared-area] tid={tid}", flush=True)
            stats["skipped"] += 1
            return

        result = await _post_shared_area(api_client, link, shared_area)
        if result.get("updated"):
            print(f"[OK] tid={tid} sharedArea={shared_area}㎡", flush=True)
            stats["updated"] += 1
        else:
            print(f"[UNCHANGED] tid={tid} reason={result.get('reason')}", flush=True)
            stats["skipped"] += 1


async def main() -> None:
    async with make_client() as tank_client, httpx.AsyncClient(timeout=20) as api_client:
        await login(tank_client)

        targets = await _fetch_targets(api_client)
        print(f"대상 물건: {len(targets)}건", flush=True)
        if not targets:
            return

        stats = {"updated": 0, "skipped": 0, "failed": 0}
        semaphore = asyncio.Semaphore(CONCURRENCY)
        await asyncio.gather(
            *[
                _process_one(tank_client, api_client, target, semaphore, stats)
                for target in targets
            ]
        )

        print(
            f"완료 — 업데이트 {stats['updated']}건, 스킵 {stats['skipped']}건, 실패 {stats['failed']}건",
            flush=True,
        )


if __name__ == "__main__":
    asyncio.run(main())
