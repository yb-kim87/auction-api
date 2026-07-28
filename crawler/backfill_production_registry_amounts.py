"""운영 DB 전체 물건의 등기 채권금액을 안전하게 재수집한다.

- 운영 /auctions에서 Tank tid를 읽는다.
- Tank 상세 원본의 cAmt/bAmt를 포함해 다시 파싱한다.
- X-Crawler-Mirror: 1로 저장해 텔레그램 등 신규물건 알림을 막는다.
- JSONL 체크포인트를 사용해 재실행 시 성공한 tid를 건너뛴다.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path

import httpx
from dotenv import load_dotenv

from full_httpx_worker import crawl_one_item_full_httpx
from http_client import login, make_client


ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT = ROOT / "data" / "production-registry-amount-backfill.jsonl"
CONCURRENCY = max(1, min(int(os.getenv("REGISTRY_BACKFILL_CONCURRENCY", "3")), 5))


def load_completed() -> set[str]:
    completed: set[str] = set()
    if not CHECKPOINT.exists():
        return completed
    for line in CHECKPOINT.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("ok") and row.get("tid"):
            completed.add(str(row["tid"]))
    return completed


def extract_tid(link: object) -> str:
    match = re.search(r"[?&]tid=(\d+)", str(link or ""))
    return match.group(1) if match else ""


async def main() -> None:
    load_dotenv(ROOT / ".env")
    production_base = (
        os.getenv("PRODUCTION_API_URL") or os.getenv("API_PRODUCTION_URL") or ""
    ).rstrip("/")
    crawler_secret = os.getenv("CRAWLER_SECRET", "").strip()
    if not production_base or not crawler_secret:
        raise RuntimeError("PRODUCTION_API_URL 또는 CRAWLER_SECRET이 없습니다.")

    async with httpx.AsyncClient(timeout=45) as api:
        response = await api.get(f"{production_base}/auctions?limit=10000")
        response.raise_for_status()
        payload = response.json()
    items = (
        payload.get("items", payload.get("data", payload))
        if isinstance(payload, dict)
        else payload
    )
    targets = [(extract_tid(item.get("link")), item.get("auctionNo")) for item in items]
    targets = [(tid, no) for tid, no in targets if tid]
    completed = load_completed()
    pending = [(tid, no) for tid, no in targets if tid not in completed]
    print(
        f"TOTAL={len(targets)} COMPLETED={len(completed)} "
        f"PENDING={len(pending)} CONCURRENCY={CONCURRENCY}",
        flush=True,
    )

    semaphore = asyncio.Semaphore(CONCURRENCY)
    write_lock = asyncio.Lock()
    progress = {"done": len(completed), "success": 0, "failed": 0}

    async def record(row: dict) -> None:
        async with write_lock:
            CHECKPOINT.parent.mkdir(parents=True, exist_ok=True)
            with CHECKPOINT.open("a", encoding="utf-8") as file:
                file.write(json.dumps(row, ensure_ascii=False) + "\n")

    async def process(source: httpx.AsyncClient, tid: str, auction_no: object) -> None:
        async with semaphore:
            try:
                item = await crawl_one_item_full_httpx(source, tid)
                async with httpx.AsyncClient(timeout=45) as api:
                    saved = await api.post(
                        f"{production_base}/crawler/import-item",
                        json={
                            **item,
                            "submittedBy": "crawler-production-rights-backfill",
                        },
                        headers={
                            "X-Crawler-Secret": crawler_secret,
                            "X-Crawler-Mirror": "1",
                        },
                    )
                    saved.raise_for_status()
                registry = str(
                    item.get("deunggi_info") or item.get("buildingRegistry") or ""
                )
                amount_count = len(re.findall(r"\b\d{1,3}(?:,\d{3})+\b", registry))
                progress["success"] += 1
                await record(
                    {
                        "tid": tid,
                        "auctionNo": auction_no,
                        "ok": True,
                        "amountCount": amount_count,
                    }
                )
            except Exception as exc:
                progress["failed"] += 1
                await record(
                    {
                        "tid": tid,
                        "auctionNo": auction_no,
                        "ok": False,
                        "error": f"{type(exc).__name__}: {exc}"[:500],
                    }
                )
            finally:
                progress["done"] += 1
                if progress["done"] % 25 == 0 or progress["done"] == len(targets):
                    print(
                        f"PROGRESS={progress['done']}/{len(targets)} "
                        f"SUCCESS={progress['success']} FAILED={progress['failed']}",
                        flush=True,
                    )
                await asyncio.sleep(0.3)

    async with make_client() as source:
        await login(source)
        await asyncio.gather(
            *(process(source, tid, auction_no) for tid, auction_no in pending)
        )

    print(
        f"DONE TOTAL={len(targets)} SUCCESS={progress['success']} "
        f"FAILED={progress['failed']} CHECKPOINT={CHECKPOINT}",
        flush=True,
    )


if __name__ == "__main__":
    asyncio.run(main())
