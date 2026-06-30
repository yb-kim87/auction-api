"""네이버 카페 게시글 수집 (수동 로그인 지원)."""

from __future__ import annotations

import re
import time
from typing import Callable
from urllib.parse import parse_qs, unquote, urljoin, urlparse

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

NAVER_CAFE_CRAWL_REVISION = "2026-06-30-v15-url-collect-speed"

DEFAULT_CAFE_URL = "https://cafe.naver.com/0113053470"
NAVER_LOGIN_PAGE = "https://nid.naver.com/nidlogin.login?mode=form&url=https://www.naver.com"


class NaverLoginRequiredError(RuntimeError):
    pass


def is_naver_logged_in(driver, *, allow_navigate: bool = False) -> bool:
    try:
        for cookie in driver.get_cookies():
            if cookie.get("name") in ("NID_AUT", "NID_SES"):
                return True
    except Exception:
        pass

    if not allow_navigate:
        return False

    try:
        current = (driver.current_url or "").lower()
        if "nid.naver.com" in current:
            return False
        driver.get("https://www.naver.com")
        time.sleep(1.0)
        page = driver.page_source
        if "로그아웃" in page:
            return True
        if "link_login" in page:
            return False
    except Exception:
        pass
    return False


def open_naver_login(driver) -> str:
    """로그인 페이지만 연다. 로그인 여부는 확인하지 않는다."""
    if is_naver_logged_in(driver):
        return (
            "저장된 Chrome 프로필로 이미 네이버에 로그인되어 있습니다. "
            "추가 인증 없이 카페 수집을 진행할 수 있습니다."
        )

    current = (driver.current_url or "").lower()
    if "nid.naver.com/nidlogin" not in current:
        driver.get(NAVER_LOGIN_PAGE)
        time.sleep(1)
    return (
        "네이버 로그인 페이지를 열었습니다. "
        "브라우저에서 직접 로그인하거나, 관리자 화면에서 ID/비밀번호로 자동 로그인하세요."
    )


def _fill_login_input(driver, element, value: str) -> None:
    """네이버는 JS value 대입을 막으므로 클립보드 붙여넣기로 입력."""
    import pyperclip
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.common.keys import Keys

    driver.execute_script(
        "arguments[0].scrollIntoView({block:'center'});", element
    )
    time.sleep(0.15)
    try:
        element.click()
    except Exception:
        driver.execute_script("arguments[0].click();", element)
    time.sleep(0.15)

    ActionChains(driver).key_down(Keys.CONTROL).send_keys("a").key_up(
        Keys.CONTROL
    ).perform()
    time.sleep(0.05)
    ActionChains(driver).send_keys(Keys.DELETE).perform()
    time.sleep(0.05)

    pyperclip.copy(value)
    time.sleep(0.1)
    ActionChains(driver).key_down(Keys.CONTROL).send_keys("v").key_up(
        Keys.CONTROL
    ).perform()
    time.sleep(0.25)

    filled = (element.get_attribute("value") or "").strip()
    if len(filled) < max(1, len(value) // 2):
        try:
            element.clear()
        except Exception:
            pass
        element.send_keys(value)
        time.sleep(0.15)


def _switch_to_naver_login_frame(driver) -> bool:
    driver.switch_to.default_content()
    for iframe in driver.find_elements(By.CSS_SELECTOR, "iframe"):
        try:
            src = (iframe.get_attribute("src") or "").lower()
            name = (iframe.get_attribute("name") or "").lower()
            if any(token in src or token in name for token in ("nid", "login")):
                driver.switch_to.frame(iframe)
                return True
        except Exception:
            continue
    return False


def _login_needs_manual_auth(driver) -> bool:
    page = _page_source(driver).lower()
    url = (driver.current_url or "").lower()
    markers = (
        "captcha",
        "캡cha",
        "2단계",
        "본인확인",
        "휴대폰",
        "otp",
        "device_confirm",
        "아이디 또는 비밀번호",
        "비밀번호가 일치",
    )
    return any(marker in page or marker in url for marker in markers)


def _login_progress(driver) -> str:
    """'ok' | 'manual' | 'waiting'"""
    if is_naver_logged_in(driver):
        return "ok"
    if _login_needs_manual_auth(driver):
        return "manual"
    url = (driver.current_url or "").lower()
    if "nid.naver.com/nidlogin" not in url and "nid.naver.com" not in url:
        time.sleep(0.8)
        if is_naver_logged_in(driver):
            return "ok"
    return "waiting"


def _wait_login_form(driver, timeout: float = 15):
    """로그인 ID/PW 입력란 대기 (네이버 DOM 변경 대비 여러 selector)."""

    def _find(d):
        id_selectors = (
            "#id",
            "input#id",
            "input[name='id']",
            "input#input_item_id",
            "input[type='text'][autocomplete='username']",
        )
        pw_selectors = (
            "#pw",
            "input#pw",
            "input[name='pw']",
            "input#input_item_pw",
            "input[type='password']",
        )
        for id_sel in id_selectors:
            for pw_sel in pw_selectors:
                try:
                    id_el = d.find_element(By.CSS_SELECTOR, id_sel)
                    pw_el = d.find_element(By.CSS_SELECTOR, pw_sel)
                    if id_el.is_displayed() and pw_el.is_displayed():
                        return id_el, pw_el
                except Exception:
                    continue
        return None

    driver.switch_to.default_content()
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = _find(driver)
        if found:
            return found
        if _switch_to_naver_login_frame(driver):
            found = _find(driver)
            if found:
                return found
            driver.switch_to.default_content()
        time.sleep(0.25)

    raise NaverLoginRequiredError(
        "네이버 로그인 입력란을 찾지 못했습니다. "
        "「로그인 페이지 열기」로 Chrome 창을 연 뒤 직접 로그인해 주세요."
    )


def _click_login_button(driver, pw_input) -> None:
    selectors = (
        "#log\\.login",
        "button.btn_login",
        ".btn_login",
        "button[type='submit']",
        ".login_btn",
    )
    for selector in selectors:
        try:
            btn = driver.find_element(By.CSS_SELECTOR, selector)
            if btn.is_displayed() and btn.is_enabled():
                driver.execute_script(
                    "arguments[0].scrollIntoView({block:'center'});", btn
                )
                time.sleep(0.1)
                try:
                    btn.click()
                except Exception:
                    driver.execute_script("arguments[0].click();", btn)
                return
        except Exception:
            continue
    pw_input.submit()


def login_naver(
    driver,
    user_id: str,
    password: str,
    *,
    wait_2fa_sec: int = 180,
) -> str:
    """ID/PW 입력 후 로그인. 추가인증(캡차·2단계)은 브라우저에서 완료할 때까지 대기."""
    uid = (user_id or "").strip()
    pw = (password or "").strip()
    if not uid or not pw:
        raise NaverLoginRequiredError("네이버 ID와 비밀번호를 입력해 주세요.")

    if is_naver_logged_in(driver):
        return f"이미 네이버에 로그인되어 있습니다. ({uid})"

    current = (driver.current_url or "").lower()
    if "nid.naver.com/nidlogin" not in current:
        driver.get(NAVER_LOGIN_PAGE)
        time.sleep(1.5)
    else:
        time.sleep(0.4)

    driver.switch_to.default_content()
    id_input, pw_input = _wait_login_form(driver)
    _fill_login_input(driver, id_input, uid)
    time.sleep(0.35)
    _fill_login_input(driver, pw_input, pw)
    time.sleep(0.35)

    _click_login_button(driver, pw_input)
    time.sleep(1.0)

    progress = _login_progress(driver)
    if progress == "ok":
        return f"네이버 로그인 완료 ({uid})"
    if progress == "manual":
        raise NaverLoginRequiredError(
            "네이버 추가인증(캡차·2단계)이 필요합니다. "
            "열린 Chrome 창에서 인증을 완료한 뒤 「로그인 확인」을 눌러 주세요."
        )

    deadline = time.time() + wait_2fa_sec
    while time.time() < deadline:
        progress = _login_progress(driver)
        if progress == "ok":
            return f"네이버 로그인 완료 ({uid})"
        if progress == "manual":
            raise NaverLoginRequiredError(
                "네이버 추가인증(캡차·2단계)이 필요합니다. "
                "열린 Chrome 창에서 인증을 완료한 뒤 「로그인 확인」을 눌러 주세요."
            )
        time.sleep(1.5)

    if is_naver_logged_in(driver, allow_navigate=True):
        return f"네이버 로그인 완료 ({uid})"

    current = (driver.current_url or "").lower()
    if "nid.naver.com" in current:
        raise NaverLoginRequiredError(
            "네이버 추가인증(캡차·2단계)을 브라우저에서 완료해 주세요. "
            "완료 후 다시 「네이버 로그인」을 누르거나 수집을 시작하세요."
        )
    raise NaverLoginRequiredError(
        "네이버 로그인에 실패했습니다. ID/비밀번호를 확인해 주세요."
    )


def open_cafe(driver, cafe_url: str) -> str:
    current = (driver.current_url or "").strip()
    if cafe_url.rstrip("/") not in current.rstrip("/"):
        driver.get(cafe_url)
        time.sleep(2)
    return f"카페 페이지를 열었습니다: {cafe_url}"


def switch_to_cafe_iframe(driver, wait_sec: float = 0) -> bool:
    from selenium.webdriver.support import expected_conditions as EC

    driver.switch_to.default_content()
    if wait_sec:
        time.sleep(wait_sec)

    iframe_selectors = [
        "iframe#cafe_main",
        "iframe[name='cafe_main']",
        "iframe[id*='cafe']",
        "iframe[src*='cafe.naver.com']",
        "iframe[src*='ArticleList']",
    ]
    for selector in iframe_selectors:
        try:
            iframe = WebDriverWait(driver, 6).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, selector))
            )
            driver.switch_to.frame(iframe)
            return True
        except Exception:
            continue

    for iframe in driver.find_elements(By.CSS_SELECTOR, "iframe"):
        try:
            src = (iframe.get_attribute("src") or "").lower()
            if any(
                token in src
                for token in ("cafe.naver.com", "articlelist", "article")
            ):
                driver.switch_to.default_content()
                driver.switch_to.frame(iframe)
                return True
        except Exception:
            continue
    driver.switch_to.default_content()
    return False


