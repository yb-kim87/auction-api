"""대한민국 법원경매정보(courtauction.go.kr) HTTPX 클라이언트.

탱크옥션(http_client.py)과 원리는 같다 — 화면 자체는 XML/JS로 그려지는
RIA 프레임워크지만, 실제 물건 데이터는 로그인 없이도 호출 가능한 JSON
POST API로 오간다는 것을 실측(2026-07-19)으로 확인했다.

핵심 API 2개(Chrome DevTools 네트워크 캡처로 확인):
  - POST /pgj/pgjsearch/searchControllerMain.on   : 물건 목록 검색
  - POST /pgj/pgj15B/selectAuctnCsSrchRslt.on      : 물건 상세 조회

목록 응답 한 건(dlt_srchResult)의 srnSaNo(사건번호 표시용)/boCd(법원코드)/
mokmulSer(물건순번)를 그대로 상세 API의 csNo/cortOfcCd/dspslGdsSeq에
넣으면 상세를 받을 수 있다.
"""

from __future__ import annotations

import os

import httpx

from exceptions import NonRetryableError, RetryableError

BASE_URL = "https://www.courtauction.go.kr"
LIST_PATH = "/pgj/pgjsearch/searchControllerMain.on"
DETAIL_PATH = "/pgj/pgj15B/selectAuctnCsSrchRslt.on"

DEFAULT_HEADERS = {
    "Content-Type": "application/json;charset=UTF-8",
    "Accept": "application/json",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Referer": f"{BASE_URL}/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml",
    "User-Agent": (
        os.environ.get("CRAWL_USER_AGENT")
        or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
    ),
    # 2026-09-03 재실측: 실제 브라우저(Chrome 151) 요청을 Playwright로
    # 캡처해 httpx로 그대로 재현했을 때만 통과했다 — 브라우저 핑거프린트
    # 헤더(sec-ch-ua 계열)도 함께 넣어둔다(어느 쪽이 결정적이었는지는
    # 확정 못 했지만, 실제로 통과한 조합을 그대로 유지).
    "sec-ch-ua-platform": '"Windows"',
    "sec-ch-ua": '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
    "sec-ch-ua-mobile": "?0",
    # WebSquare(RIA 프레임워크)가 "이 요청이 어느 UI 컴포넌트에서 보내졌는지"
    # 식별하는 커스텀 헤더 — 실측(2026-07-19)으로 확인. 이 헤더가 없으면
    # 서버가 정상 화면 흐름이 아니라고 판단해 400을 반환한다.
    "submissionid": "mf_wfm_mainFrame_sbm_selectGdsDtlSrch",
    # 비로그인 사용자 식별값. 로그인 세션이 있으면 SYSTEM 등으로 바뀌지만,
    # 로그인 없이 크롤링하는 경우 NONUSER 고정값으로도 정상 동작을 확인했다.
    "SC-Userid": "NONUSER",
}

CRAWL_TIMEOUT = float(os.environ.get("CRAWL_TIMEOUT", "20"))

# 물건 용도 코드(사용대분류/중분류/소분류) — 법원경매정보 화면의 "매각물건종류"
# 콤보박스에 대응. 아파트/연립/다세대(주거용 부동산)만 우선 지원한다.
# 대분류 20000=부동산, 중분류 20100=주거용, 소분류는 세부 유형.
USAGE_CODE_APARTMENT = "20104"  # 아파트
USAGE_CODE_MULTI_HOUSEHOLD = "20105"  # 다세대(빌라)
USAGE_CODE_ROW_HOUSE = "20103"  # 연립주택


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=BASE_URL, headers=DEFAULT_HEADERS, timeout=CRAWL_TIMEOUT
    )


def _classify_and_raise(resp: httpx.Response, *, context: str) -> None:
    status = resp.status_code
    if status == 429:
        retry_after_raw = resp.headers.get("retry-after")
        try:
            retry_after = float(retry_after_raw) if retry_after_raw else None
        except ValueError:
            retry_after = None
        raise RetryableError(f"{context} 요청 제한(429)", retry_after=retry_after)
    if status in (500, 502, 503, 504):
        raise RetryableError(f"{context} 서버 오류({status})")
    if status >= 400:
        raise NonRetryableError(f"{context} 처리할 수 없는 응답({status})")


