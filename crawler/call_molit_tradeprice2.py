import asyncio, os, sys, json
sys.path.insert(0, ".")
os.environ.setdefault("TANKAUCTION_ID", "zgamez")
os.environ.setdefault("TANKAUCTION_PW", "young1!")
from http_client import make_client, login, fetch_detail, fetch_env_view_data

TID = "2500112"

async def main():
    async with make_client() as client:
        await login(client)
        detail = await fetch_detail(client, TID)
        env = await fetch_env_view_data(client, TID)
        base = detail.get("baseInfo", {})
        dtdj = (env or {}).get("dtDj", {})

        params = {
            "gb": 1, "tid": TID,
            "x": base.get("x"), "y": base.get("y"),
            "cat2": base.get("cat2"), "cat3": base.get("cat3"),
            "pnu": base.get("lst_pnu"),
            "roadAddr": base.get("road_adrs"), "roadNm": base.get("road_nm"),
            "mBldgNo": base.get("m_bldg_no"), "sBldgNo": base.get("s_bldg_no"),
            "bldgNm": base.get("bldg_nm"), "adrs": base.get("adrs"),
            "regnAdrs": base.get("regn_adrs"),
            "kaptCd": dtdj.get("ka_code") or dtdj.get("apt_code"),
            "hjCd": base.get("hjCd"),
            "maemae": 1, "jeonse": 1, "wolse": 1, "isChart": 1,
        }
        params = {k: v for k, v in params.items() if v not in (None, "")}

        resp = await client.post(
            "/molit/res/TradePriceApi.php",
            params={"mode": "trade-price"},
            data=params,
            headers={"X-Requested-With": "XMLHttpRequest"},
        )
        data = resp.json()
        with open("molit_tradeprice_sample.json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print("saved, item count:", len(data.get("item", [])))

asyncio.run(main())
