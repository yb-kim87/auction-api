"""실거래 표 DOM 구조 진단."""
import json
import time

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By

from naver_crawl import _element_text, _scrape_transaction_tables, scrape_articles, scrape_transactions
from tank_login import ensure_login

TANK = "https://www.tankauction.com/ca/caView.php?tid=2441282"
TARGET = 113.02


def main():
    opts = uc.ChromeOptions()
    opts.add_argument("--lang=ko-KR")
    driver = uc.Chrome(options=opts, version_main=149)
    try:
        ensure_login(driver)
        driver.get(TANK)
        time.sleep(3)
        article = scrape_articles(driver, "unknown", TARGET)
        # need complex from page
        from naver_crawl import resolve_complex_id

        cid, _ = resolve_complex_id(driver)
        article = scrape_articles(driver, cid, TARGET)
        tx = scrape_transactions(driver, TARGET, article.matched_area_label)

        samples = []
        selectors = (
            "[class*='ComplexTransactionPriceTable'][class*='__area-title-table']",
            "[class*='ComplexTransactionPriceTable'][class*='__table']",
            "[class*='TransactionPriceTable'][class*='__area-title-table']",
            "[class*='TransactionPriceTable'][class*='__table']",
        )
        for selector in selectors:
            for i, el in enumerate(driver.find_elements(By.CSS_SELECTOR, selector)[:5]):
                text = _element_text(el)
                samples.append(
                    {
                        "selector": selector,
                        "i": i,
                        "len": len(text),
                        "preview": text[:300],
                        "class": el.get_attribute("class"),
                    }
                )

        print(
            json.dumps(
                {
                    "complex_id": cid,
                    "matched": article.matched_area_label,
                    "tx_len": len(tx.transaction_prices),
                    "tx_preview": tx.transaction_prices[:1200],
                    "dom_samples": samples,
                    "scrape_fn": _scrape_transaction_tables(driver)[:1200],
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


if __name__ == "__main__":
    main()
