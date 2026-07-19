import re
import time
import traceback
import importlib
from datetime import datetime

import naver_crawl
from crawl_abort import CrawlStoppedError, ShouldStop, check_stop
from naver_crawl import parse_building_area_m2
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from tank_detail import _normalize_auction_no

# 탱크 DOM 없을 때 최대 대기(초) — 네이버 전 수집 순서는 유지, 타임아웃만 최소화
TANK_DOM_TIMEOUT = 0.8
TANK_RENDER_TIMEOUT = 1.5
TANK_NAV_TIMEOUT = 8.0
TANK_HYDRATE_TIMEOUT = 2.5
TANK_DOM_POLL = 0.1


def _find_or_wait(driver, by, selector: str, timeout: float = TANK_DOM_TIMEOUT):
    """find_elements 즉시 시도 → 없으면 짧게만 대기."""
    found = driver.find_elements(by, selector)
    if found:
        return found[0]
    try:
        return WebDriverWait(driver, timeout, poll_frequency=TANK_DOM_POLL).until(
            EC.presence_of_element_located((by, selector))
        )
    except Exception:
        return None


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
    return _normalize_auction_no(prefix)


def _auction_no_from_page_text(driver) -> str:
    try:
        body = driver.find_element(By.TAG_NAME, "body").text
        normalized = _normalize_auction_no(body.replace(" ", "").replace("\u00a0", ""))
        if normalized:
            return normalized
        normalized = _normalize_auction_no(body[:800])
        if normalized:
            return normalized
    except Exception:
        pass
    return ""


def _extract_auction_no(driver, raw_entry: str, wait: WebDriverWait | None = None) -> str:
    label = _auction_no_from_label(raw_entry)
    if label:
        return label

    page_text = _auction_no_from_page_text(driver)
    if page_text:
        return page_text

    for by, selector in AUCTION_NO_SELECTORS:
        try:
            elements = driver.find_elements(by, selector)
            if elements:
                normalized = _normalize_auction_no(_element_text(elements[0]))
                if normalized:
                    return normalized
        except Exception:
            continue

    if wait is not None:
        for by, selector in AUCTION_NO_SELECTORS:
            try:
                element = wait.until(EC.presence_of_element_located((by, selector)))
                normalized = _normalize_auction_no(_element_text(element))
                if normalized:
                    return normalized
            except Exception:
                continue

    return "없음"


def _tid_from_url(url: str) -> str | None:
    match = re.search(r"[?&]tid=(\d+)", url or "")
    return match.group(1) if match else None


def _panel_inner_text(driver, panel_id: str) -> str:
    try:
        text = driver.execute_script(
            """
            const el = document.getElementById(arguments[0]);
            return el ? (el.innerText || el.textContent || '') : '';
            """,
            panel_id,
        )
        return (text or "").strip()
    except Exception:
        return ""


def _click_tank_tab_label(driver, label: str) -> bool:
    for xpath in (
        f"//a[contains(normalize-space(.), '{label}')]",
        f"//button[contains(normalize-space(.), '{label}')]",
        f"//*[@role='tab'][contains(normalize-space(.), '{label}')]",
        f"//li[contains(normalize-space(.), '{label}')]",
    ):
        for element in driver.find_elements(By.XPATH, xpath):
            try:
                driver.execute_script(
                    "arguments[0].scrollIntoView({block:'center'}); arguments[0].click();",
                    element,
                )
                time.sleep(0.12)
                return True
            except Exception:
                continue
    return False


