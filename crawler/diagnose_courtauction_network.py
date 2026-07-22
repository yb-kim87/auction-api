"""법원경매정보(courtauction.go.kr) 물건 검색 시 실제로 오가는 네트워크 요청을
Chrome DevTools Protocol(Network 도메인) 로그로 캡처한다.

목적: 화면이 XML/JS로 렌더링되는 RIA 구조라, HTTPX(순수 HTTP 요청)만으로
크롤링이 가능한지 판단하려면 "브라우저가 실제로 어떤 백엔드 엔드포인트를
호출해서 물건 데이터(JSON/XML)를 받아오는지"를 먼저 확인해야 한다.

사용법: python diagnose_courtauction_network.py
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By

OUT_DIR = Path(__file__).resolve().parent.parent / "logs" / "courtauction_probe"
MAIN_URL = "https://www.courtauction.go.kr/pgj/index.on"


def _build_options() -> uc.ChromeOptions:
    opts = uc.ChromeOptions()
    opts.add_argument("--lang=ko-KR")
    opts.add_argument("--window-size=1920,1080")
    # CDP performance 로그를 켜서 Network.* 이벤트(모든 요청/응답)를 수집한다.
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


def _extract_requests(log_entries: list[dict]) -> list[dict]:
    """Network.requestWillBeSent / Network.responseReceived 이벤트에서
    URL·메서드·응답 content-type·상태코드를 뽑아 요약한다."""
    requests: dict[str, dict] = {}
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

    return list(requests.values())


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = uc.Chrome(options=_build_options())

    try:
        print(f"[1] 메인 페이지 접속: {MAIN_URL}")
        driver.get(MAIN_URL)
        time.sleep(5)  # RIA 프레임워크 초기 렌더링 대기

        main_page_requests = _extract_requests(_drain_performance_log(driver))
        (OUT_DIR / "01_main_page_requests.json").write_text(
            json.dumps(main_page_requests, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"    → 요청 {len(main_page_requests)}건 기록 (01_main_page_requests.json)")

        print("[2] 페이지 소스 일부 저장(구조 파악용)")
        (OUT_DIR / "01_main_page_source.html").write_text(
            driver.page_source, encoding="utf-8"
        )

        # "물건상세검색" 또는 유사 메뉴 링크를 찾아 클릭 시도.
        # 정확한 셀렉터는 실제 DOM을 봐야 알 수 있으므로, 우선 텍스트 기반으로 탐색.
        print("[3] '물건상세검색' 메뉴 탐색 시도")
        candidates = driver.find_elements(By.PARTIAL_LINK_TEXT, "물건상세검색")
        if not candidates:
            candidates = driver.find_elements(By.XPATH, "//*[contains(text(), '물건상세검색')]")
        print(f"    → 후보 {len(candidates)}개 발견")

        if candidates:
            try:
                candidates[0].click()
                time.sleep(5)
                search_page_requests = _extract_requests(_drain_performance_log(driver))
                (OUT_DIR / "02_search_page_requests.json").write_text(
                    json.dumps(search_page_requests, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                print(f"    → 요청 {len(search_page_requests)}건 기록 (02_search_page_requests.json)")
                (OUT_DIR / "02_search_page_source.html").write_text(
                    driver.page_source, encoding="utf-8"
                )
            except Exception as exc:  # noqa: BLE001
                print(f"    ! 클릭 실패: {exc}")
        else:
            print("    ! 메뉴를 찾지 못함 — 01_main_page_source.html을 사람이 직접 확인 필요")

        # "검색" 버튼을 찾아 클릭해 실제 물건 목록 조회 API를 캡처한다.
        print("[4] '검색' 버튼 탐색 및 클릭 시도(물건 목록 API 캡처 목적)")
        search_btn_candidates = driver.find_elements(By.XPATH, "//*[contains(text(), '검색')]")
        print(f"    → '검색' 텍스트 후보 {len(search_btn_candidates)}개")
        clicked = False
        for i, el in enumerate(search_btn_candidates):
            try:
                if el.is_displayed() and el.tag_name.lower() in ("button", "a", "span", "div"):
                    el.click()
                    clicked = True
                    print(f"    → 후보 #{i} 클릭 성공 (tag={el.tag_name}, text={el.text[:30]!r})")
                    break
            except Exception:
                continue

        if clicked:
            time.sleep(6)
            list_page_requests = _extract_requests(_drain_performance_log(driver))
            (OUT_DIR / "03_list_page_requests.json").write_text(
                json.dumps(list_page_requests, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"    → 요청 {len(list_page_requests)}건 기록 (03_list_page_requests.json)")
            (OUT_DIR / "03_list_page_source.html").write_text(
                driver.page_source, encoding="utf-8"
            )
        else:
            print("    ! 검색 버튼 클릭 실패 — 브라우저 창을 열어둔 채로 대기하니 수동 클릭 가능")

        print(f"\n완료. 결과는 {OUT_DIR} 에 저장됨.")
        print("브라우저 창을 60초간 유지합니다(직접 조작해 추가 캡처하려면 이 시간 내에).")
        time.sleep(60)

        final_requests = _extract_requests(_drain_performance_log(driver))
        if final_requests:
            (OUT_DIR / "04_final_requests.json").write_text(
                json.dumps(final_requests, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"    → 추가 요청 {len(final_requests)}건 기록 (04_final_requests.json)")

    finally:
        driver.quit()


if __name__ == "__main__":
    main()
