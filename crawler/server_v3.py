"""v3(완전 HTTPX) 전용 경량 워커 서버 — selenium/Chrome 없이 동작.

server.py(기존 Selenium 워커)와 별개의 프로세스로 존재한다. 이 서버는
full_httpx_worker.py 외에는 아무 것도 import하지 않으며, browser.py나
naver_crawl.py, item_crawl.py(모두 selenium 의존)를 전혀 참조하지 않는다
— 이게 이 파일의 존재 이유(Chrome 설치 없는 환경, 예: Railway 컨테이너에
배포하기 위함).

관리자 PC(server.py, /crawl/start, /crawl/start-v2)와는 완전히 독립적으로
동작한다. /crawl/start-v3 하나만 지원하며, 기존 워커 프로토콜(JSON
POST/GET, X-Crawler-Worker-Secret 인증)은 동일하게 맞춰 crawler.service.ts
쪽 수정을 최소화한다.
"""

from __future__ import annotations

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

def _load_dotenv() -> None:
    """runner.py 와 동일한 최소 .env 파서 — 로컬 개발용. Railway 등 실제
    배포 환경에서는 플랫폼이 제공하는 환경변수를 그대로 쓰므로 이 파일이
    없어도 무방하다(존재하지 않으면 조용히 넘어감)."""
    from pathlib import Path

    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv()

import asyncio
import json as json_module

from full_httpx_worker import full_httpx_crawl_worker
from http_client import LoginCredentialsMissing, login, make_client
from http_client import fetch_favorite_searches, fetch_list_page_with_preset
from presets_httpx import (
    UnsupportedPresetError,
    build_query_from_search_config,
    list_response_to_url_entries,
    parse_favorite_search_param,
    PA_LIST_PATH,
)
from tank_detail import tid_from_url


async def _collect_urls_v3(
    api_path: str, params: dict, *, is_public: bool, data_size: int
) -> list[dict]:
    """로그인 후 목록 API를 (필요하면 여러 페이지) 조회해 URL 엔트리로 변환.

    url_collect.py: collect_urls() 의 HTTPX 버전 — 단, 브라우저 화면
    페이지네이션이 없으므로 totalCount 를 보고 필요한 페이지 수만큼 반복
    호출한다. 무한 루프 방지를 위해 최대 50페이지(=5,000건)로 상한을 둔다.
    """
    async with make_client() as client:
        await login(client)

        entries: list[dict] = []
        page_no = 1
        max_pages = 50
        while page_no <= max_pages:
            data = await fetch_list_page_with_preset(
                client, api_path, params, page_no=page_no, data_size=data_size
            )
            page_entries = list_response_to_url_entries(data, is_public=is_public)
            if not page_entries:
                break
            entries.extend(page_entries)

            total_count = data.get("totalCount") or data.get("total") or 0
            try:
                total_count = int(total_count)
            except (TypeError, ValueError):
                total_count = 0
            if total_count and len(entries) >= total_count:
                break
            if len(page_entries) < data_size:
                break
            page_no += 1

        return entries


async def _check_tank_login_v3() -> bool:
    """자격증명(TANKAUCTION_ID/PW)으로 실제 로그인이 되는지 1회 확인.

    v3는 요청마다 자체 로그인하는 무상태(stateless) 구조라 "로그인 상태
    유지"라는 개념 자체가 없다 — 이 함수는 세션을 남기지 않고 자격증명이
    유효한지만 검증한다. 관리자 화면에서 "탱크옥션 로그인 확인" 버튼을
    눌러 즐겨찾기 조회/주소추가를 활성화하기 전에 먼저 통과시키는 게이트
    로 사용한다.
    """
    async with make_client() as client:
        await login(client)
    return True


async def _count_search_results_v3(api_path: str, params: dict) -> int:
    """주소 추가 실행 없이 조건에 맞는 물건이 몇 건인지만 확인.

    관심조건/즐겨찾기 선택 직후 "이 조건으로 몇 건 나오는지" 미리
    보여주기 위한 용도 — dataSize=1로 최소한만 조회해 totalCount 만
    읽는다(전체 목록을 긁지 않아 가볍다).
    """
    async with make_client() as client:
        await login(client)
        data = await fetch_list_page_with_preset(
            client, api_path, params, page_no=1, data_size=1
        )
    total_count = data.get("totalCount") or data.get("total") or 0
    try:
        return int(total_count)
    except (TypeError, ValueError):
        return 0