def _gather_all_page_html(driver) -> str:
    """default_content + 모든 iframe HTML을 합친다."""
    parts: list[str] = []
    driver.switch_to.default_content()
    parts.append(_page_source(driver))
    for iframe in driver.find_elements(By.CSS_SELECTOR, "iframe"):
        try:
            driver.switch_to.default_content()
            driver.switch_to.frame(iframe)
            parts.append(_page_source(driver))
        except Exception:
            continue
    driver.switch_to.default_content()
    return "\n".join(parts)


def _merge_article_entries(
    base: list[dict],
    extra: list[dict],
    *,
    max_count: int,
) -> list[dict]:
    seen: set[str] = set()
    merged: list[dict] = []
    for entry in base + extra:
        if len(merged) >= max_count:
            break
        key = _normalize_article_key(
            entry.get("url") or "", entry.get("articleId") or ""
        )
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(entry)
    return merged


def _entries_from_html(
    source: str,
    *,
    club_id: str | None,
    cafe_slug: str | None,
    cafe_url: str,
    max_count: int,
) -> list[dict]:
    """HTML 전체에서 cafe 글 URL/articleId 추출."""
    entries: list[dict] = []
    seen_ids: set[str] = set()

    slug = cafe_slug or ""
    url_patterns = []
    if slug:
        url_patterns.append(
            rf"https?://cafe\.naver\.com/{re.escape(slug)}/(\d{{3,}})"
        )
    url_patterns.extend(
        [
            r"https?://cafe\.naver\.com/[A-Za-z0-9_-]+/(\d{3,})",
            r'href=["\']([^"\']*ArticleRead[^"\']*)["\']',
        ]
    )

    for pattern in url_patterns:
        for match in re.finditer(pattern, source, re.I):
            if len(entries) >= max_count:
                return entries
            if match.lastindex and match.lastindex >= 1:
                val = match.group(1)
                if val.isdigit():
                    aid = val
                else:
                    aid = _parse_article_id(val) or ""
                    if not aid:
                        continue
                if aid in seen_ids:
                    continue
                seen_ids.add(aid)
                entries.append(
                    {
                        "url": _build_article_url(
                            aid,
                            club_id=club_id,
                            cafe_slug=cafe_slug,
                            base_url=cafe_url,
                        ),
                        "articleId": aid,
                        "title": f"게시글 {aid}",
                    }
                )

    for aid in _extract_ids_from_source(source):
        if len(entries) >= max_count:
            break
        if aid in seen_ids:
            continue
        seen_ids.add(aid)
        entries.append(
            {
                "url": _build_article_url(
                    aid,
                    club_id=club_id,
                    cafe_slug=cafe_slug,
                    base_url=cafe_url,
                ),
                "articleId": aid,
                "title": f"게시글 {aid}",
            }
        )
    return entries


def _page_source(driver) -> str:
    try:
        return driver.page_source or ""
    except Exception:
        return ""


