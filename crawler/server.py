import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import requests

import importlib

from browser import (
    CONTEXT_CAFE,
    CONTEXT_TANK,
    browser_is_ready,
    close_driver,
    ensure_cafe_driver,
    ensure_driver,
    get_existing_driver,
    is_session_alive,
    selenium_lock,
)
import item_crawl
from crawl_abort import CrawlStoppedError
from tank_login import ensure_login, is_logged_in, login, _is_logged_in_unlocked
from url_collect import apply_preset, collect_urls

CRAWLER_SERVER_REVISION = "2026-07-01-tank-baseinfo"


def _reload_crawler_modules():
    """워커 재시작 없이 crawler/*.py 변경 반영."""
    import naver_crawl
    import crawl_abort

    importlib.reload(crawl_abort)
    importlib.reload(naver_crawl)
    importlib.reload(item_crawl)
    import url_collect

    importlib.reload(url_collect)
    return item_crawl.crawl_item


def _crawl_should_stop() -> bool:
    with STATE.lock:
        return STATE.stop_requested


class CrawlerState:
    def __init__(self):
        self.lock = threading.Lock()
        self.phase = "idle"
        self.browser_ready = False
        self.urls: list[dict] = []
        self.completed = 0
        self.total = 0
        self.created = 0
        self.updated = 0
        self.preset = "현재"
        self.error = None
        self.last_message = None
        self.stop_requested = False
        self.crawl_thread: threading.Thread | None = None
        self.events: list[str] = []
        self.cached_tank_logged_in: bool | None = None
        self._login_check_at = 0.0

    def push_event(self, message: str):
        with self.lock:
            self.events.append(message)

    def snapshot(self) -> dict:
        with self.lock:
            events = list(self.events)
            self.events.clear()
            busy = self.phase in ("collecting", "logging_in", "crawling", "starting")
            if busy:
                ready = self.browser_ready
            else:
                ready = browser_is_ready(CONTEXT_TANK)
                self.browser_ready = ready

            tank_logged_in = self.cached_tank_logged_in
            login_check_cooldown = 45.0
            should_probe_login = (
                not busy
                and (
                    tank_logged_in is None
                    or time.time() - self._login_check_at >= login_check_cooldown
                )
            )
            if should_probe_login:
                try:
                    with selenium_lock:
                        driver = get_existing_driver(CONTEXT_TANK)
                        if driver is not None:
                            tank_logged_in = _is_logged_in_unlocked(driver)
                            self.cached_tank_logged_in = tank_logged_in
                            self._login_check_at = time.time()
                            if tank_logged_in and self.phase == "logging_in":
                                self.phase = "idle"
                                self.error = None
                                self.last_message = "탱크옥션 로그인 상태입니다."
                except Exception:
                    pass

            return {
                "phase": self.phase,
                "browserReady": ready,
                "tankLoggedIn": tank_logged_in,
                "urls": list(self.urls),
                "completed": self.completed,
                "total": self.total,
                "created": self.created,
                "updated": self.updated,
                "preset": self.preset,
                "error": self.error,
                "lastMessage": self.last_message,
                "events": events,
            }

    def set_message(self, message: str):
        with self.lock:
            self.last_message = message


STATE = CrawlerState()


class CafeCrawlState:
    def __init__(self):
        self.lock = threading.Lock()
        self.phase = "idle"
        self.cafe_url = ""
        self.completed = 0
        self.total = 0
        self.imported = 0
        self.skipped = 0
        self.error = None
        self.last_message = None
        self.stop_requested = False
        self.naver_logged_in = False
        self.crawl_thread: threading.Thread | None = None
        self.events: list[str] = []
        self.collected_urls: list[dict] = []
        self.sub_phase = ""

    def push_event(self, message: str):
        with self.lock:
            self.events.append(message)

    def snapshot(self) -> dict:
        with self.lock:
            events = list(self.events)
            self.events.clear()
            return {
                "phase": self.phase,
                "cafeUrl": self.cafe_url,
                "completed": self.completed,
                "total": self.total,
                "imported": self.imported,
                "skipped": self.skipped,
                "browserReady": browser_is_ready(CONTEXT_CAFE),
                "naverLoggedIn": self.naver_logged_in,
                "error": self.error,
                "lastMessage": self.last_message,
                "events": events,
                "subPhase": self.sub_phase,
                "urlCollectTotal": len(self.collected_urls),
                "collectedUrls": [
                    {
                        "url": item.get("url", ""),
                        "title": item.get("title", ""),
                        "articleId": item.get("articleId", ""),
                    }
                    for item in self.collected_urls[:50]
                ],
            }


CAFE_STATE = CafeCrawlState()
CAFE_DRIVER_LOCK = threading.Lock()


def _cafe_urls_store_path():
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent / "data" / "crawler"
    root.mkdir(parents=True, exist_ok=True)
    return root / "cafe-collected-urls.json"


