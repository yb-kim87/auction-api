import asyncio, os, sys, json
sys.path.insert(0, ".")
os.environ.setdefault("TANKAUCTION_ID", "zgamez")
os.environ.setdefault("TANKAUCTION_PW", "young1!")

from http_client import make_client, login, fetch_detail

TID = "2500112"

async def main():
    async with make_client() as client:
        await login(client)
        detail = await fetch_detail(client, TID)
        with open("sample_2500112_detail.json", "w", encoding="utf-8") as f:
            json.dump(detail, f, ensure_ascii=False, indent=2, default=str)
        print("keys:", list(detail.keys()))
        base = detail.get("baseInfo", {})
        print("apiBldgTitle_Pk:", base.get("apiBldgTitle_Pk"))
        print("apt_cd:", base.get("apt_cd"))
        print("lst_pnu:", base.get("lst_pnu"))

asyncio.run(main())