def extract_club_id_from_source(source: str, cafe_url: str = "") -> str | None:
    patterns = [
        r"clubid['\"]?\s*[:=]\s*['\"]?(\d+)",
        r"g_sClubId\s*=\s*['\"](\d+)['\"]",
        r"clubId['\"]?\s*[:=]\s*['\"]?(\d+)",
        r"article\.clubid\s*=\s*(\d+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, source, re.I)
        if match:
            return match.group(1)

    path = urlparse(cafe_url).path.strip("/")
    if path.isdigit():
        return path
    return None


def extract_cafe_slug(cafe_url: str) -> str | None:
    path = urlparse(cafe_url).path.strip("/")
    return path.split("/")[0] if path else None


def ensure_naver_login(
    driver,
    user_id: str | None = None,
    password: str | None = None,
) -> None:
    if is_naver_logged_in(driver):
        return

    uid = (user_id or "").strip()
    pw = (password or "").strip()
    if uid and pw:
        login_naver(driver, uid, pw)
        if is_naver_logged_in(driver):
            return

    if is_naver_logged_in(driver, allow_navigate=True):
        return

    raise NaverLoginRequiredError(
        "네이버 로그인이 필요합니다. ID/비밀번호를 입력하고 「네이버 로그인」을 눌러 주세요."
    )


def extract_club_id(driver, cafe_url: str) -> str | None:
    source = _page_source(driver)
    club_id = extract_club_id_from_source(source, cafe_url)
    if club_id:
        return club_id

    driver.get(cafe_url)
    time.sleep(2)
    return extract_club_id_from_source(_page_source(driver), cafe_url)


def _safe_click(driver, element) -> None:
    driver.execute_script(
        "arguments[0].scrollIntoView({block:'center'});", element
    )
    time.sleep(0.15)
    try:
        element.click()
    except Exception:
        driver.execute_script("arguments[0].click();", element)


def _collect_list_article_links(driver) -> list:
    """전체글 목록 iframe 안에서 클릭 가능한 게시글 링크 수집."""
    switch_to_cafe_iframe(driver, wait_sec=0.25)
    selectors = [
        ".article-board:not(#upperArticleList) a.article",
        ".article-board.m-tcol-c a.article",
        "#main-area .article-board a.article",
        "a.article",
        ".inner_list a.clink",
        ".inner_list a",
        "td.td_article a",
        ".board-list .inner_list a",
        ".article-title a",
        "a[href*='ArticleRead']",
        "a[href*='/articles/']",
        "a[href*='/cafes/'][href*='/articles/']",
    ]

    seen_keys: set[str] = set()
    links: list = []

    for selector in selectors:
        try:
            candidates = driver.find_elements(By.CSS_SELECTOR, selector)
        except Exception:
            candidates = []
        for el in candidates:
            title = _link_title(el)
            aid = _article_id_from_element(el)
            href = _normalize_href(el.get_attribute("href") or "", driver)
            key = aid or title or href
            if not key or key in seen_keys:
                continue
            if title and title in ("공지", "필독"):
                continue
            if not title and not aid and not _href_looks_like_article(href):
                continue
            if title and len(title) < 2 and not aid:
                continue
            seen_keys.add(key)
            links.append(el)
        if len(links) >= 3:
            break

    if links:
        return links

    for tr in driver.find_elements(
        By.CSS_SELECTOR,
        ".article-board tr, #main-area table tbody tr",
    ):
        try:
            el = tr.find_element(
                By.CSS_SELECTOR,
                "a.article, td.td_article a, .board-list a, .inner_list a",
            )
            title = _link_title(el)
            key = _article_id_from_element(el) or title
            if key and key not in seen_keys and title:
                seen_keys.add(key)
                links.append(el)
        except Exception:
            continue
    return links


def wait_for_article_list(driver, timeout: float = 12.0, *, quick: bool = False) -> bool:
    deadline = time.time() + timeout
    poll = 0.2 if quick else 0.5
    iframe_wait = 0.1 if quick else 0.3
    while time.time() < deadline:
        switch_to_cafe_iframe(driver, wait_sec=iframe_wait)
        source = _page_source(driver)
        if any(
            token in source
            for token in (
                "article-board",
                "ArticleList",
                "td_article",
                "inner_list",
                "board-list",
                "article-list",
            )
        ):
            if quick:
                driver.switch_to.default_content()
                return True
            if _collect_list_article_links(driver):
                driver.switch_to.default_content()
                return True
        driver.switch_to.default_content()
        time.sleep(poll)
    return False


def _article_list_shell_url(cafe_url: str, club_id: str, page: int = 1) -> str:
    from urllib.parse import quote

    iframe_path = (
        f"/ArticleList.nhn?search.clubid={club_id}"
        f"&search.boardtype=L&userDisplay=50"
    )
    if page > 1:
        iframe_path += f"&search.page={page}"
    return f"{cafe_url.rstrip('/')}?iframe_url={quote(iframe_path, safe='')}"


def _parse_list_page_number(url: str = "", page_source: str = "") -> int:
    """목록 현재 페이지 번호 (1부터)."""
    if page_source:
        for pattern in (
            r"search\.page['\"]?\s*[:=]\s*['\"]?(\d+)",
            r"search\.page=(\d+)",
            r"page=(\d+).*ArticleList",
        ):
            match = re.search(pattern, page_source, re.I)
            if match:
                try:
                    return max(1, int(match.group(1)))
                except ValueError:
                    pass

    if not url:
        return 1

    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    for key in ("search.page",):
        if key in qs:
            try:
                return max(1, int(qs[key][0]))
            except ValueError:
                pass

    for key in ("iframe_url_utf8", "iframe_url"):
        for raw in qs.get(key, []):
            nested = raw
            for _ in range(4):
                if "%" not in nested:
                    break
                nested = unquote(nested)
            nested_qs = parse_qs(urlparse(nested).query)
            if "search.page" in nested_qs:
                try:
                    return max(1, int(nested_qs["search.page"][0]))
                except ValueError:
                    pass
    return 1


def _go_to_list_page(
    driver,
    cafe_url: str,
    page: int,
    club_id: str | None = None,
) -> bool:
    """전체글 목록의 특정 페이지로 이동 (1→2→3 순차)."""
    if page < 1:
        page = 1
    resolved_club_id = (club_id or "").strip()
    if not resolved_club_id:
        resolved_club_id = extract_club_id_from_source(_page_source(driver), cafe_url) or ""
    if not resolved_club_id:
        resolved_club_id = extract_club_id(driver, cafe_url) or ""
    if not resolved_club_id:
        return False

    driver.switch_to.default_content()
    driver.get(_article_list_shell_url(cafe_url, resolved_club_id, page=page))
    return wait_for_article_list(driver, timeout=4, quick=True)


def _find_strict_next_page_link(driver):
    """「마지막」·「>>」이 아닌 「다음」 링크만 찾는다."""
    if not switch_to_cafe_iframe(driver, wait_sec=0.15):
        return None

    candidates = []
    for anchor in driver.find_elements(By.CSS_SELECTOR, "a"):
        try:
            text = (anchor.text or "").strip()
            cls = (anchor.get_attribute("class") or "").lower()
            aria = (anchor.get_attribute("aria-label") or "").strip()
            title = (anchor.get_attribute("title") or "").strip()
        except Exception:
            continue

        blob = f"{text} {aria} {title} {cls}".lower()
        if any(
            token in blob
            for token in ("마지막", "last", "끝페이지", "끝으로", "pg_end", "btn_last")
        ):
            continue
        if text in (">>", "»", "▶▶", "››"):
            continue

        if text in ("다음", "다음페이지", "Next") or aria in ("다음", "다음페이지", "Next"):
            candidates.append((0, anchor))
        elif cls in ("pg_next", "btn_next") or "pg_next" in cls or "btn_next" in cls:
            candidates.append((1, anchor))
        elif text == ">" and ">>" not in text:
            candidates.append((2, anchor))

    driver.switch_to.default_content()
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0])
    return candidates[0][1]


