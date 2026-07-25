"""10단계: HTTPX(목록/상세) + Selenium(네이버부동산) 하이브리드 오케스트레이터.

기존 /crawl/start(Selenium 전체 경로)는 그대로 두고, 이 모듈은 별도
엔드포인트(/crawl/start-v2)에서만 사용한다. 목록·상세는 HTTPX로 빠르게
처리하고, 네이버부동산 호가 조회만 기존 naver_crawl.py(Selenium)를 그대로
호출한다. 최종적으로 완성된(불완전하지 않은) 결과만 기존 post_item_to_api()
콜백으로 저장한다.
"""

from __future__ import annotations

import asyncio
import threading

import httpx

import item_crawl
import naver_crawl
from browser import CONTEXT_TANK, browser_is_ready, ensure_driver, selenium_lock
from crawl_abort import CrawlStoppedError, check_stop
from http_client import fetch_detail, fetch_env_view_data, login, make_client
from parsers import parse_detail_page
from repository import post_item_to_api
from tank_detail import extract_complex_id_from_env_payload
from tank_login import is_logged_in, login as selenium_login


def _is_apartment_usage(usage: str) -> bool:
    normalized = (usage or "").strip().replace(" ", " ")
    return (
        normalized.startswith("아파트")
        or normalized.startswith("오피스텔")
        or "업무시설" in normalized
    )


async def _fetch_tank_part(client: httpx.AsyncClient, tid: str) -> tuple[dict, str | None]:
    """HTTPX로 상세+환경정보를 가져와 parse_detail_page() 결과와 네이버
    단지ID 후보를 함께 반환. 이 함수는 네이버부동산을 건드리지 않는다."""
    detail = await fetch_detail(client, tid)
    env_payload = await fetch_env_view_data(client, tid)
    parsed = parse_detail_page(detail, env_payload)
    naver_complex_id = extract_complex_id_from_env_payload(env_payload)
    return parsed, naver_complex_id


def _apply_naver_part(driver, item: dict, naver_complex_id: str | None, tid: str, should_stop) -> dict:
    """Selenium 브라우저로 네이버부동산 호가만 채워 item에 병합.

    item_crawl.py의 네이버 호출부와 동일한 조건(아파트 + 면적 있음)을 그대로
    적용한다 — 최종 반환 딕셔너리 키 집합은 기존 crawl_item()과 동일하게 유지.
    """
    usage = item.get("usage") or "없음"
    building_area = item.get("area") or "0"

    naver = {
        "naver_price_detail": "",
        "naver_lowest_price": None,
        "gap_margin": None,
        "gap_margin_sold_price": None,
        "new_case_gap_margin": None,
        "transaction_prices": "",
        "real_trade_count": "",
    }
    if _is_apartment_usage(usage) and building_area not in ("0", "없음"):
        check_stop(should_stop)
        naver = naver_crawl.extract_naver_prices(
            driver,
            building_area,
            "",
            complex_id=naver_complex_id,
            tid=tid,
            should_stop=should_stop,
        )
        min_price = item.get("min_price") or 0
        sale_price = item.get("sale_price")
        appraisal_price = item.get("appraisal_price") or 0
        if naver.get("naver_lowest_price") and min_price:
            naver["gap_margin"] = naver["naver_lowest_price"] - min_price
        if naver.get("naver_lowest_price") and sale_price:
            naver["gap_margin_sold_price"] = naver["naver_lowest_price"] - sale_price
        if naver.get("naver_lowest_price") and appraisal_price:
            naver["new_case_gap_margin"] = naver["naver_lowest_price"] - appraisal_price

    item["naver_lowest_price"] = naver.get("naver_lowest_price") or 0
    item["gap_margin_sold_price"] = naver.get("gap_margin_sold_price")
    item["gap_margin"] = naver.get("gap_margin")
    item["new_case_gap_margin"] = naver.get("new_case_gap_margin")
    item["real_trade_count"] = naver.get("real_trade_count") or ""
    item["naver_price_detail"] = naver.get("naver_price_detail") or ""
    item["transaction_prices"] = naver.get("transaction_prices") or ""
    item["naver_id"] = str(naver.get("complex_id") or naver_complex_id or "").strip()
    return item


