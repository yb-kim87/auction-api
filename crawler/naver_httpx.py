"""네이버부동산(fin.land.naver.com) 정적 조회 — curl_cffi 기반, 브라우저 불필요.

기존 naver_crawl.py(Selenium)와 동일한 반환 인터페이스
(naver_price_detail, naver_lowest_price, transaction_prices,
real_trade_count, complex_id, matched_area_label)를 유지한다.

동작 원리: fin.land.naver.com이 TLS/HTTP2 핑거프린트로 봇을 걸러내는 것을
확인했고(순수 httpx는 429), curl_cffi로 Chrome 핑거프린트를 재현하면
정상 응답함을 실측 검증했다(2026-07-17). 실제 매물/시세는
front-api/v1/complex/* 엔드포인트에서 그대로 JSON으로 제공된다.
"""

from __future__ import annotations

from curl_cffi import requests as curl_requests

BASE_URL = "https://fin.land.naver.com"
AREA_TOLERANCE_M2 = 2.0


def _format_won(amount: int) -> str:
    eok = amount // 100_000_000
    rest = (amount % 100_000_000) // 10_000
    if eok and rest:
        return f"{eok}억 {rest:,}"
    if eok:
        return f"{eok}억"
    return f"{rest:,}만"


def empty_naver_result(naver_price_detail: str = "", **overrides) -> dict:
    payload = {
        "naver_price_detail": naver_price_detail,
        "naver_lowest_price": None,
        "gap_margin": None,
        "gap_margin_sold_price": None,
        "new_case_gap_margin": None,
        "transaction_prices": "",
        "real_trade_count": "",
        "complex_id": None,
        "matched_area_label": "",
    }
    payload.update(overrides)
    return payload


def _make_session() -> curl_requests.Session:
    session = curl_requests.Session(impersonate="chrome124")
    return session


def _resolve_pyeong_numbers(
    session: curl_requests.Session, complex_id: str, target_m2: float, referer: str
) -> tuple[list[int], str]:
    """target_m2 와 exclusiveArea 차이가 tolerance 이내인 평형번호 전부를 찾는다.

    기존 Selenium(apply_target_area_filters)이 tolerance 범위 내 평형을
    전부 체크박스로 선택하는 것과 동일하게, 가장 가까운 것 하나만 고르지
    않고 범위 내 전부를 대상으로 한다 — 단일 평형만 보면 매물이 우연히
    없는 인접 평형의 매물을 놓칠 수 있음(실측으로 확인된 버그, 2026-07-17).
    """
    resp = session.get(
        f"{BASE_URL}/front-api/v1/complex/pyeongList",
        params={"complexNumber": complex_id},
        headers={"Accept": "application/json", "Referer": referer},
    )
    if resp.status_code != 200:
        return [], ""
    data = resp.json()
    if not data.get("isSuccess"):
        return [], ""

    numbers: list[int] = []
    labels: list[str] = []
    for row in data.get("result") or []:
        exclusive = row.get("exclusiveArea")
        if exclusive is None:
            continue
        diff = abs(float(exclusive) - target_m2)
        if diff <= AREA_TOLERANCE_M2:
            number = row.get("number")
            if number is not None:
                numbers.append(number)
                labels.append(str(row.get("name") or ""))
    return numbers, ", ".join(labels)


def _fetch_articles(
    session: curl_requests.Session,
    complex_id: str,
    pyeong_numbers: list[int],
    referer: str,
) -> tuple[int | None, str]:
    body = {
        "size": 30,
        "complexNumber": str(complex_id),
        "tradeTypes": ["A1"],
        "pyeongTypes": pyeong_numbers,
        "dongNumbers": [],
        "userChannelType": "PC",
        "articleSortType": "RANKING_DESC",
        "lastInfo": [],
    }
    resp = session.post(
        f"{BASE_URL}/front-api/v1/complex/article/list",
        json=body,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Referer": referer,
        },
    )
    if resp.status_code != 200:
        return None, ""
    data = resp.json()
    if not data.get("isSuccess"):
        return None, ""

    rows = (data.get("result") or {}).get("list") or []
    prices: list[int] = []
    lines: list[str] = []
    seen: set[str] = set()
    for row in rows:
        info = row.get("representativeArticleInfo") or {}
        price_info = info.get("priceInfo") or {}
        deal_price = price_info.get("dealPrice")
        if not deal_price:
            continue
        prices.append(deal_price)

        dong = str(info.get("dongName") or "").strip()
        space = (info.get("spaceInfo") or {}).get("supplySpaceName") or ""
        exclusive = (info.get("spaceInfo") or {}).get("exclusiveSpaceName") or ""
        floor_info = (info.get("articleDetail") or {}).get("floorInfo") or ""
        exposure_date = (info.get("verificationInfo") or {}).get("exposureStartDate") or ""
        broker = (info.get("brokerInfo") or {}).get("brokerageName") or ""
        description = (info.get("articleDetail") or {}).get("articleFeatureDescription") or ""

        parts = [
            f"{dong}동" if dong else "",
            f"매매{_format_won(deal_price)}",
            f"{space}㎡ (전용{exclusive})" if space else "",
            floor_info,
            exposure_date,
            broker,
        ]
        line = " ".join(p for p in parts if p)
        if description:
            line = f'{line}\n\n"\n{description}\n"'
        if line in seen:
            continue
        seen.add(line)
        lines.append(line)

    if not prices:
        return None, ""
    return min(prices), "\n\n".join(lines)