def _ensure_tank_detail_panels_ready(driver, timeout: float = TANK_HYDRATE_TIMEOUT) -> None:
    """
    탱크 caView — 사용자 화면과 동일하게 비동기 섹션·탭 내용 로드.
    (lyCnt_* 컨테이너는 있어도 탭 클릭/JS 렌더 전에는 비어 있음)
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        loading = driver.find_elements(
            By.XPATH,
            "//*[contains(normalize-space(.), '불러오는 중')]",
        )
        hist = driver.find_elements(By.CSS_SELECTOR, ".hist_tr.his_Old")
        base = _panel_inner_text(driver, "lyCnt_base")
        if not loading and (hist or "최저" in base or "매각" in base):
            break
        time.sleep(TANK_DOM_POLL)

    panels = (
        ("lyCnt_add", ("추가내용", "추가")),
        ("lyCnt_regist", ("등기내용", "등기")),
        ("lyCnt_leas", ("임차인내용", "임차")),
        ("bldg_table", ("물건내용", "건물")),
    )
    for panel_id, labels in panels:
        if panel_id == "lyCnt_add":
            add_text = _panel_inner_text(driver, panel_id)
            if "사용승인" in add_text or "세대수" in add_text:
                continue
        elif panel_id != "lyCnt_leas" and len(_panel_inner_text(driver, panel_id)) > 24:
            continue
        for label in labels:
            if _click_tank_tab_label(driver, label):
                break
        time.sleep(0.12)


def _wait_lycnt_leas(driver, timeout: float = TANK_HYDRATE_TIMEOUT) -> None:
    """#lyCnt_leas 스크롤 후 tr.leasInfoTr·기타사항 렌더만 짧게 대기."""
    try:
        driver.execute_script(
            """
            const el = document.getElementById('lyCnt_leas');
            if (el) el.scrollIntoView({ block: 'center' });
            """
        )
    except Exception:
        pass

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if driver.find_elements(By.CSS_SELECTOR, "#lyCnt_leas tr.leasInfoTr"):
            return
        banner_rows = driver.find_elements(
            By.CSS_SELECTOR,
            "#lyCnt_leas table.Ltbl_list tbody tr:not(.leasInfoTr) td[colspan]",
        )
        if banner_rows and (banner_rows[0].text or "").strip():
            return
        leas_text = _panel_inner_text(driver, "lyCnt_leas")
        if "임차인 현황" in leas_text and ("보:" in leas_text or "기타사항" in leas_text):
            return
        if "기타사항" in leas_text and len(leas_text) > 40:
            return
        time.sleep(TANK_DOM_POLL)


def _navigate_tank_detail(driver, url: str, timeout: float = TANK_NAV_TIMEOUT) -> None:
    """탱크 caView — eager 로드로 이미지/광고 대기 생략."""
    tid = _tid_from_url(url)
    current = driver.current_url or ""
    if not tid or tid not in current or "caView.php" not in current:
        try:
            driver.set_page_load_strategy("eager")
        except Exception:
            pass
        driver.get(url)
        try:
            driver.set_page_load_strategy("normal")
        except Exception:
            pass
    if tid:
        try:
            WebDriverWait(driver, timeout, poll_frequency=TANK_DOM_POLL).until(
                lambda d: tid in (d.current_url or "")
                and "caView.php" in (d.current_url or "")
            )
        except Exception:
            pass


def _wait_tank_detail_render(
    driver, tid: str | None, timeout: float = TANK_RENDER_TIMEOUT
) -> None:
    """client-top-summary DOM 렌더 대기 (폴링 중 API 호출 금지)."""

    def ready(d):
        for binding in ("regnAdrs", "saNo", "bidDtm"):
            els = d.find_elements(
                By.CSS_SELECTOR, f'[data-base-info-text="{binding}"]'
            )
            if els and _element_text(els[0]):
                return True
        return bool(d.find_elements(By.ID, "lyTopFixMent"))

    try:
        WebDriverWait(driver, timeout, poll_frequency=TANK_DOM_POLL).until(ready)
    except Exception:
        pass


def _extract_address_from_dom(driver) -> str:
    for selector in (
        '[data-base-info-text="regnAdrs"]',
        '[style*="padding:5px 0 10px"]',
        '[style*="padding:5px 0"]',
    ):
        try:
            element = driver.find_element(By.CSS_SELECTOR, selector)
            text = _clean_address(_element_text(element))
            if text and text not in ("없음", "값없음"):
                return text
        except Exception:
            continue
    return ""


def _ensure_tank_page(driver, url: str) -> None:
    _navigate_tank_detail(driver, url)


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


def _education_from_dom(driver, timeout: float = TANK_DOM_TIMEOUT) -> str:
    edu_el = driver.find_elements(
        By.CSS_SELECTOR, '[data-render="client-education-environment"]'
    )
    if edu_el and (edu_el[0].text or "").strip():
        return _clean_education(edu_el[0].text)
    edu_el = _find_or_wait(
        driver,
        By.CSS_SELECTOR,
        '[data-render="client-education-environment"]',
        timeout=timeout,
    )
    if edu_el and (edu_el.text or "").strip():
        return _clean_education(edu_el.text)
    return ""


