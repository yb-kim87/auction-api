from selenium.common.exceptions import ElementClickInterceptedException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.select import Select
from selenium.webdriver.support.ui import WebDriverWait

CA_LIST_URL = "https://www.tankauction.com/ca/caList.php"
PA_LIST_URL = "https://www.tankauction.com/pa/paList.php"
COLLECT_TIMEOUT = 2
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
    driver.execute_script(
        "arguments[0].scrollIntoView({block:'center', inline:'nearest'});",
        element,
    )
    try:
        element.click()
    except ElementClickInterceptedException:
        driver.execute_script("arguments[0].click();", element)


def _wait_list_ready(driver, timeout: float = COLLECT_TIMEOUT):
    WebDriverWait(driver, timeout, poll_frequency=POLL).until(
        EC.presence_of_element_located((By.NAME, "chk_idx"))
    )


def _click_chk_ment(driver, keyword: str):
    for element in driver.find_elements(By.CLASS_NAME, "chk_ment"):
        if element.text == keyword:
            _safe_click(driver, element)
            return


def apply_search_config(driver, config: dict | None):
    if not config:
        return "검색 조건 없이 진행합니다."

    list_type = config.get("listType", "auction")
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

    exclude_conditions = config.get("excludeSpecialConditions") or []
    if exclude_conditions:
        _safe_click(driver, _wait_clickable(driver, By.ID, "splSrchType4"))
        for keyword in exclude_conditions:
            _click_chk_ment(driver, keyword)

    if list_type == "public":
        _safe_click(
            driver,
            _wait_clickable(driver, By.CSS_SELECTOR, "button.button.btn_tank.radius_10"),
        )
    else:
        _safe_click(driver, _wait_clickable(driver, By.ID, "btnSrch"))

    page_size = config.get("pageSize", "100")
    select = Select(_wait_visible(driver, By.NAME, "dataSize_s"))
    select.select_by_visible_text(str(page_size))
    _wait_list_ready(driver)
    return "검색 조건을 적용했습니다."


def apply_preset(driver, preset: str, search: dict | None = None):
    if preset == "현재":
        return "현재 브라우저 페이지에서 URL을 수집합니다."

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
    }

    preset_config = presets.get(preset)
    if preset_config:
        return apply_search_config(driver, preset_config)

    return (
        f"'{preset}' 프리셋은 자동 검색이 없습니다. "
        "브라우저에서 필터를 설정한 뒤 '현재'로 수집하세요."
    )


def collect_urls(driver) -> list[dict]:
    entries: list[dict] = []
    _wait_list_ready(driver)

    page_no = driver.find_elements(By.CLASS_NAME, "pageNo")
    pageflag = 0

    for i in range(0, len(page_no) + 1, 1):
        if pageflag != 0:
            _safe_click(driver, page_no[i - 1])
            _wait_list_ready(driver)

        page_now = _wait_visible(driver, By.CSS_SELECTOR, "strong").text
        page_no = driver.find_elements(By.CLASS_NAME, "pageNo")
        chk_idx = driver.find_elements(By.NAME, "chk_idx")

        try:
            page_title_left_text = driver.find_element(
                By.CLASS_NAME, "page_title_left"
            ).text
        except Exception:
            page_title_left_text = ""

        is_public = "공매" in page_title_left_text

        for chk_element in chk_idx:
            chk = chk_element.get_attribute("value")
            if not chk:
                continue

            if is_public:
                case_num = driver.find_element(By.ID, f"mgmtNo_{chk}").text
                url = (
                    "https://www.tankauction.com/pa/paView.php?cltrNo="
                    f"{chk}&chkNo={page_now}&TotNo={len(chk_idx)}"
                )
                label = f"{case_num}_{url}"
            else:
                case_num = driver.find_element(By.ID, f"saNo_{chk}").text
                case_num = case_num.replace("-", "타경")
                url = (
                    "https://www.tankauction.com/ca/caView.php?tid="
                    f"{chk}&chkNo={page_now}&TotNo={len(chk_idx)}"
                )
                label = f"{case_num}_{url}"

            entries.append({"label": label, "url": label})

        pageflag = 1

    return entries
