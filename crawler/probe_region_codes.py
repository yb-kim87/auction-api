"""관리자 PC(Chrome 설치 환경) 전용 1회성 스크립트 — 탱크옥션 검색 폼의
시/도 → 시/군/구 → 읍/면/동 연쇄 select가 어떤 API를 호출해 옵션을
채우는지 실측한다.

이 환경(서버/컨테이너)에는 Chrome이 없어 실행할 수 없다. 관리자 PC에서
`python probe_region_codes.py` 로 실행하면:
  1. 탱크옥션 로그인 후 /ca/caList.php 를 연다.
  2. CDP로 네트워크 요청을 후킹해 siCd select 변경 시 발생하는 XHR을 캡처한다.
  3. 캡처된 API 경로/파라미터를 region_probe_result.json 에 저장한다.
  4. (API를 찾으면) 서울(11) 기준으로 guCd 옵션을 select에서 읽어 함께 저장한다.

이 파일이 만든 JSON을 이 대화로 전달해 주면 presets_httpx.py 의
REGION_CODES 를 채워 넣는다. 기존 크롤러 파일(browser.py, tank_login.py)은
읽기만 하고 수정하지 않는다.
"""

from __future__ import annotations

import json
import time

from browser import get_driver
from selenium.webdriver.common.by import By
from tank_login import ensure_login


def main():
    driver = get_driver(navigate="https://www.tankauction.com/ca/caList.php")
    ensure_login(driver)

    driver.get("https://www.tankauction.com/ca/caList.php")
    time.sleep(2)

    # XHR/fetch 후킹 — siCd 변경 후 발생하는 요청의 URL만 모은다.
    driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {
            "source": """
            window.__regionRequests = [];
            const origOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url) {
                window.__regionRequests.push({method, url});
                return origOpen.apply(this, arguments);
            };
            const origFetch = window.fetch;
            window.fetch = function(url, opts) {
                window.__regionRequests.push({method: (opts && opts.method) || 'GET', url: String(url)});
                return origFetch.apply(this, arguments);
            };
            """
        },
    )
    driver.get("https://www.tankauction.com/ca/caList.php")
    time.sleep(2)

    si_select = driver.find_element(By.ID, "siCd")
    si_options = [
        (opt.get_attribute("value"), opt.text.strip())
        for opt in si_select.find_elements(By.TAG_NAME, "option")
    ]
    print(f"[probe] 시/도 옵션 {len(si_options)}개 확인")

    # 서울(값 확인 필요 - 보통 11)을 선택해 guCd 로딩 API를 유발
    seoul_value = next((v for v, label in si_options if "서울" in label), None)
    if not seoul_value:
        print("[probe] 서울 옵션을 찾지 못했습니다 — 수동 확인 필요")
        seoul_value = si_options[1][0] if len(si_options) > 1 else None

    if seoul_value:
        driver.execute_script(
            "document.getElementById('siCd').value = arguments[0];"
            "document.getElementById('siCd').dispatchEvent(new Event('change', {bubbles: true}));",
            seoul_value,
        )
        time.sleep(2)

    requests = driver.execute_script("return window.__regionRequests || [];")
    region_requests = [
        r for r in requests
        if any(k in r["url"] for k in ("guCd", "dnCd", "Area", "Region", "Gu", "Dong", "sido", "gugun"))
    ]

    gu_select = driver.find_element(By.ID, "guCd")
    gu_options = [
        (opt.get_attribute("value"), opt.text.strip())
        for opt in gu_select.find_elements(By.TAG_NAME, "option")
    ]
    print(f"[probe] 서울 선택 후 구/군 옵션 {len(gu_options)}개 확인")

    result = {
        "si_options": si_options,
        "seoul_value_used": seoul_value,
        "gu_options_after_seoul": gu_options,
        "captured_requests_all": requests,
        "captured_requests_region_filtered": region_requests,
    }

    with open("region_probe_result.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print("[probe] 결과를 region_probe_result.json 에 저장했습니다.")
    print("[probe] 이 파일을 대화로 전달해 주세요.")


if __name__ == "__main__":
    main()
