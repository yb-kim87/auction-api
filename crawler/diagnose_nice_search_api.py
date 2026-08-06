"""나이스옥션 고급검색 페이지(/search/total?...)가 비로그인 상태에서도
카운트를 보여주는지, 그렇다면 실제로 어떤 API를 호출하는지 CDP로
캡처한다. 사용자 제공 URL을 그대로 새(비로그인) 프로필로 연다."""

from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

import undetected_chromedriver as uc

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

OUT_DIR = Path(__file__).resolve().parent / "courtauction_probe"
TARGET_URL = (
    "https://niceauction.co.kr/search/total?searchType=advanced&objTypes=%EA%B2%BD%EB%A7%A4"
    "&dspslDxdyYmdStart=2026-07-30&tojiAreaUnit=m2&bldgAreaUnit=m2"
    "&objProgStatusCd=9000003%2C9000004%2C9000006%2C9000012%2C9000011"
    "&courtCdPnuCdMode=pnuCd&specialObjCdMode=include&yongdoCd=2020110"
    "&isUpdatePicker=false"
    "&pageSortOrder=objType_asc%2CdspslDxdyYmd_desc%2CsaYear_desc%2CsaNo_desc%2CobjNo2_asc"
    "&pageSize=20"
)
WAIT_SECONDS = 240


def _build_options() -> uc.ChromeOptions:
    opts = uc.ChromeOptions()
    opts.add_argument("--lang=ko-KR")
    opts.add_argument("--window-size=1600,1000")
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
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = uc.Chrome(options=_build_options(), version_main=150)
    captured: list[dict] = []
    pending: dict[str, dict] = {}
    try:
        print(f"[안내] 비로그인 프로필로 이동: {TARGET_URL}", flush=True)
        driver.get(TARGET_URL)
        print(
            f"\n[안내] {WAIT_SECONDS}초 동안 직접 조작해 주세요:\n"
            "  용도(yongdoCd) 필터를 바꿔가며 눌러보시면 됩니다.\n"
            "  그동안 모든 API 요청/응답을 계속 기록합니다.\n",
            flush=True,
        )

        elapsed = 0
        interval = 2
        while elapsed < WAIT_SECONDS:
            time.sleep(interval)
            elapsed += interval
            for msg in _drain(driver):
                method = msg.get("method")
                params = msg.get("params", {})
                if method == "Network.requestWillBeSent":
                    req_id = params.get("requestId")
                    req = params.get("request", {})
                    pending[req_id] = {
                        "url": req.get("url", ""),
                        "method": req.get("method"),
                        "postData": req.get("postData"),
                    }
                elif method == "Network.responseReceived":
                    req_id = params.get("requestId")
                    if req_id not in pending:
                        continue
                    try:
                        body = driver.execute_cdp_cmd(
                            "Network.getResponseBody", {"requestId": req_id}
                        )
                        pending[req_id]["responseBody"] = body.get("body")
                    except Exception as exc:  # noqa: BLE001
                        pending[req_id]["responseBody"] = f"<실패: {exc}>"
                    captured.append(pending.pop(req_id))
            print(f"  ...{elapsed}s, 요청 {len(captured)}건", flush=True)

        api_calls = [
            r for r in captured
            if "/api/" in r["url"] and "niceauction" in r["url"]
        ]
        out_path = OUT_DIR / "nice_search_api_capture.json"
        out_path.write_text(
            json.dumps({"api_calls": api_calls, "all": captured}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"\n[완료] api 호출 {len(api_calls)}건(전체 {len(captured)}건) 저장: {out_path}", flush=True)
        for r in api_calls:
            print(" -", r["method"], r["url"][:150], flush=True)
        print("[안내] 브라우저는 계속 열어둡니다 — 종료하지 마세요.", flush=True)
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        print("[중단] 브라우저는 유지합니다.", flush=True)
        while True:
            time.sleep(60)


if __name__ == "__main__":
    main()
