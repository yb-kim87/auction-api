import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import requests

import importlib

from browser import browser_is_ready, close_driver, ensure_driver
import item_crawl
from tank_login import ensure_login, is_logged_in, login
from url_collect import apply_preset, collect_urls

CRAWLER_SERVER_REVISION = "2026-06-28-naver-id-backfill"


def _reload_crawler_modules():
    """워커 재시작 없이 crawler/*.py 변경 반영."""
    import naver_crawl

    importlib.reload(naver_crawl)
    importlib.reload(item_crawl)
    return item_crawl.crawl_item


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

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "phase": self.phase,
                "browserReady": browser_is_ready(),
                "urls": list(self.urls),
                "completed": self.completed,
                "total": self.total,
                "created": self.created,
                "updated": self.updated,
                "preset": self.preset,
                "error": self.error,
                "lastMessage": self.last_message,
            }

    def set_message(self, message: str):
        with self.lock:
            self.last_message = message


STATE = CrawlerState()


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


def _with_live_driver(action, force_retry: bool = True):
    try:
        driver = ensure_driver()
        return action(driver)
    except Exception as exc:
        if force_retry and _is_invalid_session(exc):
            driver = ensure_driver(force_new=True)
            return action(driver)
        raise


def post_item_to_api(item: dict):
    callback = os.environ.get(
        "CRAWLER_CALLBACK_URL",
        "http://127.0.0.1:3001/crawler/import-item",
    )
    secret = os.environ.get("CRAWLER_SECRET", "local-crawler-secret")
    payload = {**item, "submittedBy": "crawler"}
    res = requests.post(
        callback,
        json=payload,
        headers={"X-Crawler-Secret": secret, "Content-Type": "application/json"},
        timeout=30,
    )
    res.raise_for_status()
    return res.json()


def post_naver_id_to_api(auction_no: str, naver_id: str) -> dict:
    callback = os.environ.get(
        "CRAWLER_CALLBACK_URL",
        "http://127.0.0.1:3001/crawler/import-item",
    )
    base = callback.rsplit("/", 1)[0]
    secret = os.environ.get("CRAWLER_SECRET", "local-crawler-secret")
    res = requests.post(
        f"{base}/import-naver-id",
        json={
            "auctionNo": auction_no,
            "naverId": naver_id,
            "submittedBy": "crawler-naver-backfill",
        },
        headers={"X-Crawler-Secret": secret, "Content-Type": "application/json"},
        timeout=30,
    )
    res.raise_for_status()
    return res.json()


def crawl_worker(urls: list[str]):
    try:
        with STATE.lock:
            STATE.phase = "crawling"
            STATE.completed = 0
            STATE.total = len(urls)
            STATE.stop_requested = False
            STATE.error = None

        crawl_item = _reload_crawler_modules()
        driver = ensure_driver()
        driver.implicitly_wait(1)

        for index, entry in enumerate(urls):
            with STATE.lock:
                if STATE.stop_requested:
                    STATE.phase = "stopped"
                    STATE.last_message = "사용자 요청으로 조회가 중단되었습니다."
                    return

            try:
                if not browser_is_ready():
                    driver = ensure_driver(force_new=True)
                    driver.implicitly_wait(1)
                crawl_item = _reload_crawler_modules()
                item = crawl_item(driver, entry)
                result = post_item_to_api(item)
                with STATE.lock:
                    STATE.completed = index + 1
                    if result.get("created"):
                        STATE.created += 1
                    elif not result.get("skipped"):
                        STATE.updated += 1
                    naver_note = ""
                    if not item.get("naver_lowest_price"):
                        detail = str(item.get("naver_price_detail") or "").strip()
                        area = str(item.get("area") or "")
                        if detail:
                            naver_note = f" (네이버: {detail[:60]})"
                        elif area in ("0", "없음", ""):
                            naver_note = " (면적 미수집)"
                    STATE.last_message = (
                        f"[{index + 1}/{len(urls)}] "
                        f"{item.get('auctionNo') or item.get('address')}"
                        f"{naver_note}"
                    )
            except Exception as exc:
                with STATE.lock:
                    if _is_invalid_session(exc):
                        STATE.last_message = (
                            f"브라우저 세션 만료 — 재연결 후 재시도 ({index + 1}/{len(urls)})"
                        )
                        try:
                            driver = ensure_driver(force_new=True)
                            driver.implicitly_wait(1)
                            item = crawl_item(driver, entry)
                            result = post_item_to_api(item)
                            STATE.completed = index + 1
                            if result.get("created"):
                                STATE.created += 1
                            elif not result.get("skipped"):
                                STATE.updated += 1
                            continue
                        except Exception as retry_exc:
                            STATE.last_message = f"오류 ({index + 1}/{len(urls)}): {retry_exc}"
                    else:
                        STATE.last_message = f"오류 ({index + 1}/{len(urls)}): {exc}"

            time.sleep(0.4)

        with STATE.lock:
            STATE.phase = "idle"
            STATE.last_message = f"조회 완료 ({len(urls)}건)"
    except Exception as exc:
        with STATE.lock:
            STATE.phase = "error"
            STATE.error = str(exc)
            STATE.last_message = str(exc)
    finally:
        try:
            from browser import _driver, is_session_alive

            if _driver is not None and is_session_alive(_driver):
                _driver.implicitly_wait(5)
        except Exception:
            pass


