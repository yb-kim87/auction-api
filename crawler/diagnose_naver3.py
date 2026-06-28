"""map URL 및 N단지 링크 클릭 시뮬레이션 진단."""
import json
import time

COMPLEX_ID = "25142"
ARTICLE_URL = (
    f"https://fin.land.naver.com/complexes/{COMPLEX_ID}"
    "?tradeTypes=A1&sortingType=%EB%82%AE%EC%9D%80%EA%B0%80%EA%B2%A9%EC%88%9C&tab=article"
)
MAP_URL = (
    "https://fin.land.naver.com/map?tradeTypes=A1&layer="
    "NobwRAlgJmBcYGMD2BbADgGwKYA8D6UWALgIYQZgA0YaJATiSgM5zjLrY4CSM8ATAFYAjABY%2BYAL7UmWeggAWABXqMWscKQBGcMPSIQE2KmCINCAFQCeaLGrABBIcaZI6%2BgHYBzKzZ2A6hsABccAAGsBKmsAcIckJAF0gA"
)
TANK_STYLE_HREF = f"https://fin.land.naver.com/complexes/{COMPLEX_ID}"


def snap(driver, label):
    time.sleep(3)
    return {
        "label": label,
        "url": driver.current_url,
        "title": driver.title,
        "cdcCount": driver.execute_script(
            "return Object.keys(window).filter(k => k.startsWith('cdc_')).length;"
        ),
        "webdriver": driver.execute_script("return navigator.webdriver;"),
        "body": driver.execute_script(
            "return (document.body && document.body.innerText || '').slice(0, 400);"
        ),
    }


def run():
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By

    opts = Options()
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    driver = webdriver.Chrome(options=opts)
    steps = []
    try:
        # 1) direct article URL
        driver.get(ARTICLE_URL)
        steps.append(snap(driver, "direct_article_url"))

        # 2) map redirect URL
        driver.get(MAP_URL)
        steps.append(snap(driver, "map_redirect_url"))

        # 3) fin.land home then link navigation
        driver.get("https://fin.land.naver.com/")
        time.sleep(2)
        driver.execute_script("window.open(arguments[0], '_blank');", ARTICLE_URL)
        driver.switch_to.window(driver.window_handles[-1])
        steps.append(snap(driver, "home_then_window_open"))

        # 4) simulate tank: page with anchor click
        driver.switch_to.window(driver.window_handles[0])
        driver.get("about:blank")
        driver.execute_script(
            """
            const a = document.createElement('a');
            a.href = arguments[0];
            a.textContent = 'N단지정보';
            a.target = '_blank';
            document.body.appendChild(a);
            a.click();
            """,
            TANK_STYLE_HREF,
        )
        driver.switch_to.window(driver.window_handles[-1])
        steps.append(snap(driver, "anchor_click_new_tab"))
    finally:
        driver.quit()
    print(json.dumps(steps, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    run()