async def _fetch_favorite_searches_v3() -> list[dict]:
    """로그인 후 탱크옥션 "즐겨쓰는 검색" 목록을 조회해 관리자 화면에서
    바로 쓸 수 있는 형태({id, title, search}) 로 변환."""
    async with make_client() as client:
        await login(client)
        raw_items = await fetch_favorite_searches(client)

    results: list[dict] = []
    for item in raw_items:
        param_raw = item.get("param")
        if not param_raw:
            continue
        try:
            param_json = json_module.loads(param_raw)
        except (TypeError, ValueError):
            continue
        search_config = parse_favorite_search_param(param_json)
        title = item.get("user_title") or item.get("srch_tt") or f"즐겨찾기 {item.get('idx')}"
        results.append(
            {
                "id": str(item.get("idx")),
                "title": title,
                "count": item.get("srch_cnt"),
                "search": search_config,
            }
        )
    return results


class CrawlerStateV3:
    """server.py: CrawlerState 의 경량 버전 — browser.py(selenium) 참조 없음."""

    def __init__(self):
        self.lock = threading.Lock()
        self.phase = "idle"
        self.completed = 0
        self.total = 0
        self.created = 0
        self.updated = 0
        self.error: str | None = None
        self.last_message: str | None = None
        self.stop_requested = False
        self.crawl_thread: threading.Thread | None = None
        self.events: list[str] = []

    def snapshot(self) -> dict:
        with self.lock:
            events = list(self.events)
            self.events.clear()
            return {
                "phase": self.phase,
                "browserReady": False,  # v3는 브라우저를 쓰지 않음 — 항상 False
                "completed": self.completed,
                "total": self.total,
                "created": self.created,
                "updated": self.updated,
                "error": self.error,
                "lastMessage": self.last_message,
                "events": events,
            }


STATE = CrawlerStateV3()


def _crawl_should_stop() -> bool:
    with STATE.lock:
        return STATE.stop_requested


def _resolve_callback(callback_url: str | None, callback_secret: str | None) -> dict:
    return {
        "url": (
            callback_url
            or os.environ.get(
                "CRAWLER_CALLBACK_URL", "http://127.0.0.1:3001/crawler/import-item"
            )
        ).strip(),
        "secret": (
            callback_secret or os.environ.get("CRAWLER_SECRET", "local-crawler-secret")
        ).strip(),
    }


def _worker_secret() -> str:
    return os.environ.get("CRAWLER_WORKER_SECRET", "").strip()


def _worker_auth_ok(headers) -> bool:
    expected = _worker_secret()
    if not expected:
        return True
    got = (headers.get("X-Crawler-Worker-Secret") or "").strip()
    return got == expected


