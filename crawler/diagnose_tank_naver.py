"""탱크 URL → 면적 추출 → 네이버 호가·실거래 진단."""
import json
import re
import sys
import time

import undetected_chromedriver as uc

from selenium.webdriver.common.by import By

from item_crawl import crawl_item
from naver_crawl import extract_naver_prices, resolve_complex_id
from tank_login import ensure_login

TANK_URL = (
    sys.argv[1]
    if len(sys.argv) > 1
    else "https://www.tankauction.com/ca/caView.php?tid=2499411&chkNo=1&TotNo=39"
)
RAW_ENTRY = f"diag_{TANK_URL}"


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


def extract_building_area_raw(driver) -> dict:
    out = {"building_area_raw": "", "top_text_snippet": "", "usage": ""}
    try:
        out["usage"] = driver.find_elements(By.CLASS_NAME, "viewobject")[1].text
    except Exception:
        pass
    try:
        top_text = driver.find_element(By.CLASS_NAME, "lyTopFixMent").get_attribute(
            "innerText"
        )
        out["top_text_snippet"] = (top_text or "")[:500]
        out["building_area_raw"] = top_text.split("건물면적")[1].split("㎡")[0].strip()
    except Exception as exc:
        out["error"] = str(exc)
    return out


def try_float_area(raw: str) -> dict:
    result = {"raw": raw, "float_ok": False, "value": None, "error": ""}
    try:
        result["value"] = float(raw)
        result["float_ok"] = True
    except ValueError as exc:
        result["error"] = str(exc)
    m = re.search(r"([\d]+(?:\.\d+)?)", raw)
    if m:
        result["regex_extract"] = float(m.group(1))
    return result


def main():
    opts = uc.ChromeOptions()
    opts.add_argument("--lang=ko-KR")
    opts.add_argument("--window-size=1920,1080")
    driver = uc.Chrome(options=opts, version_main=chrome_version_main())
    report = {"tank_url": TANK_URL}
    try:
        ensure_login(driver)
        driver.get(TANK_URL)
        time.sleep(3)
        try:
            alert = driver.switch_to.alert
            alert.accept()
            time.sleep(1)
        except Exception:
            pass
        report["page_title"] = driver.title
        report["area_extract"] = extract_building_area_raw(driver)
        raw_area = report["area_extract"].get("building_area_raw", "")
        report["float_parse"] = try_float_area(raw_area)

        complex_id, cid_err = resolve_complex_id(driver)
        report["complex_id"] = complex_id
        report["complex_id_error"] = cid_err

        naver = extract_naver_prices(driver, raw_area, "")
        report["naver"] = {
            "naver_lowest_price": naver.get("naver_lowest_price"),
            "lowest_eok": (
                round(naver["naver_lowest_price"] / 100_000_000, 2)
                if naver.get("naver_lowest_price")
                else None
            ),
            "price_detail_len": len(naver.get("naver_price_detail") or ""),
            "transaction_prices_len": len(naver.get("transaction_prices") or ""),
            "real_trade_count": naver.get("real_trade_count"),
            "matched_area_label": naver.get("matched_area_label"),
            "error_in_detail": (naver.get("naver_price_detail") or "")[:200],
        }

        # full crawl_item for comparison
        item = crawl_item(driver, RAW_ENTRY)
        report["crawl_item"] = {
            "usage": item.get("usage"),
            "area": item.get("area"),
            "naver_lowest_price": item.get("naver_lowest_price"),
            "transaction_prices_len": len(item.get("transaction_prices") or ""),
            "auction_no": item.get("auctionNo"),
            "address": item.get("address"),
        }
    finally:
        try:
            driver.quit()
        except Exception:
            pass

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
