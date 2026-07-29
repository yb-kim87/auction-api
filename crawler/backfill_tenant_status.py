"""임차인 대항력/분석 필드 버그 수정(2026-07-29) 이후, 기존에 이미
크롤링된 물건들을 재크롤링해 tenantDetail을 갱신하는 백필 스크립트.
docs/history/2026-07-29_04_tenant-opposability-analysis-fix.md 참고.
"""
import asyncio
import json
import os

os.environ.setdefault("TANKAUCTION_ID", "zgamez")
os.environ.setdefault("TANKAUCTION_PW", "young1!")
os.environ.setdefault(
    "CRAWLER_CALLBACK_URL",
    "https://auction-production-2c72.up.railway.app/crawler/import-item",
)
os.environ.setdefault("CRAWLER_SECRET", "local-crawler-secret")

from http_client import make_client, login
from full_httpx_worker import crawl_one_item_detail_only_httpx
from item_validation import validate_crawl_item_reason
from repository import post_item_to_api


async def main(tids: list[int], log_path: str = "tenant_backfill_log.jsonl"):
    saved = 0
    failed = 0
    async with make_client() as client:
        await login(client)
        with open(log_path, "w", encoding="utf-8") as logf:
            for i, tid in enumerate(tids):
                entry: dict = {"tid": tid}
                try:
                    item = await crawl_one_item_detail_only_httpx(client, tid)
                    valid, reason = validate_crawl_item_reason(item)
                    entry["valid"] = valid
                    entry["invalid_reason"] = reason
                    if valid:
                        await post_item_to_api(client, item)
                        entry["saved"] = True
                        saved += 1
                    else:
                        entry["saved"] = False
                        failed += 1
                except Exception as e:  # noqa: BLE001
                    entry["error"] = f"{type(e).__name__}: {e}"
                    failed += 1
                logf.write(json.dumps(entry, ensure_ascii=False) + "\n")
                logf.flush()
                if (i + 1) % 20 == 0:
                    print(
                        f"[{i + 1}/{len(tids)}] saved={saved} failed={failed}",
                        flush=True,
                    )
                await asyncio.sleep(0.3)
    print(f"완료: 전체 {len(tids)} / 저장 {saved} / 실패 {failed}", flush=True)


if __name__ == "__main__":
    with open("tenant_backfill_tids.json", encoding="utf-8") as f:
        all_tids = json.load(f)
    asyncio.run(main(all_tids))
