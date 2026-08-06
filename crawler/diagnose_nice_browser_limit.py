"""나이스옥션 상세 API 비로그인 12건 제한이 raw API 호출뿐 아니라
실제 브라우저(사람이 페이지를 넘겨보는 것과 동일한 흐름)에서도
동일하게 걸리는지 확인한다 — 같은 IP, 새 브라우저 프로필(쿠키 없음)로
물건 상세 페이지를 순서대로 열어보며 CDP로 /api/v1/obj/ 응답 상태를
기록한다.
"""

from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

import undetected_chromedriver as uc

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

OBJ_IDS = json.loads(Path("_browser_test_objids.json").read_text(encoding="utf-8"))


def _build_options() -> uc.ChromeOptions:
    opts = uc.ChromeOptions()
    opts.add_argument("--lang=ko-KR")
    opts.add_argument("--window-size=1400,1000")
    opts.add_argument("--incognito")
    opts.set_capability("goog:loggingPrefs", {"performance": "ALL"})
    return opts


def _drain(driver) -> list[dict]:
    entries = []
    for entry in driver.get_log("performance"):
        try:
            message = json.loads(entry["message"])["message"]
        except (KeyError, json.JSONDecodeError):
            continue
        entries.append(message)
    return entries


def main() -> None:
    driver = uc.Chrome(options=_build_options(), version_main=150)
    driver.execute_cdp_cmd("Network.enable", {})
    pending: dict[str, dict] = {}
    results: list[dict] = []
    try:
        for i, obj_id in enumerate(OBJ_IDS, start=1):
            url = f"https://niceauction.co.kr/auction/detail/{obj_id}"
            driver.get(url)
            time.sleep(2.5)

            # 이 objId에 대한 모든 요청/응답을 기록(마지막 것만 남기지 않음) —
            # 1차 요청 실패 후 페이지 JS가 재시도해 최종 200을 받아도, 화면엔
            # 1차 실패 얼럿이 그대로 남아있는 경우가 실측 확인됨(2026-07-30).
            attempts = []
            for msg in _drain(driver):
                method = msg.get("method")
                params = msg.get("params", {})
                if method == "Network.requestWillBeSent":
                    req_id = params.get("requestId")
                    req = params.get("request", {})
                    if f"/api/v1/obj/{obj_id}" in req.get("url", ""):
                        pending[req_id] = {"url": req.get("url", "")}
                elif method == "Network.responseReceived":
                    req_id = params.get("requestId")
                    if req_id in pending:
                        resp = params.get("response", {})
                        body_ok = None
                        body_code = None
                        try:
                            body = driver.execute_cdp_cmd(
                                "Network.getResponseBody", {"requestId": req_id}
                            )
                            parsed = json.loads(body.get("body", "{}"))
                            body_code = parsed.get("code")
                            body_ok = body_code == 0
                        except Exception:  # noqa: BLE001
                            pass
                        attempts.append(
                            {
                                "httpStatus": resp.get("status"),
                                "bodyCode": body_code,
                                "bodyOk": body_ok,
                            }
                        )
                        pending.pop(req_id, None)

            final_ok = bool(attempts) and attempts[-1]["bodyOk"] is True
            print(
                f"[{i}/{len(OBJ_IDS)}] objId={obj_id} attempts={attempts} finalOk={final_ok}",
                flush=True,
            )
            results.append({"i": i, "objId": obj_id, "attempts": attempts, "finalOk": final_ok})

        print("\n결과 요약:", flush=True)
        for r in results:
            print(r, flush=True)
    finally:
        driver.quit()
        print("[종료] 브라우저 닫음", flush=True)


if __name__ == "__main__":
    main()
