"""네이버 fin.land 호가·실거래 수집 (호가 우선, 실거래는 후속)."""

from __future__ import annotations

NAVER_CRAWL_REVISION = "2026-06-29-tx-tab-click-only"

import re
import time
from dataclasses import dataclass, field

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from crawl_abort import CrawlStoppedError, ShouldStop, check_stop, wait_until

ARTICLE_URL = (
    "https://fin.land.naver.com/complexes/{complex_id}"
    "?tradeTypes=A1&sortingType=%EB%82%AE%EC%9D%80%EA%B0%80%EA%B2%A9%EC%88%9C&tab=article"
)
TRANSACTION_URL = (
    "https://fin.land.naver.com/complexes/{complex_id}"
    "?tradeType=A1&marketPriceCP=kab&tab=transaction"
)

NAVER_COMPLEX_URL_RE = re.compile(
    r"(?:fin|new)\.land\.naver\.com/complexes/(\d+)",
    re.I,
)
_LINE_TAB_SELECTOR = (
    "[class*='LineTab-module_link'], "
    "[class*='ComplexTab'] a, "
    "[class*='ComplexTab'] button, "
    "[role='tab']"
)

AREA_TOLERANCE_M2 = 2.0
AREA_FILTER_TOLERANCE_M2 = 2.0


@dataclass
class AreaOption:
    label: str
    exclusive_m2: float
    supply_m2: float | None = None


@dataclass
class NaverArticle:
    summary: str
    price_min: int
    price_max: int | None
    exclusive_m2: float | None
    dong: str = ""
    floor: str = ""
    listed_date: str = ""
    broker_label: str = ""
    description: str = ""
    area_label: str = ""

    @property
    def price_label(self) -> str:
        if self.price_max and self.price_max != self.price_min:
            return f"{_format_won(self.price_min)} ~ {_format_won(self.price_max)}"
        return _format_won(self.price_min)


@dataclass
class NaverArticleResult:
    complex_id: str | None = None
    matched_area_label: str = ""
    articles: list[NaverArticle] = field(default_factory=list)
    naver_lowest_price: int | None = None
    naver_price_detail: str = ""
    filter_applied: bool = False
    error: str = ""


@dataclass
class NaverTransactionBlock:
    area_label: str
    content: str


@dataclass
class NaverTransactionResult:
    blocks: list[NaverTransactionBlock] = field(default_factory=list)
    transaction_prices: str = ""
    real_trade_count: str = ""
    error: str = ""


def _element_text(element) -> str:
    return (element.get_attribute("innerText") or element.text or "").strip()


def _format_won(amount: int) -> str:
    eok = amount // 100_000_000
    rest = (amount % 100_000_000) // 10_000
    if eok and rest:
        return f"{eok}억 {rest:,}"
    if eok:
        return f"{eok}억"
    return f"{rest:,}만"


def _won_from_parts(billion: str | None, rest: str | None) -> int:
    total = int(billion) * 100_000_000 if billion else 0
    if rest:
        total += int(rest.replace(",", "")) * 10_000
    return total


def parse_building_area_m2(raw: str) -> float | None:
    cleaned = raw.strip()
    if not cleaned or cleaned in ("0", "없음"):
        return None
    try:
        return float(cleaned)
    except ValueError:
        match = re.search(r"([\d]+(?:\.\d+)?)", cleaned)
        return float(match.group(1)) if match else None


def parse_exclusive_token(text: str) -> tuple[float, str] | None:
    normalized = text.replace("\n", " ")
    match = re.search(r"\(([\d.]+)([A-Za-z])", normalized)
    if match:
        return float(match.group(1)), match.group(2)
    match = re.search(r"\(([\d.]+)", normalized)
    if match:
        return float(match.group(1)), ""
    match = re.search(r"([\d.]+)([A-Za-z])(?:\s|$|\))", normalized)
    if match:
        return float(match.group(1)), match.group(2)
    return None


def exclusive_token_label(value: float, suffix: str = "") -> str:
    text = f"{value:g}"
    return f"{text}{suffix}" if suffix else text


def tx_area_keys_match(target_m2: float, exclusive_m2: float, tolerance: float) -> bool:
    return abs(exclusive_m2 - target_m2) <= tolerance


def parse_exclusive_m2(text: str) -> float | None:
    token = parse_exclusive_token(text)
    if token:
        return token[0]
    match = re.search(r"전용\s*([\d.]+)", text)
    if match:
        return float(match.group(1))
    return None


def parse_area_option_label(label: str) -> AreaOption | None:
    exclusive = None
    supply = None
    ex_match = re.search(r"\(([\d.]+)", label)
    if ex_match:
        exclusive = float(ex_match.group(1))
    sup_match = re.match(r"([\d.]+)", label.strip())
    if sup_match:
        supply = float(sup_match.group(1))
    if exclusive is None:
        return None
    return AreaOption(label=label.strip(), exclusive_m2=exclusive, supply_m2=supply)


