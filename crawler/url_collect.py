import re

from selenium.common.exceptions import (
    ElementClickInterceptedException,
    StaleElementReferenceException,
)
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.select import Select
from selenium.webdriver.support.ui import WebDriverWait

CA_LIST_URL = "https://www.tankauction.com/ca/caList.php"
PA_LIST_URL = "https://www.tankauction.com/pa/paList.php"
COLLECT_TIMEOUT = 5
LIST_READY_TIMEOUT = 20
POLL = 0.1


def _wait_visible(driver, by, value, timeout: float = COLLECT_TIMEOUT):
    return WebDriverWait(driver, timeout, poll_frequency=POLL).until(
        EC.visibility_of_element_located((by, value))
    )


def _wait_clickable(driver, by, value, timeout: float = COLLECT_TIMEOUT):
    return WebDriverWait(driver, timeout, poll_frequency=POLL).until(
        EC.element_to_be_clickable((by, value))
    )


def _safe_click(driver, element):
    try:
        driver.execute_script("arguments[0].click();", element)
    except Exception:
        try:
            element.click()
        except ElementClickInterceptedException:
            driver.execute_script("arguments[0].click();", element)


def _list_has_rows(driver) -> bool:
    if driver.find_elements(By.NAME, "chk_idx"):
        return True
    if driver.find_elements(By.CSS_SELECTOR, "a[href*='caView.php?tid=']"):
        return True
    if driver.find_elements(By.CSS_SELECTOR, "a[href*='paView.php?cltrNo=']"):
        return True
    return False


def _wait_list_ready(driver, timeout: float = LIST_READY_TIMEOUT):
    def _ready(_driver):
        return _list_has_rows(_driver)

    WebDriverWait(driver, timeout, poll_frequency=POLL).until(_ready)


def _find_page_size_select(driver):
    for name in ("dataSize", "dataSize_s"):
        try:
            element = driver.find_element(By.NAME, name)
            if element.is_displayed():
                return Select(element)
        except Exception:
            continue
    return None


def _set_page_size(driver, page_size: str):
    for _attempt in range(2):
        select = _find_page_size_select(driver)
        if select is None:
            return
        try:
            select.select_by_visible_text(str(page_size))
            return
        except StaleElementReferenceException:
            continue
        except Exception:
            try:
                select.select_by_value(str(page_size))
                return
            except StaleElementReferenceException:
                continue
            except Exception:
                return


def _is_public_list(driver) -> bool:
    try:
        return "공매" in driver.find_element(By.CLASS_NAME, "page_title_left").text
    except Exception:
        return False


def _paging_root(driver):
    for selector in (
        ".paging_num",
        ".paginate",
        ".pageArea",
        "div.page",
        ".paging",
    ):
        elements = driver.find_elements(By.CSS_SELECTOR, selector)
        if elements:
            return elements[0]

    page_links = driver.find_elements(By.CLASS_NAME, "pageNo")
    if page_links:
        try:
            return page_links[0].find_element(By.XPATH, "./..")
        except Exception:
            pass
    return None


def _page_link_elements(driver) -> list:
    root = _paging_root(driver)
    if root is None:
        return driver.find_elements(By.CLASS_NAME, "pageNo")

    links = root.find_elements(By.CLASS_NAME, "pageNo")
    if links:
        return links

    candidates = []
    for element in root.find_elements(By.CSS_SELECTOR, "a, button, span"):
        text = element.text.strip()
        onclick = element.get_attribute("onclick") or ""
        if text.isdigit() or "page" in onclick.lower() or "goto" in onclick.lower():
            candidates.append(element)
    return candidates


def _current_page_number(driver) -> str:
    root = _paging_root(driver)
    if root is not None:
        for element in root.find_elements(By.CSS_SELECTOR, "strong, b"):
            text = element.text.strip()
            if text.isdigit():
                return text

        for element in root.find_elements(By.CSS_SELECTOR, "a, span"):
            text = element.text.strip()
            if not text.isdigit():
                continue
            classes = (element.get_attribute("class") or "").lower()
            if any(token in classes for token in ("on", "active", "current", "selected")):
                return text

    for element in driver.find_elements(By.CLASS_NAME, "pageNo"):
        parent = None
        try:
            parent = element.find_element(By.XPATH, "./..")
            for strong in parent.find_elements(By.TAG_NAME, "strong"):
                text = strong.text.strip()
                if text.isdigit():
                    return text
        except Exception:
            continue

    return "1"


