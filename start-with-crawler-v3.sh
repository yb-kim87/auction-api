#!/bin/sh
# NestJS API 와 Python v3(HTTPX 전용, selenium 없음) 크롤러 워커를 같은
# 컨테이너에서 함께 실행. 워커는 백그라운드로 띄우고 API 프로세스를
# 포그라운드로 유지 — 둘 중 하나가 죽으면 Railway 의 재시작 정책이
# 컨테이너 전체를 재시작하도록 exec 로 API 를 마지막에 실행한다.

set -e

# curl_cffi(네이티브 확장, naver_httpx.py 가 사용)가 libstdc++.so.6 을 찾도록
# Nix store 에서 stdenv.cc.cc.lib 경로를 동적으로 찾아 LD_LIBRARY_PATH 에 추가.
# nixpacks.toml 의 [phases.setup] nixPkgs 에 "stdenv.cc.cc.lib" 를 포함해야 함.
FOUND_LIB=$(find /nix/store -maxdepth 4 -name 'libstdc++.so.6' 2>/dev/null | head -n 1)
if [ -n "$FOUND_LIB" ]; then
  STDCXX_LIB_DIR=$(dirname "$FOUND_LIB")
  export LD_LIBRARY_PATH="$STDCXX_LIB_DIR:$LD_LIBRARY_PATH"
  echo "[start] LD_LIBRARY_PATH set to include $STDCXX_LIB_DIR (found: $FOUND_LIB)"
else
  echo "[start] WARNING: libstdc++.so.6 not found under /nix/store (maxdepth 4) — curl_cffi may fail"
  echo "[start] debug: listing /nix/store top-level entries containing 'gcc' or 'stdenv'"
  ls /nix/store 2>/dev/null | grep -iE 'gcc|stdenv' | head -20
fi

echo "[start] launching crawler v3 worker (python, no selenium)..."
/opt/venv-v3/bin/python3 crawler/server_v3.py &
CRAWLER_PID=$!

echo "[start] launching NestJS API..."
exec node dist/main
