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
    # 매매가 포함된 요소의 class 수집
    els = driver.find_elements(By.XPATH, "//*[contains(text(), '매매')]")
    samples = []
    for el in els[:15]:
        samples.append(
            {
                "tag": el.tag_name,
                "class": el.get_attribute("class"),
                "text": (el.text or "")[:120],
            }
        )
    # article 관련 class 패턴
    all_classes = driver.execute_script(
        """
        const out = new Set();
        document.querySelectorAll('[class]').forEach(el => {
          const c = el.className;
          if (typeof c === 'string' && /Article|article|Complex|Listing|Item/i.test(c))
            out.add(c.split(' ').filter(x => /Article|article|Complex|Listing|Item/i.test(x)).join(' '));
        });
        return [...out].slice(0, 40);
        """
    )
    print(json.dumps({"samples": samples, "article_classes": all_classes}, ensure_ascii=False, indent=2))
finally:
    try:
        driver.quit()
    except Exception:
        pass