def navigate_to_all_articles(driver, cafe_url: str) -> str:
    club_id = extract_club_id_from_source(_page_source(driver), cafe_url)
    if not club_id:
        driver.get(cafe_url)
        time.sleep(2)
        club_id = extract_club_id(driver, cafe_url)

    if club_id:
        shell_url = _article_list_shell_url(cafe_url, club_id, page=1)
        driver.get(shell_url)
        time.sleep(3)
        if wait_for_article_list(driver, timeout=10):
            return f"전체글 목록으로 이동했습니다. (clubId={club_id})"

    driver.get(cafe_url)
    time.sleep(2.5)
    switch_to_cafe_iframe(driver, wait_sec=0.5)

    for link in driver.find_elements(By.CSS_SELECTOR, "a"):
        text = (link.text or "").strip()
        href = link.get_attribute("href") or ""
        if "전체글보기" in text or (
            "ArticleList" in href and "boardtype=L" in href
        ):
            try:
                _safe_click(driver, link)
                time.sleep(3)
                switch_to_cafe_iframe(driver, wait_sec=0.5)
                if wait_for_article_list(driver, timeout=8):
                    return "전체글보기로 이동했습니다."
            except Exception:
                break

    if club_id:
        list_url = (
            f"https://cafe.naver.com/ArticleList.nhn?"
            f"search.clubid={club_id}&search.boardtype=L&userDisplay=50"
        )
        driver.get(list_url)
        time.sleep(3)
        switch_to_cafe_iframe(driver, wait_sec=0.5)
        if wait_for_article_list(driver, timeout=8):
            return f"전체글 목록으로 이동했습니다. (clubId={club_id})"

    raise RuntimeError("전체글 목록을 열지 못했습니다. 카페 가입·로그인을 확인해 주세요.")


def _parse_article_id(url: str) -> str | None:
    if not url:
        return None

    parsed = urlparse(url)
    qs = parse_qs(parsed.query)

    for key in ("iframe_url_utf8", "iframe_url"):
        nested_values = qs.get(key) or []
        for raw in nested_values:
            nested = raw
            for _ in range(4):
                if "%" not in nested:
                    break
                nested = unquote(nested)
            nested_id = _parse_article_id(nested)
            if nested_id:
                return nested_id

    for key in ("articleid", "articleId"):
        if key in qs and qs[key][0].strip().isdigit():
            return qs[key][0].strip()

    path_parts = [p for p in parsed.path.split("/") if p]
    if len(path_parts) >= 2 and path_parts[-1].isdigit():
        return path_parts[-1]

    if len(path_parts) == 1 and path_parts[0].isdigit():
        lowered = url.lower()
        if "articleread" in lowered or "articleid=" in lowered:
            return path_parts[0]
        return None

    match = re.search(r"articles/(\d+)", url, re.I)
    if match:
        return match.group(1)
    return None


def _resolve_article_identity(
    *,
    fallback_url: str = "",
    expected_article_id: str = "",
    current_url: str = "",
) -> tuple[str, str]:
    """목록 수집 URL/ID를 우선해 sourceUrl·sourceArticleId 확정."""
    article_id = (
        (expected_article_id or "").strip()
        or _parse_article_id(fallback_url or "")
        or _parse_article_id(current_url or "")
        or ""
    )

    source_url = (fallback_url or "").strip()
    if source_url and (_parse_article_id(source_url) or "articleid=" in source_url.lower()):
        return source_url, article_id

    if current_url and _parse_article_id(current_url):
        return current_url, article_id or (_parse_article_id(current_url) or "")

    if source_url:
        return source_url, article_id
    return (current_url or "").strip(), article_id


def _should_skip_non_knowledge_post(title: str, content: str) -> str | None:
    """경매 지식과 무관한 글은 저장 전에 건너뜀."""
    title_text = (title or "").strip()
    lowered = title_text.lower()
    skip_title_keywords = (
        "등업",
        "등업신청",
        "가입인사",
        "출석체크",
        "출석 체크",
        "공지",
        "운영진",
        "카페 규칙",
        "자기소개",
    )
    if any(keyword in title_text for keyword in skip_title_keywords):
        return "경매 지식과 무관한 글(등업·인사·공지 등)"
    if lowered in ("등업 신청합니다", "등업신청합니다", "등업 신청"):
        return "경매 지식과 무관한 글(등업·인사·공지 등)"

    body = (content or "").strip()
    if len(body) < 80:
        return "본문이 너무 짧음"
    return None


def _build_article_url(
    article_id: str,
    *,
    club_id: str | None,
    cafe_slug: str | None,
    base_url: str,
) -> str:
    if cafe_slug:
        return f"https://cafe.naver.com/{cafe_slug}/{article_id}"
    if club_id:
        return (
            f"https://cafe.naver.com/ArticleRead.nhn?"
            f"clubid={club_id}&articleid={article_id}"
        )
    parsed = urlparse(base_url)
    slug = parsed.path.strip("/").split("/")[0]
    if slug:
        return f"https://cafe.naver.com/{slug}/{article_id}"
    return f"https://cafe.naver.com/ArticleRead.nhn?articleid={article_id}"


def _normalize_href(href: str, driver) -> str:
    if not href or href.startswith("javascript"):
        return ""
    if href.startswith("//"):
        return "https:" + href
    if href.startswith("/"):
        return urljoin(driver.current_url or "https://cafe.naver.com/", href)
    return href


def _link_title(anchor) -> str:
    text = (anchor.text or "").strip()
    if len(text) >= 2:
        return text[:200]
    try:
        title = anchor.get_attribute("title") or ""
        if title.strip():
            return title.strip()[:200]
    except Exception:
        pass
    try:
        inner = anchor.get_attribute("innerText") or ""
        if inner.strip():
            return inner.strip()[:200]
    except Exception:
        pass
    return ""


def _href_looks_like_article(href: str, cafe_slug: str | None = None) -> bool:
    if not href or href.startswith("javascript") or href in ("#", ""):
        return False
    if "ArticleList" in href or "MemberProfile" in href:
        return False
    if "ArticleRead" in href or "/articles/" in href:
        return True
    if cafe_slug and f"/{cafe_slug}/" in href:
        return True
    if re.search(r"cafe\.naver\.com/[^/?#]+/\d{3,}", href):
        return True
    return _parse_article_id(href) is not None


def _article_id_from_element(anchor) -> str | None:
    href = anchor.get_attribute("href") or ""
    aid = _parse_article_id(href)
    if aid:
        return aid

    onclick = anchor.get_attribute("onclick") or ""
    for pattern in (
        r"articleid['\"]?\s*[,:=]\s*['\"]?(\d{3,})",
        r"articleId['\"]?\s*[,:=]\s*['\"]?(\d{3,})",
        r"goArticleRead\s*\(\s*['\"]?(\d+)",
        r"readArticle\s*\(\s*['\"]?(\d+)",
    ):
        match = re.search(pattern, onclick, re.I)
        if match:
            return match.group(1)

    for attr in ("data-articleid", "data-article-id", "data-art"):
        val = anchor.get_attribute(attr) or ""
        if val.isdigit():
            return val
    return None


