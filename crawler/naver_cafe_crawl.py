"""네이버 카페 게시글 수집 (수동 로그인 지원)."""

from __future__ import annotations

import re
import time
from typing import Callable
from urllib.parse import parse_qs, urljoin, urlparse

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

NAVER_CAFE_CRAWL_REVISION = "2026-06-29-v5-list-click"

DEFAULT_CAFE_URL = "https://cafe.naver.com/0113053470"


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
        driver.get("https://nid.naver.com/nidlogin.login")
        time.sleep(1)
    return (
        "네이버 로그인 페이지를 열었습니다. "
        "브라우저에서 직접 로그인하거나, 관리자 화면에서 ID/비밀번호로 자동 로그인하세요."
    )


def _set_input_value(driver, element, value: str) -> None:
    driver.execute_script(
        """
        const el = arguments[0];
        const val = arguments[1];
        el.focus();
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        """,
        element,
        value,
    )


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

    driver.get("https://nid.naver.com/nidlogin.login")
    time.sleep(1.5)

    id_input = WebDriverWait(driver, 12).until(
        lambda d: d.find_element(By.ID, "id")
    )
    pw_input = driver.find_element(By.ID, "pw")
    _set_input_value(driver, id_input, uid)
    time.sleep(0.2)
    _set_input_value(driver, pw_input, pw)
    time.sleep(0.3)

    clicked = False
    for selector in ("#log\\.login", "button.btn_login", ".btn_login"):
        try:
            btn = driver.find_element(By.CSS_SELECTOR, selector)
            if btn.is_displayed():
                driver.execute_script(
                    "arguments[0].scrollIntoView({block:'center'});", btn
                )
                btn.click()
                clicked = True
                break
        except Exception:
            continue
    if not clicked:
        pw_input.submit()

    deadline = time.time() + wait_2fa_sec
    while time.time() < deadline:
        if is_naver_logged_in(driver):
            return f"네이버 로그인 완료 ({uid})"
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
    driver.switch_to.default_content()
    if wait_sec:
        time.sleep(wait_sec)
    selectors = ["iframe#cafe_main", "iframe[name='cafe_main']", "#cafe_main"]
    for selector in selectors:
        try:
            iframe = driver.find_element(By.CSS_SELECTOR, selector)
            driver.switch_to.frame(iframe)
            return True
        except Exception:
            continue
    return False


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


def wait_for_article_list(driver, timeout: float = 12.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        switch_to_cafe_iframe(driver, wait_sec=0.3)
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
            if _collect_list_article_links(driver):
                driver.switch_to.default_content()
                return True
        driver.switch_to.default_content()
        time.sleep(0.5)
    return False


def _article_list_shell_url(cafe_url: str, club_id: str) -> str:
    from urllib.parse import quote

    iframe_path = (
        f"/ArticleList.nhn?search.clubid={club_id}"
        f"&search.boardtype=L&userDisplay=50"
    )
    return f"{cafe_url.rstrip('/')}?iframe_url={quote(iframe_path, safe='')}"


def navigate_to_all_articles(driver, cafe_url: str) -> str:
    club_id = extract_club_id_from_source(_page_source(driver), cafe_url)
    if not club_id:
        driver.get(cafe_url)
        time.sleep(2)
        club_id = extract_club_id(driver, cafe_url)

    if club_id:
        shell_url = _article_list_shell_url(cafe_url, club_id)
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
    for key in ("articleid", "articleId"):
        if key in qs:
            return qs[key][0]

    path_parts = [p for p in parsed.path.split("/") if p]
    if path_parts and path_parts[-1].isdigit() and len(path_parts[-1]) >= 3:
        return path_parts[-1]

    match = re.search(r"articles/(\d+)", url, re.I)
    if match:
        return match.group(1)
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
    ]

    for selector in selectors:
        try:
            anchors = driver.find_elements(By.CSS_SELECTOR, selector)
        except Exception:
            anchors = []
        for anchor in anchors:
            if len(found) >= max_articles:
                return found
            href = _normalize_href(anchor.get_attribute("href") or "", driver)
            aid = _article_id_from_element(anchor)
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