def _fill_add_info_from_dom(
    driver, timeout: float = TANK_DOM_TIMEOUT
) -> tuple[str, int, str]:
    """구 UI lyCnt_add DOM fallback — 짧은 대기만."""
    build_year = "값없음"
    total_units = 0
    education_setup = _education_from_dom(driver, timeout=timeout)

    ly_cnt_add = _find_or_wait(driver, By.ID, "lyCnt_add", timeout=timeout)
    if ly_cnt_add is None:
        return build_year, total_units, education_setup

    add_text = _panel_inner_text(driver, "lyCnt_add") or (ly_cnt_add.text or "")
    try:
        from tank_detail import parse_build_year_from_text

        parsed_year = parse_build_year_from_text(add_text)
        if parsed_year:
            build_year = parsed_year
    except Exception:
        pass
    units_match = re.search(r"세대수[:\s]*([\d,]+)", add_text)
    if units_match:
        total_units = int(units_match.group(1).replace(",", ""))
    if not education_setup:
        edu_match = re.search(r"교육환경(.*?)주변환경", add_text, re.DOTALL)
        if edu_match:
            education_setup = _clean_education(edu_match.group(1).strip())
    return build_year, total_units, education_setup


def _tank_api_has_core(tank_fields: dict) -> bool:
    return bool(tank_fields.get("auctionNo") and tank_fields.get("address"))