def build_list_payload(
    *,
    page_no: int = 1,
    page_size: int = 40,
    bid_bgng_ymd: str,
    bid_end_ymd: str,
    lcls_usg_cd: str = "20000",
    mcls_usg_cd: str = "20100",
    scls_usg_cd: str = "",
    cort_ofc_cd: str = "",
) -> dict:
    """목록 검색 요청 본문. 실측 캡처(list_request_full)의 구조를 그대로 따른다.
    scls_usg_cd를 비워두면 중분류(주거용) 전체가 조회된다."""
    return {
        "dma_pageInfo": {
            "pageNo": page_no,
            "pageSize": page_size,
            "bfPageNo": "",
            "startRowNo": "",
            "totalCnt": "",
            "totalYn": "Y",
            "groupTotalCount": "",
        },
        "dma_srchGdsDtlSrchInfo": {
            "rletDspslSpcCondCd": "",
            "bidDvsCd": "000331",
            "mvprpRletDvsCd": "00031R",
            "cortAuctnSrchCondCd": "0004601",
            "rprsAdongSdCd": "",
            "rprsAdongSggCd": "",
            "rprsAdongEmdCd": "",
            "rdnmSdCd": "",
            "rdnmSggCd": "",
            "rdnmNo": "",
            "mvprpDspslPlcAdongSdCd": "",
            "mvprpDspslPlcAdongSggCd": "",
            "mvprpDspslPlcAdongEmdCd": "",
            "rdDspslPlcAdongSdCd": "",
            "rdDspslPlcAdongSggCd": "",
            "rdDspslPlcAdongEmdCd": "",
            "cortOfcCd": cort_ofc_cd,
            "jdbnCd": "",
            "execrOfcDvsCd": "",
            "lclDspslGdsLstUsgCd": lcls_usg_cd,
            "mclDspslGdsLstUsgCd": mcls_usg_cd,
            "sclDspslGdsLstUsgCd": scls_usg_cd,
            "cortAuctnMbrsId": "",
            "aeeEvlAmtMin": "",
            "aeeEvlAmtMax": "",
            "lwsDspslPrcRateMin": "",
            "lwsDspslPrcRateMax": "",
            "flbdNcntMin": "",
            "flbdNcntMax": "",
            "objctArDtsMin": "",
            "objctArDtsMax": "",
            "mvprpArtclKndCd": "",
            "mvprpArtclNm": "",
            "mvprpAtchmPlcTypCd": "",
            "notifyLoc": "off",
            "lafjOrderBy": "",
            "pgmId": "PGJ151F01",
            "csNo": "",
            "cortStDvs": "1",
            "statNum": 1,
            "bidBgngYmd": bid_bgng_ymd,
            "bidEndYmd": bid_end_ymd,
            "dspslDxdyYmd": "",
            "fstDspslHm": "",
            "scndDspslHm": "",
            "thrdDspslHm": "",
            "fothDspslHm": "",
            "dspslPlcNm": "",
            "lwsDspslPrcMin": "",
            "lwsDspslPrcMax": "",
            "grbxTypCd": "",
            "gdsVendNm": "",
            "fuelKndCd": "",
            "carMdyrMax": "",
            "carMdyrMin": "",
            "carMdlNm": "",
            "sideDvsCd": "",
        },
    }


async def fetch_list_page(client: httpx.AsyncClient, payload: dict) -> dict:
    try:
        resp = await client.post(LIST_PATH, json=payload)
    except httpx.TimeoutException as exc:
        raise RetryableError(f"목록 API 타임아웃: {exc}") from exc
    if resp.status_code >= 400:
        _classify_and_raise(resp, context="목록 API")
    try:
        body = resp.json()
    except ValueError as exc:
        raise NonRetryableError(f"목록 API 응답 파싱 실패: {exc}") from exc
    if body.get("status") != 200:
        raise NonRetryableError(f"목록 API 오류 응답: {body.get('message')}")
    return body.get("data", {})


def build_detail_payload(
    *, cs_no: str, cort_ofc_cd: str, dspsl_gds_seq: str | int, srch_info: dict
) -> dict:
    return {
        "dma_srchGdsDtlSrch": {
            "csNo": cs_no,
            "cortOfcCd": cort_ofc_cd,
            "dspslGdsSeq": str(dspsl_gds_seq),
            "pgmId": "PGJ151F01",
            "srchInfo": srch_info,
        }
    }


async def fetch_detail(client: httpx.AsyncClient, payload: dict) -> dict:
    identifier = payload.get("dma_srchGdsDtlSrch", {}).get("csNo", "?")
    try:
        resp = await client.post(DETAIL_PATH, json=payload)
    except httpx.TimeoutException as exc:
        raise RetryableError(f"상세 API 타임아웃(csNo={identifier}): {exc}") from exc
    if resp.status_code >= 400:
        _classify_and_raise(resp, context=f"상세 API(csNo={identifier})")
    try:
        body = resp.json()
    except ValueError as exc:
        raise NonRetryableError(
            f"상세 API 응답 파싱 실패(csNo={identifier}): {exc}"
        ) from exc
    if body.get("status") != 200:
        raise NonRetryableError(
            f"상세 API 오류 응답(csNo={identifier}): {body.get('message')}"
        )
    return body.get("data", {}).get("dma_result", {})
