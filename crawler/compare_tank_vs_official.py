import httpx, json, xml.etree.ElementTree as ET, time

KEY = "e41f12b775b61e800cbf372e5a4f0e234171f43344a616c65ee7e87a63feeed6"
LAWD_CD = "28245"
MONTHS = ["202402","202405","202407","202408","202409",
          "202501","202503","202504","202505","202506","202507","202511",
          "202603","202604","202606","202607"]

url = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade"
all_records = []
for ym in MONTHS:
    resp = httpx.get(url, params={"serviceKey": KEY, "LAWD_CD": LAWD_CD, "DEAL_YMD": ym, "numOfRows": 200, "pageNo": 1},
                      headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
    resp.encoding = "utf-8"
    root = ET.fromstring(resp.content)
    items = root.findall(".//item")
    for it in items:
        rec = {child.tag: (child.text or "").strip() for child in it}
        rec["_ym"] = ym
        all_records.append(rec)
    time.sleep(0.3)

target = [r for r in all_records if "경남아너스빌" in r.get("aptNm","")]
with open("official_target_complex_all.json", "w", encoding="utf-8") as f:
    json.dump(target, f, ensure_ascii=False, indent=2)
print("공식 API 매칭 건수:", len(target))
