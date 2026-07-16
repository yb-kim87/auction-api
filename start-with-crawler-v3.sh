#!/bin/sh
# NestJS API 와 Python v3(HTTPX 전용, selenium 없음) 크롤러 워커를 같은
# 컨테이너에서 함께 실행. 워커는 백그라운드로 띄우고 API 프로세스를
# 포그라운드로 유지 — 둘 중 하나가 죽으면 Railway 의 재시작 정책이
# 컨테이너 전체를 재시작하도록 exec 로 API 를 마지막에 실행한다.

set -e

echo "[start] launching crawler v3 worker (python, no selenium)..."
python3 crawler/server_v3.py &
CRAWLER_PID=$!

echo "[start] launching NestJS API..."
exec node dist/main
