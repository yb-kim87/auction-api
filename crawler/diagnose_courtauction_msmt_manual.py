"""매각물건명세서 링크(ecfs.scourt.go.kr) 생성 과정을 사람이 직접 클릭하며
확인하는 캡처 스크립트. 자동 클릭(diagnose_courtauction_msmt_link.py)이
WebSquare 커스텀 위젯에서 계속 엉뚱한 요소를 집는 문제로 실패해, 이번엔
브라우저 창을 띄워두고 사용자가 직접 조작하는 동안 CDP로 전체 네트워크
요청/응답을 기록한다.

사용법: 이 스크립트를 실행하면 Chrome 창이 뜬다. 그 창에서 사용자가
  1) 소재지 > 서울특별시, 용도 > 건물 > 주거용건물 > 아파트, 검색
  2) 목록 1행 사건번호 클릭
  3) 상세 페이지에서 '매각물건명세서' 클릭
을 직접 진행하면 된다. 새 창/탭이 열리면(ecfs.scourt.go.kr) 그대로 둔다.
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

OUT_DIR = Path(__file__).resolve().parent / "courtauction_probe"
START_URL = "https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml"
WAIT_SECONDS = 240


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
    driver = uc.Chrome(options=_build_options(), version_main=150)
    captured: list[dict] = []
    pending: dict[str, dict] = {}

    try:
        print(f"[안내] Chrome 창을 엽니다: {START_URL}", flush=True)
        driver.get(START_URL)

        print(
            f"\n[안내] {WAIT_SECONDS}초 동안 직접 조작해 주세요:\n"
            "  1) 소재지 > 서울특별시, 용도 > 건물 > 주거용건물 > 아파트 선택 후 검색\n"
            "  2) 목록 1행 사건번호 클릭\n"
            "  3) 상세 페이지에서 '매각물건명세서' 클릭 (새 창/탭이 뜨면 그대로 둠)\n"
            "전체 네트워크 요청/응답을 계속 기록합니다.\n",
            flush=True,
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
                        pending[req_id]["base64Encoded"] = body.get("base64Encoded")
                    except Exception as exc:  # noqa: BLE001
                        pending[req_id]["responseBody"] = f"<가져오기 실패: {exc}>"
                    captured.append(pending.pop(req_id))

            handles = driver.window_handles
            urls = []
            for h in handles:
                try:
                    driver.switch_to.window(h)
                    urls.append(driver.current_url)
                except Exception:  # noqa: BLE001
                    pass

            remaining = WAIT_SECONDS - elapsed
            print(
                f"  ...남은 시간 {remaining}초 (요청 {len(captured)}건, 창 {len(handles)}개: {urls})",
                flush=True,
            )

            if any("ecfs" in u or "sgvo" in u.lower() for u in urls):
                print("\n[감지] ecfs/sgvo URL을 가진 창을 발견했습니다 — 10초 더 대기 후 저장합니다.", flush=True)
                time.sleep(10)
                for _ in range(3):
                    for msg in _drain_performance_log(driver):
                        pass
                break

        out_path = OUT_DIR / "msmt_manual_capture.json"
        out_path.write_text(
            json.dumps(captured, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n[완료] 캡처 {len(captured)}건 저장: {out_path}", flush=True)
        print("[안내] 브라우저는 계속 열어둡니다 — 종료하지 마세요.", flush=True)

        while True:
            time.sleep(60)

    except KeyboardInterrupt:
        print("[중단] 브라우저는 유지합니다.", flush=True)
        while True:
            time.sleep(60)


if __name__ == "__main__":
    main()