def _collect_from_page_elements(
    driver,
    *,
    club_id: str | None,
    cafe_slug: str | None,
    base_url: str,
    seen_ids: set[str],
    max_articles: int,
) -> list[dict]:
    found: list[dict] = []
    selectors = [
        "a.article",
        "a.inner_link",
        "a.clink",
        ".inner_list a",
        ".board-list a",
        ".article-board a",
        "#upperArticleListTable a",
        "td.td_article a",
        ".article-title a",
        "a[href*='ArticleRead']",
        "a[href*='/articles/']",
        ".ArticleBoardList a",
        "div.article-board a",
    ]
    if cafe_slug:
        selectors.append(f"a[href*='/{cafe_slug}/']")

    for selector in selectors:
        try:
            anchors = driver.find_elements(By.CSS_SELECTOR, selector)
        except Exception:
            anchors = []
        for anchor in anchors:
            if len(found) >= max_articles:
                return found
            try:
                href = _normalize_href(anchor.get_attribute("href") or "", driver)
                aid = _article_id_from_element(anchor)
            except Exception:
                continue
            if not aid or aid in seen_ids:
                continue
            if href and not _href_looks_like_article(href, cafe_slug):
                if not aid:
                    continue
            seen_ids.add(aid)
            url = href if href and _href_looks_like_article(href, cafe_slug) else _build_article_url(
                aid, club_id=club_id, cafe_slug=cafe_slug, base_url=base_url
            )
            found.append(
                {
                    "url": url,
                    "articleId": aid,
                    "title": _link_title(anchor) or f"게시글 {aid}",
                }
            )
    return found


def crawl_article_from_current_page(
    driver,
    fallback_url: str = "",
    expected_article_id: str = "",
) -> dict:
    """현재 페이지(또는 iframe)에서 글 본문 추출 — driver.get 없음."""
    for _ in range(2):
        if switch_to_cafe_iframe(driver, wait_sec=0.2):
            break
        time.sleep(0.25)

    try:
        WebDriverWait(driver, 4).until(
            lambda d: any(
                kw in _page_source(d)
                for kw in (
                    "se-main-container",
                    "postViewArea",
                    "article_viewer",
                    "ArticleContent",
                    "title_text",
                )
            )
        )
    except Exception:
        pass

    current_url = driver.current_url or ""
    title = ""
    title_selectors = [
        ".title_text",
        "h3.title",
        ".ArticleTitle",
        ".tit_area",
        ".article_title",
        "meta[property='og:title']",
    ]
    for selector in title_selectors:
        try:
            if selector.startswith("meta"):
                title = driver.find_element(By.CSS_SELECTOR, selector).get_attribute(
                    "content"
                ) or ""
            else:
                title = driver.find_element(By.CSS_SELECTOR, selector).text.strip()
            if title:
                break
        except Exception:
            continue

    board = ""
    for selector in [".board_name", ".link_board", ".breadcrumb", ".BoardName"]:
        try:
            board = driver.find_element(By.CSS_SELECTOR, selector).text.strip()
            if board:
                break
        except Exception:
            continue

    content = ""
    content_selectors = [
        ".se-main-container",
        "#postViewArea",
        ".article_viewer",
        ".ContentRenderer",
        ".article_container",
        ".ArticleContentBox",
        "#app .se-viewer",
        ".se-viewer",
    ]
    for selector in content_selectors:
        try:
            text = driver.find_element(By.CSS_SELECTOR, selector).text.strip()
            if len(text) > 20:
                content = text
                break
        except Exception:
            continue

    if len(content) < 20:
        try:
            content = driver.find_element(By.TAG_NAME, "body").text.strip()
        except Exception:
            content = ""

    url, article_id = _resolve_article_identity(
        fallback_url=fallback_url,
        expected_article_id=expected_article_id,
        current_url=current_url,
    )
    if not article_id:
        match = re.search(r"articleid=(\d+)", _page_source(driver), re.I)
        if match:
            article_id = match.group(1)

    driver.switch_to.default_content()
    return {
        "sourceUrl": url or fallback_url or current_url,
        "sourceArticleId": article_id,
        "sourceTitle": title,
        "sourceBoard": board,
        "rawContent": content[:20000],
    }


def _is_on_article_list_page(driver, list_shell_url: str) -> bool:
    """글 상세 URL(슬러그/숫자)과 목록 URL을 구분."""
    url = (driver.current_url or "").lower()
    if "articlelist" in url or "iframe_url=" in url:
        return True
    if _parse_article_id(url):
        return False
    base = (list_shell_url or "").split("?")[0].rstrip("/").lower()
    if base and url.rstrip("/") == base:
        return True
    switch_to_cafe_iframe(driver, wait_sec=0.2)
    try:
        return bool(_collect_list_article_links(driver))
    finally:
        driver.switch_to.default_content()


def _return_to_article_list(driver, list_shell_url: str) -> None:
    """글 상세에서 전체글 목록으로 복귀."""
    driver.switch_to.default_content()
    if not list_shell_url or "cafe.naver.com" not in list_shell_url:
        return
    if _is_on_article_list_page(driver, list_shell_url):
        return
    driver.get(list_shell_url)
    time.sleep(2)
    wait_for_article_list(driver, timeout=8)


def _collect_list_article_entries(
    driver,
    cafe_url: str,
    *,
    max_count: int,
    on_progress: Callable[[str], None] | None = None,
    club_id: str | None = None,
    cafe_slug: str | None = None,
    fast: bool = False,
) -> list[dict]:
    """목록 페이지에서 글 URL·ID·제목을 수집 (DOM → HTML fallback)."""

    def log(msg: str):
        if on_progress:
            on_progress(msg)

    resolved_club_id = (club_id or "").strip()
    if not resolved_club_id:
        resolved_club_id = extract_club_id_from_source(_page_source(driver), cafe_url) or ""
    if not resolved_club_id:
        resolved_club_id = extract_club_id(driver, cafe_url) or ""
    resolved_slug = cafe_slug or extract_cafe_slug(cafe_url)

    entries: list[dict] = []
    seen_ids: set[str] = set()
    iframe_wait = 0.12 if fast else 0.35

    if switch_to_cafe_iframe(driver, wait_sec=iframe_wait):
        try:
            entries = _collect_from_page_elements(
                driver,
                club_id=resolved_club_id,
                cafe_slug=resolved_slug,
                base_url=cafe_url,
                seen_ids=seen_ids,
                max_articles=max_count,
            )
        finally:
            driver.switch_to.default_content()

    if fast and entries:
        return entries[:max_count]

    if len(entries) < 3:
        driver.switch_to.default_content()
        default_entries = _collect_from_page_elements(
            driver,
            club_id=resolved_club_id,
            cafe_slug=resolved_slug,
            base_url=cafe_url,
            seen_ids=seen_ids,
            max_articles=max_count,
        )
        entries = _merge_article_entries(entries, default_entries, max_count=max_count)

    if len(entries) < 3:
        html = _gather_all_page_html(driver)
        html_entries = _entries_from_html(
            html,
            club_id=resolved_club_id,
            cafe_slug=resolved_slug,
            cafe_url=cafe_url,
            max_count=max_count,
        )
        entries = _merge_article_entries(entries, html_entries, max_count=max_count)
        if html_entries:
            log(f"    HTML에서 URL {len(html_entries)}건 추출")

    if len(entries) < 3 and resolved_club_id:
        list_url = (
            f"https://cafe.naver.com/ArticleList.nhn?"
            f"search.clubid={resolved_club_id}&search.boardtype=L&userDisplay=50"
        )
        log(f"    목록 직접 이동: {list_url[:70]}…")
        driver.get(list_url)
        time.sleep(1.5)
        if switch_to_cafe_iframe(driver, wait_sec=0.5):
            try:
                direct = _collect_from_page_elements(
                    driver,
                    club_id=resolved_club_id,
                    cafe_slug=resolved_slug,
                    base_url=cafe_url,
                    seen_ids=seen_ids,
                    max_articles=max_count,
                )
                entries = _merge_article_entries(entries, direct, max_count=max_count)
            finally:
                driver.switch_to.default_content()
        html = _gather_all_page_html(driver)
        html_entries = _entries_from_html(
            html,
            club_id=resolved_club_id,
            cafe_slug=resolved_slug,
            cafe_url=cafe_url,
            max_count=max_count,
        )
        entries = _merge_article_entries(entries, html_entries, max_count=max_count)

    if not entries:
        log(f"    ⚠ URL 없음 — 현재 주소: {(driver.current_url or '')[:90]}")

    return entries[:max_count]


