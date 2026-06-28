import json
import time

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By

URL = (
    "https://fin.land.naver.com/complexes/25142"
    "?tradeType=A1&marketPriceCP=kab&tab=transaction"
)
opts = uc.ChromeOptions()
opts.add_argument("--lang=ko-KR")
driver = uc.Chrome(options=opts, version_main=149)
try:
    driver.get(URL)
    time.sleep(6)
    clickable = driver.find_elements(
        By.XPATH, "//*[contains(text(), '134') or contains(text(), '전용')]"
    )
    samples = [
        {"tag": e.tag_name, "class": e.get_attribute("class"), "text": (e.text or "")[:100]}
        for e in clickable[:20]
    ]
    filters = driver.find_elements(By.CSS_SELECTOR, "[class*='ComplexTransactionPriceFilter']")
    print(
        json.dumps(
            {
                "filter_count": len(filters),
                "filter_text": [f.text[:200] for f in filters[:3]],
                "samples": samples,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
finally:
    try:
        driver.quit()
    except Exception:
        pass
