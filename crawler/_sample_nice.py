import asyncio, json, random
from nice_client import make_client, fetch_sitemap_page_obj_ids, fetch_obj_detail, OBJ_TYPE_AUCTION

async def main():
    async with make_client() as client:
        ids = await fetch_sitemap_page_obj_ids(client, OBJ_TYPE_AUCTION, 1)
        sample = random.sample(ids, 60)
        results = []
        sem = asyncio.Semaphore(10)
        async def fetch(oid):
            async with sem:
                try:
                    obj = await fetch_obj_detail(client, oid)
                    results.append({
                        "objId": oid,
                        "objProgStatusCd": obj.get("objProgStatusCd"),
                        "objStatusCd": obj.get("objStatusCd"),
                        "yongdoCd": obj.get("yongdoCd"),
                        "yongdoCd1": obj.get("yongdoCd1"),
                        "yongdoCd2": obj.get("yongdoCd2"),
                        "yejungYongdoNm": obj.get("yejungYongdoNm"),
                        "auctnLstDvsCd": obj.get("auctnLstDvsCd"),
                    })
                except Exception as e:
                    results.append({"objId": oid, "error": str(e)})
        await asyncio.gather(*(fetch(i) for i in sample))
        with open("_nice_sample_out.json", "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print("done", len(results))

asyncio.run(main())
