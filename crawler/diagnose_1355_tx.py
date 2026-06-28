"""complex 1355 / 101.85 실거래 상세 진단."""
import json
import time

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By

from naver_crawl import (
    apply_target_area_filters,
    scrape_articles,
    scrape_transactions,
    _scan_tx_area_choices,
    _open_tx_area_picker,
    _close_tx_area_picker,
    _element_text,
)

COMPLEX_ID = "1355"
TARGET_M2 = 101.85


def chrome_version_main() -> int:
    try:
        import winreg

        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, r"Software\Google\Chrome\BLBeacon"
        )
        version, _ = winreg.QueryValueEx(key, "version")
        winreg.CloseKey(key)
        return int(str(version).split(".")[0])
    except OSError:
        return 149


def main():
    opts = uc.ChromeOptions()
    opts.add_argument("--lang=ko-KR")
    driver = uc.Chrome(options=opts, version_main=chrome_version_main())
    out = {}
    try:
        article = scrape_articles(driver, COMPLEX_ID, TARGET_M2)
        out["article"] = {
            "filter_applied": article.filter_applied,
            "matched_area_label": article.matched_area_label,
            "error": article.error,
            "count": len(article.articles),
            "lowest_eok": (
                round(article.naver_lowest_price / 100_000_000, 2)
                if article.naver_lowest_price
                else None
            ),
        }

        # re-open picker scan on current driver state after articles
        picker_open = _open_tx_area_picker(driver)
        choices = {}
        if picker_open:
            choices = _scan_tx_area_choices(driver, TARGET_M2)
            layer_labels = [
                _element_text(el)
                for el in driver.find_elements(
                    By.CSS_SELECTOR, "[class*='RadioLayer'] label, [class*='RadioLayer'] button"
                )
            ][:20]
            out["tx_layer_labels"] = layer_labels
            _close_tx_area_picker(driver)
        out["tx_picker_open"] = picker_open
        out["tx_scanned_choices"] = {str(k): v for k, v in choices.items()}

        tx = scrape_transactions(driver, TARGET_M2, article.matched_area_label)
        out["tx"] = {
            "error": tx.error,
            "blocks": len(tx.blocks),
            "preview": tx.transaction_prices[:400] if tx.transaction_prices else "",
        }
    finally:
        try:
            driver.quit()
        except Exception:
            pass
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
