from naver_httpx import _make_session, BASE_URL
import json

COMPLEX_ID = "112034"

session = _make_session()
session.get(f"{BASE_URL}/complexes/{COMPLEX_ID}")

body = {
    "size": 5,
    "complexNumber": str(COMPLEX_ID),
    "tradeTypes": ["A1"],
    "pyeongTypes": [1],
    "dongNumbers": [],
    "userChannelType": "PC",
    "articleSortType": "PRICE_ASC",
    "lastInfo": [],
}
resp = session.post(
    f"{BASE_URL}/front-api/v1/complex/article/list",
    json=body,
    headers={"Accept": "application/json", "Content-Type": "application/json", "Referer": f"{BASE_URL}/complexes/{COMPLEX_ID}"},
)
print("status:", resp.status_code)
data = resp.json()
with open("naver_articles_raw.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