def _save_cafe_collected_urls(cafe_url: str, entries: list[dict]) -> None:
    import datetime

    payload = {
        "cafeUrl": cafe_url,
        "collectedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "total": len(entries),
        "urls": [
            {
                "url": item.get("url", ""),
                "title": item.get("title", ""),
                "articleId": item.get("articleId", ""),
            }
            for item in entries
        ],
    }
    _cafe_urls_store_path().write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _load_cafe_collected_urls() -> dict:
    path = _cafe_urls_store_path()
    if not path.is_file():
        return {"cafeUrl": "", "collectedAt": None, "total": 0, "urls": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {"cafeUrl": "", "collectedAt": None, "total": 0, "urls": []}


def cafe_collect_urls_worker(
    cafe_url: str,
    max_articles: int,
    max_pages: int,
    naver_user_id: str = "",
    naver_password: str = "",
    known_urls: list | None = None,
    known_article_ids: list | None = None,
):
    from naver_cafe_crawl import (
        NaverLoginRequiredError,
        collect_cafe_urls_only,
        ensure_naver_login,
        is_naver_logged_in,
    )
    from browser import ensure_cafe_driver

    try:
        with CAFE_STATE.lock:
            CAFE_STATE.phase = "collecting_urls"
            CAFE_STATE.sub_phase = "urls_only"
            CAFE_STATE.cafe_url = cafe_url
            CAFE_STATE.completed = 0
            CAFE_STATE.total = 0
            CAFE_STATE.imported = 0
            CAFE_STATE.skipped = 0
            CAFE_STATE.error = None
            CAFE_STATE.stop_requested = False
            CAFE_STATE.collected_urls = []

        driver = ensure_cafe_driver()

        def on_progress(message: str):
            CAFE_STATE.push_event(message)
            with CAFE_STATE.lock:
                CAFE_STATE.last_message = message

        with CAFE_DRIVER_LOCK:
            with CAFE_STATE.lock:
                CAFE_STATE.naver_logged_in = is_naver_logged_in(driver)
            ensure_naver_login(driver, naver_user_id or None, naver_password or None)
            with CAFE_STATE.lock:
                CAFE_STATE.naver_logged_in = True

            result = collect_cafe_urls_only(
                driver,
                cafe_url,
                max_articles=max_articles,
                max_pages=max_pages,
                on_progress=on_progress,
                naver_user_id=naver_user_id or None,
                naver_password=naver_password or None,
                known_urls=known_urls or [],
                known_article_ids=known_article_ids or [],
            )

        entries = result.get("entries") or []
        _save_cafe_collected_urls(cafe_url, entries)

        with CAFE_STATE.lock:
            CAFE_STATE.collected_urls = list(entries)
            CAFE_STATE.total = len(entries)
            CAFE_STATE.phase = "idle"
            CAFE_STATE.sub_phase = "urls_ready"
            CAFE_STATE.last_message = f"글 URL {len(entries)}건 수집 완료"
    except NaverLoginRequiredError as exc:
        with CAFE_STATE.lock:
            CAFE_STATE.phase = "error"
            CAFE_STATE.error = str(exc)
            CAFE_STATE.last_message = str(exc)
        CAFE_STATE.push_event(str(exc))
    except Exception as exc:
        with CAFE_STATE.lock:
            CAFE_STATE.phase = "error"
            CAFE_STATE.error = str(exc)
            CAFE_STATE.last_message = str(exc)
        CAFE_STATE.push_event(str(exc))


def _is_invalid_session(exc: Exception) -> bool:
    message = str(exc).lower()
    return "invalid session id" in message or "invalidsessionid" in message


def _run_login(user_id, password) -> str:
    try:
        driver = ensure_driver()
        return ensure_login(driver, user_id=user_id, user_pw=password)
    except Exception as exc:
        if _is_invalid_session(exc):
            driver = ensure_driver(force_new=True)
            return ensure_login(driver, user_id=user_id, user_pw=password)
        raise


class LoginRequiredError(RuntimeError):
    pass


def _crawler_on_tank_site(driver) -> bool:
    return "tankauction.com" in (driver.current_url or "")


def _ensure_logged_in(user_id=None, password=None) -> str:
    with selenium_lock:
        driver = ensure_driver()
        if is_logged_in(driver):
            return "탱크옥션 로그인 상태입니다."
        message = ensure_login(driver, user_id=user_id, user_pw=password)
        if not is_logged_in(driver):
            raise LoginRequiredError(
                "탱크옥션 로그인에 실패했습니다. ID/비밀번호를 확인하거나 "
                "브라우저에서 직접 로그인해 주세요."
            )
        return message


def _fail_login_state(message: str) -> None:
    with STATE.lock:
        STATE.phase = "error"
        STATE.error = message
        STATE.last_message = message
        STATE.events.append(message)


def _with_live_driver(action, force_retry: bool = True):
    try:
        driver = ensure_driver()
        return action(driver)
    except Exception as exc:
        if force_retry and _is_invalid_session(exc):
            driver = ensure_driver(force_new=True)
            return action(driver)
        raise


def _resolve_callback(callback_url: str | None = None, callback_secret: str | None = None):
    return {
        "url": (
            callback_url
            or os.environ.get(
                "CRAWLER_CALLBACK_URL",
                "http://127.0.0.1:3001/crawler/import-item",
            )
        ).strip(),
        "secret": (callback_secret or os.environ.get("CRAWLER_SECRET", "local-crawler-secret")).strip(),
    }


def _push_api_log(
    message: str,
    level: str = "info",
    callback_url: str | None = None,
    callback_secret: str | None = None,
) -> None:
    cfg = _resolve_callback(callback_url, callback_secret)
    log_url = cfg["url"].rsplit("/", 1)[0] + "/worker-log"
    try:
        requests.post(
            log_url,
            json={"message": message, "level": level},
            headers={
                "X-Crawler-Secret": cfg["secret"],
                "Content-Type": "application/json",
            },
            timeout=5,
        )
    except Exception:
        pass


def _entry_label(entry: str) -> str:
    if "_" in entry:
        prefix = entry.split("_", 1)[0].strip()
        if prefix and not prefix.startswith("http"):
            return prefix
    return entry[:48]


def _set_live_message(message: str) -> None:
    with STATE.lock:
        STATE.last_message = message


def _post_mirror_item(
    mirror_url: str,
    mirror_secret: str,
    payload: dict,
    label: str,
) -> None:
    try:
        mirror_res = requests.post(
            mirror_url,
            json=payload,
            headers={
                "X-Crawler-Secret": mirror_secret,
                "Content-Type": "application/json",
                "X-Crawler-Mirror": "1",
            },
            timeout=30,
        )
        mirror_res.raise_for_status()
    except Exception as exc:
        err = f"운영 DB 동기화 실패 ({label}): {exc}"
        print(f"[crawler] {err}", flush=True)
        STATE.push_event(err)


def post_item_to_api(
    item: dict,
    callback_url: str | None = None,
    callback_secret: str | None = None,
    mirror_callback_url: str | None = None,
    mirror_callback_secret: str | None = None,
):
    cfg = _resolve_callback(callback_url, callback_secret)
    payload = {**item, "submittedBy": "crawler"}
    headers = {
        "X-Crawler-Secret": cfg["secret"],
        "Content-Type": "application/json",
    }
    res = requests.post(cfg["url"], json=payload, headers=headers, timeout=30)
    res.raise_for_status()
    result = res.json()

    mirror_url = (
        mirror_callback_url
        or os.environ.get("CRAWLER_MIRROR_URL", "")
    ).strip()
    if mirror_url and mirror_url.rstrip("/") != cfg["url"].rstrip("/"):
        mirror_secret = (
            mirror_callback_secret
            or os.environ.get("CRAWLER_SECRET", cfg["secret"])
        ).strip()
        label = _auction_label(item)
        threading.Thread(
            target=_post_mirror_item,
            args=(mirror_url, mirror_secret, payload, label),
            daemon=True,
        ).start()

    return result


def post_naver_id_to_api(
    auction_no: str,
    naver_id: str,
    callback_url: str | None = None,
    callback_secret: str | None = None,
    mirror_callback_url: str | None = None,
    mirror_callback_secret: str | None = None,
) -> dict:
    cfg = _resolve_callback(callback_url, callback_secret)
    base = cfg["url"].rsplit("/", 1)[0]
    secret = cfg["secret"]
    payload = {
        "auctionNo": auction_no,
        "naverId": naver_id,
        "submittedBy": "crawler-naver-backfill",
    }
    headers = {
        "X-Crawler-Secret": secret,
        "Content-Type": "application/json",
    }
    res = requests.post(
        f"{base}/import-naver-id",
        json=payload,
        headers=headers,
        timeout=30,
    )
    res.raise_for_status()
    result = res.json()

    mirror_url = (
        mirror_callback_url
        or os.environ.get("CRAWLER_MIRROR_URL", "")
    ).strip()
    if mirror_url:
        mirror_base = mirror_url.rsplit("/", 1)[0]
        if mirror_base.rstrip("/") != base.rstrip("/"):
            mirror_secret = (
                mirror_callback_secret
                or os.environ.get("CRAWLER_SECRET", secret)
            ).strip()
            try:
                mirror_res = requests.post(
                    f"{mirror_base}/import-naver-id",
                    json=payload,
                    headers={
                        "X-Crawler-Secret": mirror_secret,
                        "Content-Type": "application/json",
                        "X-Crawler-Mirror": "1",
                    },
                    timeout=30,
                )
                mirror_res.raise_for_status()
            except Exception as exc:
                err = f"운영 DB 네이버ID 동기화 실패 ({auction_no}): {exc}"
                print(f"[crawler] {err}", flush=True)
                STATE.push_event(err)

    return result


def post_cafe_post_to_api(
    item: dict,
    callback_url: str | None = None,
    callback_secret: str | None = None,
) -> dict:
    cfg = _resolve_callback(callback_url, callback_secret)
    base = cfg["url"].rsplit("/", 1)[0]
    secret = cfg["secret"]
    payload = {
        **item,
        "submittedBy": "crawler-cafe",
    }
    headers = {
        "X-Crawler-Secret": secret,
        "Content-Type": "application/json",
    }
    res = requests.post(
        f"{base}/import-cafe-post",
        json=payload,
        headers=headers,
        timeout=60,
    )
    res.raise_for_status()
    return res.json()


def _naver_credentials(body: dict) -> tuple[str, str]:
    user_id = (
        body.get("naverUserId")
        or body.get("naver_user_id")
        or body.get("userId")
        or body.get("user_id")
        or ""
    )
    password = (
        body.get("naverPassword")
        or body.get("naver_password")
        or body.get("password")
        or ""
    )
    return str(user_id).strip(), str(password)


def cafe_crawl_worker(
    cafe_url: str,
    max_articles: int,
    max_pages: int,
    callback_url: str | None = None,
    callback_secret: str | None = None,
    naver_user_id: str = "",
    naver_password: str = "",
    known_urls: list | None = None,
    known_article_ids: list | None = None,
):
    from naver_cafe_crawl import (
        NaverLoginRequiredError,
        crawl_and_process_articles,
        ensure_naver_login,
        is_naver_logged_in,
    )
    from browser import ensure_cafe_driver

    try:
        with CAFE_STATE.lock:
            CAFE_STATE.phase = "crawling"
            CAFE_STATE.cafe_url = cafe_url
            CAFE_STATE.completed = 0
            CAFE_STATE.total = 0
            CAFE_STATE.imported = 0
            CAFE_STATE.skipped = 0
            CAFE_STATE.error = None
            CAFE_STATE.stop_requested = False
            CAFE_STATE.collected_urls = []
            CAFE_STATE.sub_phase = "collecting_urls"

        driver = ensure_cafe_driver()

        def on_progress(message: str):
            CAFE_STATE.push_event(message)
            with CAFE_STATE.lock:
                CAFE_STATE.last_message = message

        def should_stop() -> bool:
            with CAFE_STATE.lock:
                return CAFE_STATE.stop_requested

        with CAFE_STATE.lock:
            CAFE_STATE.naver_logged_in = is_naver_logged_in(driver)

        with CAFE_DRIVER_LOCK:
            ensure_naver_login(driver, naver_user_id or None, naver_password or None)
            with CAFE_STATE.lock:
                CAFE_STATE.naver_logged_in = True

            def on_urls_collected(entries: list[dict]):
                _save_cafe_collected_urls(cafe_url, entries)
                with CAFE_STATE.lock:
                    CAFE_STATE.collected_urls = list(entries)
                    CAFE_STATE.sub_phase = "reading_articles"

            def on_urls_ready(count: int):
                with CAFE_STATE.lock:
                    CAFE_STATE.total = count

            def on_article_saved(data: dict, _entry: dict) -> dict:
                result = post_cafe_post_to_api(
                    data,
                    callback_url=callback_url,
                    callback_secret=callback_secret,
                )
                with CAFE_STATE.lock:
                    CAFE_STATE.completed += 1
                    if result.get("skipped"):
                        CAFE_STATE.skipped += 1
                    else:
                        CAFE_STATE.imported += 1
                return result

            stats = crawl_and_process_articles(
                driver,
                cafe_url,
                max_articles=max_articles,
                max_pages=max_pages,
                on_progress=on_progress,
                should_stop=should_stop,
                on_article_saved=on_article_saved,
                on_urls_ready=on_urls_ready,
                on_urls_collected=on_urls_collected,
                naver_user_id=naver_user_id or None,
                naver_password=naver_password or None,
                known_urls=known_urls or [],
                known_article_ids=known_article_ids or [],
            )

        skipped_known = stats.get("skipped_known", 0)
        with CAFE_STATE.lock:
            CAFE_STATE.total = stats.get("total", CAFE_STATE.completed)
            CAFE_STATE.phase = "idle"
            CAFE_STATE.last_message = (
                f"카페 수집 완료 — 저장 {CAFE_STATE.imported}건, "
                f"DB중복 {CAFE_STATE.skipped}건, 기수집 {skipped_known}건"
            )
    except NaverLoginRequiredError as exc:
        with CAFE_STATE.lock:
            CAFE_STATE.phase = "error"
            CAFE_STATE.error = str(exc)
            CAFE_STATE.last_message = str(exc)
        CAFE_STATE.push_event(str(exc))
    except Exception as exc:
        with CAFE_STATE.lock:
            CAFE_STATE.phase = "error"
            CAFE_STATE.error = str(exc)
            CAFE_STATE.last_message = str(exc)
        CAFE_STATE.push_event(str(exc))


def cafe_single_article_worker(
    article_url: str,
    cafe_url: str,
    callback_url: str | None = None,
    callback_secret: str | None = None,
    naver_user_id: str = "",
    naver_password: str = "",
):
    from naver_cafe_crawl import (
        NaverLoginRequiredError,
        crawl_single_article,
        ensure_naver_login,
        is_naver_logged_in,
    )
    from browser import ensure_cafe_driver

    with CAFE_STATE.lock:
        CAFE_STATE.phase = "crawling"
        CAFE_STATE.error = None
        CAFE_STATE.stop_requested = False
        CAFE_STATE.completed = 0
        CAFE_STATE.total = 1
        CAFE_STATE.imported = 0
        CAFE_STATE.skipped = 0

    try:
        driver = ensure_cafe_driver()
        with CAFE_STATE.lock:
            CAFE_STATE.naver_logged_in = is_naver_logged_in(driver)
        ensure_naver_login(driver, naver_user_id or None, naver_password or None)
        with CAFE_STATE.lock:
            CAFE_STATE.naver_logged_in = True

        CAFE_STATE.push_event(f"단일 글 수집: {article_url[:80]}")
        data = crawl_single_article(
            driver,
            article_url,
            cafe_url=cafe_url,
            naver_user_id=naver_user_id or None,
            naver_password=naver_password or None,
        )
        result = post_cafe_post_to_api(
            data,
            callback_url=callback_url,
            callback_secret=callback_secret,
        )
        with CAFE_STATE.lock:
            CAFE_STATE.completed = 1
            if result.get("skipped"):
                CAFE_STATE.skipped = 1
            else:
                CAFE_STATE.imported = 1
            CAFE_STATE.phase = "idle"
            CAFE_STATE.last_message = (
                "단일 글 수집 완료 (중복)" if result.get("skipped") else "단일 글 초안 저장 완료"
            )
        return result
    except Exception as exc:
        with CAFE_STATE.lock:
            CAFE_STATE.phase = "error"
            CAFE_STATE.error = str(exc)
            CAFE_STATE.last_message = str(exc)
        CAFE_STATE.push_event(str(exc))
        raise


def _auction_label(item: dict) -> str:
    return str(item.get("auctionNo") or item.get("address") or "물건").strip()


def _record_import_result(
    item: dict,
    result: dict,
    index: int,
    total: int,
    *,
    callback_url: str | None = None,
    callback_secret: str | None = None,
) -> None:
    label = _auction_label(item)
    naver_note = ""
    if not item.get("naver_lowest_price"):
        detail = str(item.get("naver_price_detail") or "").strip()
        area = str(item.get("area") or "")
        if detail:
            naver_note = f" (네이버: {detail[:60]})"
        elif area in ("0", "없음", ""):
            naver_note = " (면적 미수집)"

    if result.get("skipped") and result.get("unchanged"):
        status_label = f"{label} (변경 없음)"
    elif result.get("skipped"):
        reason = str(result.get("reason") or "저장 스킵")
        if reason in ("invalid_auction_no", "invalid_address", "invalid_link"):
            status_label = f"{label} 저장 스킵 (물건 아님)"
        else:
            status_label = f"{label} 저장 스킵 ({reason})"
    elif result.get("created"):
        status_label = f"{label} 등록완료"
    else:
        status_label = f"{label} 갱신완료"

    log_line = f"[{index}/{total}] {status_label}{naver_note}"
    _push_api_log(log_line, "info", callback_url, callback_secret)

    with STATE.lock:
        STATE.completed = index
        if result.get("created"):
            STATE.created += 1
        elif not result.get("skipped"):
            STATE.updated += 1
        STATE.last_message = log_line


def crawl_worker(
    urls: list[str],
    callback_url: str | None = None,
    callback_secret: str | None = None,
    mirror_callback_url: str | None = None,
    mirror_callback_secret: str | None = None,
    user_id: str | None = None,
    password: str | None = None,
):
    cfg = _resolve_callback(callback_url, callback_secret)
    mirror_url = (
        mirror_callback_url
        or os.environ.get("CRAWLER_MIRROR_URL", "")
    ).strip()
    target = cfg["url"]
    if mirror_url and mirror_url.rstrip("/") != target.rstrip("/"):
        print(f"[crawler] import callback → local {target} + mirror {mirror_url}", flush=True)
    else:
        print(f"[crawler] import callback → {target}", flush=True)
    try:
        try:
            _ensure_logged_in(user_id, password)
        except (LoginRequiredError, RuntimeError) as exc:
            _fail_login_state(str(exc))
            return

        with STATE.lock:
            STATE.phase = "crawling"
            STATE.completed = 0
            STATE.total = len(urls)
            STATE.created = 0
            STATE.updated = 0
            STATE.stop_requested = False
            STATE.error = None
            STATE.events.clear()

        crawl_item = _reload_crawler_modules()
        driver = ensure_driver()
        driver.implicitly_wait(1)

        for index, entry in enumerate(urls):
            pos = index + 1
            total_count = len(urls)
            entry_label = _entry_label(entry)

            with STATE.lock:
                if STATE.stop_requested:
                    STATE.phase = "stopped"
                    STATE.last_message = "사용자 요청으로 조회가 중단되었습니다."
                    STATE.events.append("조회작업 중단")
                    return

            try:
                with selenium_lock:
                    if not browser_is_ready(CONTEXT_TANK):
                        driver = ensure_driver(force_new=True)
                        driver.implicitly_wait(1)
                    if _crawler_on_tank_site(driver):
                        if not is_logged_in(driver):
                            try:
                                _ensure_logged_in(user_id, password)
                            except (LoginRequiredError, RuntimeError) as exc:
                                _fail_login_state(f"조회 중 로그인 만료: {exc}")
                                return
                    crawl_item = _reload_crawler_modules()
                    _set_live_message(f"[{pos}/{total_count}] {entry_label} 조회 중...")
                    query_log = f"[{pos}/{total_count}] {entry_label} 조회 시작"
                    _push_api_log(query_log, "info", cfg["url"], cfg["secret"])
                    with STATE.lock:
                        STATE.last_message = query_log
                    item = crawl_item(driver, entry, should_stop=_crawl_should_stop)
                    gaps = item_crawl.summarize_tank_collection_gaps(item)
                    if gaps:
                        gap_msg = (
                            f"[{pos}/{total_count}] {entry_label} 탱크 미수집: "
                            + ", ".join(gaps)
                        )
                        _push_api_log(gap_msg, "warn", cfg["url"], cfg["secret"])
                if not item_crawl.is_valid_crawl_item(item):
                    _, skip_reason = item_crawl.validate_crawl_item_reason(item)
                    with STATE.lock:
                        STATE.completed = pos
                        skip_msg = (
                            f"[{pos}/{total_count}] 저장 스킵 ({skip_reason}): "
                            f"{item.get('auctionNo') or item.get('address') or entry[:40]}"
                        )
                        STATE.last_message = skip_msg
                    _push_api_log(skip_msg, "warn", cfg["url"], cfg["secret"])
                    continue
                item_label = _auction_label(item)
                _set_live_message(f"[{pos}/{total_count}] {item_label} 저장 중...")
                result = post_item_to_api(
                    item,
                    callback_url=cfg["url"],
                    callback_secret=cfg["secret"],
                    mirror_callback_url=mirror_url or None,
                    mirror_callback_secret=mirror_callback_secret,
                )
                _record_import_result(
                    item,
                    result,
                    pos,
                    total_count,
                    callback_url=cfg["url"],
                    callback_secret=cfg["secret"],
                )
            except CrawlStoppedError:
                with STATE.lock:
                    STATE.phase = "stopped"
                    STATE.last_message = "사용자 요청으로 조회가 중단되었습니다."
                    STATE.events.append("조회작업 중단")
                _push_api_log("조회작업 중단", "info", cfg["url"], cfg["secret"])
                return
            except Exception as exc:
                if _is_invalid_session(exc):
                    with STATE.lock:
                        STATE.last_message = (
                            f"브라우저 세션 만료 — 재연결 후 재시도 ({pos}/{total_count})"
                        )
                    try:
                        with selenium_lock:
                            driver = ensure_driver(force_new=True)
                            driver.implicitly_wait(1)
                            _set_live_message(f"[{pos}/{total_count}] {entry_label} 조회 중...")
                            item = crawl_item(
                                driver, entry, should_stop=_crawl_should_stop
                            )
                        if not item_crawl.is_valid_crawl_item(item):
                            _, skip_reason = item_crawl.validate_crawl_item_reason(item)
                            with STATE.lock:
                                STATE.completed = pos
                                skip_msg = (
                                    f"[{pos}/{total_count}] 저장 스킵 ({skip_reason}): "
                                    f"{item.get('auctionNo') or item.get('address') or entry[:40]}"
                                )
                                STATE.last_message = skip_msg
                            _push_api_log(skip_msg, "warn", cfg["url"], cfg["secret"])
                            continue
                        item_label = _auction_label(item)
                        _set_live_message(f"[{pos}/{total_count}] {item_label} 저장 중...")
                        result = post_item_to_api(
                            item,
                            callback_url=cfg["url"],
                            callback_secret=cfg["secret"],
                            mirror_callback_url=mirror_url or None,
                            mirror_callback_secret=mirror_callback_secret,
                        )
                        _record_import_result(
                            item,
                            result,
                            pos,
                            total_count,
                            callback_url=cfg["url"],
                            callback_secret=cfg["secret"],
                        )
                        continue
                    except CrawlStoppedError:
                        with STATE.lock:
                            STATE.phase = "stopped"
                            STATE.last_message = "사용자 요청으로 조회가 중단되었습니다."
                            STATE.events.append("조회작업 중단")
                        _push_api_log("조회작업 중단", "info", cfg["url"], cfg["secret"])
                        return
                    except Exception as retry_exc:
                        err_msg = f"오류 ({pos}/{total_count}): {retry_exc}"
                        with STATE.lock:
                            STATE.completed = pos
                            STATE.last_message = err_msg
                            STATE.events.append(err_msg)
                else:
                    err_msg = f"오류 ({pos}/{total_count}): {exc}"
                    with STATE.lock:
                        STATE.completed = pos
                        STATE.last_message = err_msg
                        STATE.events.append(err_msg)

            if _crawl_should_stop():
                with STATE.lock:
                    STATE.phase = "stopped"
                    STATE.last_message = "사용자 요청으로 조회가 중단되었습니다."
                    STATE.events.append("조회작업 중단")
                _push_api_log("조회작업 중단", "info", cfg["url"], cfg["secret"])
                return

            time.sleep(0.1)

        with STATE.lock:
            STATE.phase = "idle"
            STATE.completed = total_count
            done_msg = f"조회작업 완료 ({total_count}건)"
            STATE.last_message = done_msg
        _push_api_log(done_msg, "info", cfg["url"], cfg["secret"])
    except Exception as exc:
        with STATE.lock:
            STATE.phase = "error"
            STATE.error = str(exc)
            STATE.last_message = str(exc)
            STATE.events.append(f"조회작업 오류: {exc}")
    finally:
        try:
            driver = get_existing_driver(CONTEXT_TANK)
            if driver is not None and is_session_alive(driver):
                driver.implicitly_wait(5)
        except Exception:
            pass


def naver_id_backfill_worker(
    items: list[dict],
    callback_url: str | None = None,
    callback_secret: str | None = None,
    mirror_callback_url: str | None = None,
    mirror_callback_secret: str | None = None,
):
    cfg = _resolve_callback(callback_url, callback_secret)
    mirror_url = (
        mirror_callback_url
        or os.environ.get("CRAWLER_MIRROR_URL", "")
    ).strip()
    print(f"[crawler] naver-id callback → {cfg['url']}", flush=True)
    try:
        with STATE.lock:
            STATE.phase = "crawling"
            STATE.completed = 0
            STATE.total = len(items)
            STATE.stop_requested = False
            STATE.error = None
            STATE.created = 0
            STATE.updated = 0

        importlib.reload(item_crawl)
        fetch_naver_id_only = item_crawl.fetch_naver_id_only
        driver = ensure_driver()
        driver.implicitly_wait(1)

        for index, entry in enumerate(items):
            with STATE.lock:
                if STATE.stop_requested:
                    STATE.phase = "stopped"
                    STATE.last_message = "네이버 ID 수집이 중단되었습니다."
                    return

            url = str(entry.get("url") or entry.get("link") or "").strip()
            auction_no = str(
                entry.get("auctionNo") or entry.get("auction_no") or ""
            ).strip()
            label = auction_no or url[:40]

            try:
                if not browser_is_ready(CONTEXT_TANK):
                    driver = ensure_driver(force_new=True)
                    driver.implicitly_wait(1)
                importlib.reload(item_crawl)
                fetch_naver_id_only = item_crawl.fetch_naver_id_only
                result = fetch_naver_id_only(driver, url)
                naver_id = str(result.get("naver_id") or "").strip()
                note = ""
                if naver_id and auction_no:
                    api_result = post_naver_id_to_api(
                        auction_no,
                        naver_id,
                        callback_url=cfg["url"],
                        callback_secret=cfg["secret"],
                        mirror_callback_url=mirror_url or None,
                        mirror_callback_secret=mirror_callback_secret,
                    )
                    with STATE.lock:
                        STATE.completed = index + 1
                        if api_result.get("updated"):
                            STATE.updated += 1
                            note = f" → ID {naver_id}"
                        else:
                            note = " (변경 없음)" if api_result.get("skipped") else ""
                else:
                    err = str(result.get("error") or "ID 없음")
                    note = f" ({err})"
                    with STATE.lock:
                        STATE.completed = index + 1

                with STATE.lock:
                    STATE.last_message = (
                        f"[네이버ID {index + 1}/{len(items)}] {label}{note}"
                    )
            except Exception as exc:
                with STATE.lock:
                    if _is_invalid_session(exc):
                        STATE.last_message = (
                            f"브라우저 세션 만료 — 재연결 후 재시도 ({index + 1}/{len(items)})"
                        )
                        try:
                            driver = ensure_driver(force_new=True)
                            driver.implicitly_wait(1)
                            importlib.reload(item_crawl)
                            fetch_naver_id_only = item_crawl.fetch_naver_id_only
                            result = fetch_naver_id_only(driver, url)
                            naver_id = str(result.get("naver_id") or "").strip()
                            if naver_id and auction_no:
                                api_result = post_naver_id_to_api(
                                    auction_no,
                                    naver_id,
                                    callback_url=cfg["url"],
                                    callback_secret=cfg["secret"],
                                    mirror_callback_url=mirror_url or None,
                                    mirror_callback_secret=mirror_callback_secret,
                                )
                                STATE.completed = index + 1
                                if api_result.get("updated"):
                                    STATE.updated += 1
                            else:
                                STATE.completed = index + 1
                            continue
                        except Exception as retry_exc:
                            STATE.last_message = (
                                f"오류 ({index + 1}/{len(items)}): {retry_exc}"
                            )
                    else:
                        STATE.last_message = f"오류 ({index + 1}/{len(items)}): {exc}"
                    STATE.completed = index + 1

            time.sleep(0.4)

        with STATE.lock:
            STATE.phase = "idle"
            STATE.last_message = (
                f"네이버 ID 수집 완료 ({len(items)}건, 갱신 {STATE.updated}건)"
            )
    except Exception as exc:
        with STATE.lock:
            STATE.phase = "error"
            STATE.error = str(exc)
            STATE.last_message = str(exc)
    finally:
        try:
            driver = get_existing_driver(CONTEXT_TANK)
            if driver is not None and is_session_alive(driver):
                driver.implicitly_wait(5)
        except Exception:
            pass


def _worker_secret() -> str:
    return os.environ.get("CRAWLER_WORKER_SECRET", "").strip()


def _worker_auth_ok(headers) -> bool:
    expected = _worker_secret()
    if not expected:
        return True
    got = (headers.get("X-Crawler-Worker-Secret") or "").strip()
    return got == expected


class Handler(BaseHTTPRequestHandler):
    server_version = "TankCrawler/1.0"

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionAbortedError, BrokenPipeError):
            # UI 상태 폴링 중 이전 요청이 끊길 때 — 무시
            return

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def log_message(self, format, *args):
        return

    def _require_auth(self) -> bool:
        if _worker_auth_ok(self.headers):
            return True
        self._send_json(401, {"error": "워커 인증 실패"})
        return False

    def do_GET(self):
        path = urlparse(self.path).path
        if path != "/health" and not self._require_auth():
            return
        if path == "/health":
            try:
                from naver_crawl import NAVER_CRAWL_REVISION
            except ImportError:
                NAVER_CRAWL_REVISION = "unknown"
            self._send_json(
                200,
                {
                    "ok": True,
                    "serverRevision": CRAWLER_SERVER_REVISION,
                    "naverCrawlRevision": NAVER_CRAWL_REVISION,
                },
            )
            return
        if path == "/status":
            self._send_json(200, STATE.snapshot())
            return
        if path == "/session":
            with STATE.lock:
                busy = STATE.phase in ("collecting", "logging_in", "crawling", "starting")
                cached = STATE.cached_tank_logged_in
            logged_in = cached if cached is not None else False
            browser_ready = browser_is_ready(CONTEXT_TANK)
            if not busy:
                with selenium_lock:
                    driver = get_existing_driver(CONTEXT_TANK)
                    browser_ready = driver is not None
                    if browser_ready:
                        try:
                            logged_in = _is_logged_in_unlocked(driver)
                            with STATE.lock:
                                STATE.cached_tank_logged_in = logged_in
                        except Exception:
                            logged_in = False
            with STATE.lock:
                if logged_in and STATE.phase == "logging_in":
                    STATE.phase = "idle"
                    STATE.error = None
            self._send_json(
                200,
                {"browserReady": browser_ready, "loggedIn": logged_in},
            )
            return
        if path == "/cafe/status":
            self._send_json(200, CAFE_STATE.snapshot())
            return
        if path == "/cafe/collected-urls":
            data = _load_cafe_collected_urls()
            with CAFE_STATE.lock:
                if CAFE_STATE.collected_urls:
                    data = {
                        "cafeUrl": CAFE_STATE.cafe_url or data.get("cafeUrl", ""),
                        "collectedAt": data.get("collectedAt"),
                        "total": len(CAFE_STATE.collected_urls),
                        "urls": [
                            {
                                "url": item.get("url", ""),
                                "title": item.get("title", ""),
                                "articleId": item.get("articleId", ""),
                            }
                            for item in CAFE_STATE.collected_urls
                        ],
                    }
            self._send_json(200, {"ok": True, **data})
            return
        if path == "/cafe/session":
            naver_logged_in = False
            driver = get_existing_driver(CONTEXT_CAFE)
            browser_ready = driver is not None
            if browser_ready:
                try:
                    from naver_cafe_crawl import is_naver_logged_in

                    naver_logged_in = is_naver_logged_in(driver)
                    with CAFE_STATE.lock:
                        CAFE_STATE.naver_logged_in = naver_logged_in
                except Exception:
                    naver_logged_in = False
            self._send_json(
                200,
                {"browserReady": browser_ready, "naverLoggedIn": naver_logged_in},
            )
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if not self._require_auth():
            return
        path = urlparse(self.path).path
        body = self._read_json()

        try:
            if path == "/login":
                with STATE.lock:
                    STATE.phase = "logging_in"
                user_id = body.get("userId") or body.get("user_id")
                password = body.get("password")
                try:
                    try:
                        message = _ensure_logged_in(user_id, password)
                    except (LoginRequiredError, RuntimeError) as exc:
                        _fail_login_state(str(exc))
                        self._send_json(503, {"ok": False, "error": str(exc)})
                        return
                    with STATE.lock:
                        STATE.phase = "idle"
                        STATE.browser_ready = browser_is_ready(CONTEXT_TANK)
                        STATE.error = None
                        STATE.last_message = message
                        STATE.cached_tank_logged_in = True
                    self._send_json(
                        200,
                        {"ok": True, "message": message, "loggedIn": True},
                    )
                finally:
                    with STATE.lock:
                        if STATE.phase == "logging_in":
                            STATE.phase = "idle"
                return

            if path == "/ensure-login":
                with STATE.lock:
                    STATE.phase = "logging_in"
                user_id = body.get("userId") or body.get("user_id")
                password = body.get("password")
                try:
                    try:
                        message = _ensure_logged_in(user_id, password)
                    except (LoginRequiredError, RuntimeError) as exc:
                        _fail_login_state(str(exc))
                        self._send_json(
                            503,
                            {"ok": False, "error": str(exc), "loggedIn": False},
                        )
                        return
                    with STATE.lock:
                        STATE.phase = "idle"
                        STATE.browser_ready = browser_is_ready(CONTEXT_TANK)
                        STATE.error = None
                        STATE.last_message = message
                        STATE.cached_tank_logged_in = True
                    self._send_json(
                        200,
                        {"ok": True, "message": message, "loggedIn": True},
                    )
                finally:
                    with STATE.lock:
                        if STATE.phase == "logging_in":
                            STATE.phase = "idle"
                return

            if path == "/collect-urls":
                preset = body.get("preset", "현재")
                clear = body.get("clear", True)
                search = body.get("search")
                user_id = body.get("userId") or body.get("user_id")
                password = body.get("password")
                with STATE.lock:
                    STATE.phase = "collecting"
                    STATE.preset = preset
                    STATE.error = None

                try:
                    try:
                        if STATE.cached_tank_logged_in:
                            with selenium_lock:
                                driver = ensure_driver()
                                if _is_logged_in_unlocked(driver):
                                    login_message = "탱크옥션 로그인 상태입니다."
                                else:
                                    login_message = _ensure_logged_in(user_id, password)
                        else:
                            login_message = _ensure_logged_in(user_id, password)
                    except (LoginRequiredError, RuntimeError) as exc:
                        _fail_login_state(str(exc))
                        self._send_json(503, {"ok": False, "error": str(exc), "urls": []})
                        return

                    def collect_action(driver):
                        with selenium_lock:
                            if not _is_logged_in_unlocked(driver):
                                raise LoginRequiredError(
                                    "탱크옥션 로그인이 풀렸습니다. 다시 로그인해 주세요."
                                )
                            with STATE.lock:
                                STATE.cached_tank_logged_in = True
                            driver.implicitly_wait(0)

                        def on_progress(message: str):
                            STATE.set_message(message)

                        try:
                            with selenium_lock:
                                preset_message = apply_preset(driver, preset, search)
                            with selenium_lock:
                                entries = collect_urls(
                                    driver,
                                    on_progress=on_progress,
                                    current_page_only=(preset == "현재"),
                                )
                            return preset_message, entries
                        finally:
                            with selenium_lock:
                                driver.implicitly_wait(1)

                    try:
                        message, entries = _with_live_driver(collect_action)
                    except LoginRequiredError as exc:
                        _fail_login_state(str(exc))
                        self._send_json(503, {"ok": False, "error": str(exc), "urls": []})
                        return
                    except Exception as exc:
                        if not _is_invalid_session(exc):
                            raise
                        try:
                            _ensure_logged_in(user_id, password)
                            message, entries = _with_live_driver(
                                collect_action, force_retry=False
                            )
                        except (LoginRequiredError, RuntimeError) as login_exc:
                            _fail_login_state(str(login_exc))
                            self._send_json(
                                503, {"ok": False, "error": str(login_exc), "urls": []}
                            )
                            return
                    with STATE.lock:
                        STATE.completed = 0
                        STATE.phase = "idle"
                        STATE.error = None
                        STATE.last_message = (
                            f"{login_message} / {message} ({len(entries)}건 수집)"
                        )
                    self._send_json(
                        200,
                        {"ok": True, "urls": entries, "message": STATE.last_message},
                    )
                finally:
                    with STATE.lock:
                        if STATE.phase == "collecting":
                            STATE.phase = "idle"
                return

            if path == "/urls":
                urls = body.get("urls", [])
                with STATE.lock:
                    STATE.urls = urls
                    STATE.total = len(urls)
                self._send_json(200, {"ok": True, "urls": STATE.urls})
                return

            if path == "/crawl/start":
                urls = body.get("urls") or [
                    entry["url"] if isinstance(entry, dict) else entry
                    for entry in STATE.urls
                ]
                if not urls:
                    self._send_json(400, {"error": "조회할 URL이 없습니다."})
                    return

                if STATE.crawl_thread and STATE.crawl_thread.is_alive():
                    self._send_json(409, {"error": "이미 조회가 진행 중입니다."})
                    return

                callback_url = body.get("callbackUrl") or body.get("callback_url")
                callback_secret = body.get("callbackSecret") or body.get("callback_secret")
                mirror_callback_url = body.get("mirrorCallbackUrl") or body.get("mirror_callback_url")
                mirror_callback_secret = body.get("mirrorCallbackSecret") or body.get("mirror_callback_secret")
                user_id = body.get("userId") or body.get("user_id")
                password = body.get("password")
                STATE.crawl_thread = threading.Thread(
                    target=crawl_worker,
                    args=(
                        urls,
                        callback_url,
                        callback_secret,
                        mirror_callback_url,
                        mirror_callback_secret,
                        user_id,
                        password,
                    ),
                    daemon=True,
                )
                STATE.crawl_thread.start()
                self._send_json(
                    200,
                    {"ok": True, "message": f"조회를 시작합니다 ({len(urls)}건)."},
                )
                return

            if path == "/crawl/stop":
                with STATE.lock:
                    STATE.stop_requested = True
                    if STATE.phase == "crawling":
                        STATE.last_message = (
                            "중단 요청 접수 — 현재 물건 조회를 멈추는 중…"
                        )
                    else:
                        STATE.last_message = "중단 요청을 접수했습니다."
                self._send_json(200, {"ok": True})
                return

            if path == "/crawl/backfill-naver-id":
                items = body.get("items") or []
                if not items:
                    self._send_json(400, {"error": "수집할 물건이 없습니다."})
                    return

                if STATE.crawl_thread and STATE.crawl_thread.is_alive():
                    self._send_json(409, {"error": "이미 조회가 진행 중입니다."})
                    return

                callback_url = body.get("callbackUrl") or body.get("callback_url")
                callback_secret = body.get("callbackSecret") or body.get("callback_secret")
                mirror_callback_url = body.get("mirrorCallbackUrl") or body.get("mirror_callback_url")
                mirror_callback_secret = body.get("mirrorCallbackSecret") or body.get("mirror_callback_secret")
                STATE.crawl_thread = threading.Thread(
                    target=naver_id_backfill_worker,
                    args=(
                        items,
                        callback_url,
                        callback_secret,
                        mirror_callback_url,
                        mirror_callback_secret,
                    ),
                    daemon=True,
                )
                STATE.crawl_thread.start()
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "message": f"네이버 ID 수집을 시작합니다 ({len(items)}건).",
                    },
                )
                return

            if path == "/cafe/login":
                user_id, password = _naver_credentials(body)
                if not user_id or not password:
                    self._send_json(
                        400,
                        {"ok": False, "error": "네이버 ID와 비밀번호를 입력해 주세요."},
                    )
                    return
                try:
                    from browser import (
                        CONTEXT_CAFE,
                        ensure_cafe_driver,
                        profile_dir_for,
                        restart_cafe_browser,
                    )
                    from naver_cafe_crawl import (
                        NAVER_LOGIN_PAGE,
                        NaverLoginRequiredError,
                        is_naver_logged_in,
                        login_naver,
                    )

                    with CAFE_DRIVER_LOCK:
                        try:
                            driver = ensure_cafe_driver(navigate=NAVER_LOGIN_PAGE)
                        except Exception:
                            driver = restart_cafe_browser(navigate=NAVER_LOGIN_PAGE)
                        try:
                            message = login_naver(driver, user_id, password)
                            logged_in = is_naver_logged_in(driver)
                        except NaverLoginRequiredError as exc:
                            logged_in = is_naver_logged_in(driver, allow_navigate=True)
                            with CAFE_STATE.lock:
                                CAFE_STATE.naver_logged_in = logged_in
                            self._send_json(
                                200,
                                {
                                    "ok": logged_in,
                                    "naverLoggedIn": logged_in,
                                    "needsManualAuth": not logged_in,
                                    "message": str(exc),
                                },
                            )
                            return

                    with CAFE_STATE.lock:
                        CAFE_STATE.naver_logged_in = logged_in
                    self._send_json(
                        200,
                        {
                            "ok": True,
                            "message": message,
                            "naverLoggedIn": logged_in,
                            "profileDir": profile_dir_for(CONTEXT_CAFE),
                        },
                    )
                except Exception as exc:
                    self._send_json(
                        500,
                        {"ok": False, "error": str(exc), "browserError": True},
                    )
                return

            if path == "/cafe/browser/restart":
                try:
                    from browser import (
                        CONTEXT_CAFE,
                        profile_dir_for,
                        restart_cafe_browser,
                    )
                    from naver_cafe_crawl import NAVER_LOGIN_PAGE, is_naver_logged_in

                    navigate = (
                        body.get("navigate")
                        or body.get("url")
                        or NAVER_LOGIN_PAGE
                    )
                    with CAFE_DRIVER_LOCK:
                        driver = restart_cafe_browser(navigate=navigate)
                        logged_in = is_naver_logged_in(driver)
                    with CAFE_STATE.lock:
                        CAFE_STATE.naver_logged_in = logged_in
                    self._send_json(
                        200,
                        {
                            "ok": True,
                            "message": "카페용 Chrome을 재시작했습니다.",
                            "naverLoggedIn": logged_in,
                            "currentUrl": driver.current_url or "",
                            "profileDir": profile_dir_for(CONTEXT_CAFE),
                        },
                    )
                except Exception as exc:
                    self._send_json(
                        500,
                        {"ok": False, "error": str(exc), "browserError": True},
                    )
                return

            if path == "/cafe/open-login":
                try:
                    from browser import (
                        CONTEXT_CAFE,
                        profile_dir_for,
                        restart_cafe_browser,
                    )
                    from naver_cafe_crawl import (
                        NAVER_LOGIN_PAGE,
                        is_naver_logged_in,
                        open_naver_login,
                    )

                    with CAFE_DRIVER_LOCK:
                        try:
                            from browser import ensure_cafe_driver

                            driver = ensure_cafe_driver(navigate=NAVER_LOGIN_PAGE)
                        except Exception:
                            driver = restart_cafe_browser(navigate=NAVER_LOGIN_PAGE)
                        message = open_naver_login(driver)
                        logged_in = is_naver_logged_in(driver)
                    with CAFE_STATE.lock:
                        CAFE_STATE.naver_logged_in = logged_in
                    self._send_json(
                        200,
                        {
                            "ok": True,
                            "message": message,
                            "naverLoggedIn": logged_in,
                            "profileDir": profile_dir_for(CONTEXT_CAFE),
                        },
                    )
                except Exception as exc:
                    self._send_json(
                        500,
                        {"ok": False, "error": str(exc), "browserError": True},
                    )
                return

            if path == "/cafe/open":
                cafe_url = (
                    body.get("cafeUrl")
                    or body.get("cafe_url")
                    or "https://cafe.naver.com/0113053470"
                )
                try:
                    from browser import ensure_cafe_driver
                    from naver_cafe_crawl import open_cafe, is_naver_logged_in

                    driver = ensure_cafe_driver(navigate=cafe_url)
                    message = open_cafe(driver, cafe_url)
                    logged_in = is_naver_logged_in(driver)
                    if not logged_in:
                        user_id, password = _naver_credentials(body)
                        if user_id and password:
                            from naver_cafe_crawl import ensure_naver_login

                            ensure_naver_login(driver, user_id, password)
                            logged_in = is_naver_logged_in(driver)
                    with CAFE_STATE.lock:
                        CAFE_STATE.cafe_url = cafe_url
                        CAFE_STATE.naver_logged_in = logged_in
                    self._send_json(
                        200,
                        {"ok": True, "message": message, "naverLoggedIn": logged_in},
                    )
                except Exception as exc:
                    self._send_json(500, {"ok": False, "error": str(exc)})
                return

            if path == "/cafe/check-login":
                try:
                    from naver_cafe_crawl import is_naver_logged_in

                    with CAFE_DRIVER_LOCK:
                        driver = get_existing_driver(CONTEXT_CAFE) or ensure_cafe_driver()
                        logged_in = is_naver_logged_in(driver)
                        if not logged_in:
                            logged_in = is_naver_logged_in(driver, allow_navigate=True)
                    with CAFE_STATE.lock:
                        CAFE_STATE.naver_logged_in = logged_in
                    if logged_in:
                        message = "네이버 로그인 확인됨 (카페 전용 Chrome)"
                    else:
                        message = (
                            "네이버 로그인이 필요합니다. "
                            "「로그인 페이지 열기」로 연 Chrome 창에서 로그인해 주세요."
                        )
                    self._send_json(
                        200,
                        {"ok": True, "naverLoggedIn": logged_in, "message": message},
                    )
                except Exception as exc:
                    self._send_json(500, {"ok": False, "error": str(exc)})
                return

            if path == "/cafe/collect-urls/start":
                if CAFE_STATE.crawl_thread and CAFE_STATE.crawl_thread.is_alive():
                    self._send_json(409, {"error": "이미 카페 작업이 진행 중입니다."})
                    return

                cafe_url = (
                    body.get("cafeUrl")
                    or body.get("cafe_url")
                    or "https://cafe.naver.com/0113053470"
                )
                max_articles = int(body.get("maxArticles") or body.get("max_articles") or 50)
                max_pages = int(body.get("maxPages") or body.get("max_pages") or 5)
                naver_user_id, naver_password = _naver_credentials(body)
                known_urls = body.get("knownUrls") or body.get("known_urls") or []
                known_article_ids = (
                    body.get("knownArticleIds") or body.get("known_article_ids") or []
                )

                CAFE_STATE.crawl_thread = threading.Thread(
                    target=cafe_collect_urls_worker,
                    args=(
                        cafe_url,
                        max(1, min(max_articles, 500)),
                        max(1, min(max_pages, 50)),
                        naver_user_id,
                        naver_password,
                        known_urls,
                        known_article_ids,
                    ),
                    daemon=True,
                )
                CAFE_STATE.crawl_thread.start()
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "message": f"글 URL 수집을 시작합니다 (최대 {max_articles}건).",
                    },
                )
                return

            if path == "/cafe/crawl/start":
                if CAFE_STATE.crawl_thread and CAFE_STATE.crawl_thread.is_alive():
                    self._send_json(409, {"error": "이미 카페 수집이 진행 중입니다."})
                    return

                cafe_url = (
                    body.get("cafeUrl")
                    or body.get("cafe_url")
                    or "https://cafe.naver.com/0113053470"
                )
                max_articles = int(body.get("maxArticles") or body.get("max_articles") or 30)
                max_pages = int(body.get("maxPages") or body.get("max_pages") or 5)
                callback_url = body.get("callbackUrl") or body.get("callback_url")
                callback_secret = body.get("callbackSecret") or body.get("callback_secret")
                naver_user_id, naver_password = _naver_credentials(body)
                known_urls = body.get("knownUrls") or body.get("known_urls") or []
                known_article_ids = (
                    body.get("knownArticleIds") or body.get("known_article_ids") or []
                )

                CAFE_STATE.crawl_thread = threading.Thread(
                    target=cafe_crawl_worker,
                    args=(
                        cafe_url,
                        max(1, min(max_articles, 200)),
                        max(1, min(max_pages, 50)),
                        callback_url,
                        callback_secret,
                        naver_user_id,
                        naver_password,
                        known_urls,
                        known_article_ids,
                    ),
                    daemon=True,
                )
                CAFE_STATE.crawl_thread.start()
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "message": f"카페 수집을 시작합니다 (최대 {max_articles}건).",
                    },
                )
                return

            if path == "/cafe/crawl/stop":
                with CAFE_STATE.lock:
                    CAFE_STATE.stop_requested = True
                    CAFE_STATE.last_message = "카페 수집 중단 요청을 접수했습니다."
                self._send_json(200, {"ok": True})
                return

            if path == "/cafe/crawl/single":
                if CAFE_STATE.crawl_thread and CAFE_STATE.crawl_thread.is_alive():
                    self._send_json(409, {"error": "이미 카페 수집이 진행 중입니다."})
                    return

                article_url = (
                    body.get("articleUrl")
                    or body.get("article_url")
                    or ""
                ).strip()
                if not article_url or "cafe.naver.com" not in article_url:
                    self._send_json(
                        400,
                        {"error": "카페 글 URL을 입력해 주세요. (cafe.naver.com)"},
                    )
                    return

                cafe_url = (
                    body.get("cafeUrl")
                    or body.get("cafe_url")
                    or "https://cafe.naver.com/0113053470"
                )
                callback_url = body.get("callbackUrl") or body.get("callback_url")
                callback_secret = body.get("callbackSecret") or body.get("callback_secret")
                naver_user_id, naver_password = _naver_credentials(body)

                def run_single():
                    try:
                        cafe_single_article_worker(
                            article_url,
                            cafe_url,
                            callback_url,
                            callback_secret,
                            naver_user_id,
                            naver_password,
                        )
                    except Exception:
                        pass

                CAFE_STATE.crawl_thread = threading.Thread(
                    target=run_single,
                    daemon=True,
                )
                CAFE_STATE.crawl_thread.start()
                self._send_json(
                    200,
                    {"ok": True, "message": "단일 글 수집을 시작합니다."},
                )
                return

            if path == "/shutdown":
                with STATE.lock:
                    STATE.stop_requested = True
                    STATE.browser_ready = False
                close_driver()
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                self._send_json(200, {"ok": True})
                return

            self._send_json(404, {"error": "not found"})
        except Exception as exc:
            with STATE.lock:
                STATE.phase = "error"
                STATE.error = str(exc)
            self._send_json(500, {"error": str(exc)})


def run_server():
    port = int(os.environ.get("CRAWLER_WORKER_PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Crawler worker listening on http://127.0.0.1:{port}", flush=True)
    server.serve_forever()
