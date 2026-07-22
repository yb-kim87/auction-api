"""법원경매정보(courtauction.go.kr) 물건 목록/상세 API의 실제 요청·응답 본문을
CDP(Chrome DevTools Protocol)로 캡처한다.

diagnose_courtauction_manual.py로 이미 다음 두 핵심 API를 찾았다:
  - POST /pgj/pgjsearch/searchControllerMain.on   (물건 목록 검색)
  - POST /pgj/pgj15B/selectAuctnCsSrchRslt.on      (물건 상세 조회)

이번엔 이 두 API에 한해 응답 본문(JSON)까지 즉시 캡처해서, 실제 필드
구조(주소·감정가·최저가·입찰일 등이 어떤 키로 오는지)를 확보한다.
CDP는 응답이 지나간 뒤엔 body를 못 가져오므로, Network.responseReceived
이벤트가 뜨는 즉시 Network.getResponseBody를 호출해야 한다.

사용법: python diagnose_courtauction_manual2.py
  Chrome 창이 뜨면 이전과 동일하게 "물건상세검색" → 검색 → 상세 클릭.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import undetected_chromedriver as uc

OUT_DIR = Path(__file__).resolve().parent.parent / "logs" / "courtauction_probe"
MAIN_URL = "https://www.courtauction.go.kr/pgj/index.on"
WAIT_SECONDS = 150

TARGET_PATH_FRAGMENTS = ["searchControllerMain.on", "selectAuctnCsSrchRslt.on"]


def _build_options() -> uc.ChromeOptions:
    opts = uc.ChromeOptions()
    opts.add_argument("--lang=ko-KR")
    opts.add_argument("--window-size=1600,1000")
    opts.set_capability("goog:loggingPrefs", {"performance": "ALL"})
    return opts


def _drain_performance_log(driver) -> list[dict]:
    entries = []
    for entry in driver.get_log("performance"):
        try:
            message = json.loads(entry["message"])["message"]
        except (KeyError, json.JSONDecodeError):
            continue
        entries.append(message)
    return entries


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = uc.Chrome(options=_build_options())
    captured: list[dict] = []
    pending_requests: dict[str, dict] = {}

    try:
        print(f"[안내] Chrome 창을 엽니다: {MAIN_URL}")
        driver.get(MAIN_URL)

        print(
            f"\n[안내] {WAIT_SECONDS}초 동안 직접 조작해 주세요:\n"
            "  1) '물건상세검색' → 검색 버튼 클릭 (목록 API 캡처)\n"
            "  2) 물건 하나 클릭해 상세 열기 (상세 API 캡처)\n"
            "대상 API(searchControllerMain.on, selectAuctnCsSrchRslt.on)만 응답 본문까지 저장합니다.\n"
        )

        elapsed = 0
        interval = 3
        while elapsed < WAIT_SECONDS:
            time.sleep(interval)
            elapsed += interval

            for msg in _drain_performance_log(driver):
                method = msg.get("method")
                params = msg.get("params", {})

                if method == "Network.requestWillBeSent":
                    req_id = params.get("requestId")
                    req = params.get("request", {})
                    url = req.get("url", "")
                    if any(frag in url for frag in TARGET_PATH_FRAGMENTS):
                        pending_requests[req_id] = {
                            "url": url,
                            "method": req.get("method"),
                            "postData": req.get("postData"),
                        }

                elif method == "Network.responseReceived":
                    req_id = params.get("requestId")
                    if req_id not in pending_requests:
                        continue
                    try:
                        body_result = driver.execute_cdp_cmd(
                            "Network.getResponseBody", {"requestId": req_id}
                        )
                        pending_requests[req_id]["responseBody"] = body_result.get("body")
                        pending_requests[req_id]["base64Encoded"] = body_result.get(
                            "base64Encoded"
                        )
                    except Exception as exc:  # noqa: BLE001
                        pending_requests[req_id]["responseBody"] = f"<가져오기 실패: {exc}>"
                    captured.append(pending_requests.pop(req_id))

            remaining = WAIT_SECONDS - elapsed
            print(f"  ...남은 시간 {remaining}초 (대상 API 캡처 {len(captured)}건)")

        out_path = OUT_DIR / "manual2_target_apis_with_body.json"
        out_path.write_text(
            json.dumps(captured, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n[완료] 대상 API {len(captured)}건(응답 본문 포함) 저장: {out_path}")

    finally:
        driver.quit()


if __name__ == "__main__":
    main()
