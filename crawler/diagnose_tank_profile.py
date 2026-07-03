"""탱크 tid별 API/DOM 필드 수집·구간별 소요 시간 진단."""
import json
import sys
import time

from browser import ensure_driver
from item_crawl import (
    TANK_DOM_TIMEOUT,
    _collect_tank_page_fields,
    _find_or_wait,
    _tank_api_has_core,
    _tid_from_url,
    _wait_tank_detail_render,
)
from selenium.webdriver.common.by import By
from tank_detail import (
    extract_building_area_from_detail,
    extract_complex_id_from_env_payload,
    fetch_tank_detail_bundle,
    merge_tank_fields,
    parse_apt_meta_from_env_payload,
    parse_base_info_fields,
    parse_education_from_env_payload,
    parse_lease_from_detail,
    parse_intr_flag_from_detail,
    read_dom_base_info,
)
from tank_login import ensure_login

URL = (
    sys.argv[1]
    if len(sys.argv) > 1
    else "https://www.tankauction.com/ca/caView.php?tid=2418146&chkNo=1&TotNo=43"
)


def _probe_dom(driver, selector: str, by=By.CSS_SELECTOR) -> bool:
    if selector.startswith("#") or selector.startswith("."):
        by = By.CSS_SELECTOR if selector.startswith((".", "[")) else By.ID
        sel = selector[1:] if selector.startswith("#") else selector
    else:
        sel = selector
    return bool(driver.find_elements(by, sel))


def main():
    report: dict = {"url": URL, "timings_ms": {}, "api": {}, "dom_present": {}, "missing": []}
    tid = _tid_from_url(URL)

    driver = ensure_driver()
    driver.implicitly_wait(0)
    ensure_login(driver)

    t0 = time.perf_counter()
    driver.set_page_load_strategy("eager")
    driver.get(URL)
    driver.set_page_load_strategy("normal")
    report["timings_ms"]["page_get"] = round((time.perf_counter() - t0) * 1000)

    t1 = time.perf_counter()
    raw_detail, env_payload = fetch_tank_detail_bundle(driver, tid or "")
    report["timings_ms"]["api_bundle"] = round((time.perf_counter() - t1) * 1000)

    api_fields = parse_base_info_fields(raw_detail)
    report["api"]["auct_ok"] = raw_detail is not None
    report["api"]["env_ok"] = env_payload is not None
    report["api"]["fields"] = api_fields
    report["api"]["complex_id"] = extract_complex_id_from_env_payload(env_payload)
    report["api"]["building_area"] = (
        extract_building_area_from_detail(raw_detail) if raw_detail else ""
    )
    report["api"]["education"] = (
        parse_education_from_env_payload(env_payload) if env_payload else ""
    )
    report["api"]["apt_meta"] = (
        parse_apt_meta_from_env_payload(env_payload) if env_payload else {}
    )
    report["api"]["lease"] = parse_lease_from_detail(raw_detail) if raw_detail else ""

    t2 = time.perf_counter()
    if not _tank_api_has_core(api_fields):
        _wait_tank_detail_render(driver, tid)
    report["timings_ms"]["render_wait"] = round((time.perf_counter() - t2) * 1000)

    t3 = time.perf_counter()
    dom_base = read_dom_base_info(driver)
    merged = merge_tank_fields(api_fields, dom_base)
    report["timings_ms"]["dom_base"] = round((time.perf_counter() - t3) * 1000)
    report["dom_base"] = dom_base

    dom_checks = {
        "lyTopFixMent": _probe_dom(driver, "lyTopFixMent", By.CLASS_NAME),
        "lyCnt_base": _probe_dom(driver, "#lyCnt_base"),
        "lyCnt_add": _probe_dom(driver, "#lyCnt_add"),
        "lyCnt_regist": _probe_dom(driver, "#lyCnt_regist"),
        "lyCnt_leas": _probe_dom(driver, "#lyCnt_leas"),
        "bldg_table": _probe_dom(driver, "#bldg_table"),
        "hitInfo": _probe_dom(driver, "#hitInfo"),
        "data-base-info regnAdrs": _probe_dom(
            driver, '[data-base-info-text="regnAdrs"]'
        ),
        "client-education-environment": _probe_dom(
            driver, '[data-render="client-education-environment"]'
        ),
        "Btbl_list": _probe_dom(driver, "Btbl_list", By.CLASS_NAME),
        "Ltbl_list": _probe_dom(driver, "Ltbl_list", By.CLASS_NAME),
    }
    report["dom_present"] = dom_checks

    t4 = time.perf_counter()
    snap = _collect_tank_page_fields(
        driver,
        f"diag_{URL}",
        URL,
        raw_detail=raw_detail,
        env_payload=env_payload,
        tank_fields=merged,
        top_text="",
        building_area=report["api"]["building_area"] or "0",
        dom_timeout=TANK_DOM_TIMEOUT,
        parse_apt_meta_from_env_payload=parse_apt_meta_from_env_payload,
        parse_education_from_env_payload=parse_education_from_env_payload,
        parse_lease_from_detail=parse_lease_from_detail,
        parse_intr_flag_from_detail=parse_intr_flag_from_detail,
        tid=tid,
    )
    report["timings_ms"]["collect_dom"] = round((time.perf_counter() - t4) * 1000)
    report["snapshot"] = snap

    field_checks = {
        "auctionNo": snap.get("auction_no"),
        "address": snap.get("address"),
        "min_price": snap.get("min_price"),
        "building_area": snap.get("building_area"),
        "education_setup": snap.get("education_setup"),
        "build_year": snap.get("build_year"),
        "total_units": snap.get("total_units"),
        "deunggi_info": snap.get("deunggi_info"),
        "lease_info": snap.get("lease_info"),
        "owner": snap.get("owner"),
        "elevator": snap.get("elevator"),
        "bid_info": snap.get("bid_info"),
    }
    for key, val in field_checks.items():
        empty = val in (None, "", "0", "없음", "값없음", "임차정보없음")
        if empty:
            report["missing"].append(key)

    report["timings_ms"]["total_before_naver"] = round(
        (time.perf_counter() - t0) * 1000
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