def _normalize_article_key(url: str = "", article_id: str = "") -> str:
    """중복 판별용 — articleId 우선, 없으면 URL path."""
    aid = (article_id or _parse_article_id(url) or "").strip()
    if aid:
        return f"id:{aid}"
    parsed = urlparse((url or "").strip().split("#")[0])
    host = (parsed.netloc or "").lower()
    path = parsed.path.rstrip("/").lower()
    if not host and not path:
        return ""
    return f"url:{host}{path}"


def _build_known_key_set(
    known_urls: list[str] | None,
    known_article_ids: list[str] | None,
) -> set[str]:
    keys: set[str] = set()
    for aid in known_article_ids or []:
        normalized = str(aid).strip()
        if normalized:
            keys.add(f"id:{normalized}")
    for url in known_urls or []:
        key = _normalize_article_key(url)
        if key:
            keys.add(key)
    return keys


def _entry_is_known(entry: dict, known_keys: set[str]) -> bool:
    if not known_keys:
        return False
    url = entry.get("url") or ""
    aid = entry.get("articleId") or ""
    return _normalize_article_key(url, aid) in known_keys


def _go_to_next_list_page(
    driver,
    cafe_url: str = "",
    club_id: str | None = None,
) -> bool:
    """다음 목록 페이지로 이동 — URL page+1 우선, 실패 시 「다음」 버튼."""
    base = (cafe_url or driver.current_url or "").strip()
    current_page = _parse_list_page_number(driver.current_url or "")
    next_page = current_page + 1

    if base and _go_to_list_page(driver, base, next_page, club_id=club_id):
        return True

    driver.switch_to.default_content()
    next_link = _find_strict_next_page_link(driver)
    if not next_link:
        return False

    try:
        _safe_click(driver, next_link)
    except Exception:
        try:
            href = _normalize_href(next_link.get_attribute("href") or "", driver)
        except Exception:
            href = ""
        driver.switch_to.default_content()
        if href and not href.startswith("javascript"):
            driver.get(href)
        else:
            return False
    else:
        driver.switch_to.default_content()

    return wait_for_article_list(driver, timeout=4, quick=True)


def collect_all_article_entries(
    driver,
    cafe_url: str,
    *,
    max_articles: int,
    max_pages: int,
    known_keys: set[str] | None = None,
    on_progress: Callable[[str], None] | None = None,
) -> list[dict]:
    """여러 페이지에서 글 URL을 먼저 모은다. 기수집만 있는 페이지는 건너뛰고 다음 페이지로."""

    def log(msg: str):
        if on_progress:
            on_progress(msg)

    known = known_keys or set()
    all_entries: list[dict] = []
    seen_keys: set[str] = set()
    cached_club_id: str | None = None
    cached_slug = extract_cafe_slug(cafe_url)
    list_ready = False

    def count_new() -> int:
        return sum(
            1
            for entry in all_entries
            if not _entry_is_known(entry, known)
        )

    for page in range(max(1, max_pages)):
        if count_new() >= max_articles:
            break

        page_entries: list[dict] = []
        try:
            page_entries = _collect_list_article_entries(
                driver,
                cafe_url,
                max_count=50,
                on_progress=on_progress,
                club_id=cached_club_id,
                cafe_slug=cached_slug,
                fast=list_ready,
            )
        except Exception as exc:
            log(f"  {page + 1}페이지 URL 수집 오류: {exc}")
            break
        if page_entries:
            list_ready = True
            if not cached_club_id:
                cached_club_id = (
                    extract_club_id_from_source(_page_source(driver), cafe_url)
                    or extract_club_id(driver, cafe_url)
                )
        added = 0
        new_on_page = 0
        for entry in page_entries:
            key = _normalize_article_key(
                entry.get("url") or "", entry.get("articleId") or ""
            )
            if not key or key in seen_keys:
                continue
            if known and _entry_is_known(entry, known):
                continue
            seen_keys.add(key)
            all_entries.append(entry)
            added += 1
            new_on_page += 1

        log(
            f"  {page + 1}페이지 URL +{added}건 (신규 {new_on_page}건) — "
            f"누적 신규 {count_new()}건"
        )

        if count_new() >= max_articles:
            break
        if page + 1 >= max_pages:
            break
        if not _go_to_next_list_page(driver, cafe_url, club_id=cached_club_id):
            log("  다음 페이지 없음 — URL 수집 종료")
            break

    return all_entries


def _open_list_article(
    driver,
    el,
    *,
    href: str,
    aid: str | None,
    club_id: str | None,
    cafe_slug: str | None,
    cafe_url: str,
) -> str:
    """목록 항목을 URL 이동 또는 클릭으로 연다. 최종 URL 반환."""
    driver.switch_to.default_content()
    if href and _href_looks_like_article(href, cafe_slug):
        driver.get(href)
        return href
    if aid:
        url = _build_article_url(
            aid, club_id=club_id, cafe_slug=cafe_slug, base_url=cafe_url
        )
        driver.get(url)
        return url

    switch_to_cafe_iframe(driver, wait_sec=0.2)
    _safe_click(driver, el)
    time.sleep(2.5)
    driver.switch_to.default_content()
    top_url = driver.current_url or ""
    if _parse_article_id(top_url) and "ArticleList" not in top_url:
        return top_url

    switch_to_cafe_iframe(driver, wait_sec=0.3)
    iframe_url = driver.current_url or ""
    driver.switch_to.default_content()
    if _parse_article_id(iframe_url) and "ArticleList" not in iframe_url:
        if not iframe_url.startswith("http"):
            iframe_url = urljoin("https://cafe.naver.com/", iframe_url.lstrip("/"))
        driver.get(iframe_url)
        return iframe_url
    raise RuntimeError("글 상세 페이지로 이동하지 못했습니다.")


