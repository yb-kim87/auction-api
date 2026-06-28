"""네이버 fin.land 접근 진단 스크립트."""
import json
import sys
import time

URL = (
    "https://fin.land.naver.com/complexes/25142"
    "?tradeTypes=A1&sortingType=%EB%82%AE%EC%9D%80%EA%B0%80%EA%B2%A9%EC%88%9C&tab=article"
)

def probe_selenium():
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options

    opts = Options()
    opts.add_argument("--lang=ko-KR")
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    opts.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    )

    driver = webdriver.Chrome(options=opts)
    try:
        driver.execute_cdp_cmd(
            "Page.addScriptToEvaluateOnNewDocument",
            {
                "source": (
                    "Object.defineProperty(navigator, 'webdriver', "
                    "{get: () => undefined});"
                )
            },
        )
        driver.get(URL)
        time.sleep(4)
        info = driver.execute_script(
            """
            return {
              webdriver: navigator.webdriver,
              userAgent: navigator.userAgent,
              languages: navigator.languages,
              pluginsLength: navigator.plugins.length,
              hasChrome: !!window.chrome,
              cdcKeys: Object.keys(window).filter(k => k.startsWith('cdc_')),
              title: document.title,
              url: location.href,
              bodySnippet: (document.body && document.body.innerText || '').slice(0, 800),
            };
            """
        )
        return {"mode": "selenium_default", **info}
    finally:
        driver.quit()


def probe_selenium_via_tank():
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By

    opts = Options()
    opts.add_argument("--lang=ko-KR")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)

    driver = webdriver.Chrome(options=opts)
    try:
        driver.get("https://www.tankauction.com/")
        time.sleep(2)
        driver.switch_to.new_window("tab")
        driver.get(URL)
        time.sleep(4)
        info = driver.execute_script(
            """
            return {
              webdriver: navigator.webdriver,
              title: document.title,
              url: location.href,
              bodySnippet: (document.body && document.body.innerText || '').slice(0, 800),
            };
            """
        )
        return {"mode": "selenium_after_tank_new_tab", **info}
    finally:
        driver.quit()


def main():
    modes = [probe_selenium]
    if len(sys.argv) > 1 and sys.argv[1] == "tank":
        modes.append(probe_selenium_via_tank)

    results = []
    for fn in modes:
        try:
            results.append(fn())
        except Exception as exc:
            results.append({"mode": fn.__name__, "error": str(exc)})

    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
