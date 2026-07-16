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

from full_httpx_worker import full_httpx_crawl_worker
from tank_detail import tid_from_url


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
        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if not self._require_auth():
            return
        path = urlparse(self.path).path
        body = self._read_json()

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
                {"ok": True, "message": f"완전 HTTPX 조회를 시작합니다 ({len(tids)}건)."},
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