def naver_id_backfill_worker(items: list[dict]):
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
                if not browser_is_ready():
                    driver = ensure_driver(force_new=True)
                    driver.implicitly_wait(1)
                importlib.reload(item_crawl)
                fetch_naver_id_only = item_crawl.fetch_naver_id_only
                result = fetch_naver_id_only(driver, url)
                naver_id = str(result.get("naver_id") or "").strip()
                note = ""
                if naver_id and auction_no:
                    api_result = post_naver_id_to_api(auction_no, naver_id)
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
                                api_result = post_naver_id_to_api(auction_no, naver_id)
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
            from browser import _driver, is_session_alive

            if _driver is not None and is_session_alive(_driver):
                _driver.implicitly_wait(5)
        except Exception:
            pass


class Handler(BaseHTTPRequestHandler):
    server_version = "TankCrawler/1.0"

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def log_message(self, format, *args):
        return

    def do_GET(self):
        path = urlparse(self.path).path
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
            logged_in = False
            browser_ready = browser_is_ready()
            if browser_ready:
                try:
                    from browser import _driver

                    logged_in = is_logged_in(_driver)
                except Exception:
                    logged_in = False
            self._send_json(
                200,
                {"browserReady": browser_ready, "loggedIn": logged_in},
            )
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        body = self._read_json()

        try:
            if path == "/login":
                with STATE.lock:
                    STATE.phase = "logging_in"
                user_id = body.get("userId") or body.get("user_id")
                password = body.get("password")
                message = _run_login(user_id, password)
                with STATE.lock:
                    STATE.phase = "idle"
                    STATE.browser_ready = browser_is_ready()
                    STATE.last_message = message
                self._send_json(200, {"ok": True, "message": message})
                return

            if path == "/ensure-login":
                with STATE.lock:
                    STATE.phase = "logging_in"
                user_id = body.get("userId") or body.get("user_id")
                password = body.get("password")
                message = _run_login(user_id, password)
                with STATE.lock:
                    STATE.phase = "idle"
                    STATE.browser_ready = browser_is_ready()
                    STATE.last_message = message
                self._send_json(
                    200,
                    {"ok": True, "message": message, "loggedIn": True},
                )
                return

            if path == "/collect-urls":
                preset = body.get("preset", "현재")
                clear = body.get("clear", True)
                search = body.get("search")
                with STATE.lock:
                    STATE.phase = "collecting"
                    STATE.preset = preset

                def collect_action(driver):
                    try:
                        driver.implicitly_wait(0)
                        message = apply_preset(driver, preset, search)
                        entries = collect_urls(driver)
                        return message, entries
                    finally:
                        driver.implicitly_wait(1)

                try:
                    message, entries = _with_live_driver(collect_action)
                except Exception as exc:
                    if not _is_invalid_session(exc):
                        raise
                    message, entries = _with_live_driver(
                        collect_action, force_retry=False
                    )
                with STATE.lock:
                    STATE.completed = 0
                    STATE.phase = "idle"
                    STATE.last_message = f"{message} ({len(entries)}건 수집)"
                self._send_json(
                    200,
                    {"ok": True, "urls": entries, "message": STATE.last_message},
                )
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

                STATE.crawl_thread = threading.Thread(
                    target=crawl_worker, args=(urls,), daemon=True
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

                STATE.crawl_thread = threading.Thread(
                    target=naver_id_backfill_worker, args=(items,), daemon=True
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
