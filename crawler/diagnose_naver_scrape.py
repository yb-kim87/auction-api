"""undetected-chromedriver로 네이버 호가/실거래 스크래핑 검증."""
import json
import time

import undetected_chromedriver as uc

from item_crawl import _scrape_naver_article_tab, _scrape_naver_transaction_tab

COMPLEX_ID = "25142"
TARGET_AREA = 134.0  # 예시 면적

opts = uc.ChromeOptions()
opts.add_argument("--lang=ko-KR")
opts.add_argument("--window-size=1920,1080")
driver = uc.Chrome(options=opts, version_main=149)
try:
    detail, lowest = _scrape_naver_article_tab(driver, COMPLEX_ID, TARGET_AREA)
    tx, count = _scrape_naver_transaction_tab(driver, COMPLEX_ID, TARGET_AREA)
    with open("out_scrape.json", "w", encoding="utf-8") as f:
        json.dump(
            {
                "lowest_price": lowest,
                "detail_preview": detail[:500],
                "tx_preview": tx[:500],
                "real_trade_count": count,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
finally:
    try:
        driver.quit()
    except Exception:
        pass
