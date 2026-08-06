from naver_httpx import _make_session, BASE_URL
import json

COMPLEX_ID = "112034"  # 2025타경577 샘플에서 확인된 단지ID

session = _make_session()
session.get(f"{BASE_URL}/complexes/{COMPLEX_ID}")

resp = session.get(
    f"{BASE_URL}/front-api/v1/complex/pyeong/realPrice",
    params={"complexNumber": COMPLEX_ID, "pyeongTypeNumber": 1, "page": 1, "size": 5, "tradeType": "A1"},
    headers={"Accept": "application/json", "Referer": f"{BASE_URL}/complexes/{COMPLEX_ID}"},
)
print("status:", resp.status_code)
data = resp.json()
with open("naver_realprice_raw.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print(json.dumps(data, ensure_ascii=False, indent=2)[:200])