def crawl_articles_from_list(
    driver,
    cafe_url: str,
    max_articles: int,
    max_pages: int = 5,
    known_urls: list[str] | None = None,
    known_article_ids: list[str] | None = None,
    on_progress: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    on_article_saved: Callable[[dict, dict], None] | None = None,
    on_urls_ready: Callable[[int], None] | None = None,
    on_urls_collected: Callable[[list[dict]], None] | None = None,
) -> dict:
    """1) 목록 URL 수집 → 2) 기수집 제외 → 3) 글 순차 열람."""

    def log(msg: str):
        if on_progress:
            on_progress(msg)

    list_shell_url = driver.current_url or cafe_url
    _return_to_article_list(driver, list_shell_url)

    known_keys = _build_known_key_set(known_urls, known_article_ids)
    if known_keys:
        log(f"  기수집 URL/ID {len(known_keys)}건 — 중복 시 열람 생략")

    log("  1단계: 목록에서 글 URL 수집 중…")
    all_entries = collect_all_article_entries(
        driver,
        cafe_url,
        max_articles=max_articles,
        max_pages=max_pages,
        known_keys=known_keys,
        on_progress=on_progress,
    )
    if not all_entries:
        log("  ⚠ 목록에서 글 URL을 찾지 못했습니다. 로그인·카페 가입·목록 접근 권한을 확인해 주세요.")
        return {
            "total": 0,
            "saved": 0,
            "skipped": 0,
            "skipped_known": 0,
            "failed": 0,
            "empty": 0,
            "urls_collected": 0,
        }

    log(f"  ✓ 1단계 완료 — 목록 URL {len(all_entries)}건 저장")
    for idx, entry in enumerate(all_entries[:10]):
        url = entry.get("url") or ""
        title = (entry.get("title") or "")[:40]
        log(f"    [{idx + 1}] {title} → {url[:80]}")
    if len(all_entries) > 10:
        log(f"    … 외 {len(all_entries) - 10}건")

    if on_urls_collected:
        on_urls_collected(all_entries)

    pending: list[dict] = []
    skipped_known = 0
    for entry in all_entries:
        if _entry_is_known(entry, known_keys):
            skipped_known += 1
            continue
        if len(pending) >= max_articles:
            break
        pending.append(entry)

    log(
        f"  URL {len(all_entries)}건 중 신규 {len(pending)}건 열람 "
        f"(기수집 {skipped_known}건 제외)"
    )
    if on_urls_ready:
        on_urls_ready(len(pending))

    stats = {
        "total": len(pending),
        "saved": 0,
        "skipped": 0,
        "skipped_known": skipped_known,
        "skipped_irrelevant": 0,
        "failed": 0,
        "empty": 0,
    }
    seen_ids: set[str] = set()

    log("  2단계: 저장된 URL로 글 본문 순차 수집 중…")
    for idx, entry in enumerate(pending):
        if should_stop and should_stop():
            log("중단 요청으로 수집을 멈췄습니다.")
            break

        title = entry.get("title") or f"게시글 {idx + 1}"
        article_url = entry.get("url") or ""
        aid = entry.get("articleId") or ""
        if aid and aid in seen_ids:
            continue

        log(f"[{idx + 1}/{len(pending)}] 글 열람: {title[:50]}")

        try:
            driver.switch_to.default_content()
            if not article_url:
                raise RuntimeError("글 URL이 없습니다.")
            driver.get(article_url)
            time.sleep(0.9)

            data = crawl_article_from_current_page(
                driver,
                fallback_url=article_url,
                expected_article_id=aid,
            )
            data["cafeUrl"] = cafe_url
            if not data.get("sourceTitle"):
                data["sourceTitle"] = title

            resolved_url, resolved_id = _resolve_article_identity(
                fallback_url=article_url,
                expected_article_id=aid,
                current_url=data.get("sourceUrl") or "",
            )
            data["sourceUrl"] = resolved_url or article_url
            data["sourceArticleId"] = resolved_id or aid or _parse_article_id(article_url) or ""

            article_id = data.get("sourceArticleId") or ""
            if article_id:
                seen_ids.add(article_id)

            raw = (data.get("rawContent") or "").strip()
            skip_reason = _should_skip_non_knowledge_post(title, raw)
            if skip_reason:
                stats["skipped_irrelevant"] += 1
                log(f"  → 경매 지식 무관 — 스킵 ({skip_reason})")
                if on_article_saved and article_id:
                    marker = {
                        "sourceUrl": data.get("sourceUrl") or article_url,
                        "sourceArticleId": article_id,
                        "sourceTitle": data.get("sourceTitle") or title,
                        "sourceBoard": data.get("sourceBoard") or "",
                        "cafeUrl": cafe_url,
                        "rawContent": "",
                        "markAsSkipped": True,
                        "skipReason": skip_reason,
                    }
                    on_article_saved(marker, {
                        "url": article_url,
                        "articleId": article_id,
                        "title": title,
                    })
                    known_keys.add(_normalize_article_key(article_url, article_id))
            elif len(raw) < 30:
                stats["empty"] += 1
                log(f"  → 본문이 너무 짧아 스킵 ({len(raw)}자)")
            else:
                log(f"  → 본문 {len(raw)}자, 초안 저장 중…")
                save_entry = {
                    "url": data.get("sourceUrl") or article_url,
                    "articleId": article_id,
                    "title": title,
                }
                if on_article_saved:
                    result = on_article_saved(data, save_entry)
                    if result.get("skipped"):
                        stats["skipped"] += 1
                        log("  → DB 중복/스킵")
                    else:
                        stats["saved"] += 1
                        known_keys.add(
                            _normalize_article_key(article_url, article_id)
                        )
                        log("  → 초안 저장됨")
                else:
                    stats["saved"] += 1

        except Exception as exc:
            stats["failed"] += 1
            log(f"  → 오류: {exc}")

        time.sleep(0.12)

    stats["total"] = (
        stats["saved"]
        + stats["skipped"]
        + stats["skipped_irrelevant"]
        + stats["empty"]
        + stats["failed"]
    )
    log(
        f"수집 완료 — 저장 {stats['saved']}건, "
        f"DB중복 {stats['skipped']}건, 무관글 {stats['skipped_irrelevant']}건, "
        f"기수집 {stats['skipped_known']}건, "
        f"본문없음 {stats['empty']}건, 실패 {stats['failed']}건"
    )
    return stats


def _extract_ids_from_source(source: str) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    patterns = [
        r"articleid=(\d{3,})",
        r'"articleId"\s*:\s*"?(\d{3,})"?',
        r"'articleId'\s*:\s*'?(\d{3,})'?",
        r"articleId['\"]?\s*[:=]\s*['\"]?(\d{3,})",
        r"/articles/(\d{3,})",
        r"/cafes/\d+/articles/(\d{3,})",
        r"cafe\.naver\.com/\d+/(\d{3,})",
        r"cafe\.naver\.com/[A-Za-z0-9_-]+/(\d{3,})",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, source, re.I):
            aid = match.group(1)
            if aid not in seen:
                seen.add(aid)
                ids.append(aid)
    return ids


