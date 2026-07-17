"""탱크옥션 HTTPX 정적 요청 클라이언트 (2단계: 로그인 + 목록 1건 + 상세 1건 검증용).

기존 Selenium 크롤러(tank_login.py, url_collect.py, tank_detail.py)를 대체하지
않는다. 이 파일은 병행 검증용이며, 여기서 만든 httpx.AsyncClient 는 이후
queue_manager.py / parsers/ 단계에서 재사용될 예정이다.
"""

from __future__ import annotations

import os

import httpx

from exceptions import NonRetryableError, RetryableError, SessionExpiredError

BASE_URL = "https://www.tankauction.com"
LOGIN_PATH = "/auth/res/logIn.php"
LIST_PATH = "/api/proxy/api1.php/ca/AuctList.php"
DETAIL_PATH = "/api/proxy/api1.php/ca/AuctView.php"
ENV_VIEW_PATH = "/molit/res/EnvViewData.php"

DEFAULT_HEADERS = {
    "Accept": "application/json",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Referer": f"{BASE_URL}/ca/caList.php",
    "User-Agent": (
        os.environ.get("CRAWL_USER_AGENT")
        or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
}

CRAWL_TIMEOUT = float(os.environ.get("CRAWL_TIMEOUT", "20"))


class LoginCredentialsMissing(RuntimeError):
    pass


# 7단계 이전 호환용 별칭 — 신규 코드는 exceptions.SessionExpiredError 사용
SessionInvalidError = SessionExpiredError


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=BASE_URL,
        headers=DEFAULT_HEADERS,
        timeout=CRAWL_TIMEOUT,
        follow_redirects=False,
    )


async def login(client: httpx.AsyncClient) -> None:
    """TANKAUCTION_ID / TANKAUCTION_PW 환경변수로 로그인, 쿠키는 client가 자동 보관."""
    client_id = os.environ.get("TANKAUCTION_ID")
    passwd = os.environ.get("TANKAUCTION_PW")
    if not client_id or not passwd:
        raise LoginCredentialsMissing(
            "TANKAUCTION_ID / TANKAUCTION_PW 환경변수가 설정되어 있지 않습니다."
        )

    resp = await client.post(
        LOGIN_PATH,
        data={"mode": "member", "client_id": client_id, "passwd": passwd},
    )
    resp.raise_for_status()

    if "access_token" not in client.cookies:
        raise SessionInvalidError(
            f"로그인 응답에 access_token 쿠키가 없습니다 (status={resp.status_code})."
        )


def _looks_like_login_redirect(resp: httpx.Response) -> bool:
    """정상 JSON이 아니라 로그인 페이지 HTML 등으로 리다이렉트된 경우 감지."""
    content_type = resp.headers.get("content-type", "")
    if "application/json" not in content_type:
        return True
    return False


_RETRYABLE_STATUS = {500, 502, 503, 504}


def _classify_and_raise(resp: httpx.Response, *, context: str) -> None:
    """상태코드별 차등 오류 분류 — 요청 지침의 7단계 기준을 그대로 구현.

    - 401/403: 세션만료 → SessionExpiredError (재로그인 필요, 반복 재시도 금지)
    - 404: 존재하지 않는 페이지 → NonRetryableError (재시도 안 함)
    - 429: Retry-After 헤더 확인 후 RetryableError
    - 500/502/503/504: 일시적 서버오류 → RetryableError
    - 그 외 4xx/5xx: NonRetryableError (원인 불명, 반복 재시도로 해결 안 됨)
    """
    status = resp.status_code
    if status in (401, 403):
        raise SessionExpiredError(f"{context} 인증/세션 오류({status})")
    if status == 404:
        raise NonRetryableError(f"{context} 존재하지 않는 페이지(404)")
    if status == 429:
        retry_after_raw = resp.headers.get("retry-after")
        try:
            retry_after = float(retry_after_raw) if retry_after_raw else None
        except ValueError:
            retry_after = None
        raise RetryableError(
            f"{context} 요청 제한(429)", retry_after=retry_after
        )
    if status in _RETRYABLE_STATUS:
        raise RetryableError(f"{context} 서버 오류({status})")
    if status >= 400:
        raise NonRetryableError(f"{context} 처리할 수 없는 응답({status})")


async def fetch_list_page(
    client: httpx.AsyncClient, *, page_no: int = 1, data_size: int = 20
) -> dict:
    try:
        resp = await client.get(
            LIST_PATH,
            params={"dataSize": data_size, "pageNo": page_no, "ck_photo": 0},
        )
    except httpx.TimeoutException as exc:
        raise RetryableError(f"목록 API 타임아웃: {exc}") from exc
    if resp.status_code >= 400:
        _classify_and_raise(resp, context="목록 API")
    if _looks_like_login_redirect(resp):
        raise SessionExpiredError(
            f"목록 API가 JSON이 아닌 응답을 반환했습니다 (content-type="
            f"{resp.headers.get('content-type')!r})."
        )
    try:
        return resp.json()
    except ValueError as exc:
        raise NonRetryableError(f"목록 API 응답 파싱 실패: {exc}") from exc


