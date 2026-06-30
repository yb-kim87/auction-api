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

from server import run_server


def main():
    if len(sys.argv) < 2 or sys.argv[1] != "serve":
        print("Usage: python runner.py serve", file=sys.stderr)
        sys.exit(1)
    run_server()


if __name__ == "__main__":
    main()