def _parse_total_count(driver, *, lightweight: bool = False) -> int | None:
    patterns = (
        r"검색(?:된)?\s*물건수\s*[:：]?\s*([\d,]+)",
        r"총\s*([\d,]+)\s*건",
        r"([\d,]+)\s*건\s*검색",
        r"전체\s*[:：]?\s*([\d,]+)\s*건",
        r"물건\s*([\d,]+)\s*건",
        r"([\d,]+)\s*개\s*물건",
    )
    sources: list[str] = []
    for selector in (
        ".page_title_left",
        ".page_title",
        ".list_count",
        "#totCnt",
        ".total_count",
    ):
        try:
            for element in driver.find_elements(By.CSS_SELECTOR, selector):
                text = (element.text or "").strip()
                if text:
                    sources.append(text)
        except Exception:
            pass

    if not lightweight:
        try:
            sources.append(driver.find_element(By.TAG_NAME, "body").text[:5000])
        except Exception:
            pass

        try:
            sources.append(driver.page_source[:80000])
        except Exception:
            pass

    for text in sources:
        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                return int(match.group(1).replace(",", ""))
    return None


def _page_size_on_list(driver) -> int:
    rows = driver.find_elements(By.NAME, "chk_idx")
    if rows:
        return len(rows)
    select = _find_page_size_select(driver)
    if select is not None:
        try:
            value = (select.first_selected_option.text or "").strip()
            if value.isdigit():
                return int(value)
        except Exception:
            pass
    return 100


def _go_to_page(driver, target: int) -> bool:
    target_str = str(target)
    current = int(_current_page_number(driver) or "1")
    if current == target:
        if _list_has_rows(driver):
            return True
        _wait_list_ready(driver, timeout=5)
        return True

    if _click_page_number(driver, target_str):
        if int(_current_page_number(driver) or "0") == target:
            return True

    for script in (
        f"if(typeof goPage==='function'){{goPage({target});}}",
        f"if(typeof gotoPage==='function'){{gotoPage('{target}','{target}');}}",
        f"if(typeof movePage==='function'){{movePage({target});}}",
        f"if(typeof pageMove==='function'){{pageMove({target});}}",
    ):
        try:
            before = _first_row_key(driver)
            driver.execute_script(script)
            if int(_current_page_number(driver) or "0") == target:
                _wait_list_ready(driver)
                return True
            if _wait_list_changed(driver, before):
                if int(_current_page_number(driver) or "0") == target:
                    return True
        except Exception:
            continue

    steps = 0
    while current < target and steps < 30:
        before = _first_row_key(driver)
        moved = False

        jump_targets = sorted(
            {
                int(element.text.strip())
                for element in _page_link_elements(driver)
                if element.text.strip().isdigit()
            }
        )
        for jump in jump_targets:
            if current < jump <= target and _click_page_number(driver, str(jump)):
                moved = True
                break

        if not moved and _click_page_number(driver, str(current + 1)):
            moved = True

        if not moved and _click_next_page_block(driver):
            moved = True

        if not moved:
            break

        if not _wait_list_changed(driver, before):
            break

        current = int(_current_page_number(driver) or str(current + 1))
        steps += 1
        if current == target:
            return True

    return int(_current_page_number(driver) or "0") == target


def _click_page_number(driver, page: str) -> bool:
    for element in _page_link_elements(driver):
        if element.text.strip() == page:
            _safe_click(driver, element)
            _wait_list_ready(driver)
            return True

    for element in driver.find_elements(By.XPATH, f"//a[normalize-space(text())='{page}']"):
        _safe_click(driver, element)
        _wait_list_ready(driver)
        return True

    return False


