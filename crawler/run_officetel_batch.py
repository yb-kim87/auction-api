import asyncio, os, sys, json, time

os.environ.setdefault("TANKAUCTION_ID", "zgamez")
os.environ.setdefault("TANKAUCTION_PW", "young1!")
os.environ.setdefault("CRAWLER_CALLBACK_URL", "https://auction-production-2c72.up.railway.app/crawler/import-item")
os.environ.setdefault("CRAWLER_SECRET", "local-crawler-secret")

from http_client import make_client, login
from full_httpx_worker import crawl_one_item_full_httpx
from item_validation import validate_crawl_item_reason
from repository import post_item_to_api

async def main(tids, save=False, log_path="batch_log.jsonl"):
    results = []
    async with make_client() as client:
        await login(client)
        with open(log_path, "a", encoding="utf-8") as logf:
            for i, tid in enumerate(tids):
                entry = {"tid": tid}
                try:
                    item = await crawl_one_item_full_httpx(client, tid)
                    entry["usage"] = item.get("usage")
                    entry["area"] = item.get("area")
                    entry["naver_lowest_price"] = item.get("naver_lowest_price")
                    entry["naver_price_detail_len"] = len(item.get("naver_price_detail") or "")
                    entry["real_trade_count"] = item.get("real_trade_count")
                    entry["naver_id"] = item.get("naver_id")
                    if save:
                        valid, reason = validate_crawl_item_reason(item)
                        entry["valid"] = valid
                        entry["invalid_reason"] = reason
                        if valid:
                            api_result = await post_item_to_api(client, item)
                            entry["saved"] = True
                        else:
                            entry["saved"] = False
                except Exception as e:
                    entry["error"] = f"{type(e).__name__}: {e}"
                logf.write(json.dumps(entry, ensure_ascii=False) + "\n")
                logf.flush()
                results.append(entry)
                print(i+1, tid, entry.get("naver_lowest_price"), entry.get("error", ""), flush=True)
    return results

if __name__ == "__main__":
    with open("officetel_tids.json", encoding="utf-8") as f:
        tids = json.load(f)
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    end = int(sys.argv[2]) if len(sys.argv) > 2 else start + 5
    save = (len(sys.argv) > 3 and sys.argv[3] == "save")
    asyncio.run(main(tids[start:end], save=save))