def pick_matching_areas(
    options: list[AreaOption], target_m2: float, tolerance: float = AREA_FILTER_TOLERANCE_M2
) -> list[AreaOption]:
    return [
        opt
        for opt in options
        if abs(opt.exclusive_m2 - target_m2) <= tolerance
    ]


def pick_closest_area(options: list[AreaOption], target_m2: float) -> AreaOption | None:
    if not options:
        return None
    return min(options, key=lambda opt: abs(opt.exclusive_m2 - target_m2))


def area_matches(exclusive_m2: float | None, target_m2: float, tolerance: float = AREA_TOLERANCE_M2) -> bool:
    if exclusive_m2 is None:
        return False
    return abs(exclusive_m2 - target_m2) <= tolerance


def parse_sale_price(text: str) -> tuple[int | None, int | None]:
    match = re.search(
        r"매매\s*"
        r"(?:(\d+)억\s*)?(\d{1,3}(?:,\d{3})*)?"
        r"(?:\s*~\s*(?:(\d+)억\s*)?(\d{1,3}(?:,\d{3})*)?)?",
        text,
    )
    if not match:
        return None, None
    low = _won_from_parts(match.group(1), match.group(2))
    high = _won_from_parts(match.group(3), match.group(4)) if match.group(3) or match.group(4) else None
    if not low:
        return None, None
    return low, high or low


def _compact_price_label(price_min: int, price_max: int | None) -> str:
    def part(amount: int) -> str:
        eok = amount // 100_000_000
        rest = (amount % 100_000_000) // 10_000
        if eok and rest:
            return f"{eok}억{rest:,}"
        if eok:
            return f"{eok}억"
        return f"{rest:,}만"

    low = part(price_min)
    if price_max and price_max != price_min:
        return f"매매{low}~{part(price_max)}"
    return f"매매{low}"


def _parse_article_area_label(text: str) -> str:
    match = re.search(r"([\d.]+)㎡\s*\(전용([\d.]+)\)", text)
    if match:
        supply = f"{float(match.group(1)):g}"
        exclusive = f"{float(match.group(2)):g}"
        return f"{supply}㎡ (전용{exclusive})"
    exclusive = parse_exclusive_m2(text)
    if exclusive is not None:
        return f"(전용{exclusive:g})"
    return ""


def _parse_article_floor(text: str) -> str:
    match = re.search(r"(\d+|중|저|고)/(\d+)층", text)
    if match:
        return f"{match.group(1)}/{match.group(2)}"
    return ""


def _parse_article_listed_date(text: str) -> str:
    match = re.search(r"(\d{4}\.\d{2}\.\d{2})", text)
    return match.group(1) if match else ""


def _parse_article_broker_label(text: str) -> str:
    match = re.search(r"중개사\s*(\d+)곳", text)
    if match:
        return f"{match.group(1)}곳 등록"
    return ""


