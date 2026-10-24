# -*- coding: utf-8 -*-
"""new.land.naver.com 호출용 curl_cffi 브릿지.

Node의 기본 fetch(undici)는 TLS/HTTP2 핑거프린트가 실제 Chrome과 달라
Bearer 토큰/쿠키가 정상이어도 /api/* 호출 첫 요청부터 429(TOO_MANY_REQUESTS)로
차단당한다(실측 확인, 2026-09-12). curl_cffi로 Chrome 핑거프린트를 재현하면
정상 응답한다 — 코치픽(auction-api) 프로젝트의 crawler/naver_httpx.py에서
fin.land.naver.com에 적용해 검증된 것과 동일한 해법을 new.land.naver.com에도
적용한 것.

stdin으로 JSON 한 줄을 받아 stdout으로 JSON 한 줄을 반환한다(요청당 1회 프로세스).
{"action": "warmup", "complexNo": "12647"}
  -> {"ok": true, "token": "...", "cookie": "k=v; k2=v2"} 또는 {"ok": false, "status": N}

{"action": "get", "url": "...", "headers": {...}}
  -> {"ok": true, "status": 200, "body": "..."}
"""

import json
import re
import sys

from curl_cffi import requests as curl_requests

NEW_LAND = "https://new.land.naver.com"
TIMEOUT_SEC = 10


def _make_session():
    return curl_requests.Session(impersonate="chrome124", timeout=TIMEOUT_SEC)


def do_warmup(payload):
    complex_no = payload["complexNo"]
    session = _make_session()
    res = session.get(f"{NEW_LAND}/complexes/{complex_no}")
    if res.status_code != 200:
        return {"ok": False, "status": res.status_code}

    html = res.text
    token_match = re.search(r'"token"\s*:\s*\{\s*"token"\s*:\s*"([^"]+)"', html) or re.search(
        r"eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}", html
    )
    token = token_match.group(1) if token_match and token_match.lastindex else (
        token_match.group(0) if token_match else None
    )
    if not token:
        return {"ok": False, "status": res.status_code, "reason": "no_token"}

    cookie_dict = session.cookies.get_dict()
    cookie = "; ".join(f"{k}={v}" for k, v in cookie_dict.items())
    return {"ok": True, "token": token, "cookie": cookie}


def do_get(payload):
    url = payload["url"]
    headers = payload.get("headers") or {}
    session = _make_session()
    res = session.get(url, headers=headers)
    return {"ok": True, "status": res.status_code, "body": res.text}


def main():
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "reason": f"invalid_input: {exc}"}))
        return

    action = payload.get("action")
    try:
        if action == "warmup":
            result = do_warmup(payload)
        elif action == "get":
            result = do_get(payload)
        else:
            result = {"ok": False, "reason": f"unknown_action: {action}"}
    except Exception as exc:  # noqa: BLE001 — 호출부(Node)가 이유를 알 수 있게 문자열로 전달
        result = {"ok": False, "reason": str(exc)}

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
