import asyncio, json
from nice_client import make_client, fetch_obj_detail

ids_by_code = {
    "20201": "2071344443264336277",
    "20202": "2076622227020710965",
    "20203": "2076542349038584885",
    "20101": "2069889058368127493",
}

async def main():
    async with make_client() as client:
        for code, oid in ids_by_code.items():
            obj = await fetch_obj_detail(client, oid)
            with open(f"_yongdo_{code}.txt", "w", encoding="utf-8") as f:
                f.write(f"addr: {obj.get('addrNoPrivacy')}\n")
                f.write(f"bldgNm: {obj.get('bldgNm')}\n")
                f.write(f"yongdoCd: {obj.get('yongdoCd')}\n")
                f.write(f"yejungYongdoNm: {obj.get('yejungYongdoNm')}\n")

asyncio.run(main())