def _parse_article_description(text: str) -> str:
    match = re.search(r'"\s*\n(.+?)\n\s*"', text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return ""


def format_article_compact(article: NaverArticle) -> str:
    parts = [
        article.dong,
        _compact_price_label(article.price_min, article.price_max),
        article.area_label,
        article.floor,
        article.listed_date,
        article.broker_label,
    ]
    line = " ".join(part for part in parts if part)
    if article.description:
        return f'{line}\n\n"\n{article.description}\n"'
    return line


def parse_article_card(text: str) -> NaverArticle | None:
    if not text or "매매" not in text:
        return None
    price_min, price_max = parse_sale_price(text)
    if not price_min:
        return None
    dong_match = re.search(r"\d+동", text)
    return NaverArticle(
        summary=text.strip(),
        price_min=price_min,
        price_max=price_max if price_max != price_min else None,
        exclusive_m2=parse_exclusive_m2(text),
        dong=dong_match.group(0) if dong_match else "",
        floor=_parse_article_floor(text),
        listed_date=_parse_article_listed_date(text),
        broker_label=_parse_article_broker_label(text),
        description=_parse_article_description(text),
        area_label=_parse_article_area_label(text),
    )


def _tid_from_current_url(driver) -> str | None:
    url = driver.current_url or ""
    match = re.search(r"[?&]tid=(\d+)", url)
    return match.group(1) if match else None


def _complex_id_from_dom_once(driver) -> str | None:
    """탱크 caView — #dj_no, complexes 링크, page_source."""
    for by, value in (
        (By.ID, "dj_no"),
        (By.CSS_SELECTOR, "input#dj_no"),
    ):
        for element in driver.find_elements(by, value):
            raw = (element.get_attribute("value") or "").strip()
            if raw.isdigit() and int(raw) > 0:
                return raw

    for element in driver.find_elements(
        By.CSS_SELECTOR, "[data-action='out-link'][data-url*='complexes/']"
    ):
        data_url = element.get_attribute("data-url") or ""
        match = re.search(r"complexes/(\d+)", data_url)
        if match:
            return match.group(1)

    for element in driver.find_elements(By.CSS_SELECTOR, "a[href*='complexes/']"):
        href = element.get_attribute("href") or ""
        match = re.search(r"complexes/(\d+)", href)
        if match:
            return match.group(1)

    for xpath in (
        "//a[contains(text(), 'N단지정보')]",
        "//a[contains(text(), 'N단지')]",
        "//span[contains(text(), 'N단지정보')]",
    ):
        for element in driver.find_elements(By.XPATH, xpath):
            href = element.get_attribute("href") or element.get_attribute("data-url") or ""
            match = re.search(r"complexes/(\d+)", href)
            if match:
                return match.group(1)

    source = driver.page_source or ""
    match = re.search(r'id=["\']dj_no["\'][^>]*value=["\'](\d+)["\']', source)
    if match and int(match.group(1)) > 0:
        return match.group(1)
    for match in re.finditer(
        r"(?:new|fin)\.land\.naver\.com/complexes/(\d+)", source, re.I
    ):
        return match.group(1)
    return None


def _poll_complex_id_from_dom(driver, timeout: float = 4.0) -> str | None:
    """late-stage client-apartment-complex-info 렌더 대기."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        complex_id = _complex_id_from_dom_once(driver)
        if complex_id:
            return complex_id
        time.sleep(0.25)
    return _complex_id_from_dom_once(driver)


def _complex_id_from_env_api(driver, tid: str) -> str | None:
    """탱크 /molit/res/EnvViewData.php — dtDj.dj_no (구 N단지정보 링크 대체)."""
    try:
        raw = driver.execute_async_script(
            """
            const tid = arguments[0];
            const cb = arguments[arguments.length - 1];
            const params = new URLSearchParams({ tid: String(tid), gb: '1' });
            fetch('/molit/res/EnvViewData.php?' + params.toString(), {
              method: 'GET',
              credentials: 'same-origin',
              headers: {
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
              },
            })
              .then(r => r.text())
              .then(text => {
                const start = text.indexOf('{');
                if (start < 0) { cb(null); return; }
                const data = JSON.parse(text.slice(start));
                const dtDj = data?.dtDj || {};
                const aptRow = dtDj?.aptRow && typeof dtDj.aptRow === 'object'
                  && !Array.isArray(dtDj.aptRow)
                  ? dtDj.aptRow
                  : (Object.prototype.hasOwnProperty.call(dtDj, 'apt_code') ? dtDj : {});
                const aptInfo = dtDj?.aptInfo || {};
                const djNo = Number(
                  aptRow?.dj_no || aptInfo?.dj_no?.value || dtDj?.dj_no || data?.dj_no || 0
                );
                cb(djNo > 0 ? String(djNo) : null);
              })
              .catch(() => cb(null));
            """,
            tid,
        )
        if raw and str(raw).isdigit() and int(raw) > 0:
            return str(raw)
    except Exception:
        pass
    return None


def resolve_complex_id(driver, tid: str | None = None) -> tuple[str | None, str | None]:
    tid = tid or _tid_from_current_url(driver)

    if tid:
        complex_id = _complex_id_from_env_api(driver, tid)
        if complex_id:
            return complex_id, None

    complex_id = _complex_id_from_dom_once(driver)
    if complex_id:
        return complex_id, None

    complex_id = _poll_complex_id_from_dom(driver, timeout=0.8)
    if complex_id:
        return complex_id, None

    return None, "단지정보 없음 (dj_no·complexes 링크·EnvViewData 미발견)"


def _wait_article_page(
    driver, timeout: int = 6, should_stop: ShouldStop = None
) -> None:
    wait_until(
        driver,
        lambda d: "financial.pstatic.net/404" not in d.current_url,
        timeout=timeout,
        should_stop=should_stop,
    )
    wait_until(
        driver,
        lambda d: d.find_elements(
            By.CSS_SELECTOR,
            "[class*='ArticleCard-module'][class*='__area-data'], "
            "[class*='ComplexArticleItem_area-information']",
        ),
        timeout=timeout,
        should_stop=should_stop,
    )


def _open_area_filter(driver) -> bool:
    try:
        chips = driver.find_elements(By.CSS_SELECTOR, "[class*='ChipsItem-module_chip']")
        chip = next((c for c in chips if c.text.strip() == "전체면적"), None)
        if chip:
            chip.click()
            time.sleep(0.15)
            return True
        button = driver.find_element(By.XPATH, "//button[contains(., '전체면적')]")
        button.click()
        time.sleep(0.15)
        return True
    except Exception:
        return False


def _area_filter_labels(driver):
    return driver.find_elements(
        By.CSS_SELECTOR, "[class*='CheckboxLayer'][class*='__label']"
    )


def _close_area_filter(driver) -> None:
    """드롭다운 외부 클릭으로 면적 필터 적용·닫기."""
    try:
        driver.find_element(
            By.CSS_SELECTOR,
            "[class*='ComplexSummary-module'], [class*='ComplexTab-module']",
        ).click()
    except Exception:
        try:
            driver.find_element(By.TAG_NAME, "body").click()
        except Exception:
            pass
    time.sleep(0.2)


def _read_area_options_from_open_layer(driver) -> list[AreaOption]:
    options: list[AreaOption] = []
    for label in _area_filter_labels(driver):
        text = _element_text(label)
        if not text or ("전체" in text and "세대" in text):
            continue
        option = parse_area_option_label(text)
        if option:
            options.append(option)
    return options


def list_area_options(driver) -> list[AreaOption]:
    if not _open_area_filter(driver):
        return []
    return _read_area_options_from_open_layer(driver)


def apply_target_area_filters(
    driver,
    target_m2: float,
    tolerance: float = AREA_FILTER_TOLERANCE_M2,
) -> tuple[bool, list[str]]:
    """
    전체면적 → 전체 해제 → 전용면적이 target±tolerance 인 평형(복수) 체크 → 외부 클릭 적용.
    """
    try:
        if not _open_area_filter(driver):
            return False, []

        labels = _area_filter_labels(driver)
        all_label = next(
            (
                label
                for label in labels
                if "전체" in _element_text(label) and "세대" in _element_text(label)
            ),
            None,
        )
        if all_label:
            all_label.click()
            time.sleep(0.15)
            labels = _area_filter_labels(driver)

        matched_labels: list[str] = []
        for label in labels:
            text = _element_text(label)
            option = parse_area_option_label(text)
            if not option:
                continue
            if abs(option.exclusive_m2 - target_m2) > tolerance:
                continue
            label.click()
            time.sleep(0.08)
            matched_labels.append(text.replace("\n", " ").strip())

        if not matched_labels:
            _close_area_filter(driver)
            return False, []

        _close_area_filter(driver)
        return True, matched_labels
    except Exception:
        return False, []


def apply_area_filter(driver, area: AreaOption) -> bool:
    """단일 평형 필터 (하위 호환)."""
    applied, _ = apply_target_area_filters(driver, area.exclusive_m2)
    return applied


def _scroll_article_list(driver, rounds: int = 2) -> None:
    containers = driver.find_elements(
        By.CSS_SELECTOR,
        "[class*='SideLayer-module'][class*='__area-content'], "
        "[class*='ScrollBox-module'][class*='__root']",
    )
    container = containers[0] if containers else None
    prev_count = 0
    for _ in range(rounds):
        cards = driver.find_elements(
            By.CSS_SELECTOR, "[class*='ArticleCard-module'][class*='__area-data']"
        )
        if len(cards) == prev_count and prev_count > 0:
            break
        prev_count = len(cards)
        if container:
            driver.execute_script(
                "arguments[0].scrollTop = arguments[0].scrollHeight", container
            )
        else:
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight)")
        time.sleep(0.12)


def collect_article_cards(driver) -> list[str]:
    _scroll_article_list(driver)
    texts: list[str] = []
    seen: set[str] = set()
    cards = driver.find_elements(
        By.CSS_SELECTOR, "[class*='ArticleCard-module'][class*='__area-data']"
    )
    if cards:
        for card in cards:
            text = _element_text(card)
            if text and text not in seen:
                seen.add(text)
                texts.append(text)
        return texts

    for element in driver.find_elements(
        By.CLASS_NAME, "ComplexArticleItem_area-information__YTn9y"
    ):
        text = _element_text(element)
        if text and text not in seen:
            seen.add(text)
            texts.append(text)
    return texts


def _naver_complex_id_from_url(driver) -> str | None:
    match = NAVER_COMPLEX_URL_RE.search(driver.current_url or "")
    return match.group(1) if match else None


def _is_on_naver_land_complex(driver) -> bool:
    return _naver_complex_id_from_url(driver) is not None


def _is_on_naver_complex(driver, complex_id: str | None) -> bool:
    if not complex_id:
        return _is_on_naver_land_complex(driver)
    current_id = _naver_complex_id_from_url(driver)
    return current_id is not None and current_id == str(complex_id).strip()


def _tab_head_label(element) -> str:
    return _element_text(element).split("\n")[0].strip()


def _on_transaction_tab(driver) -> bool:
    if driver.find_elements(
        By.CSS_SELECTOR, "[class*='ComplexTransactionPriceFilter']"
    ):
        return True
    for tab in driver.find_elements(By.CSS_SELECTOR, _LINE_TAB_SELECTOR):
        label = _tab_head_label(tab)
        if label == "시세" and tab.get_attribute("aria-selected") == "true":
            return True
        classes = tab.get_attribute("class") or ""
        if label == "시세" and (
            "active" in classes.lower() or "selected" in classes.lower()
        ):
            return True
    return False


def _on_article_tab(driver) -> bool:
    if _on_transaction_tab(driver):
        return False
    return bool(
        driver.find_elements(
            By.CSS_SELECTOR,
            "[class*='ArticleCard-module'][class*='__area-data'], "
            "[class*='ComplexArticleItem_area-information'], "
            "[class*='ChipsItem-module_chip']",
        )
    )


def _click_line_tab(driver, label: str) -> None:
    for tab in driver.find_elements(By.CSS_SELECTOR, _LINE_TAB_SELECTOR):
        if _tab_head_label(tab) == label:
            driver.execute_script(
                "arguments[0].scrollIntoView({block: 'center'});", tab
            )
            try:
                tab.click()
            except Exception:
                driver.execute_script("arguments[0].click();", tab)
            return

    clicked = driver.execute_script(
        """
        const label = String(arguments[0] || '');
        const nodes = document.querySelectorAll(
          "a, button, [role='tab'], [class*='LineTab']"
        );
        for (const el of nodes) {
          const head = (el.innerText || el.textContent || '')
            .trim()
            .split(/\\n/)[0]
            .trim();
          if (head !== label) continue;
          el.scrollIntoView({ block: 'center' });
          el.click();
          return true;
        }
        return false;
        """,
        label,
    )
    if clicked:
        return
    raise TimeoutException(f"{label} 탭을 찾을 수 없음")


def _click_article_tab(driver) -> None:
    if _on_article_tab(driver):
        return
    for label in ("매물", "호가"):
        try:
            _click_line_tab(driver, label)
            return
        except TimeoutException:
            continue
    raise TimeoutException("매물 탭을 찾을 수 없음")


def _switch_to_transaction_tab(
    driver,
    timeout: float = 6,
    should_stop: ShouldStop = None,
) -> None:
    """네이버 단지 페이지에서 시세 탭만 클릭 — driver.get 금지."""
    check_stop(should_stop)
    if not _on_transaction_tab(driver):
        _click_price_tab(driver)
    wait_until(
        driver,
        lambda d: d.find_elements(
            By.CSS_SELECTOR, "[class*='ComplexTransactionPriceFilter']"
        ),
        timeout=timeout,
        should_stop=should_stop,
    )


def _ensure_article_page(
    driver,
    complex_id: str,
    should_stop: ShouldStop = None,
) -> None:
    """단지 매물(호가) 탭 — 같은 단지면 탭 전환, 아니면 최초 1회만 URL 로드."""
    check_stop(should_stop)
    if not _is_on_naver_complex(driver, complex_id):
        driver.get(ARTICLE_URL.format(complex_id=complex_id))
        try:
            _wait_article_page(driver, should_stop=should_stop)
        except TimeoutException as exc:
            raise TimeoutException("네이버 호가 페이지 로드 실패") from exc
        return

    if _on_transaction_tab(driver):
        _click_article_tab(driver)
        try:
            _wait_article_page(driver, timeout=4, should_stop=should_stop)
        except TimeoutException:
            pass


def scrape_articles(
    driver,
    complex_id: str,
    target_m2: float,
    should_stop: ShouldStop = None,
) -> NaverArticleResult:
    result = NaverArticleResult(complex_id=complex_id)
    check_stop(should_stop)

    try:
        _ensure_article_page(driver, complex_id, should_stop=should_stop)
    except TimeoutException:
        result.error = "네이버 호가 페이지 로드 실패"
        return result

    check_stop(should_stop)
    filter_applied, matched_labels = apply_target_area_filters(
        driver, target_m2, tolerance=AREA_FILTER_TOLERANCE_M2
    )
    result.filter_applied = filter_applied
    result.matched_area_label = ", ".join(matched_labels)

    if filter_applied:
        try:
            _wait_article_page(driver, timeout=4, should_stop=should_stop)
        except TimeoutException:
            pass

    check_stop(should_stop)
    raw_cards = collect_article_cards(driver)
    articles: list[NaverArticle] = []
    for raw in raw_cards:
        article = parse_article_card(raw)
        if not article:
            continue
        if filter_applied or area_matches(
            article.exclusive_m2, target_m2, tolerance=AREA_TOLERANCE_M2
        ):
            articles.append(article)

    if articles:
        articles.sort(key=lambda a: (a.price_min, a.price_max or a.price_min))
        result.articles = articles
        result.naver_lowest_price = min(a.price_min for a in articles)
        compact_lines: list[str] = []
        seen: set[str] = set()
        for article in articles:
            compact = format_article_compact(article)
            if compact in seen:
                continue
            seen.add(compact)
            compact_lines.append(compact)
        result.naver_price_detail = "\n\n".join(compact_lines)
    elif result.error == "":
        result.error = "면적 조건에 맞는 호가 매물 없음"

    return result


def _click_price_tab(driver) -> None:
    if _on_transaction_tab(driver):
        return
    _click_line_tab(driver, "시세")


def _ensure_price_tab(driver, timeout: int = 10) -> None:
    _click_price_tab(driver)
    WebDriverWait(driver, timeout).until(
        EC.presence_of_element_located(
            (By.CSS_SELECTOR, "[class*='ComplexTransactionPriceFilter']")
        )
    )


def _ensure_transaction_page(
    driver,
    complex_id: str | None = None,
    timeout: int = 6,
    should_stop: ShouldStop = None,
    *,
    after_article_page: bool = False,
) -> None:
    """호가(매물) 직후엔 시세 탭 클릭만. URL 이동은 네이버 단지 밖일 때만."""
    check_stop(should_stop)
    if after_article_page or _is_on_naver_land_complex(driver):
        _switch_to_transaction_tab(
            driver, timeout=timeout, should_stop=should_stop
        )
        return

    if complex_id:
        driver.get(TRANSACTION_URL.format(complex_id=complex_id))
    elif not _on_transaction_tab(driver):
        _click_price_tab(driver)

    wait_until(
        driver,
        lambda d: d.find_elements(
            By.CSS_SELECTOR, "[class*='ComplexTransactionPriceFilter']"
        ),
        timeout=timeout,
        should_stop=should_stop,
    )


def _wait_tx_table(driver, timeout: float = 1.5) -> None:
    try:
        WebDriverWait(driver, timeout, poll_frequency=0.1).until(
            EC.presence_of_element_located(
                (
                    By.CSS_SELECTOR,
                    "[class*='ComplexTransactionPriceTable'], "
                    "[class*='TransactionPriceTable']",
                )
            )
        )
    except TimeoutException:
        pass


def _open_tx_area_picker(driver) -> bool:
    try:
        filt = driver.find_element(
            By.CSS_SELECTOR, "[class*='ComplexTransactionPriceFilter']"
        )
        buttons = filt.find_elements(By.TAG_NAME, "button")
        area_button = None
        for button in buttons:
            text = _element_text(button)
            if re.search(r"\([\d.]+[A-Za-z]?\)", text) and "매매" not in text:
                area_button = button
                break
        if area_button is None and len(buttons) >= 2:
            area_button = buttons[1]
        if area_button is None:
            return False
        area_button.click()
        WebDriverWait(driver, 3, poll_frequency=0.1).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "[class*='RadioLayer']"))
        )
        return True
    except Exception:
        return False


def _radio_layer_labels(driver):
    return driver.find_elements(
        By.CSS_SELECTOR, "[class*='RadioLayer'][class*='__label']"
    )


def _radio_scroll_box(driver):
    boxes = driver.find_elements(
        By.CSS_SELECTOR, "[class*='RadioLayer'] [class*='ScrollBox']"
    )
    if not boxes:
        boxes = driver.find_elements(By.CSS_SELECTOR, "[class*='RadioLayer']")
    return max(boxes, key=lambda element: len(element.text or ""), default=None)


def _reset_radio_scroll(driver) -> None:
    box = _radio_scroll_box(driver)
    if box:
        driver.execute_script("arguments[0].scrollTop = 0", box)


def _scroll_radio_layer_down(driver) -> None:
    box = _radio_scroll_box(driver)
    if box:
        driver.execute_script("arguments[0].scrollTop += 480", box)
        time.sleep(0.1)


def _close_tx_area_picker(driver) -> None:
    _close_area_filter(driver)


def _scan_tx_area_choices(
    driver,
    target_m2: float,
    tolerance: float = AREA_FILTER_TOLERANCE_M2,
    should_stop: ShouldStop = None,
) -> dict[tuple[float, str], str]:
    choices: dict[tuple[float, str], str] = {}
    _reset_radio_scroll(driver)
    for _ in range(4):
        check_stop(should_stop)
        for element in _radio_layer_labels(driver):
            text = _element_text(element).replace("\n", " ")
            if not text:
                continue
            token = parse_exclusive_token(text)
            if not token:
                continue
            exclusive_m2, suffix = token
            if not tx_area_keys_match(target_m2, exclusive_m2, tolerance):
                continue
            key = (exclusive_m2, suffix)
            if key in choices and "세대" not in text:
                continue
            choices[key] = text
        if choices:
            break
        _scroll_radio_layer_down(driver)
    return choices


def _parse_tx_area_keys_from_labels(
    labels_text: str,
    target_m2: float,
    tolerance: float = AREA_FILTER_TOLERANCE_M2,
) -> list[tuple[float, str, str]]:
    if not labels_text:
        return []
    keys: list[tuple[float, str, str]] = []
    seen: set[tuple[float, str]] = set()
    for part in labels_text.split(","):
        label = part.strip()
        if not label:
            continue
        token = parse_exclusive_token(label)
        if not token:
            continue
        exclusive_m2, suffix = token
        if not tx_area_keys_match(target_m2, exclusive_m2, tolerance):
            continue
        if token in seen:
            continue
        seen.add(token)
        keys.append((exclusive_m2, suffix, label))
    return keys


def _select_tx_area_key(
    driver, exclusive_m2: float, suffix: str, should_stop: ShouldStop = None
) -> bool:
    check_stop(should_stop)
    if not _open_tx_area_picker(driver):
        return False
    try:
        clicked = driver.execute_script(
            """
            const m2 = Number(arguments[0]);
            const suffix = String(arguments[1] || '').toUpperCase();
            const labels = [
              ...document.querySelectorAll(
                "[class*='RadioLayer'] [class*='__label'], [class*='RadioLayer'] label"
              ),
            ];
            for (const el of labels) {
              const text = (el.innerText || el.textContent || '').replace(/\\n/g, ' ');
              const match = text.match(/([\\d.]+)([A-Za-z]?)/);
              if (!match) continue;
              const val = parseFloat(match[1]);
              const suf = (match[2] || '').toUpperCase();
              if (!Number.isFinite(val)) continue;
              if (Math.abs(val - m2) > 2.0) continue;
              if (suffix && suf !== suffix) continue;
              el.click();
              return true;
            }
            return false;
            """,
            exclusive_m2,
            suffix,
        )
        if clicked:
            _close_tx_area_picker(driver)
            _wait_tx_table(driver, timeout=1.5)
            return True
    except Exception:
        pass
    _reset_radio_scroll(driver)
    for _ in range(4):
        check_stop(should_stop)
        for element in _radio_layer_labels(driver):
            text = _element_text(element).replace("\n", " ")
            token = parse_exclusive_token(text)
            if token == (exclusive_m2, suffix):
                element.click()
                _close_tx_area_picker(driver)
                _wait_tx_table(driver, timeout=1.5)
                return True
        _scroll_radio_layer_down(driver)
    _close_tx_area_picker(driver)
    return False


_TX_HEADER = "계약일\t등기일\t층\t가격"
_TX_REG_DATE = r"(?:\d{2}\.\d{2}\.|-|계약취소)"
_TX_TAB_ROW = re.compile(
    rf"^(\d{{2}}\.\d{{2}}\.)\t({_TX_REG_DATE})\t(\d+층)\t(.+)$"
)
_TX_SPACE_ROW = re.compile(
    rf"^(\d{{2}}\.\d{{2}}\.)\s+({_TX_REG_DATE})\s+(\d+층)\s+(.+)$"
)
_TX_YEAR = re.compile(r"(\d{4}년(?:\s*계약)?)")


def _parse_tx_row_line(line: str) -> tuple[str, str, str, str] | None:
    match = _TX_TAB_ROW.match(line)
    if not match:
        match = _TX_SPACE_ROW.match(re.sub(r"\s+", " ", line))
    if not match:
        return None
    return (
        match.group(1),
        match.group(2),
        match.group(3),
        match.group(4).strip(),
    )


def _format_tx_row(key: tuple[str, str, str, str]) -> str:
    return f"{key[0]}\t{key[1]}\t{key[2]}\t{key[3]}"


def _normalize_tx_year_label(label: str) -> str:
    match = re.search(r"(\d{4})", label)
    if not match:
        return label.strip()
    return f"{match.group(1)}년 계약"


def _extract_tx_rows_by_year_from_text(
    text: str,
) -> list[tuple[str, list[tuple[str, str, str, str]]]]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    current_year: str | None = None
    year_order: list[str] = []
    year_rows: dict[str, dict[tuple[str, str, str, str], None]] = {}

    for line in lines:
        year_match = _TX_YEAR.search(line)
        if year_match:
            current_year = _normalize_tx_year_label(year_match.group(1))
            year_rows.setdefault(current_year, {})
            if current_year not in year_order:
                year_order.append(current_year)
            continue
        key = _parse_tx_row_line(line)
        if not key or not current_year:
            continue
        year_rows[current_year][key] = None

    return [
        (year, list(year_rows[year]))
        for year in year_order
        if year_rows.get(year)
    ]


def _extract_tx_rows_from_text(text: str) -> tuple[str | None, list[tuple[str, str, str, str]]]:
    by_year = _extract_tx_rows_by_year_from_text(text)
    if not by_year:
        return None, []
    first_year, first_rows = by_year[0]
    all_rows = [row for _, rows in by_year for row in rows]
    return first_year, all_rows


def _clean_tx_section_text(text: str) -> str:
    """단일 텍스트 블록 정리 (연도 + 헤더 + 행)."""
    by_year = _extract_tx_rows_by_year_from_text(text)
    if not by_year:
        return text.strip()

    sections: list[str] = []
    for year, rows in by_year:
        sections.append(
            "\n".join([year, _TX_HEADER, *(_format_tx_row(row) for row in rows)])
        )
    return "\n\n".join(sections)


def _merge_tx_sections(sections: list[str]) -> list[str]:
    """여러 DOM 조각을 연도별 하나의 표로 병합 (부분 표·행 중복 제거)."""
    year_order: list[str] = []
    year_rows: dict[str, dict[tuple[str, str, str, str], None]] = {}

    for raw in sections:
        if not raw.strip():
            continue
        for year, rows in _extract_tx_rows_by_year_from_text(raw):
            if year not in year_rows:
                year_rows[year] = {}
                year_order.append(year)
            for key in rows:
                year_rows[year][key] = None

    results: list[str] = []
    for year in year_order:
        keys = list(year_rows.get(year, {}))
        if not keys:
            continue
        results.append(
            "\n".join([year, _TX_HEADER, *(_format_tx_row(key) for key in keys)])
        )
    return results


def _scrape_transaction_tables(driver) -> str:
    sections: list[str] = []
    selectors = (
        "[class*='ComplexTransactionPriceTable'][class*='__area-title-table']",
        "[class*='TransactionPriceTable'][class*='__area-title-table']",
        "[class*='ComplexTransactionPriceTable'][class*='__table']",
        "[class*='TransactionPriceTable'][class*='__table']",
    )
    for selector in selectors:
        for element in driver.find_elements(By.CSS_SELECTOR, selector):
            raw = _element_text(element)
            if raw:
                sections.append(raw)

    cleaned_sections = _merge_tx_sections(sections)
    return "\n\n".join(cleaned_sections)


def _is_cancelled_tx_row(row: tuple[str, str, str, str]) -> bool:
    return row[1].replace("\u00a0", " ").strip() == "계약취소"


def _count_tx_rows_by_year(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for year_label, rows in _extract_tx_rows_by_year_from_text(text):
        year_match = re.match(r"(\d{4})", year_label)
        if not year_match:
            continue
        year = year_match.group(1)
        counts[year] = counts.get(year, 0) + sum(
            1 for row in rows if not _is_cancelled_tx_row(row)
        )
    return counts


def _parse_real_trade_count(text: str) -> str:
    counts = _count_tx_rows_by_year(text)
    if not counts:
        return ""
    return ", ".join(
        f"{year} {count}건"
        for year, count in sorted(counts.items(), key=lambda item: item[0], reverse=True)
    )


def scrape_transactions(
    driver,
    target_m2: float,
    matched_area_labels: str = "",
    complex_id: str | None = None,
    should_stop: ShouldStop = None,
    *,
    after_article_page: bool = False,
) -> NaverTransactionResult:
    result = NaverTransactionResult()
    check_stop(should_stop)
    try:
        _ensure_transaction_page(
            driver,
            complex_id=complex_id,
            should_stop=should_stop,
            after_article_page=after_article_page,
        )
    except TimeoutException:
        result.error = "시세 탭 로드 실패"
        return result

    area_keys = _parse_tx_area_keys_from_labels(matched_area_labels, target_m2)

    # 호가(±2㎡)와 동일 — 시세 탭 면적 선택지에서 target±tolerance 전부 병합
    if _open_tx_area_picker(driver):
        scanned = _scan_tx_area_choices(
            driver, target_m2, should_stop=should_stop
        )
        _close_tx_area_picker(driver)
        seen_keys = {(m2, suf) for m2, suf, _ in area_keys}
        for (exclusive_m2, suffix), label in scanned.items():
            key = (exclusive_m2, suffix)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            area_keys.append((exclusive_m2, suffix, label))

    if not area_keys:
        result.error = "실거래 면적 타입 없음"
        return result

    blocks: list[NaverTransactionBlock] = []
    for exclusive_m2, suffix, area_label in area_keys:
        check_stop(should_stop)
        if not _select_tx_area_key(
            driver, exclusive_m2, suffix, should_stop=should_stop
        ):
            continue
        content = _scrape_transaction_tables(driver)
        if content:
            blocks.append(NaverTransactionBlock(area_label=area_label, content=content))

    if not blocks:
        result.error = "실거래 데이터 없음"
        return result

    result.blocks = blocks
    formatted_blocks = [
        f"[{block.area_label}]\n{block.content}" for block in blocks
    ]
    result.transaction_prices = "\n\n---\n\n".join(formatted_blocks)
    result.real_trade_count = _parse_real_trade_count(result.transaction_prices)
    return result


def empty_naver_result(naver_price_detail: str = "", **overrides) -> dict:
    payload = {
        "naver_price_detail": naver_price_detail,
        "naver_lowest_price": None,
        "gap_margin": None,
        "gap_margin_sold_price": None,
        "new_case_gap_margin": None,
        "transaction_prices": "",
        "real_trade_count": "",
        "complex_id": None,
        "matched_area_label": "",
    }
    payload.update(overrides)
    return payload


def extract_naver_prices(
    driver,
    building_area: str,
    build_year: str = "",
    *,
    complex_id: str | None = None,
    tid: str | None = None,
    should_stop: ShouldStop = None,
) -> dict:
    del build_year  # 실거래·추가 필터에 추후 사용
    check_stop(should_stop)

    if not complex_id:
        complex_id, error = resolve_complex_id(driver, tid=tid)
        if error:
            return empty_naver_result(error)

    check_stop(should_stop)
    try:
        target_m2 = parse_building_area_m2(building_area)
        if target_m2 is None:
            raise ValueError("면적 파싱 실패")
    except ValueError:
        return empty_naver_result("면적 파싱 실패", complex_id=complex_id)

    try:
        article_result = scrape_articles(
            driver, complex_id, target_m2, should_stop=should_stop
        )
        check_stop(should_stop)
        tx_result = scrape_transactions(
            driver,
            target_m2,
            article_result.matched_area_label,
            complex_id=complex_id,
            should_stop=should_stop,
            after_article_page=True,
        )
    except CrawlStoppedError:
        raise
    except Exception:
        return empty_naver_result("호가 조회 실패", complex_id=complex_id)

    if article_result.error and not article_result.naver_lowest_price:
        return empty_naver_result(
            article_result.error,
            complex_id=complex_id,
            matched_area_label=article_result.matched_area_label,
        )

    return empty_naver_result(
        naver_price_detail=article_result.naver_price_detail,
        naver_lowest_price=article_result.naver_lowest_price,
        transaction_prices=tx_result.transaction_prices,
        real_trade_count=tx_result.real_trade_count,
        complex_id=complex_id,
        matched_area_label=article_result.matched_area_label,
    )