def _click_next_page_block(driver) -> bool:
    before = _first_row_key(driver)
    current = int(_current_page_number(driver) or "1")

    jump_targets = sorted(
        {
            int(element.text.strip())
            for element in _page_link_elements(driver)
            if element.text.strip().isdigit() and int(element.text.strip()) > current
        }
    )
    if jump_targets and _click_page_number(driver, str(jump_targets[0])):
        return _wait_list_changed(driver, before)

    for xpath in (
        "//a[contains(@class,'pageNo') and contains(@class,'next')]",
        "//a[contains(@class,'next')]",
        "//a[contains(@class,'PageNext')]",
        "//a[contains(@onclick,'next')]",
        "//a[contains(normalize-space(.),'다음')]",
        "//a[contains(normalize-space(.),'▶')]",
        "//a[normalize-space(text())='>']",
        "//a[normalize-space(text())='>>']",
    ):
        for element in driver.find_elements(By.XPATH, xpath):
            _safe_click(driver, element)
            if _wait_list_changed(driver, before):
                return True
    return False


def _first_row_key(driver) -> str:
    rows = driver.find_elements(By.NAME, "chk_idx")
    if rows:
        return rows[0].get_attribute("value") or ""
    for selector in (
        "a[href*='caView.php?tid=']",
        "a[href*='paView.php?cltrNo=']",
    ):
        for element in driver.find_elements(By.CSS_SELECTOR, selector):
            href = element.get_attribute("href") or ""
            match = re.search(r"(?:tid|cltrNo)=(\d+)", href)
            if match:
                return match.group(1)
    return ""


def _wait_list_changed(driver, previous_key: str, timeout: float = LIST_READY_TIMEOUT) -> bool:
    try:
        WebDriverWait(driver, timeout, poll_frequency=POLL).until(
            lambda d: _list_has_rows(d)
        )
        if not previous_key:
            return True

        def _changed(_driver):
            current = _first_row_key(_driver)
            return bool(current) and current != previous_key

        return WebDriverWait(driver, timeout, poll_frequency=POLL).until(_changed)
    except Exception:
        return False


def _collect_from_view_links(driver, page_now: str, is_public: bool) -> list[dict]:
    entries: list[dict] = []
    seen: set[str] = set()
    selector = (
        "a[href*='paView.php?cltrNo=']"
        if is_public
        else "a[href*='caView.php?tid=']"
    )
    param = "cltrNo" if is_public else "tid"
    base = "https://www.tankauction.com/pa/paView.php" if is_public else "https://www.tankauction.com/ca/caView.php"

    for element in driver.find_elements(By.CSS_SELECTOR, selector):
        href = element.get_attribute("href") or ""
        match = re.search(rf"{param}=(\d+)", href)
        if not match:
            continue
        item_id = match.group(1)
        if item_id in seen:
            continue
        seen.add(item_id)

        case_num = (element.text or "").strip() or item_id
        if not is_public:
            case_num = case_num.replace("-", "타경")
        url = f"{base}?{param}={item_id}&chkNo={page_now}&TotNo={len(seen)}"
        label = f"{case_num}_{url}"
        entries.append({"label": label, "url": label})

    return entries


def _collect_page_entries(driver, page_now: str, is_public: bool) -> list[dict]:
    entries: list[dict] = []
    chk_idx = driver.find_elements(By.NAME, "chk_idx")

    for chk_element in chk_idx:
        chk = chk_element.get_attribute("value")
        if not chk:
            continue

        try:
            if is_public:
                case_num = driver.find_element(By.ID, f"mgmtNo_{chk}").text
                url = (
                    "https://www.tankauction.com/pa/paView.php?cltrNo="
                    f"{chk}&chkNo={page_now}&TotNo={len(chk_idx)}"
                )
            else:
                case_num = driver.find_element(By.ID, f"saNo_{chk}").text
                case_num = case_num.replace("-", "타경")
                url = (
                    "https://www.tankauction.com/ca/caView.php?tid="
                    f"{chk}&chkNo={page_now}&TotNo={len(chk_idx)}"
                )
            label = f"{case_num}_{url}"
            entries.append({"label": label, "url": label})
        except StaleElementReferenceException:
            continue
        except Exception:
            continue

    if entries:
        return entries

    return _collect_from_view_links(driver, page_now, is_public)


