import asyncio, os, sys, json

os.environ.setdefault("TANKAUCTION_ID", "zgamez")
os.environ.setdefault("TANKAUCTION_PW", "young1!")
os.environ.setdefault("CRAWLER_CALLBACK_URL", "https://auction-production-2c72.up.railway.app/crawler/import-item")
os.environ.setdefault("CRAWLER_SECRET", "local-crawler-secret")

from http_client import make_client, login
from full_httpx_worker import crawl_one_item_full_httpx
from item_validation import validate_crawl_item_reason
from repository import post_item_to_api


async def main(tids, log_path="backfill_log.jsonl"):
    async with make_client() as client:
        await login(client)
        with open(log_path, "w", encoding="utf-8") as logf:
            for i, tid in enumerate(tids):
                entry = {"tid": tid}
                try:
                    item = await crawl_one_item_full_httpx(client, tid)
                    entry["case_state"] = item.get("caseState")
                    entry["lawd_cd"] = item.get("lawd_cd")
                    entry["umd_nm"] = item.get("umd_nm")
                    entry["jibun"] = item.get("jibun")
                    entry["sale_confirmed_at"] = item.get("sale_confirmed_at")
                    entry["payment_completed_at"] = item.get("payment_completed_at")
                    valid, reason = validate_crawl_item_reason(item)
                    entry["valid"] = valid
                    entry["invalid_reason"] = reason
                    if valid:
                        await post_item_to_api(client, item)
                        entry["saved"] = True
                    else:
                        entry["saved"] = False
                except Exception as e:
                    entry["error"] = f"{type(e).__name__}: {e}"
                logf.write(json.dumps(entry, ensure_ascii=False) + "\n")
                logf.flush()
                print(
                    i + 1, tid,
                    "완납일=", entry.get("payment_completed_at"),
                    "lawdCd=", entry.get("lawd_cd"),
                    entry.get("error", ""),
                    flush=True,
                )


if __name__ == "__main__":
    with open("backfill_tids.json", encoding="utf-8") as f:
        tids = json.load(f)
    asyncio.run(main(tids))
