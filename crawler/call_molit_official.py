import httpx, os

KEY = "e41f12b775b61e800cbf372e5a4f0e234171f43344a616c65ee7e87a63feeed6"
LAWD_CD = "28245"

for deal_ymd in ["202604", "202603", "202605"]:
    for endpoint in [
        "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
        "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
    ]:
        try:
            resp = httpx.get(
                endpoint,
                params={
                    "serviceKey": KEY,
                    "LAWD_CD": LAWD_CD,
                    "DEAL_YMD": deal_ymd,
                    "numOfRows": 10,
                    "pageNo": 1,
                },
                timeout=15,
            )
            print(f"=== {endpoint.split('/')[-1]} {deal_ymd} status={resp.status_code} ===")
            print(resp.text[:800])
            print()
        except Exception as e:
            print("ERROR", endpoint, deal_ymd, e)