def _collect_tank_page_fields(
    driver,
    raw_entry: str,
    url: str,
    *,
    raw_detail,
    env_payload,
    tank_fields: dict,
    top_text: str,
    building_area: str,
    dom_timeout: float,
    parse_apt_meta_from_env_payload,
    parse_education_from_env_payload,
    parse_lease_from_detail,
    parse_intr_flag_from_detail,
    tid,
) -> dict:
    """탱크 상세 페이지 DOM/API 스냅샷 — 네이버 이동 전에 한 번만 수집."""
    auction_no = tank_fields.get("auctionNo") or _extract_auction_no(
        driver, raw_entry, wait=None
    )

    address = _clean_address(
        str(
            tank_fields.get("address")
            or _extract_address_from_dom(driver)
            or "없음"
        )
    )

    try:
        views = driver.find_element(By.ID, "hitInfo").text.split("누적:")[1].split(
            "평균"
        )[0].strip()
    except Exception:
        views = "0"

    if not top_text:
        top_el = _find_or_wait(
            driver, By.CLASS_NAME, "lyTopFixMent", timeout=dom_timeout
        )
        if top_el:
            top_text = top_el.get_attribute("innerText") or ""
    if building_area in ("0", "", "없음") and top_text:
        building_area = _extract_building_area(top_text)

    apt_meta = (
        parse_apt_meta_from_env_payload(env_payload)
        if env_payload and tid and parse_apt_meta_from_env_payload
        else {"build_year": "", "total_units": 0}
    )
    build_year = apt_meta.get("build_year") or ""
    total_units = apt_meta.get("total_units") or 0
    education_setup = (
        parse_education_from_env_payload(env_payload)
        if env_payload and tid and parse_education_from_env_payload
        else ""
    )

    bid_date = "없음"
    try:
        from tank_detail import format_bid_date as _format_bid_date

        bid_el = driver.find_elements(
            By.CSS_SELECTOR, '[data-base-info-text="bidDtm"]'
        )
        if bid_el and (bid_el[0].text or "").strip():
            bid_date = _format_bid_date(
                (bid_el[0].text or "").split("(")[0].strip()
            )
        else:
            span_boxes = driver.find_elements(By.CLASS_NAME, "spanBox")
            if len(span_boxes) > 3:
                bid_date = span_boxes[3].text.split("매각일자")[1].split("(")[0].strip()
    except Exception:
        pass
    if tank_fields.get("bidDate"):
        bid_date = tank_fields["bidDate"]

    appraisal_price = tank_fields.get("appraisal_price")
    if appraisal_price is None and top_text:
        try:
            match = re.search(r"감정가\s*([\d,]+)원", top_text)
            if match:
                appraisal_price = int(match.group(1).replace(",", ""))
        except Exception:
            pass

    min_price = tank_fields.get("min_price")
    sale_price = tank_fields.get("sale_price")
    if min_price is None or sale_price is None:
        try:
            ly_cnt_base_el = _find_or_wait(
                driver, By.ID, "lyCnt_base", timeout=dom_timeout
            )
            if ly_cnt_base_el is not None:
                if min_price is None:
                    blue = ly_cnt_base_el.find_element(By.CSS_SELECTOR, ".blue.right").text
                    match = re.search(r"\)\s*([\d,]+)", blue)
                    if match:
                        min_price = int(match.group(1).replace(",", ""))
                if sale_price is None and "매각가" in ly_cnt_base_el.text:
                    red = ly_cnt_base_el.find_element(By.CSS_SELECTOR, ".right.red").text
                    match_sale = re.search(r"\)\s*([\d,]+)", red)
                    if match_sale:
                        sale_price = int(match_sale.group(1).replace(",", ""))
        except Exception:
            pass

    try:
        from tank_detail import (
            extract_build_year_from_dom,
            is_valid_build_year,
            normalize_build_year_value,
            parse_build_year_from_detail,
            parse_build_year_from_text,
        )

        if raw_detail and not is_valid_build_year(build_year):
            detail_year = parse_build_year_from_detail(raw_detail)
            if detail_year:
                build_year = detail_year

        need_year_or_units = not is_valid_build_year(build_year) or not total_units
        if not education_setup:
            education_setup = _education_from_dom(driver, timeout=dom_timeout)
        if need_year_or_units:
            dom_year, dom_units, dom_edu = _fill_add_info_from_dom(
                driver, timeout=dom_timeout
            )
            if not is_valid_build_year(build_year) and is_valid_build_year(dom_year):
                build_year = dom_year
            if not total_units and dom_units:
                total_units = dom_units
            if not education_setup and dom_edu:
                education_setup = dom_edu

        if not is_valid_build_year(build_year):
            dom_year = extract_build_year_from_dom(driver)
            if dom_year:
                build_year = dom_year

        if not is_valid_build_year(build_year):
            for text_source in (
                _panel_inner_text(driver, "bldg_table"),
                top_text,
            ):
                parsed_year = parse_build_year_from_text(text_source)
                if parsed_year:
                    build_year = parsed_year
                    break

        if is_valid_build_year(build_year):
            build_year = normalize_build_year_value(build_year) or build_year
        else:
            build_year = "값없음"
    except Exception:
        if not build_year:
            build_year = "값없음"

    bid_info = ""
    if raw_detail:
        try:
            from tank_detail import parse_bid_info_from_detail

            bid_info = parse_bid_info_from_detail(raw_detail)
        except Exception:
            pass
    if not bid_info or bid_info.strip() in ("", "없음"):
        bid_info = _extract_bid_info(driver)

    owner = "값없음"
    if raw_detail:
        try:
            from tank_detail import parse_owner_from_detail

            owner = parse_owner_from_detail(raw_detail) or owner
        except Exception:
            pass
    if owner in ("", "값없음"):
        try:
            owner = (
                driver.find_elements(By.CLASS_NAME, "Btbl_list")[0]
                .text.split("소유자")[1]
                .split("감정가")[0]
                .strip()
            )
        except Exception:
            owner = "값없음"

    appraiser = "값없음"
    if raw_detail:
        try:
            from tank_detail import parse_appraiser_from_detail

            appraiser = parse_appraiser_from_detail(raw_detail) or appraiser
        except Exception:
            pass
    if appraiser in ("", "값없음"):
        try:
            from tank_detail import extract_appraiser_from_dom

            appraiser = extract_appraiser_from_dom(driver) or appraiser
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
    if (
        raw_detail
        and tid
        and parse_intr_flag_from_detail
        and parse_intr_flag_from_detail(raw_detail)
        and "유치권" not in special_note
    ):
        special_note = (
            f"{special_note} (유치권 존재)" if special_note != "없음" else "유치권 존재"
        )

    elevator = "없음"
    parking = "없음"
    if raw_detail:
        try:
            from tank_detail import parse_bldg_meta_from_detail

            bldg_meta = parse_bldg_meta_from_detail(raw_detail)
            elevator = bldg_meta.get("elevator") or elevator
            parking = bldg_meta.get("parking") or parking
        except Exception:
            pass
    if elevator in ("", "없음") or parking in ("", "없음"):
        bldg_text = _panel_inner_text(driver, "bldg_table")
        if not bldg_text:
            try:
                bldg_text = driver.find_element(By.ID, "bldg_table").text
            except Exception:
                bldg_text = ""
        if bldg_text:
            if elevator in ("", "없음"):
                elevator = _parse_elevator_from_bldg_table(bldg_text)
            if parking in ("", "없음"):
                parking = _parse_parking_from_bldg_table(bldg_text)

    land_area = "없음"
    try:
        land_area = top_text.split("대지권")[1].split("㎡")[0].strip()
    except Exception:
        try:
            land_area = top_text.split("토지면적")[1].split("㎡")[0].strip()
        except Exception:
            pass

    deunggi_info = ""
    if raw_detail:
        try:
            from tank_detail import parse_deunggi_from_detail

            deunggi_info = parse_deunggi_from_detail(raw_detail)
        except Exception:
            pass
    if not deunggi_info or deunggi_info == "값없음":
        regist_text = _panel_inner_text(driver, "lyCnt_regist")
        if regist_text:
            deunggi_info = _clean_building_registry(regist_text)
        else:
            try:
                ly_cnt_regist = driver.find_element(By.ID, "lyCnt_regist")
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
    if tid:
        try:
            from tank_detail import collect_lease_status

            _wait_lycnt_leas(driver)
            lease_info = collect_lease_status(raw_detail, driver)
        except Exception:
            lease_info = ""
    if not lease_info:
        lease_info = "값없음"

    return {
        "auction_no": auction_no,
        "court": tank_fields.get("court") or "",
        "address": address,
        "views": views,
        "top_text": top_text,
        "building_area": building_area,
        "build_year": build_year,
        "total_units": total_units,
        "education_setup": education_setup,
        "bid_date": bid_date,
        "appraisal_price": appraisal_price,
        "min_price": min_price,
        "sale_price": sale_price,
        "bid_info": bid_info,
        "owner": owner,
        "appraiser": appraiser,
        "official_land_price": official_land_price,
        "tenant_info": tenant_info,
        "special_note": special_note,
        "elevator": elevator,
        "parking": parking,
        "land_area": land_area,
        "deunggi_info": deunggi_info,
        "lease_info": lease_info,
    }


