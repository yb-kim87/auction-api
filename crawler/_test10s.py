import asyncio, io, sys, json, time
import random
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from nice_client import make_client, fetch_obj_detail

d = json.load(open("nice_lists/match_result.json", encoding="utf-8"))
seen = {}
for m in d["matched"]:
    seen[m["auctionId"]] = m
existing = json.load(open("nice_lists/detail_results.json", encoding="utf-8"))
ok_ids = {r["auctionId"] for r in existing if "error" not in r}
targets = [(aid, m["objId"]) for aid, m in seen.items() if aid not in ok_ids][:25]

async def main():
    async with make_client() as client:
        for i, (aid, oid) in enumerate(targets, 1):
            t0 = time.time()
            try:
                await fetch_obj_detail(client, oid)
                status = "OK"
            except Exception as e:
                status = f"FAIL: {str(e)[:40]}"
            elapsed = time.time() - t0
            print(f"{i:2d} {status} ({elapsed:.2f}s)", flush=True)
            if status != "OK":
                print(f"실패 발생 — {i}번째에서 중단합니다.", flush=True)
                return
            await asyncio.sleep(random.uniform(9.0, 11.0))
        print("25건 전부 성공!")

asyncio.run(main())
