"""공시가격(officialLandPrice)이 비어있는 진행중 물건만 보정.

EnvViewData.php(pubAmt)로 공시가격을, AuctView.php(baseInfo.spCdtn)로
특이사항(공시가 구간·유치권 등)을 함께 채운다. 전체 재크롤 대신 두 API만
호출하는 가벼운 보정(2026-07-22).
"""
from __future__ import annotations

import asyncio
import os
import sys

import httpx

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from http_client import fetch_detail, fetch_env_view_data, login, make_client
from tank_detail import parse_official_land_price_from_env_payload, parse_special_note_from_detail

API_BASE = os.environ.get("PRODUCTION_API_URL", "https://auction-production-2c72.up.railway.app")
CRAWLER_SECRET = os.environ.get("CRAWLER_SECRET", "local-crawler-secret")

CONCURRENCY = int(os.environ.get("BACKFILL_CONCURRENCY", "4"))


def _tid_from_link(link: str) -> str | None:
    if "tid=" not in link:
        return None
    return link.split("tid=", 1)[1].split("&", 1)[0].strip()


async def _fetch_targets(api_client: httpx.AsyncClient) -> list[dict]:
    resp = await api_client.get(
        f"{API_BASE}/crawler/missing-official-land-price",
        headers={"x-crawler-secret": CRAWLER_SECRET},
    )
    resp.raise_for_status()
    return resp.json()


async def _post_result(
    api_client: httpx.AsyncClient, link: str, official_land_price: int, special_note: str
) -> dict:
    resp = await api_client.post(
        f"{API_BASE}/crawler/import-official-land-price",
        headers={"x-crawler-secret": CRAWLER_SECRET},
        json={
            "link": link,
            "officialLandPrice": official_land_price,
            "specialNote": special_note,
            "submittedBy": "crawler-land-price-backfill",
        },
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
            env_payload = await fetch_env_view_data(tank_client, tid)
        except Exception as exc:
            print(f"[FAIL fetch] tid={tid}: {exc}", flush=True)
            stats["failed"] += 1
            return

        official_land_price = parse_official_land_price_from_env_payload(env_payload) or 0
        special_note = parse_special_note_from_detail(detail)

        if not official_land_price and special_note == "없음":
            print(f"[SKIP no-data] tid={tid}", flush=True)
            stats["skipped"] += 1
            return

        result = await _post_result(api_client, link, official_land_price, special_note)
        if result.get("updated"):
            print(
                f"[OK] tid={tid} officialLandPrice={official_land_price} specialNote={special_note}",
                flush=True,
            )
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