def summarize_tank_collection_gaps(item: dict) -> list[str]:
    """탱크에서 비어 있거나 DOM/API 모두 실패한 필드 목록."""
    gaps: list[str] = []

    def missing(val, empty=("", "없음", "값없음", "0", "임차정보없음")) -> bool:
        if val is None:
            return True
        if isinstance(val, str) and val.startswith("__TENANT_STATUS_V1__"):
            try:
                from tank_detail import decode_tenant_status, tenant_status_is_empty

                return tenant_status_is_empty(decode_tenant_status(val))
            except Exception:
                return True
        if isinstance(val, int) and val == 0:
            return True
        text = str(val).strip()
        return text in empty

    checks = (
        ("경매번호", item.get("auctionNo")),
        ("주소", item.get("address")),
        ("면적", item.get("area")),
        ("교육환경", item.get("education_setup")),
        ("준공/사용승인", item.get("builtYear")),
        ("세대수", item.get("totalUnits")),
        ("등기(건물)", item.get("deunggi_info")),
        ("임차인 현황 없음", item.get("lease_info")),
        ("소유자", item.get("owner")),
        ("감정원", item.get("appraiser")),
        ("낙찰정보 없음", item.get("bid_info")),
        ("승강기", item.get("elevator")),
        ("주차", item.get("parking")),
        ("네이버단지ID", item.get("naver_id")),
    )
    for label, val in checks:
        if label == "세대수":
            if not val:
                gaps.append(label)
        elif missing(val):
            gaps.append(label)
    return gaps


