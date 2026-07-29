"""매각물건명세서 링크(ecfs.scourt.go.kr, encParam 포함)가 어떤 요청으로
생성되는지 확인하기 위한 최소 단위 캡처 스크립트.

사용자가 실제 화면에서 재현한 경로를 그대로 자동화한다:
  1) https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml (물건상세검색)
  2) 소재지(지번주소) > 서울특별시, 용도 > 건물 > 주거용건물 > 아파트, 검색
  3) 목록 1행(사건번호) 클릭 → 상세 페이지
  4) "매각물건명세서" 클릭

CDP Network 도메인으로 전체 요청/응답을 기록해 encParam이 서버 왕복으로
생성되는지, 클라이언트 JS만으로 만들어지는지 판별한다. 브라우저는 종료하지
않고 유지한다(사용자 지침).
"""

from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

# Windows 콘솔(cp949) 인코딩 때문에 한글/특수문자 print가 죽는 문제 방지.
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

OUT_DIR = Path(__file__).resolve().parent / "courtauction_probe"
START_URL = "https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml"


def _build_options() -> uc.ChromeOptions:
    opts = uc.ChromeOptions()
    opts.add_argument("--lang=ko-KR")
    opts.add_argument("--window-size=1600,1000")
    opts.set_capability("goog:loggingPrefs", {"performance": "ALL"})
    return opts


def _make_driver() -> uc.Chrome:
    # 설치된 Chrome(150)과 undetected_chromedriver 기본 드라이버(151) 버전이
    # 어긋나 있어 명시적으로 맞춘다.
    return uc.Chrome(options=_build_options(), version_main=150)


def _drain_performance_log(driver) -> list[dict]:
    entries = []
    for entry in driver.get_log("performance"):
        try:
            message = json.loads(entry["message"])["message"]
        except (KeyError, json.JSONDecodeError):
            continue
        entries.append(message)
    return entries


def _js_click(driver, el) -> None:
    """WebSquare 커스텀 위젯은 실제로는 화면 밖/숨김 상태인 DOM에 옵션
    텍스트가 존재하는 경우가 많아 일반 click()이 element not interactable로
    실패한다. 스크롤 후 JS로 강제 클릭한다."""
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", el)
    driver.execute_script("arguments[0].click();", el)


def _collect(driver, captured: list[dict], pending: dict[str, dict]) -> None:
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


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = _make_driver()
    captured: list[dict] = []
    pending: dict[str, dict] = {}
    steps_log: list[str] = []

    def note(msg: str) -> None:
        print(msg, flush=True)
        steps_log.append(msg)

    try:
        note(f"[1] 이동: {START_URL}")
        driver.get(START_URL)
        time.sleep(4)
        _collect(driver, captured, pending)

        # 소재지(지번주소) 라디오는 스크린샷상 기본 선택돼 있음. 시/도
        # select는 WebSquare 커스텀 위젯일 수 있어 네이티브 select와
        # 커스텀 콤보 양쪽을 시도한다.
        note("[2] 시/도 = 서울특별시 선택 시도")
        selected_sido = False
        try:
            selects = driver.find_elements(By.TAG_NAME, "select")
            note(f"    select 태그 {len(selects)}개 발견")
            for sel in selects:
                options = [o.text.strip() for o in sel.find_elements(By.TAG_NAME, "option")]
                if "서울특별시" in options:
                    from selenium.webdriver.support.ui import Select

                    Select(sel).select_by_visible_text("서울특별시")
                    selected_sido = True
                    note("    select[option=서울특별시] 클릭 성공")
                    break
        except Exception as exc:  # noqa: BLE001
            note(f"    select 방식 실패: {exc}")

        if not selected_sido:
            try:
                candidates = driver.find_elements(
                    By.XPATH, "//*[contains(text(),'서울특별시')]"
                )
                note(f"    텍스트 '서울특별시' 후보 {len(candidates)}개")
                if candidates:
                    _js_click(driver, candidates[0])
                    selected_sido = True
                    note("    텍스트 클릭으로 서울특별시 선택")
            except Exception as exc:  # noqa: BLE001
                note(f"    텍스트 클릭 방식도 실패: {exc}")

        time.sleep(2)
        _collect(driver, captured, pending)

        note("[3] 검색 버튼 클릭 시도")
        clicked_search = False
        for xpath in [
            "//button[contains(., '검색') and not(contains(., '초기화'))]",
            "//a[contains(., '검색')]",
            "//*[@id][contains(text(),'검색')]",
        ]:
            try:
                btns = driver.find_elements(By.XPATH, xpath)
                if btns:
                    _js_click(driver, btns[0])
                    clicked_search = True
                    note(f"    검색 버튼 클릭 성공(xpath={xpath})")
                    break
            except Exception as exc:  # noqa: BLE001
                note(f"    xpath 실패({xpath}): {exc}")
        if not clicked_search:
            note("    검색 버튼을 찾지 못함 — 수동 확인 필요")

        time.sleep(5)
        _collect(driver, captured, pending)

        note("[4] 목록 1행 사건번호 링크 클릭 시도")
        clicked_case = False
        try:
            links = driver.find_elements(By.XPATH, "//a[contains(@href,'javascript') or @class]")
            # 사건번호 패턴(YYYY타경NNNNN)을 가진 링크를 찾는다.
            import re

            pattern = re.compile(r"\d{4}타경\d+")
            for link in links:
                text = (link.text or "").strip()
                if pattern.search(text):
                    _js_click(driver, link)
                    clicked_case = True
                    note(f"    사건번호 링크 클릭: {text[:30]}")
                    break
        except Exception as exc:  # noqa: BLE001
            note(f"    사건번호 링크 탐색 실패: {exc}")
        if not clicked_case:
            note("    사건번호 링크를 찾지 못함 — 수동 확인 필요")

        time.sleep(5)
        _collect(driver, captured, pending)

        note("[5] '매각물건명세서' 클릭 시도")
        clicked_msmt = False
        try:
            candidates = driver.find_elements(
                By.XPATH, "//*[contains(text(),'매각물건명세서')]"
            )
            note(f"    '매각물건명세서' 텍스트 후보 {len(candidates)}개")
            for cand in candidates:
                try:
                    _js_click(driver, cand)
                    clicked_msmt = True
                    note("    매각물건명세서 클릭 성공")
                    break
                except Exception:
                    continue
        except Exception as exc:  # noqa: BLE001
            note(f"    매각물건명세서 탐색 실패: {exc}")

        time.sleep(5)
        _collect(driver, captured, pending)

        note(f"[6] 현재 창 핸들: {driver.window_handles}")
        for handle in driver.window_handles:
            driver.switch_to.window(handle)
            note(f"    핸들 {handle} URL: {driver.current_url}")

        out_path = OUT_DIR / "msmt_link_capture.json"
        out_path.write_text(
            json.dumps(
                {"steps": steps_log, "requests": captured},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        note(f"[완료] 캡처 {len(captured)}건 저장: {out_path}")
        note("[안내] 브라우저는 계속 열어둡니다(사용자 지침) — 이 프로세스를 종료하지 마세요.")

        # 브라우저를 열어둔 채로 프로세스도 유지(quit 호출 안 함).
        while True:
            time.sleep(60)

    except KeyboardInterrupt:
        note("[중단] KeyboardInterrupt — 브라우저는 유지합니다.")
        while True:
            time.sleep(60)


if __name__ == "__main__":
    main()
