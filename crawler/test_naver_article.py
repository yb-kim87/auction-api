"""네이버 호가 수집 검증 (complex_id + 면적 직접 지정)."""
import json
import os

import undetected_chromedriver as uc

from naver_crawl import scrape_articles

COMPLEX_ID = os.environ.get("NAVER_TEST_COMPLEX_ID", "25142")
TARGET_M2 = float(os.environ.get("NAVER_TEST_AREA", "134"))

opts = uc.ChromeOptions()
opts.add_argument("--lang=ko-KR")
opts.add_argument("--window-size=1920,1080")

version_main = None
try:
    import winreg

    key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Google\Chrome\BLBeacon")
    version, _ = winreg.QueryValueEx(key, "version")
    winreg.CloseKey(key)
    version_main = int(str(version).split(".")[0])
except OSError:
    version_main = 149

driver = uc.Chrome(options=opts, version_main=version_main)
try:
    result = scrape_articles(driver, COMPLEX_ID, TARGET_M2)
    output = {
        "complex_id": result.complex_id,
        "filter_applied": result.filter_applied,
        "matched_area_labels": result.matched_area_label.split(", ") if result.matched_area_label else [],
        "error": result.error,
        "article_count": len(result.articles),
        "naver_lowest_price": result.naver_lowest_price,
        "lowest_price_eok": (
            round(result.naver_lowest_price / 100_000_000, 2)
            if result.naver_lowest_price
            else None
        ),
        "articles_preview": [
            {
                "dong": a.dong,
                "exclusive_m2": a.exclusive_m2,
                "price_min": a.price_min,
                "price_label": a.price_label,
                "summary_head": a.summary[:120],
            }
            for a in result.articles[:5]
        ],
    }
    with open("test_naver_article_out.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(
        "OK",
        output["article_count"],
        "articles, filter=",
        output["filter_applied"],
        "lowest=",
        output["lowest_price_eok"],
        "eok",
    )
finally:
    try:
        driver.quit()
    except Exception:
        pass
