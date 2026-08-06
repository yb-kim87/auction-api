"""나이스옥션(niceauction.co.kr) HTTPX 클라이언트 — 비로그인으로 물건 상세
전체 데이터를 받아올 수 있음을 실측 확인(2026-07-26,
docs/niceauction-integration-research.md 참고). 탱크옥션(로그인 방식)을
대체하기 위한 1단계 크롤러.

핵심 엔드포인트:
  - GET /api/v1/obj/{objId}?privacy=true   : 물건 상세 전체 데이터(비로그인 가능)
  - GET /api/v1/site/sitemap                : sitemap index
  - GET /api/v1/site/sitemap/{objType}/{page} : objId 목록(페이지당 최대 3만 건)
"""

from __future__ import annotations

import re

import httpx

from exceptions import NonRetryableError, RetryableError

BASE_URL = "https://niceauction.co.kr"
CRAWL_TIMEOUT = 30.0

DEFAULT_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
    ),
    # 이전엔 sec-ch-ua 3종만 넣었는데 그래도 비회원 12건 한도(2026-07-30
    # 실측)에 걸렸다. 2026-08-06 실제 브라우저 캡처 헤더(Sec-Fetch-*,
    # Priority, GA 쿠키)를 그대로 추가하고 http2=True로 붙였더니 100건
    # 연속 성공(code=0)했다 — 이 전체 세트가 진짜 필요조건으로 보인다.
    # Referer는 물건마다 달라야 해서 여기 기본값 대신 fetch_obj_detail에서
    # 매번 채운다. Cookie는 로그인 세션이 아니라 GA 트래킹 쿠키일 뿐이라
    # 계정 없이도 동작한다(실측 확인).
    "Sec-Ch-Ua": '"Not-A.Brand";v="24", "Chromium";v="146"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Priority": "u=1, i",
    "Cookie": (
        "_ga=GA1.1.157066428.1785904692; "
        "_ga_MGNYXFKQXH=GS2.1.s1785904691$o1$g1$t1785904860$j13$l0$h0"
    ),
}

# 경매(76000001)만 대상 — 공매/기타는 이번 범위 밖.
OBJ_TYPE_AUCTION = "76000001"


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=BASE_URL,
        headers=DEFAULT_HEADERS,
        timeout=CRAWL_TIMEOUT,
        http2=True,
    )


async def fetch_obj_detail(client: httpx.AsyncClient, obj_id: str) -> dict:
    headers = {"Referer": f"{BASE_URL}/auction/detail/{obj_id}"}
    try:
        resp = await client.get(
            f"/api/v1/obj/{obj_id}", params={"privacy": "true"}, headers=headers
        )
    except httpx.TimeoutException as exc:
        raise RetryableError(f"나이스옥션 상세 API 타임아웃(objId={obj_id}): {exc}") from exc
    except httpx.TransportError as exc:
        raise RetryableError(f"나이스옥션 상세 API 연결 오류(objId={obj_id}): {exc}") from exc
    if resp.status_code >= 400:
        raise RetryableError(
            f"나이스옥션 상세 API HTTP {resp.status_code}(objId={obj_id})"
        )
    try:
        body = resp.json()
    except ValueError as exc:
        raise NonRetryableError(
            f"나이스옥션 상세 API 응답 파싱 실패(objId={obj_id}): {exc}"
        ) from exc
    if body.get("code") != 0:
        raise NonRetryableError(
            f"나이스옥션 상세 API 오류 응답(objId={obj_id}): {body.get('msg')}"
        )
    return body.get("data", {}).get("obj", {})


_LOC_RE = re.compile(r"<loc>https://niceauction\.co\.kr/auction/detail/(\d+)</loc>")


async def fetch_sitemap_page_obj_ids(
    client: httpx.AsyncClient, obj_type: str, page: int
) -> list[str]:
    """sitemap 페이지 하나(최대 약 3만 건)에서 objId만 추출."""
    resp = await client.get(f"/api/v1/site/sitemap/{obj_type}/{page}")
    if resp.status_code >= 400:
        raise RetryableError(
            f"나이스옥션 sitemap 페이지 HTTP {resp.status_code}(type={obj_type}, page={page})"
        )
    return _LOC_RE.findall(resp.text)