def _fetch_real_price(
    session: curl_requests.Session,
    complex_id: str,
    pyeong_numbers: list[int],
    referer: str,
) -> tuple[str, str]:
    """pyeong/realPrice 는 pyeongTypeNumber 단수 파라미터만 받으므로,
    tolerance 범위 내 평형이 여러 개면 각각 호출해 합친다."""
    lines: list[str] = []
    for pyeong_number in pyeong_numbers:
        resp = session.get(
            f"{BASE_URL}/front-api/v1/complex/pyeong/realPrice",
            params={
                "complexNumber": complex_id,
                "pyeongTypeNumber": pyeong_number,
                "page": 1,
                "size": 20,
                "tradeType": "A1",
            },
            headers={"Accept": "application/json", "Referer": referer},
        )
        if resp.status_code != 200:
            continue
        data = resp.json()
        if not data.get("isSuccess"):
            continue

        rows = (data.get("result") or {}).get("list") or []
        for row in rows:
            if row.get("isDelete"):
                continue
            date = row.get("tradeDate") or ""
            price = row.get("dealPrice")
            floor = row.get("floor")
            if not price:
                continue
            parts = [date, f"{_format_won(price)}", f"{floor}층" if floor else ""]
            lines.append(" ".join(p for p in parts if p))

    return "\n".join(lines), str(len(lines))


def extract_naver_prices_httpx(
    building_area: str,
    *,
    complex_id: str | None = None,
    tid: str | None = None,
) -> dict:
    """extract_naver_prices()(Selenium)와 동일한 인터페이스의 브라우저 없는 버전.

    complex_id 는 이미 HTTPX로 확보한 값(hybrid_worker.py:
    extract_complex_id_from_env_payload())을 받는다 — 이 함수 자체는
    단지ID 탐색을 하지 않는다(탐색은 tank 상세 API 응답에서 이미 끝남).
    """
    if not complex_id:
        return empty_naver_result("단지ID 없음")

    try:
        target_m2 = float(building_area.strip())
    except (ValueError, AttributeError):
        return empty_naver_result("면적 파싱 실패", complex_id=complex_id)

    referer = f"{BASE_URL}/complexes/{complex_id}"
    session = _make_session()
    try:
        session.get(f"{BASE_URL}/complexes/{complex_id}")
    except Exception as exc:
        return empty_naver_result(f"네이버 접속 실패: {exc}", complex_id=complex_id)

    pyeong_numbers, matched_label = _resolve_pyeong_numbers(session, complex_id, target_m2, referer)
    if not pyeong_numbers:
        return empty_naver_result("면적 조건에 맞는 평형 없음", complex_id=complex_id)

    try:
        lowest_price, price_detail = _fetch_articles(session, complex_id, pyeong_numbers, referer)
    except Exception:
        return empty_naver_result("호가 조회 실패", complex_id=complex_id, matched_area_label=matched_label)

    if lowest_price is None:
        return empty_naver_result(
            "면적 조건에 맞는 호가 매물 없음", complex_id=complex_id, matched_area_label=matched_label
        )

    try:
        transaction_prices, real_trade_count = _fetch_real_price(
            session, complex_id, pyeong_numbers, referer
        )
    except Exception:
        transaction_prices, real_trade_count = "", ""

    return empty_naver_result(
        naver_price_detail=price_detail,
        naver_lowest_price=lowest_price,
        transaction_prices=transaction_prices,
        real_trade_count=real_trade_count,
        complex_id=complex_id,
        matched_area_label=matched_label,
    )
