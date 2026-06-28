import json
import time

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

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
    info = {
        "url": driver.current_url,
        "title": driver.title,
        "body": (driver.find_element(By.TAG_NAME, "body").text or "")[:600],
        "chip_buttons": [
            b.text for b in driver.find_elements(By.CSS_SELECTOR, "[class*='Chip-module']")[:10]
        ],
        "select_labels": [
            el.text[:80]
            for el in driver.find_elements(By.CSS_SELECTOR, "[class*='SelectLayer']")[:10]
        ],
        "tx_classes": driver.execute_script(
            """
            const out = new Set();
            document.querySelectorAll('[class]').forEach(el => {
              const c = el.className;
              if (typeof c === 'string' && /Transaction|transaction/i.test(c))
                out.add(c);
            });
            return [...out].slice(0, 15);
            """
        ),
    }
    print(json.dumps(info, ensure_ascii=False, indent=2))
finally:
    try:
        driver.quit()
    except Exception:
        pass