def _ensure_selenium_login(user_id: str | None, password: str | None) -> None:
    """네이버부동산 조회에 필요한 Selenium 브라우저/로그인만 준비.
    탱크옥션 로그인 자체는 HTTPX 세션으로 별도 처리하므로 이 함수는
    네이버 접근에 필요한 브라우저 세션 확보 목적으로만 사용."""
    with selenium_lock:
        driver = ensure_driver(context=CONTEXT_TANK)
        if not browser_is_ready(CONTEXT_TANK):
            driver = ensure_driver(force_new=True, context=CONTEXT_TANK)
        if not is_logged_in(driver) and user_id and password:
            selenium_login(driver, user_id, password)
    return None


async def _process_one(
    client: httpx.AsyncClient, driver, tid: str, should_stop
) -> dict:
    parsed, naver_complex_id = await _fetch_tank_part(client, tid)
    check_stop(should_stop)
    with selenium_lock:
        parsed = _apply_naver_part(driver, parsed, naver_complex_id, tid, should_stop)
    return parsed


async def _run_hybrid_async(
    tids: list[str],
    *,
    user_id: str | None,
    password: str | None,
    callback_url: str | None,
    callback_secret: str | None,
    state,
    should_stop,
) -> None:
    _ensure_selenium_login(user_id, password)
    driver = ensure_driver(context=CONTEXT_TANK)

    async with make_client() as client:
        await login(client)

        for index, tid in enumerate(tids):
            pos = index + 1
            check_stop(should_stop)
            with state.lock:
                if state.stop_requested:
                    state.phase = "stopped"
                    state.last_message = "사용자 요청으로 조회가 중단되었습니다."
                    return
                state.last_message = f"[{pos}/{len(tids)}] tid={tid} 조회 중 (하이브리드)..."

            try:
                item = await _process_one(client, driver, tid, should_stop)
            except CrawlStoppedError:
                with state.lock:
                    state.phase = "stopped"
                    state.last_message = "사용자 요청으로 조회가 중단되었습니다."
                return
            except Exception as exc:
                with state.lock:
                    state.completed = pos
                    state.last_message = f"[{pos}/{len(tids)}] tid={tid} 실패: {exc}"
                    state.events.append(state.last_message)
                continue

            valid, skip_reason = item_crawl.validate_crawl_item_reason(item)
            if not valid:
                with state.lock:
                    state.completed = pos
                    state.last_message = f"[{pos}/{len(tids)}] 저장 스킵 ({skip_reason})"
                    state.events.append(state.last_message)
                continue

            try:
                await post_item_to_api(
                    client, item, callback_url=callback_url, callback_secret=callback_secret
                )
                with state.lock:
                    state.completed = pos
                    state.updated += 1
                    state.last_message = f"[{pos}/{len(tids)}] {item.get('auctionNo')} 저장 완료"
                    state.events.append(state.last_message)
            except httpx.HTTPError as exc:
                with state.lock:
                    state.completed = pos
                    state.last_message = f"[{pos}/{len(tids)}] {item.get('auctionNo')} 저장 실패: {exc}"
                    state.events.append(state.last_message)

    with state.lock:
        state.phase = "done"
        state.last_message = f"하이브리드 조회 완료 ({state.completed}/{len(tids)})"
        state.events.append(state.last_message)


def hybrid_crawl_worker(
    tids: list[str],
    *,
    user_id: str | None = None,
    password: str | None = None,
    callback_url: str | None = None,
    callback_secret: str | None = None,
    state,
    should_stop=None,
) -> None:
    """threading.Thread target — 기존 crawl_worker와 동일한 방식으로 호출.

    내부적으로 asyncio 이벤트 루프를 새로 만들어 HTTPX 부분을 처리하고,
    네이버부동산 조회는 동일 스레드에서 동기 Selenium 호출을 그대로 사용한다
    (asyncio와 Selenium 동기 호출이 섞이므로 별도 스레드에서 루프를 돌림).
    """
    with state.lock:
        state.phase = "crawling"
        state.completed = 0
        state.total = len(tids)
        state.created = 0
        state.updated = 0
        state.stop_requested = False
        state.error = None
        state.events.clear()

    try:
        asyncio.run(
            _run_hybrid_async(
                tids,
                user_id=user_id,
                password=password,
                callback_url=callback_url,
                callback_secret=callback_secret,
                state=state,
                should_stop=should_stop,
            )
        )
    except Exception as exc:  # 오케스트레이터 레벨 실패는 상태에 기록하고 스레드 종료
        with state.lock:
            state.phase = "error"
            state.error = str(exc)
            state.last_message = f"하이브리드 조회 실패: {exc}"
