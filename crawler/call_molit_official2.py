import httpx

KEY = "e41f12b775b61e800cbf372e5a4f0e234171f43344a616c65ee7e87a63feeed6"
LAWD_CD = "28245"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "*/*",
}

for endpoint in [
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
]:
    try:
        resp = httpx.get(
            endpoint,
            params={"serviceKey": KEY, "LAWD_CD": LAWD_CD, "DEAL_YMD": "202604", "numOfRows": 5, "pageNo": 1},
            headers=HEADERS,
            timeout=15,
            follow_redirects=True,
        )
        print(f"=== {endpoint.split('/')[-1]} status={resp.status_code} ===")
        print(resp.text[:1000])
        print()
    except Exception as e:
        print("ERROR", endpoint, e)