def crawl_item(driver, raw_entry: str, should_stop: ShouldStop = None) -> dict:
    check_stop(should_stop)
    if "_" in raw_entry:
        url = raw_entry.split("_", 1)[-1]
    else:
        url = raw_entry

    _navigate_tank_detail(driver, url)
    tid = _tid_from_url(url)
    driver.implicitly_wait(0)

    raw_detail = None
    env_payload = None
    tank_fields: dict = {}
    naver_complex_id = None
    parse_education_from_env_payload = None
    parse_apt_meta_from_env_payload = None
    parse_lease_from_detail = None
    parse_intr_flag_from_detail = None

    if tid:
        try:
            from tank_detail import (
                extract_building_area_from_detail,
                extract_complex_id_from_env_payload,
                fetch_tank_detail_bundle_with_retry,
                merge_tank_fields,
                parse_apt_meta_from_env_payload,
                parse_base_info_fields,
                parse_education_from_env_payload,
                parse_intr_flag_from_detail,
                parse_lease_from_detail,
                read_dom_base_info,
            )

            # API 우선 — DOM 렌더 대기 전에 AuctView·EnvView 조회
            raw_detail, env_payload = fetch_tank_detail_bundle_with_retry(driver, tid)
            check_stop(should_stop)
            tank_fields = parse_base_info_fields(raw_detail)
            naver_complex_id = extract_complex_id_from_env_payload(env_payload)
        except Exception:
            tank_fields = {}

    if not _tank_api_has_core(tank_fields):
        _wait_tank_detail_render(driver, tid)
        if tid:
            try:
                from tank_detail import (
                    extract_complex_id_from_env_payload,
                    fetch_tank_detail_bundle_with_retry,
                    merge_tank_fields,
                    parse_base_info_fields,
                )

                raw_detail, env_payload = fetch_tank_detail_bundle_with_retry(
                    driver, tid
                )
                tank_fields = merge_tank_fields(
                    tank_fields, parse_base_info_fields(raw_detail)
                )
                if env_payload and not naver_complex_id:
                    naver_complex_id = extract_complex_id_from_env_payload(
                        env_payload
                    )
            except Exception:
                pass
    check_stop(should_stop)

    if tid:
        try:
            from tank_detail import merge_tank_fields, read_dom_base_info

            tank_fields = merge_tank_fields(
                tank_fields,
                read_dom_base_info(driver),
            )
        except Exception:
            pass

    usage = tank_fields.get("usage") or "없음"
    try:
        if usage in ("", "없음"):
            view_objects = driver.find_elements(By.CLASS_NAME, "viewobject")
            if len(view_objects) > 1:
                usage = view_objects[1].text.strip()
    except Exception:
        pass
    if tank_fields.get("usage"):
        usage = tank_fields["usage"]

    building_area = "0"
    if raw_detail:
        try:
            from tank_detail import extract_building_area_from_detail

            building_area = extract_building_area_from_detail(raw_detail)
        except Exception:
            pass
    top_text = ""
    if building_area in ("0", "", "없음"):
        try:
            top_el = driver.find_elements(By.CLASS_NAME, "lyTopFixMent")
            if top_el:
                top_text = top_el[0].get_attribute("innerText") or ""
                building_area = _extract_building_area(top_text)
        except Exception:
            pass

    min_price = tank_fields.get("min_price")
    sale_price = tank_fields.get("sale_price")
    appraisal_price = tank_fields.get("appraisal_price")

    _ensure_tank_detail_panels_ready(driver)
    check_stop(should_stop)

    driver.implicitly_wait(0)
    try:
        tank_snapshot = _collect_tank_page_fields(
            driver,
            raw_entry,
            url,
            raw_detail=raw_detail,
            env_payload=env_payload,
            tank_fields=tank_fields,
            top_text=top_text,
            building_area=building_area,
            dom_timeout=TANK_DOM_TIMEOUT,
            parse_apt_meta_from_env_payload=parse_apt_meta_from_env_payload,
            parse_education_from_env_payload=parse_education_from_env_payload,
            parse_lease_from_detail=parse_lease_from_detail,
            parse_intr_flag_from_detail=parse_intr_flag_from_detail,
            tid=tid,
        )
    finally:
        driver.implicitly_wait(1)

    check_stop(should_stop)
    building_area = tank_snapshot["building_area"]
    min_price = tank_snapshot["min_price"] if tank_snapshot["min_price"] is not None else min_price
    sale_price = tank_snapshot["sale_price"] if tank_snapshot["sale_price"] is not None else sale_price
    appraisal_price = (
        tank_snapshot["appraisal_price"]
        if tank_snapshot["appraisal_price"] is not None
        else appraisal_price
    )

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
            check_stop(should_stop)
            naver = naver_crawl.extract_naver_prices(
                driver,
                building_area,
                "",
                complex_id=naver_complex_id,
                tid=tid,
                should_stop=should_stop,
            )
            if naver.get("complex_id") and not naver_complex_id:
                naver_complex_id = str(naver["complex_id"])
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
        except CrawlStoppedError:
            raise
        except Exception:
            traceback.print_exc()

    auc_link = url.split("&")[0]

    return {
        "memo": "",
        "link": auc_link,
        "views": _safe_int(tank_snapshot["views"]) or 0,
        "auctionNo": tank_snapshot["auction_no"],
        "court": tank_snapshot.get("court") or "",
        "address": tank_snapshot["address"],
        "totalUnits": tank_snapshot["total_units"],
        "usage": usage,
        "area": (
            str(parse_building_area_m2(building_area) or building_area)
            if building_area not in ("0", "없음")
            else building_area
        ),
        "builtYear": tank_snapshot["build_year"],
        "bidDate": tank_snapshot["bid_date"],
        "appraisal_price": appraisal_price or 0,
        "min_price": min_price or 0,
        "sale_price": sale_price,
        "naver_lowest_price": naver["naver_lowest_price"] or 0,
        "gap_margin_sold_price": naver["gap_margin_sold_price"],
        "gap_margin": naver["gap_margin"],
        "new_case_gap_margin": naver["new_case_gap_margin"],
        "real_trade_count": naver["real_trade_count"],
        "bid_info": tank_snapshot["bid_info"].strip(),
        "owner": tank_snapshot["owner"],
        "appraiser": tank_snapshot["appraiser"],
        "official_land_price": tank_snapshot["official_land_price"] or 0,
        "tenant_info": tank_snapshot["tenant_info"],
        "special_note": tank_snapshot["special_note"],
        "elevator": tank_snapshot["elevator"],
        "parking": tank_snapshot["parking"],
        "land_area": tank_snapshot["land_area"],
        "deunggi_info": tank_snapshot["deunggi_info"],
        "education_setup": tank_snapshot["education_setup"],
        "lease_info": tank_snapshot["lease_info"],
        "naver_price_detail": naver["naver_price_detail"],
        "transaction_prices": naver["transaction_prices"],
        "naver_id": str(naver.get("complex_id") or naver_complex_id or "").strip(),
        "record_time": datetime.now().isoformat(timespec="seconds"),
    }