def _click_chk_ment(driver, keyword: str):
    for element in driver.find_elements(By.CLASS_NAME, "chk_ment"):
        if element.text == keyword:
            _safe_click(driver, element)
            return


def _configure_driver_timeouts(driver):
    try:
        driver.set_page_load_timeout(45)
        driver.set_script_timeout(30)
    except Exception:
        pass


def apply_search_config(driver, config: dict | None, *, skip_navigation: bool = False):
    if not config:
        return "검색 조건 없이 진행합니다."

    _configure_driver_timeouts(driver)
    list_type = config.get("listType", "auction")

    if not skip_navigation:
        url = PA_LIST_URL if list_type == "public" else CA_LIST_URL
        driver.get(url)

        property_types = config.get("propertyTypes") or []
        if property_types:
            _safe_click(driver, _wait_clickable(driver, By.ID, "btn_power"))
            for keyword in property_types:
                _click_chk_ment(driver, keyword)

        status = config.get("status")
        if status:
            select = Select(_wait_visible(driver, By.NAME, "stat"))
            select.select_by_visible_text(status)

        appraisal_min = config.get("appraisalMin")
        appraisal_max = config.get("appraisalMax")
        if appraisal_min:
            select = Select(_wait_visible(driver, By.NAME, "apslAmtBgn"))
            select.select_by_visible_text(appraisal_min)
        if appraisal_max:
            select = Select(_wait_visible(driver, By.NAME, "apslAmtEnd"))
            select.select_by_visible_text(appraisal_max)

        preserve = config.get("preserveRegistryFrom")
        if preserve and list_type != "public":
            _safe_click(driver, _wait_clickable(driver, By.CLASS_NAME, "BtnAddSer_0"))
            select = Select(_wait_visible(driver, By.NAME, "prsvBgn"))
            select.select_by_visible_text(str(preserve))

        special_conditions = config.get("excludeSpecialConditions") or []
        if special_conditions:
            mode = config.get("specialConditionMode") or "exclude"
            radio_id_by_mode = {
                "include-any": "splSrchType1",
                "include-all": "splSrchType2",
                "exclude": "splSrchType4",
            }
            _safe_click(
                driver,
                _wait_clickable(driver, By.ID, radio_id_by_mode.get(mode, "splSrchType4")),
            )
            for keyword in special_conditions:
                _click_chk_ment(driver, keyword)

        if list_type == "public":
            _safe_click(
                driver,
                _wait_clickable(driver, By.CSS_SELECTOR, "button.button.btn_tank.radius_10"),
            )
        else:
            _safe_click(driver, _wait_clickable(driver, By.ID, "btnSrch"))

        _wait_list_ready(driver, timeout=LIST_READY_TIMEOUT)

    page_size = config.get("pageSize", "100")
    before_key = _first_row_key(driver)
    _set_page_size(driver, str(page_size))
    if before_key and not _wait_list_changed(driver, before_key, timeout=2):
        _wait_list_ready(driver, timeout=2)
    return "검색 조건을 적용했습니다."


def apply_preset(driver, preset: str, search: dict | None = None):
    if preset == "현재":
        # 검색을 새로 실행하지 않고 현재 화면 상태에서 시작한다는 점만
        # 다르고, 페이지 크기 설정은 빌라 등 다른 프리셋(apply_search_config)과
        # 완전히 동일한 로직을 그대로 사용한다.
        current_config = {"listType": "public" if _is_public_list(driver) else "auction", "pageSize": "100"}
        apply_search_config(driver, current_config, skip_navigation=True)
        return "현재 브라우저 페이지에서 URL을 수집합니다. (페이지당 100건으로 설정)"

    if search:
        return apply_search_config(driver, search)

    presets = {
        "아파트": {
            "listType": "auction",
            "propertyTypes": ["아파트"],
            "status": "진행물건",
            "appraisalMin": "8억",
            "appraisalMax": "30억",
            "preserveRegistryFrom": "2012",
            "excludeSpecialConditions": ["위반건축물"],
            "pageSize": "100",
        },
        "공매": {
            "listType": "public",
            "propertyTypes": ["다가구주택", "상가주택"],
            "status": "기타",
            "appraisalMin": "8억",
            "appraisalMax": "30억",
            "preserveRegistryFrom": "",
            "excludeSpecialConditions": ["위반건축물"],
            "pageSize": "100",
        },
        "다가구": {
            "listType": "auction",
            "propertyTypes": ["다가구주택", "상가주택"],
            "status": "진행물건",
            "appraisalMin": "8억",
            "appraisalMax": "30억",
            "preserveRegistryFrom": "2012",
            "excludeSpecialConditions": ["위반건축물"],
            "pageSize": "100",
        },
        "빌라": {
            "listType": "auction",
            "propertyTypes": ["연립주택", "다세대주택", "도시형생활주택"],
            "status": "진행물건",
            "appraisalMin": "8억",
            "appraisalMax": "30억",
            "preserveRegistryFrom": "2012",
            "excludeSpecialConditions": ["위반건축물"],
            "pageSize": "100",
        },
    }

    preset_config = presets.get(preset)
    if preset_config:
        return apply_search_config(driver, preset_config)

    return (
        f"'{preset}' 프리셋은 자동 검색이 없습니다. "
        "브라우저에서 필터를 설정한 뒤 '현재'로 수집하세요."
    )


