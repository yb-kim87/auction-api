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
    buttons = driver.find_elements(By.TAG_NAME, "button")
    btn_texts = [b.text.strip() for b in buttons if b.text.strip()][:30]
    info = {
        "url": driver.current_url,
        "title": driver.title,
        "buttons": btn_texts,
        "has_area_info": len(
            driver.find_elements(By.CLASS_NAME, "ComplexArticleItem_area-information__YTn9y")
        ),
        "body_snippet": (driver.find_element(By.TAG_NAME, "body").text or "")[:800],
    }
    print(json.dumps(info, ensure_ascii=False, indent=2))
finally:
    try:
        driver.quit()
    except Exception:
        pass