def collect_article_urls(
    driver,
    cafe_url: str,
    max_articles: int = 30,
    max_pages: int = 5,
    on_progress: Callable[[str], None] | None = None,
) -> list[dict]:
    def log(msg: str):
        if on_progress:
            on_progress(msg)

    urls: list[dict] = []
    seen_ids: set[str] = set()

    club_id = extract_club_id_from_source(_page_source(driver), cafe_url)
    if not club_id:
        club_id = extract_club_id(driver, cafe_url)
    cafe_slug = extract_cafe_slug(cafe_url)
    if not cafe_slug:
        slug_match = re.search(r"cafe\.naver\.com/([^/?#]+)", cafe_url)
        if slug_match and not slug_match.group(1).isdigit():
            cafe_slug = slug_match.group(1)

    def add_entry(href: str, title: str, article_id: str | None = None) -> bool:
        if len(urls) >= max_articles:
            return False
        aid = article_id or _parse_article_id(href)
        if not aid or aid in seen_ids:
            return False
        seen_ids.add(aid)
        full_url = href if href.startswith("http") else _build_article_url(
            aid, club_id=club_id, cafe_slug=cafe_slug, base_url=cafe_url
        )
        urls.append(
            {
                "url": full_url,
                "articleId": aid,
                "title": title or f"게시글 {aid}",
            }
        )
        return True

    for page in range(max_pages):
        if len(urls) >= max_articles:
            break

        switch_to_cafe_iframe(driver, wait_sec=0.3)
        source = _page_source(driver)
        found_on_page = 0

        page_entries = _collect_from_page_elements(
            driver,
            club_id=club_id,
            cafe_slug=cafe_slug,
            base_url=cafe_url,
            seen_ids=seen_ids,
            max_articles=max_articles - len(urls),
        )
        for entry in page_entries:
            urls.append(entry)
            found_on_page += 1
            if len(urls) >= max_articles:
                break

        if len(urls) < max_articles:
            for aid in _extract_ids_from_source(source):
                url = _build_article_url(
                    aid,
                    club_id=club_id,
                    cafe_slug=cafe_slug,
                    base_url=cafe_url,
                )
                if add_entry(url, f"게시글 {aid}", article_id=aid):
                    found_on_page += 1
                if len(urls) >= max_articles:
                    break

        log(f"  목록 {page + 1}페이지 — 누적 {len(urls)}건 URL")

        if len(urls) >= max_articles:
            break

        next_link = None
        for anchor in driver.find_elements(By.CSS_SELECTOR, "a"):
            text = (anchor.text or "").strip()
            cls = (anchor.get_attribute("class") or "").lower()
            aria = (anchor.get_attribute("aria-label") or "").strip()
            if (
                text in ("다음", "다음페이지", ">", "Next")
                or "next" in cls
                or aria == "다음"
            ):
                next_link = anchor
                break

        if not next_link:
            break

        try:
            driver.execute_script(
                "arguments[0].scrollIntoView({block:'center'});", next_link
            )
            next_link.click()
            time.sleep(2.0)
        except Exception:
            break

        if found_on_page == 0 and page == 0:
            log("  ⚠ href 추출 실패 → 목록 클릭 방식으로 전환합니다.")
            break

    if not urls:
        log("  ⚠ URL 추출 0건 — 목록 클릭 방식은 crawl_articles_from_list에서 처리")

    return urls


def crawl_article(
    driver,
    url: str,
    expected_article_id: str = "",
) -> dict:
    driver.get(url)
    time.sleep(1.0)
    return crawl_article_from_current_page(
        driver,
        fallback_url=url,
        expected_article_id=expected_article_id or (_parse_article_id(url) or ""),
    )


def crawl_and_process_articles(
    driver,
    cafe_url: str,
    max_articles: int,
    max_pages: int,
    on_progress: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    on_article_saved: Callable[[dict, dict], None] | None = None,
    on_urls_ready: Callable[[int], None] | None = None,
    on_urls_collected: Callable[[list[dict]], None] | None = None,
    naver_user_id: str | None = None,
    naver_password: str | None = None,
    known_urls: list[str] | None = None,
    known_article_ids: list[str] | None = None,
) -> dict:
    """전체글 목록에서 글을 하나씩 열어 본문 수집."""
    def log(msg: str):
        if on_progress:
            on_progress(msg)

    ensure_naver_login(driver, naver_user_id, naver_password)

    log(navigate_to_all_articles(driver, cafe_url))
    if not wait_for_article_list(driver, timeout=8):
        log("  ⚠ 게시글 목록 로딩 확인 실패 — 계속 시도합니다.")

    return crawl_articles_from_list(
        driver,
        cafe_url,
        max_articles=max_articles,
        max_pages=max_pages,
        known_urls=known_urls,
        known_article_ids=known_article_ids,
        on_progress=on_progress,
        should_stop=should_stop,
        on_article_saved=on_article_saved,
        on_urls_ready=on_urls_ready,
        on_urls_collected=on_urls_collected,
    )


def collect_cafe_urls_only(
    driver,
    cafe_url: str,
    max_articles: int = 50,
    max_pages: int = 5,
    on_progress: Callable[[str], None] | None = None,
    naver_user_id: str | None = None,
    naver_password: str | None = None,
    known_urls: list[str] | None = None,
    known_article_ids: list[str] | None = None,
) -> dict:
    """전체글 목록에서 글 URL만 수집 (본문 열람 없음)."""

    def log(msg: str):
        if on_progress:
            on_progress(msg)

    ensure_naver_login(driver, naver_user_id, naver_password)

    log("전체글 목록으로 이동 중…")
    log(navigate_to_all_articles(driver, cafe_url))
    time.sleep(0.8)

    if not wait_for_article_list(driver, timeout=8, quick=True):
        log("  ⚠ 목록 로딩 확인 실패 — URL 수집을 계속 시도합니다.")
        if not wait_for_article_list(driver, timeout=8, quick=False):
            html_len = len(_gather_all_page_html(driver))
            log(f"  (디버그) 페이지 HTML {html_len:,}자, URL={(driver.current_url or '')[:90]}")

    log(f"목록에서 글 URL 수집 중… (최대 {max_articles}건, {max_pages}페이지)")
    known_keys = _build_known_key_set(known_urls, known_article_ids)
    if known_keys:
        log(f"  기수집/스킵 {len(known_keys)}건 — URL 목록에서 제외")
    entries = collect_all_article_entries(
        driver,
        cafe_url,
        max_articles=max_articles,
        max_pages=max_pages,
        known_keys=known_keys,
        on_progress=on_progress,
    )

    if not entries:
        html = _gather_all_page_html(driver)
        log(f"  ⚠ URL 0건 — HTML {len(html):,}자")
        if "로그인" in html or "login" in html.lower():
            log("  → 로그인이 필요할 수 있습니다. 네이버 로그인 후 다시 시도하세요.")
        if "가입" in html or "멤버" in html:
            log("  → 카페 가입·멤버 권한을 확인해 주세요.")
    else:
        log(f"✓ URL {len(entries)}건 수집 완료")
        for idx, entry in enumerate(entries[:20]):
            url = entry.get("url") or ""
            title = (entry.get("title") or "")[:45]
            log(f"  [{idx + 1}] {title} → {url}")
        if len(entries) > 20:
            log(f"  … 외 {len(entries) - 20}건")

    return {"entries": entries, "total": len(entries), "cafeUrl": cafe_url}


def crawl_single_article(
    driver,
    article_url: str,
    cafe_url: str = "",
    naver_user_id: str | None = None,
    naver_password: str | None = None,
) -> dict:
    ensure_naver_login(driver, naver_user_id, naver_password)

    data = crawl_article(driver, article_url)
    if cafe_url:
        data["cafeUrl"] = cafe_url
    elif not data.get("cafeUrl"):
        match = re.search(r"(https://cafe\.naver\.com/[^/]+)", article_url)
        if match:
            data["cafeUrl"] = match.group(1)

    if not data.get("sourceArticleId"):
        raise RuntimeError("게시글 ID를 확인할 수 없습니다. 카페 글 URL인지 확인해 주세요.")

    raw = (data.get("rawContent") or "").strip()
    if len(raw) < 10:
        raise RuntimeError(
            "본문을 가져오지 못했습니다. 로그인·회원 권한 또는 URL을 확인해 주세요."
        )
    return data
