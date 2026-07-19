import os
import sys
from pathlib import Path


def _load_dotenv() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.is_file():
        return

    loaded: set[str] = set()
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or key in loaded:
            continue
        loaded.add(key)
        if key not in os.environ:
            os.environ[key] = value


_load_dotenv()


def _use_v3_worker() -> bool:
    """Railway 등 클라우드 컨테이너는 Chrome이 없어 Selenium 워커(server.py)를
    띄울 수 없다 — RAILWAY_ENVIRONMENT가 있으면(플랫폼이 자동 주입) 브라우저
    없는 v3 워커(server_v3.py)를 대신 실행한다. 관리자 PC(로컬)에서는 이
    변수가 없으므로 기존 그대로 v1/v2용 server.py를 쓴다. CRAWLER_RUNTIME
    환경변수로 강제 지정도 가능하다("v3" 또는 "v1")."""
    forced = os.environ.get("CRAWLER_RUNTIME", "").strip().lower()
    if forced in ("v3", "v1"):
        return forced == "v3"
    return bool(os.environ.get("RAILWAY_ENVIRONMENT", "").strip())


def main():
    if len(sys.argv) < 2 or sys.argv[1] != "serve":
        print("Usage: python runner.py serve", file=sys.stderr)
        sys.exit(1)
    if _use_v3_worker():
        from server_v3 import run_server
    else:
        from server import run_server
    run_server()


if __name__ == "__main__":
    main()