async def fetch_list_page_with_preset(
    client: httpx.AsyncClient,
    path: str,
    preset_params: dict,
    *,
    page_no: int = 1,
    data_size: int = 100,
) -> dict:
    """presets_httpx.resolve_preset_request() 결과로 목록 API를 호출.

    fetch_list_page() 와 별개 함수인 이유: 프리셋 검색은 경로가
    ca/AuctList.php 뿐 아니라 pa/PubAuctList.php(공매)로도 갈 수 있고,
    파라미터 이름 자체도 완전히 다르므로 고정 경로를 쓰는 fetch_list_page
    로는 표현할 수 없다.
    """
    params = {**preset_params, "dataSize": data_size, "pageNo": page_no, "ck_photo": 0}
    try:
        resp = await client.get(path, params=params)
    except httpx.TimeoutException as exc:
        raise RetryableError(f"목록(프리셋) API 타임아웃: {exc}") from exc
    if resp.status_code >= 400:
        _classify_and_raise(resp, context="목록(프리셋) API")
    if _looks_like_login_redirect(resp):
        raise SessionExpiredError(
            f"목록(프리셋) API가 JSON이 아닌 응답을 반환했습니다 (content-type="
            f"{resp.headers.get('content-type')!r})."
        )
    try:
        return resp.json()
    except ValueError as exc:
        raise NonRetryableError(f"목록(프리셋) API 응답 파싱 실패: {exc}") from exc


async def fetch_detail(client: httpx.AsyncClient, tid: str) -> dict:
    try:
        resp = await client.get(DETAIL_PATH, params={"tid": tid})
    except httpx.TimeoutException as exc:
        raise RetryableError(f"상세 API 타임아웃(tid={tid}): {exc}") from exc
    if resp.status_code >= 400:
        _classify_and_raise(resp, context=f"상세 API(tid={tid})")
    if _looks_like_login_redirect(resp):
        raise SessionExpiredError(
            f"상세 API가 JSON이 아닌 응답을 반환했습니다 (tid={tid}, content-type="
            f"{resp.headers.get('content-type')!r})."
        )
    try:
        return resp.json()
    except ValueError as exc:
        raise NonRetryableError(f"상세 API 응답 파싱 실패(tid={tid}): {exc}") from exc


async def fetch_favorite_searches(client: httpx.AsyncClient) -> list[dict]:
    """탱크옥션 "즐겨쓰는 검색열기" 목록 — POST /ca/res/mySearchCase.php,
    mode=getFavoriteSearch. 실측(2026-07-17)으로 확인한 비공개 API로,
    로그인 세션이 있어야 자신의 목록을 받는다(유료회원 전용 기능).
    응답 형식이 바뀌면 이 파서도 함께 갱신해야 한다.
    """
    try:
        resp = await client.post(
            "/ca/res/mySearchCase.php",
            data={"mode": "getFavoriteSearch", "domain": "ca"},
        )
    except httpx.TimeoutException as exc:
        raise RetryableError(f"즐겨쓰는 검색 조회 타임아웃: {exc}") from exc
    if resp.status_code >= 400:
        _classify_and_raise(resp, context="즐겨쓰는 검색 조회")
    if _looks_like_login_redirect(resp):
        raise SessionExpiredError(
            "즐겨쓰는 검색 조회가 JSON이 아닌 응답을 반환했습니다."
        )
    try:
        data = resp.json()
    except ValueError as exc:
        raise NonRetryableError(f"즐겨쓰는 검색 조회 응답 파싱 실패: {exc}") from exc
    items = data.get("item")
    return items if isinstance(items, list) else []


async def fetch_env_view_data(client: httpx.AsyncClient, tid: str) -> dict | None:
    """탱크 /molit/res/EnvViewData.php — envInfo.envData(교육·주변), dtDj(단지) 등.

    tank_detail.py: fetch_env_view_data() 의 Selenium execute_async_script
    fetch() 호출과 동일한 엔드포인트/파라미터를 HTTPX로 재현.
    실패해도 상세 파싱 자체를 막지 않도록 예외를 삼키고 None 반환한다
    (기존 Selenium 경로도 동일하게 실패 시 None을 반환하는 정책).
    """
    try:
        resp = await client.get(
            ENV_VIEW_PATH, params={"tid": tid, "gb": "1"}
        )
        resp.raise_for_status()
        if _looks_like_login_redirect(resp):
            return None
        data = resp.json()
        return data if isinstance(data, dict) else None
    except (httpx.HTTPError, ValueError):
        return None
