"""네이버 실거래(시세 탭) 수집 검증."""
import json
import os

import undetected_chromedriver as uc

from naver_crawl import scrape_articles, scrape_transactions

COMPLEX_ID = os.environ.get("NAVER_TEST_COMPLEX_ID", "25142")
TARGET_M2 = float(os.environ.get("NAVER_TEST_AREA", "149.59"))

opts = uc.ChromeOptions()
opts.add_argument("--lang=ko-KR")
version_main = 149
try:
    import winreg

    key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Google\Chrome\BLBeacon")
    version, _ = winreg.QueryValueEx(key, "version")
    winreg.CloseKey(key)
    version_main = int(str(version).split(".")[0])
except OSError:
    pass

driver = uc.Chrome(options=opts, version_main=version_main)
try:
    article = scrape_articles(driver, COMPLEX_ID, TARGET_M2)
    tx = scrape_transactions(driver, TARGET_M2, article.matched_area_label)
    output = {
        "target_m2": TARGET_M2,
        "article_count": len(article.articles),
        "article_lowest_eok": (
            round(article.naver_lowest_price / 100_000_000, 2)
            if article.naver_lowest_price
            else None
        ),
        "tx_blocks": [{"area": b.area_label, "preview": b.content[:300]} for b in tx.blocks],
        "tx_block_count": len(tx.blocks),
        "real_trade_count": tx.real_trade_count,
        "tx_error": tx.error,
    }
    with open("test_naver_tx_out.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(
        "articles",
        output["article_count"],
        "tx_blocks",
        output["tx_block_count"],
        "err",
        tx.error,
    )
finally:
    try:
        driver.quit()
    except Exception:
        pass
