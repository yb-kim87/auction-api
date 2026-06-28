"""complex 1355 면적 필터·시세 탭 DOM 진단."""
import json
import re
import time

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By

from naver_crawl import (
    ARTICLE_URL,
    _wait_article_page,
    _open_area_filter,
    _area_filter_labels,
    _element_text,
    parse_area_option_label,
    _click_price_tab,
    _ensure_price_tab,
    _open_tx_area_picker,
)

COMPLEX_ID = "1355"
TARGET = 101.85


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
        driver.get(ARTICLE_URL.format(complex_id=COMPLEX_ID))
        _wait_article_page(driver)

        opened = _open_area_filter(driver)
        out["area_filter_opened"] = opened
        labels = []
        for label in _area_filter_labels(driver):
            text = _element_text(label).replace("\n", " ")
            opt = parse_area_option_label(text)
            labels.append(
                {
                    "text": text[:120],
                    "parsed": (
                        {
                            "exclusive": opt.exclusive_m2,
                            "supply": opt.supply_m2,
                            "label": opt.label,
                        }
                        if opt
                        else None
                    ),
                    "within_tol": (
                        abs(opt.exclusive_m2 - TARGET) <= 2.0 if opt else None
                    ),
                }
            )
        out["area_labels"] = labels

        _click_price_tab(driver)
        time.sleep(2)
        out["url_after_price_tab"] = driver.current_url
        filt_btns = []
        try:
            filt = driver.find_element(
                By.CSS_SELECTOR, "[class*='ComplexTransactionPriceFilter']"
            )
            for i, btn in enumerate(filt.find_elements(By.TAG_NAME, "button")):
                filt_btns.append({"i": i, "text": _element_text(btn)[:80]})
        except Exception as exc:
            out["tx_filter_error"] = str(exc)
        out["tx_filter_buttons"] = filt_btns
        out["tx_picker_open"] = _open_tx_area_picker(driver)
        if out["tx_picker_open"]:
            radio = [
                _element_text(el).replace("\n", " ")[:80]
                for el in driver.find_elements(
                    By.CSS_SELECTOR, "[class*='RadioLayer'][class*='__label']"
                )
            ]
            out["radio_labels"] = radio
    finally:
        try:
            driver.quit()
        except Exception:
            pass
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
