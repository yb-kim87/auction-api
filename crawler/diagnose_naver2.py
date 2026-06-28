"""네이버 fin.land 접근 진단 - 리다이렉트/차단 비교."""
import json
import time

URL = (
    "https://fin.land.naver.com/complexes/25142"
    "?tradeTypes=A1&sortingType=%EB%82%AE%EC%9D%80%EA%B0%80%EA%B2%A9%EC%88%9C&tab=article"
)


def snapshot(driver, label: str) -> dict:
    time.sleep(3)
    data = driver.execute_script(
        """
        return {
          webdriver: navigator.webdriver,
          cdcKeys: Object.keys(window).filter(k => k.startsWith('cdc_')),
          title: document.title,
          url: location.href,
          bodySnippet: (document.body && document.body.innerText || '').slice(0, 500),
        };
        """
    )
    data["label"] = label
    return data


def test_standard():
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options

    opts = Options()
    opts.add_argument("--lang=ko-KR")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
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
        return {"mode": "standard_selenium", "steps": [snapshot(driver, "after_get")]}
    finally:
        driver.quit()


def test_undetected():
    import undetected_chromedriver as uc

    opts = uc.ChromeOptions()
    opts.add_argument("--lang=ko-KR")
    driver = uc.Chrome(options=opts, version_main=None)
    try:
        driver.get(URL)
        return {"mode": "undetected_chromedriver", "steps": [snapshot(driver, "after_get")]}
    finally:
        driver.quit()


def test_undetected_naver_first():
    import undetected_chromedriver as uc

    opts = uc.ChromeOptions()
    opts.add_argument("--lang=ko-KR")
    driver = uc.Chrome(options=opts, version_main=None)
    try:
        driver.get("https://www.naver.com/")
        time.sleep(2)
        driver.switch_to.new_window("tab")
        driver.get(URL)
        return {
            "mode": "undetected_naver_cookie_first",
            "steps": [snapshot(driver, "after_get")],
        }
    finally:
        driver.quit()


def main():
    results = []
    for fn in (test_standard, test_undetected, test_undetected_naver_first):
        try:
            results.append(fn())
        except Exception as exc:
            results.append({"mode": fn.__name__, "error": str(exc)})
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
