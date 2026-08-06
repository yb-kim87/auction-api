import asyncio, os, sys, json, time

os.environ.setdefault("TANKAUCTION_ID", "zgamez")
os.environ.setdefault("TANKAUCTION_PW", "young1!")
os.environ.setdefault("CRAWLER_CALLBACK_URL", "https://auction-production-2c72.up.railway.app/crawler/import-item")
os.environ.setdefault("CRAWLER_SECRET", "local-crawler-secret")

from http_client import make_client, login
from full_httpx_worker import crawl_one_item_full_httpx
from item_validation import validate_crawl_item_reason
from repository import post_item_to_api

async def main(tids, log_path="recrawl_log.jsonl"):
    async with make_client() as client:
        await login(client)
        with open(log_path, "a", encoding="utf-8") as logf:
            for i, tid in enumerate(tids):
                entry = {"tid": tid}
                try:
                    item = await crawl_one_item_full_httpx(client, tid)
                    entry["unpaid_fee_amount"] = item.get("unpaid_fee_amount")
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
                print(i+1, tid, entry.get("unpaid_fee_amount"), entry.get("error", ""), flush=True)

if __name__ == "__main__":
    with open("recrawl_tids.json", encoding="utf-8") as f:
        tids = json.load(f)
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    end = int(sys.argv[2]) if len(sys.argv) > 2 else len(tids)
    asyncio.run(main(tids[start:end]))
