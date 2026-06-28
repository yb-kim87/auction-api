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
    filt = driver.find_element(By.CSS_SELECTOR, "[class*='ComplexTransactionPriceFilter']")
    filt.click()
    time.sleep(1)
    options = driver.find_elements(
        By.XPATH,
        "//*[contains(@class,'SelectLayer') or contains(@class,'CheckboxLayer') or contains(@class,'Chip-module')]",
    )
    texts = [(e.tag_name, (e.text or "")[:80], e.get_attribute("class")) for e in options[:25]]
    print(json.dumps(texts, ensure_ascii=False, indent=2))
finally:
    try:
        driver.quit()
    except Exception:
        pass
