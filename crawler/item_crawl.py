import re
import traceback
import importlib
from datetime import datetime

import naver_crawl
from naver_crawl import parse_building_area_m2
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


def _safe_int(value):
    if value is None or value == "" or value == "없음":
        return None
    if isinstance(value, int):
        return value
    try:
        return int(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _element_text(element) -> str:
    return (element.get_attribute("innerText") or element.text or "").strip()


def _clean_address(raw: str) -> str:
    text = raw.replace("\u00a0", " ")
    text = re.sub(r"\s*주소복사\s*", " ", text)
    text = re.sub(r" +", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return text.strip()


def _clean_education(raw: str) -> str:
    lines: list[str] = []
    for line in raw.replace("\u00a0", " ").splitlines():
        line = line.strip()
        if not line or re.fullmatch(r"\+?\s*더보기", line):
            continue
        line = re.sub(r"^\+?\s*더보기\s*", "", line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def _is_registry_header_text(text: str) -> bool:
    normalized = text.replace("\u00a0", " ").strip()
    if not normalized:
        return True
    if normalized == "순서 접수일":
        return True
    if "접수번호" in normalized and "권리종류" in normalized:
        return True
    return False


def _clean_building_registry(raw: str) -> str:
    if raw in ("", "없음", "값없음"):
        return raw
    text = raw.replace("\u00a0", " ")
    if ", " in text:
        parts = [part.strip() for part in text.split(", ") if part.strip()]
        parts = [part for part in parts if not _is_registry_header_text(part)]
        return ", ".join(parts) if parts else raw
    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not _is_registry_header_text(line.strip())
    ]
    return "\n".join(lines) if lines else raw


def _is_lease_detail_header_text(text: str) -> bool:
    normalized = re.sub(r"\s+", " ", text.replace("\u00a0", " ")).strip()
    if not normalized:
        return True
    if normalized == "점유":
        return True
    if "점유부분/기간" in normalized and "전입/확정/배당" in normalized:
        return True
    if re.match(r"^목록\??", normalized) and "임차인" in normalized and "대항력" in normalized:
        return True
    return False


def _clean_lease_detail(raw: str) -> str:
    if raw in ("", "없음", "값없음"):
        return raw
    text = raw.replace("\u00a0", " ")
    if ", " in text:
        parts = [part.strip() for part in text.split(", ") if part.strip()]
        parts = [part for part in parts if not _is_lease_detail_header_text(part)]
        return ", ".join(parts) if parts else raw
    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not _is_lease_detail_header_text(line.strip())
    ]
    return "\n".join(lines) if lines else raw


def _parse_elevator_from_bldg_table(text: str) -> str:
    normalized = text.replace("\u00a0", " ")
    match = re.search(r"(\d+대\s*/\s*\d+대)", normalized)
    if match:
        return match.group(1)
    passenger = re.search(r"승용\)\s*(\d+)\s*건", normalized)
    emergency = re.search(r"비상\)\s*(\d+)\s*건", normalized)
    if passenger or emergency:
        passenger_count = passenger.group(1) if passenger else "0"
        emergency_count = emergency.group(1) if emergency else "0"
        return f"{passenger_count}대 / {emergency_count}대"
    return "없음"


def _parse_parking_from_bldg_table(text: str) -> str:
    normalized = text.replace("\u00a0", " ")
    match = re.search(r"총\s*주차수\s*([\d,]+)\s*대", normalized)
    if match:
        return f"{match.group(1)}대"
    match = re.search(r"주차[^\d]{0,12}([\d,]+)\s*대", normalized)
    if match:
        return f"{match.group(1)}대"
    return "없음"


def _normalize_bid_history_entry(text: str) -> str:
    normalized = " ".join(text.replace("\u00a0", " ").split())
    if not normalized:
        return ""

    sale_match = re.search(r"매각\s+([\d,]+)\s*원\s*(\([^)]+\))?", normalized)
    bid_match = re.search(r"입찰\s*(.+)$", normalized)

    parts: list[str] = []
    if sale_match:
        sale_part = f"매각 {sale_match.group(1)}원"
        if sale_match.group(2):
            sale_part += f" {sale_match.group(2)}"
        parts.append(sale_part)
    if bid_match:
        parts.append(f"입찰 {bid_match.group(1).strip()}")

    if parts:
        return " / ".join(parts)

    if "입찰" in normalized or "매각" in normalized:
        return normalized
    return ""


def _extract_bid_info(driver) -> str:
    lines: list[str] = []
    seen: set[str] = set()
    try:
        for element in driver.find_elements(By.CSS_SELECTOR, ".hist_tr.his_Old"):
            raw = (element.get_attribute("textContent") or element.text or "").strip()
            line = _normalize_bid_history_entry(raw)
            if line and line not in seen:
                seen.add(line)
                lines.append(line)
    except Exception:
        return "없음"
    return "\n".join(lines) if lines else "없음"


AUCTION_NO_SELECTORS = [
    (By.CSS_SELECTOR, ".f14.bold_900"),
    (By.CSS_SELECTOR, "span.f14.bold_900"),
    (By.CSS_SELECTOR, "div.f14.bold_900"),
    (By.XPATH, "//*[contains(@class,'f14') and contains(@class,'bold_900')]"),
    (By.XPATH, "//*[contains(@class,'bold_900')]"),
]


def _auction_no_from_label(raw_entry: str) -> str:
    if "_" not in raw_entry:
        return ""
    prefix = raw_entry.split("_", 1)[0].strip()
    if not prefix or prefix.startswith("http"):
        return ""
    return prefix


def _auction_no_from_page_text(driver) -> str:
    try:
        body = driver.find_element(By.TAG_NAME, "body").text
        match = re.search(r"(\d{4}타경\d+)", body)
        if match:
            return match.group(1)
        match = re.search(r"(\d{4})\s*-\s*(\d+)", body[:800])
        if match:
            return f"{match.group(1)}타경{match.group(2)}"
    except Exception:
        pass
    return ""


def _extract_auction_no(driver, raw_entry: str, wait: WebDriverWait) -> str:
    for by, selector in AUCTION_NO_SELECTORS:
        try:
            element = wait.until(EC.presence_of_element_located((by, selector)))
            text = _element_text(element)
            if text:
                return text
        except Exception:
            continue

    label = _auction_no_from_label(raw_entry)
    if label:
        return label

    page_text = _auction_no_from_page_text(driver)
    if page_text:
        return page_text

    return "없음"


def _ensure_tank_page(driver, url: str) -> None:
    """driver.get 직후 탱크 상세 탭에 포커스 (다른 탭으로 잘못 전환하지 않음)."""
    if "tankauction.com" in (driver.current_url or ""):
        return
    for handle in driver.window_handles:
        driver.switch_to.window(handle)
        if "tankauction.com" in (driver.current_url or ""):
            return
    driver.get(url)


def _extract_building_area(top_text: str) -> str:
    if not top_text:
        return "0"
    try:
        raw = top_text.split("건물면적")[1].split("㎡")[0].strip()
        if raw:
            return raw
    except (IndexError, AttributeError):
        pass
    for pattern in (
        r"건물면적[^0-9]*([\d]+(?:\.\d+)?)",
        r"전용[^0-9]*([\d]+(?:\.\d+)?)",
    ):
        match = re.search(pattern, top_text)
        if match:
            return match.group(1)
    return "0"


def _is_apartment_usage(usage: str) -> bool:
    normalized = usage.strip().replace("\u00a0", " ")
    return normalized == "아파트" or normalized.startswith("아파트")


def crawl_item(driver, raw_entry: str) -> dict:
    if "_" in raw_entry:
        url = raw_entry.split("_", 1)[-1]
    else:
        url = raw_entry

    driver.get(url)
    _ensure_tank_page(driver, url)

    wait = WebDriverWait(driver, 3)

    auction_no = _extract_auction_no(driver, raw_entry, wait)

    try:
        address = _clean_address(
            driver.find_element(
                By.CSS_SELECTOR, '[style="padding:5px 0 10px"]'
            ).text
        )
    except Exception:
        address = "없음"

    try:
        views = driver.find_element(By.ID, "hitInfo").text.split("누적:")[1].split(
            "평균"
        )[0].strip()
    except Exception:
        views = "0"

    try:
        usage = driver.find_elements(By.CLASS_NAME, "viewobject")[1].text.strip()
    except Exception:
        usage = "없음"

    top_text = ""
    building_area = "0"
    try:
        top_el = wait.until(
            EC.presence_of_element_located((By.CLASS_NAME, "lyTopFixMent"))
        )
        top_text = top_el.get_attribute("innerText") or ""
        building_area = _extract_building_area(top_text)
    except Exception:
        pass

    build_year = "값없음"
    total_units = 0
    education_setup = ""
    try:
        ly_cnt_add = wait.until(EC.presence_of_element_located((By.ID, "lyCnt_add")))
        add_text = ly_cnt_add.text
        year_match = re.search(r"사용승인일자\s*(\d{4}-\d{2}-\d{2})", add_text)
        if year_match:
            build_year = year_match.group(1)
        units_match = re.search(r"세대수[:\s]*([\d,]+)", add_text)
        if units_match:
            total_units = int(units_match.group(1).replace(",", ""))
        edu_match = re.search(r"교육환경(.*?)주변환경", add_text, re.DOTALL)
        if edu_match:
            education_setup = _clean_education(edu_match.group(1).strip())
    except Exception:
        pass

    try:
        bid_date = driver.find_elements(By.CLASS_NAME, "spanBox")[3].text.split(
            "매각일자"
        )[1].split("(")[0].strip()
    except Exception:
        bid_date = "없음"

    appraisal_price = None
    try:
        match = re.search(r"감정가\s*([\d,]+)원", top_text)
        if match:
            appraisal_price = int(match.group(1).replace(",", ""))
    except Exception:
        pass

    min_price = None
    sale_price = None
    try:
        ly_cnt_base = wait.until(
            EC.presence_of_element_located((By.ID, "lyCnt_base"))
        )
        blue = ly_cnt_base.find_element(By.CSS_SELECTOR, ".blue.right").text
        match = re.search(r"\)\s*([\d,]+)", blue)
        if match:
            min_price = int(match.group(1).replace(",", ""))
        if "매각가" in ly_cnt_base.text:
            red = ly_cnt_base.find_element(By.CSS_SELECTOR, ".right.red").text
            match_sale = re.search(r"\)\s*([\d,]+)", red)
            if match_sale:
                sale_price = int(match_sale.group(1).replace(",", ""))
    except Exception:
        pass

    bid_info = _extract_bid_info(driver)

    try:
        owner = (
            driver.find_elements(By.CLASS_NAME, "Btbl_list")[0]
            .text.split("소유자")[1]
            .split("감정가")[0]
            .strip()
        )
    except Exception:
        owner = "값없음"

    try:
        appraiser = (
            driver.find_elements(By.CLASS_NAME, "spanBox")[4]
            .text.split("감정원 :")[1]
            .split("/")[0]
            .strip()
        )
    except Exception:
        appraiser = "값없음"

    official_land_price = None
    try:
        elements = driver.find_elements(By.CLASS_NAME, "Btbl_list")
        if len(elements) > 1:
            official_land_price = int(
                elements[1]
                .text.split("주택공시가격")[1]
                .split(":")[1]
                .split("원")[0]
                .strip()
                .replace(",", "")
            )
    except Exception:
        official_land_price = None

    tenant_info = "임차정보없음"
    try:
        tenant_info = (
            driver.find_elements(By.CLASS_NAME, "Ltbl_list")[1]
            .text.split("계", 1)[1]
            .strip()
        )
    except Exception:
        pass

    try:
        special_note = (
            driver.find_element(By.CSS_SELECTOR, ".red.spanBox").text or "없음"
        )
    except Exception:
        special_note = "없음"

    auc_link = url.split("&")[0]

    elevator = "없음"
    parking = "없음"
    try:
        bldg_table = driver.find_element(By.ID, "bldg_table").text
        elevator = _parse_elevator_from_bldg_table(bldg_table)
        parking = _parse_parking_from_bldg_table(bldg_table)
    except Exception:
        pass

    land_area = "없음"
    try:
        land_area = top_text.split("대지권")[1].split("㎡")[0].strip()
    except Exception:
        try:
            land_area = top_text.split("토지면적")[1].split("㎡")[0].strip()
        except Exception:
            pass

    deunggi_info = ""
    try:
        ly_cnt_regist = wait.until(
            EC.presence_of_element_located((By.ID, "lyCnt_regist"))
        )
        deunggi_info = _clean_building_registry(
            ", ".join(
                el.text.strip()
                for el in ly_cnt_regist.find_elements(By.CLASS_NAME, "Ltbl_list")
                if el.text.strip()
            )
        )
    except Exception:
        deunggi_info = "값없음"

    lease_info = ""
    try:
        ly_cnt_leas = wait.until(
            EC.presence_of_element_located((By.ID, "lyCnt_leas"))
        )
        lease_info = _clean_lease_detail(
            ", ".join(
                el.text.strip()
                for el in ly_cnt_leas.find_elements(By.CLASS_NAME, "Ltbl_list")
                if el.text.strip()
            )
        )
    except Exception:
        lease_info = "값없음"

    naver = {
        "naver_price_detail": "",
        "naver_lowest_price": None,
        "gap_margin": None,
        "gap_margin_sold_price": None,
        "new_case_gap_margin": None,
        "transaction_prices": "",
        "real_trade_count": "",
    }
    if _is_apartment_usage(usage) and building_area not in ("0", "없음"):
        try:
            importlib.reload(naver_crawl)
            naver = naver_crawl.extract_naver_prices(driver, building_area, build_year)
            if naver["naver_lowest_price"] and min_price:
                naver["gap_margin"] = naver["naver_lowest_price"] - min_price
            if naver["naver_lowest_price"] and sale_price:
                naver["gap_margin_sold_price"] = (
                    naver["naver_lowest_price"] - sale_price
                )
            if naver["naver_lowest_price"] and appraisal_price:
                naver["new_case_gap_margin"] = (
                    naver["naver_lowest_price"] - appraisal_price
                )
        except Exception:
            traceback.print_exc()

    return {
        "memo": "",
        "link": auc_link,
        "views": _safe_int(views) or 0,
        "auctionNo": auction_no,
        "address": address,
        "totalUnits": total_units,
        "usage": usage,
        "area": (
            str(parse_building_area_m2(building_area) or building_area)
            if building_area not in ("0", "없음")
            else building_area
        ),
        "builtYear": build_year,
        "bidDate": bid_date,
        "appraisal_price": appraisal_price or 0,
        "min_price": min_price or 0,
        "sale_price": sale_price,
        "naver_lowest_price": naver["naver_lowest_price"] or 0,
        "gap_margin_sold_price": naver["gap_margin_sold_price"],
        "gap_margin": naver["gap_margin"] or 0,
        "new_case_gap_margin": naver["new_case_gap_margin"] or 0,
        "real_trade_count": naver["real_trade_count"],
        "bid_info": bid_info.strip(),
        "owner": owner,
        "appraiser": appraiser,
        "official_land_price": official_land_price or 0,
        "tenant_info": tenant_info,
        "special_note": special_note,
        "elevator": elevator,
        "parking": parking,
        "land_area": land_area,
        "deunggi_info": deunggi_info,
        "education_setup": education_setup,
        "lease_info": lease_info,
        "naver_price_detail": naver["naver_price_detail"],
        "transaction_prices": naver["transaction_prices"],
        "naver_id": str(naver.get("complex_id") or "").strip(),
        "record_time": datetime.now().isoformat(timespec="seconds"),
    }


def fetch_naver_id_only(driver, raw_entry: str) -> dict:
    """탱크 상세 페이지에서 N단지정보 링크의 complex id만 수집."""
    if "_" in raw_entry:
        url = raw_entry.split("_", 1)[-1]
    else:
        url = raw_entry.strip()

    driver.get(url)
    _ensure_tank_page(driver, url)

    naver_id = ""
    error = ""
    try:
        importlib.reload(naver_crawl)
        complex_id, err = naver_crawl.resolve_complex_id(driver)
        if complex_id:
            naver_id = str(complex_id).strip()
        elif err:
            error = err
    except Exception as exc:
        error = str(exc)

    return {
        "naver_id": naver_id,
        "error": error,
        "link": url.split("&")[0],
    }
