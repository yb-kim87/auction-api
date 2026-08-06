import asyncio, json, io, sys
from nice_client import make_client, fetch_obj_detail

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

d = json.load(open("nice_lists/match_result.json", encoding="utf-8"))
matched = d["matched"]
seen = {}
for m in matched:
    seen[m["auctionId"]] = m
sample = list(seen.values())[:10]

async def main():
    async with make_client() as client:
        results = []
        for m in sample:
            obj = await fetch_obj_detail(client, m["objId"])
            results.append({"auctionId": m["auctionId"], "objId": m["objId"], "obj": obj})
            await asyncio.sleep(0.2)
        with open("_sample_details.json", "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print("done", len(results))

asyncio.run(main())