_INVALID_AUCTION_HINTS = (
    "MY위젯",
    "도움말",
    "위젯",
    "로그아웃",
    "로그인",
)


def validate_crawl_item_reason(item: dict) -> tuple[bool, str]:
    raw_no = str(item.get("auctionNo") or item.get("auction_no") or "").strip()
    if any(hint in raw_no for hint in _INVALID_AUCTION_HINTS):
        return False, f"로그인/위젯 페이지로 수집됨 (경매번호: {raw_no[:40]})"

    auction_no = _normalize_auction_no(raw_no)
    if not auction_no:
        return False, f"경매번호 추출 실패 (수집값: {raw_no or '없음'})"

    address = str(item.get("address") or "").strip()
    if not address or address in ("없음", "값없음"):
        return False, "주소 추출 실패 (regnAdrs·AuctView API 미수집 — 탱크 UI 렌더 대기 확인)"

    link = str(item.get("link") or "").strip()
    if link:
        if "tankauction.com" not in link:
            return False, f"탱크 링크 아님: {link[:60]}"
        if not re.search(r"/(ca|pa)/(caView|paView)\.php", link):
            return False, f"상세 URL 형식 아님: {link[:60]}"

    return True, ""


def is_valid_crawl_item(item: dict) -> bool:
    valid, _ = validate_crawl_item_reason(item)
    return valid


def fetch_naver_id_only(driver, raw_entry: str) -> dict:
    """탱크 상세 페이지에서 네이버 단지 ID(dj_no)만 수집."""
    if "_" in raw_entry:
        url = raw_entry.split("_", 1)[-1]
    else:
        url = raw_entry.strip()

    _navigate_tank_detail(driver, url)
    tid = _tid_from_url(url)
    _wait_tank_detail_render(driver, tid)

    naver_id = ""
    error = ""
    try:
        importlib.reload(naver_crawl)
        complex_id, err = naver_crawl.resolve_complex_id(driver, tid=tid)
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
