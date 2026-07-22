"""searchControllerMain.on 요청의 실제 전체 HTTP 헤더(쿠키 포함)를 캡처한다.
앞서 캡처한 postData만으로는 HTTPX 재현이 400으로 실패해서, 브라우저가
실제로 보내는 커스텀 헤더/쿠키가 있는지 확인이 필요하다."""

from __future__ import annotations

import json
import time
from pathlib import Path

import undetected_chromedriver as uc

OUT_DIR = Path(__file__).resolve().parent.parent / "logs" / "courtauction_probe"
MAIN_URL = "https://www.courtauction.go.kr/pgj/index.on"
WAIT_SECONDS = 90
TARGET = "searchControllerMain.on"


def _build_options() -> uc.ChromeOptions:
    opts = uc.ChromeOptions()
    opts.add_argument("--lang=ko-KR")
    opts.add_argument("--window-size=1600,1000")
    opts.set_capability("goog:loggingPrefs", {"performance": "ALL"})
    return opts


def _drain(driver) -> list[dict]:
    entries = []
    for entry in driver.get_log("performance"):
        try:
            entries.append(json.loads(entry["message"])["message"])
        except (KeyError, json.JSONDecodeError):
            continue
    return entries


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = uc.Chrome(options=_build_options())
    captured = []

    try:
        driver.get(MAIN_URL)
        print(f"[안내] {WAIT_SECONDS}초 동안 물건상세검색 → 검색 버튼을 눌러주세요.")

        elapsed = 0
        while elapsed < WAIT_SECONDS:
            time.sleep(3)
            elapsed += 3
            for msg in _drain(driver):
                method = msg.get("method")
                params = msg.get("params", {})
                if method == "Network.requestWillBeSentExtraInfo":
                    headers = params.get("headers", {})
                    if any(TARGET in str(v) for v in headers.values()):
                        pass  # headers alone don't contain URL; matched via requestId below
                if method == "Network.requestWillBeSent":
                    req = params.get("request", {})
                    if TARGET in req.get("url", ""):
                        captured.append(
                            {
                                "requestId": params.get("requestId"),
                                "url": req.get("url"),
                                "headers": req.get("headers"),
                            }
                        )
            print(f"  ...남은 시간 {WAIT_SECONDS - elapsed}초 (캡처 {len(captured)}건)")

        out_path = OUT_DIR / "headers_capture.json"
        out_path.write_text(json.dumps(captured, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[완료] {out_path}")

    finally:
        driver.quit()


if __name__ == "__main__":
    main()
