"""법원경매정보(courtauction.go.kr)에서 사람이 직접 검색을 실행하는 동안
Chrome DevTools Protocol(Network 도메인) 로그로 모든 요청/응답을 캡처한다.

RIA 프레임워크 특성상 검색 버튼에 의미있는 id/class가 없어 자동 클릭
탐색이 어려우므로, 브라우저 창을 열어두고 사람이 직접 "물건상세검색" →
조건 입력 없이(또는 최소 조건으로) → "검색" 버튼까지 클릭해달라고 요청한다.
그동안의 모든 요청을 주기적으로 누적 기록한다.

사용법: python diagnose_courtauction_manual.py
  1. Chrome 창이 뜨면 courtauction.go.kr 메인 화면이 보인다.
  2. "물건상세검색" 메뉴로 들어가서, 아무 조건이나 하나 넣고(혹은 기본값
     그대로) "검색" 버튼을 클릭해 물건 목록이 뜨는지 확인한다.
  3. 목록이 뜨면 아무 물건이나 하나 클릭해 상세페이지도 열어본다.
  4. 콘솔에 카운트다운이 끝나면 자동으로 종료되고 결과가 저장된다.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import undetected_chromedriver as uc

OUT_DIR = Path(__file__).resolve().parent.parent / "logs" / "courtauction_probe"
MAIN_URL = "https://www.courtauction.go.kr/pgj/index.on"
WAIT_SECONDS = 180  # 사람이 직접 검색·상세 클릭할 시간


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


def _extract_requests(log_entries: list[dict], requests: dict[str, dict]) -> None:
    """requests 딕셔너리에 누적 기록(요청ID 기준으로 request/response 매칭)."""
    for msg in log_entries:
        method = msg.get("method")
        params = msg.get("params", {})

        if method == "Network.requestWillBeSent":
            req_id = params.get("requestId")
            req = params.get("request", {})
            requests[req_id] = {
                "url": req.get("url"),
                "method": req.get("method"),
                "postData": req.get("postData"),
                "resourceType": params.get("type"),
            }
        elif method == "Network.responseReceived":
            req_id = params.get("requestId")
            resp = params.get("response", {})
            if req_id in requests:
                requests[req_id]["status"] = resp.get("status")
                requests[req_id]["mimeType"] = resp.get("mimeType")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = uc.Chrome(options=_build_options())
    all_requests: dict[str, dict] = {}

    try:
        print(f"[안내] Chrome 창을 엽니다: {MAIN_URL}")
        driver.get(MAIN_URL)

        print(
            f"\n[안내] 이제부터 {WAIT_SECONDS}초 동안 브라우저 창에서 직접 조작해 주세요:\n"
            "  1) '물건상세검색' 메뉴로 이동\n"
            "  2) 조건은 기본값 그대로 두고(또는 원하는 조건 입력) '검색' 버튼 클릭\n"
            "  3) 검색 결과 목록에서 물건 하나를 클릭해 상세페이지까지 열어보기\n"
            "그동안 모든 네트워크 요청을 자동으로 기록합니다.\n"
        )

        elapsed = 0
        interval = 5
        while elapsed < WAIT_SECONDS:
            time.sleep(interval)
            elapsed += interval
            _extract_requests(_drain_performance_log(driver), all_requests)
            remaining = WAIT_SECONDS - elapsed
            print(f"  ...남은 시간 {remaining}초 (누적 요청 {len(all_requests)}건)")

        _extract_requests(_drain_performance_log(driver), all_requests)

        result = list(all_requests.values())
        out_path = OUT_DIR / "manual_all_requests.json"
        out_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n[완료] 총 {len(result)}건 저장: {out_path}")

        # JSON 응답을 준 API만 추려서 별도 요약 파일도 남긴다(분석 편의).
        json_apis = [
            r for r in result
            if r.get("mimeType") == "application/json" and r.get("method") == "POST"
        ]
        summary_path = OUT_DIR / "manual_json_apis_summary.json"
        summary_path.write_text(
            json.dumps(json_apis, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[완료] JSON API만 {len(json_apis)}건 요약: {summary_path}")

    finally:
        driver.quit()


if __name__ == "__main__":
    main()