def crawl_article_from_current_page(driver, fallback_url: str = "") -> dict:
    """현재 페이지(또는 iframe)에서 글 본문 추출 — driver.get 없음."""
    for _ in range(3):
        if switch_to_cafe_iframe(driver, wait_sec=0.5):
            break
        time.sleep(0.6)

    try:
        WebDriverWait(driver, 8).until(
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

    iframe_url = driver.current_url or ""
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

    url = iframe_url if "cafe.naver.com" in iframe_url else fallback_url
    article_id = _parse_article_id(url) or ""
    if not article_id:
        match = re.search(r"articleid=(\d+)", _page_source(driver), re.I)
        if match:
            article_id = match.group(1)

    driver.switch_to.default_content()
    return {
        "sourceUrl": url or fallback_url,
        "sourceArticleId": article_id,
        "sourceTitle": title,
        "sourceBoard": board,
        "rawContent": content[:20000],
    }


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
    on_progress: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    on_article_saved: Callable[[dict, dict], None] | None = None,
    on_urls_ready: Callable[[int], None] | None = None,
) -> dict:
    """목록에서 글을 하나씩 클릭(또는 URL 이동)해 본문 수집."""

    def log(msg: str):
        if on_progress:
            on_progress(msg)

    club_id = extract_club_id_from_source(_page_source(driver), cafe_url)
    if not club_id:
        club_id = extract_club_id(driver, cafe_url)
    cafe_slug = extract_cafe_slug(cafe_url)
    list_shell_url = driver.current_url or cafe_url

    switch_to_cafe_iframe(driver, wait_sec=0.3)
    preview = _collect_list_article_links(driver)
    driver.switch_to.default_content()
    total_hint = min(len(preview), max_articles)
    log(f"  목록에서 {len(preview)}개 글 항목 발견 — 본문 수집 시작")
    if on_urls_ready:
        on_urls_ready(total_hint)

    stats = {"total": total_hint, "saved": 0, "skipped": 0, "failed": 0, "empty": 0}
    seen_ids: set[str] = set()

    for idx in range(max_articles):
        if should_stop and should_stop():
            log("중단 요청으로 수집을 멈췄습니다.")
            break

        driver.switch_to.default_content()
        if list_shell_url and "cafe.naver.com" in list_shell_url:
            current = (driver.current_url or "").split("?")[0]
            if list_shell_url.split("?")[0] not in current:
                driver.get(list_shell_url)
                time.sleep(2)
                wait_for_article_list(driver, timeout=6)

        links = _collect_list_article_links(driver)
        if idx >= len(links):
            log(f"  목록 {idx + 1}번째 항목 없음 — 수집 종료")
            break

        el = links[idx]
        title = _link_title(el) or f"게시글 {idx + 1}"
        href = _normalize_href(el.get_attribute("href") or "", driver)
        aid = _article_id_from_element(el)
        if aid and aid in seen_ids:
            continue

        log(f"[{idx + 1}/{max_articles}] 글 열람 중: {title[:50]}")

        try:
            article_url = _open_list_article(
                driver,
                el,
                href=href,
                aid=aid,
                club_id=club_id,
                cafe_slug=cafe_slug,
                cafe_url=cafe_url,
            )
            time.sleep(2)
            data = crawl_article_from_current_page(driver, fallback_url=article_url)
            data["cafeUrl"] = cafe_url
            if not data.get("sourceTitle"):
                data["sourceTitle"] = title
            if not data.get("sourceArticleId"):
                data["sourceArticleId"] = aid or _parse_article_id(article_url) or ""
            if not data.get("sourceUrl"):
                data["sourceUrl"] = article_url

            article_id = data.get("sourceArticleId") or ""
            if article_id:
                seen_ids.add(article_id)

            raw = (data.get("rawContent") or "").strip()
            if len(raw) < 30:
                stats["empty"] += 1
                log(f"  → 본문이 너무 짧아 스킵 ({len(raw)}자)")
            else:
                log(f"  → 본문 {len(raw)}자 수집 완료, 초안 저장 중…")
                entry = {
                    "url": data.get("sourceUrl") or article_url,
                    "articleId": article_id,
                    "title": title,
                }
                if on_article_saved:
                    result = on_article_saved(data, entry)
                    if result.get("skipped"):
                        stats["skipped"] += 1
                        log("  → 중복/스킵")
                    else:
                        stats["saved"] += 1
                        log("  → 초안 저장됨")
                else:
                    stats["saved"] += 1

        except Exception as exc:
            stats["failed"] += 1
            log(f"  → 오류: {exc}")

        time.sleep(0.8)

    stats["total"] = stats["saved"] + stats["skipped"] + stats["empty"] + stats["failed"]
    log(
        f"수집 완료 — 저장 {stats['saved']}건, "
        f"중복 {stats['skipped']}건, 본문없음 {stats['empty']}건, 실패 {stats['failed']}건"
    )
    return stats


def _extract_ids_from_source(source: str) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    patterns = [
        r"articleid=(\d{3,})",
        r"articleId['\"]?\s*[:=]\s*['\"]?(\d{3,})",
        r"/articles/(\d{3,})",
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


def crawl_article(driver, url: str) -> dict:
    driver.get(url)
    time.sleep(2.5)

    for _ in range(3):
        if switch_to_cafe_iframe(driver, wait_sec=0.5):
            break
        time.sleep(0.8)

    try:
        WebDriverWait(driver, 8).until(
            lambda d: any(
                kw in _page_source(d)
                for kw in ("se-main-container", "postViewArea", "article_viewer", "ArticleContent")
            )
        )
    except Exception:
        pass

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

    article_id = _parse_article_id(url) or ""
    if not article_id:
        match = re.search(r"articleid=(\d+)", _page_source(driver), re.I)
        if match:
            article_id = match.group(1)

    return {
        "sourceUrl": url,
        "sourceArticleId": article_id,
        "sourceTitle": title,
        "sourceBoard": board,
        "rawContent": content[:20000],
    }


def crawl_and_process_articles(
    driver,
    cafe_url: str,
    max_articles: int,
    max_pages: int,
    on_progress: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    on_article_saved: Callable[[dict, dict], None] | None = None,
    on_urls_ready: Callable[[int], None] | None = None,
    naver_user_id: str | None = None,
    naver_password: str | None = None,
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
        on_progress=on_progress,
        should_stop=should_stop,
        on_article_saved=on_article_saved,
        on_urls_ready=on_urls_ready,
    )


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
