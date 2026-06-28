import json
import time

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By

URL = (
    "https://fin.land.naver.com/complexes/25142"
    "?tradeTypes=A1&sortingType=%EB%82%AE%EC%9D%80%EA%B0%80%EA%B2%A9%EC%88%9C&tab=article"
)
opts = uc.ChromeOptions()
opts.add_argument("--lang=ko-KR")
driver = uc.Chrome(options=opts, version_main=149)
try:
    driver.get(URL)
    time.sleep(6)
    cards = driver.find_elements(By.CSS_SELECTOR, "[class*='ArticleCard-module']")
    card_info = []
    seen = set()
    for el in cards:
        cls = el.get_attribute("class") or ""
        if cls in seen:
            continue
        seen.add(cls)
        card_info.append({"class": cls, "text": (el.text or "")[:200]})
    print(json.dumps(card_info[:20], ensure_ascii=False, indent=2))
finally:
    try:
        driver.quit()
    except Exception:
        pass
