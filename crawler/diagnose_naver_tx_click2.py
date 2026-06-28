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
    buttons = driver.find_elements(By.TAG_NAME, "button")
    area_btns = [b for b in buttons if "A형" in (b.text or "") or "전용" in (b.text or "")]
    print("area buttons:", [(b.text[:60], b.get_attribute("class")) for b in area_btns[:10]])
    if area_btns:
        area_btns[0].click()
        time.sleep(2)
    layers = driver.find_elements(By.XPATH, "//*[contains(@class,'Layer') or contains(@class,'layer')]")
    print(
        json.dumps(
            [{"text": (e.text or "")[:100], "class": e.get_attribute("class")} for e in layers[:15]],
            ensure_ascii=False,
            indent=2,
        )
    )
finally:
    try:
        driver.quit()
    except Exception:
        pass