class Handler(BaseHTTPRequestHandler):
    server_version = "TankCrawlerV3/1.0"

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionAbortedError, BrokenPipeError):
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
        if path == "/health":
            self._send_json(200, {"ok": True, "version": "v3"})
            return
        if not self._require_auth():
            return
        if path == "/status":
            self._send_json(200, STATE.snapshot())
            return
        if path == "/tank-favorite-searches":
            try:
                items = asyncio.run(_fetch_favorite_searches_v3())
            except LoginCredentialsMissing as exc:
                self._send_json(400, {"error": str(exc)})
                return
            except Exception as exc:  # noqa: BLE001
                self._send_json(502, {"error": f"즐겨쓰는 검색 조회 실패: {exc}"})
                return
            self._send_json(200, {"ok": True, "items": items})
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if not self._require_auth():
            return
        path = urlparse(self.path).path
        body = self._read_json()

        if path == "/tank-login-check":
            try:
                asyncio.run(_check_tank_login_v3())
            except LoginCredentialsMissing as exc:
                self._send_json(400, {"error": str(exc)})
                return
            except Exception as exc:  # noqa: BLE001
                self._send_json(502, {"error": f"탱크옥션 로그인 확인 실패: {exc}"})
                return
            self._send_json(200, {"ok": True})
            return

        if path == "/count-search-v3":
            # v3는 "현재" 프리셋 개념이 없다 — 관리자 화면이 항상 완전한
            # search(CrawlerSearchConfig)를 보낸다.
            search = body.get("search")
            if not search:
                self._send_json(400, {"error": "검색조건(search)이 없습니다."})
                return
            try:
                api_path, params = build_query_from_search_config(search)
            except UnsupportedPresetError as exc:
                self._send_json(400, {"error": str(exc)})
                return

            try:
                total = asyncio.run(_count_search_results_v3(api_path, params))
            except LoginCredentialsMissing as exc:
                self._send_json(400, {"error": str(exc)})
                return
            except Exception as exc:  # noqa: BLE001
                self._send_json(502, {"error": f"건수 조회 실패: {exc}"})
                return

            self._send_json(200, {"ok": True, "total": total})
            return

        if path == "/collect-urls-v3":
            # v3는 "현재" 프리셋 개념이 없다 — 관리자 화면이 항상 완전한
            # search(CrawlerSearchConfig, 관심조건/즐겨찾기를 선택했거나
            # 직접 채운 값)를 보낸다. 고정 프리셋 이름(아파트/다가구/빌라/
            # 공매)은 이제 그 자체가 관심조건의 하나로 취급되어 search로
            # 채워져 오므로 별도 분기가 필요 없다.
            search = body.get("search")
            if not search:
                self._send_json(400, {"error": "검색조건(search)이 없습니다."})
                return
            try:
                api_path, params = build_query_from_search_config(search)
            except UnsupportedPresetError as exc:
                self._send_json(400, {"error": str(exc)})
                return

            try:
                data_size = int(search.get("pageSize")) if search and search.get("pageSize") else 100
            except (TypeError, ValueError):
                data_size = 100

            try:
                urls = asyncio.run(
                    _collect_urls_v3(api_path, params, is_public=api_path == PA_LIST_PATH, data_size=data_size)
                )
            except LoginCredentialsMissing as exc:
                self._send_json(400, {"error": str(exc)})
                return
            except Exception as exc:  # noqa: BLE001 — 워커 API는 원인 메시지를 그대로 전달
                self._send_json(502, {"error": f"목록 조회 실패: {exc}"})
                return

            self._send_json(
                200,
                {"ok": True, "urls": urls, "message": f"탱크옥션에서 {len(urls)}건을 찾았습니다."},
            )
            return

        if path == "/crawl/start-v3":
            urls = body.get("urls") or []
            if not urls:
                self._send_json(400, {"error": "조회할 URL이 없습니다."})
                return

            if STATE.crawl_thread and STATE.crawl_thread.is_alive():
                self._send_json(409, {"error": "이미 조회가 진행 중입니다."})
                return

            tids: list[str] = []
            for entry in urls:
                url = (
                    entry.split("_", 1)[-1]
                    if isinstance(entry, str) and "_" in entry
                    else entry
                )
                tid = tid_from_url(url)
                if tid:
                    tids.append(tid)
            if not tids:
                self._send_json(400, {"error": "URL에서 tid를 추출하지 못했습니다."})
                return

            cfg = _resolve_callback(
                body.get("callbackUrl") or body.get("callback_url"),
                body.get("callbackSecret") or body.get("callback_secret"),
            )

            STATE.crawl_thread = threading.Thread(
                target=full_httpx_crawl_worker,
                kwargs=dict(
                    tids=tids,
                    callback_url=cfg["url"],
                    callback_secret=cfg["secret"],
                    state=STATE,
                    should_stop=_crawl_should_stop,
                ),
                daemon=True,
            )
            STATE.crawl_thread.start()
            self._send_json(
                200,
                {"ok": True, "message": f"조회를 시작합니다 ({len(tids)}건)."},
            )
            return

        if path == "/crawl/stop":
            with STATE.lock:
                STATE.stop_requested = True
                STATE.last_message = "중단 요청을 접수했습니다."
            self._send_json(200, {"ok": True})
            return

        self._send_json(404, {"error": "not found"})


def run_server():
    port = int(os.environ.get("CRAWLER_WORKER_PORT", "8765"))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Crawler worker (v3, no-browser) listening on http://0.0.0.0:{port}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    run_server()