def collect_urls(
    driver,
    on_progress=None,
    *,
    current_page_only: bool = False,
) -> list[dict]:
    def progress(message: str):
        if on_progress:
            on_progress(message)

    entries: list[dict] = []
    list_timeout = LIST_READY_TIMEOUT

    if not _list_has_rows(driver):
        try:
            _wait_list_ready(driver, timeout=list_timeout)
        except Exception as exc:
            raise RuntimeError(
                "탱크옥션 목록을 찾지 못했습니다. "
                "로그인·검색 조건을 확인하거나 프리셋을 바꿔 주세요."
            ) from exc

    if not _list_has_rows(driver):
        raise RuntimeError(
            "검색 결과가 없습니다. 검색 조건(물건종류·감정가 등)을 확인해 주세요."
        )

    is_public = _is_public_list(driver)

    total_count = _parse_total_count(driver)
    page_size = _page_size_on_list(driver)
    visible_links = len(_page_link_elements(driver))

    if total_count:
        expected_pages = max(1, (total_count + page_size - 1) // page_size)
    else:
        expected_pages = max(1, visible_links + 1)

    progress(
        f"목록 {total_count or '?'}건 / 페이지당 {page_size}건 / "
        f"예상 {expected_pages}페이지 (페이지링크 {visible_links}개 감지)"
    )

    _go_to_page(driver, 1)

    last_page_count = 0
    for page_num in range(1, expected_pages + 1):
        if page_num > 1 and not _go_to_page(driver, page_num):
            progress(f"{page_num}페이지 이동 실패")
            break

        page_now = str(page_num)
        page_entries = _collect_page_entries(driver, page_now, is_public)
        last_page_count = len(page_entries)
        entries.extend(page_entries)
        progress(f"{page_now}페이지 {last_page_count}건 수집 (누적 {len(entries)}건)")

    safety = 0
    while safety < 20:
        if total_count:
            if len(entries) >= total_count:
                break
        elif last_page_count < page_size:
            break

        safety += 1
        next_page = int(_current_page_number(driver) or "1") + 1
        jump_targets = {
            int(element.text.strip())
            for element in _page_link_elements(driver)
            if element.text.strip().isdigit()
        }
        if not jump_targets or next_page > max(jump_targets):
            progress(f"더 이상 페이지 링크가 없어 수집을 종료합니다 (누적 {len(entries)}건)")
            break
        if not _go_to_page(driver, next_page):
            progress(f"{next_page}페이지 이동 실패 (안전루프 중단)")
            break

        page_entries = _collect_page_entries(driver, str(next_page), is_public)
        if not page_entries:
            progress(f"{next_page}페이지에서 항목을 찾지 못함 (수집 중단)")
            break

        last_page_count = len(page_entries)
        entries.extend(page_entries)
        progress(
            f"{next_page}페이지 {last_page_count}건 수집 (누적 {len(entries)}건)"
        )

    if total_count and len(entries) < total_count:
        progress(
            f"경고: {total_count}건 중 {len(entries)}건만 수집했습니다."
        )

    return entries
