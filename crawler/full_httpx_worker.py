"""완전 HTTPX 경로: 목록/상세/네이버부동산 전부 브라우저 없이 처리.

hybrid_worker.py(HTTPX + Selenium 네이버)와 별개로 존재하는 실험적 버전.
naver_httpx.py(curl_cffi 기반 네이버 정적 조회)가 실제로 Selenium과 동일한
품질을 내는지 검증하기 위해 신설(2026-07-17).

이 파일은 selenium을 전혀 import하지 않는다(item_crawl 대신
item_validation을 사용) — Chrome/selenium 설치 없이 순수 Python 환경(예:
Railway 컨테이너)에 v3 전용 경량 워커로 배포하기 위한 전제 조건이다.
"""

from __future__ import annotations

import asyncio
import os
import random

import httpx

from crawl_abort import check_stop
from http_client import fetch_detail, fetch_env_view_data, login, make_client
from item_validation import validate_crawl_item_reason
from naver_httpx import extract_naver_prices_httpx
from parsers import parse_detail_page
from repository import post_item_to_api
from tank_detail import extract_complex_id_from_env_payload


def _is_apartment_usage(usage: str) -> bool:
    normalized = (usage or "").strip()
    return normalized == "아파트" or normalized.startswith("아파트")


def _apply_naver_part_httpx(item: dict, naver_complex_id: str | None) -> dict:
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
        "complex_id": None,
    }
    if _is_apartment_usage(usage) and building_area not in ("0", "없음"):
        naver = extract_naver_prices_httpx(
            building_area, complex_id=naver_complex_id
        )
        print(
            f"[DEBUG naver] tid={item.get('tid')} area={building_area!r} "
            f"complex_id={naver_complex_id!r} lowest={naver.get('naver_lowest_price')!r} "
            f"detail_len={len(naver.get('naver_price_detail') or '')} "
            f"detail_head={(naver.get('naver_price_detail') or '')[:60]!r}",
            flush=True,
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
    else:
        print(
            f"[DEBUG naver] tid={item.get('tid')} skipped: usage={usage!r} area={building_area!r}",
            flush=True,
        )

    item["naver_lowest_price"] = naver.get("naver_lowest_price") or 0
    item["gap_margin_sold_price"] = naver.get("gap_margin_sold_price")
    item["gap_margin"] = naver.get("gap_margin")
    item["new_case_gap_margin"] = naver.get("new_case_gap_margin")
    item["real_trade_count"] = naver.get("real_trade_count") or ""
    item["naver_price_detail"] = naver.get("naver_price_detail") or ""
    item["transaction_prices"] = naver.get("transaction_prices") or ""
    item["naver_id"] = str(naver.get("complex_id") or naver_complex_id or "").strip()
    return item


async def crawl_one_item_full_httpx(client: httpx.AsyncClient, tid: str) -> dict:
    """목록/상세/네이버 전부 브라우저 없이 처리한 완성 결과 하나를 반환."""
    detail = await fetch_detail(client, tid)
    env_payload = await fetch_env_view_data(client, tid)
    item = parse_detail_page(detail, env_payload)
    naver_complex_id = extract_complex_id_from_env_payload(env_payload)
    check_stop(None)
    item = _apply_naver_part_httpx(item, naver_complex_id)
    return item


async def run_full_httpx(
    tids: list[str], *, save_to_db: bool = False
) -> list[dict]:
    results: list[dict] = []
    async with make_client() as client:
        await login(client)
        for tid in tids:
            item = await crawl_one_item_full_httpx(client, tid)
            if save_to_db:
                valid, _ = validate_crawl_item_reason(item)
                if valid:
                    await post_item_to_api(client, item)
            results.append(item)
    return results


# 동시 처리 개수 — 탱크옥션/네이버 양쪽에 부담을 주지 않으면서 순차(20초/건)
# 대비 체감 속도를 크게 올리는 값. queue_manager.py(6~7단계 병렬 큐)와
# 동일한 기본값을 사용해 두 워커의 동시성 정책을 맞춘다.
FULL_HTTPX_CONCURRENCY = int(os.environ.get("CRAWL_CONCURRENCY", "5"))

# naver_httpx.py가 남기는 "찾을 수 없음" 계열 문구 — 이 경우 저장은
# 정상 완료됐지만 네이버 데이터는 못 채웠다는 걸 실행 로그에서 바로
# 알 수 있어야 한다는 요청(2026-07-20). DB에는 저장되지만 로그 화면
# 에서는 완전히 안 보이던 문제.
_NAVER_MISS_PHRASES = (
    "단지ID 없음",
    "면적 파싱 실패",
    "면적 조건에 맞는 평형 없음",
    "면적 조건에 맞는 호가·실거래 없음",
    "네이버 접속 실패",
    "호가 조회 실패",
)


def _naver_miss_note(item: dict) -> str:
    detail = str(item.get("naver_price_detail") or "").strip()
    if not detail:
        return ""
    if any(detail.startswith(phrase) for phrase in _NAVER_MISS_PHRASES):
        return f" (네이버: {detail})"
    return ""


def _case_state_note(api_result: dict) -> str:
    """(변경 없음)일 때 왜 이 물건이 재조회 대상에 남아 있는지 사유를
    붙인다. 예전에는 이 사유를 NestJS(import-item 콜백) 쪽에서 로그로
    남겼지만, 워커 자체 이벤트와 중복돼 콜백 쪽 로그를 억제한 뒤로는
    사유 없는 "(변경 없음)"만 남아 왜 재조회되는지 알 수 없었다(실측,
    2026-07-20). post_item_to_api 응답에 실려 오는 item.caseState를
    읽어 워커 로그에 직접 사유를 붙인다."""
    case_state = str((api_result.get("item") or {}).get("caseState") or "").strip()
    if case_state == "변경":
        return " — 매각기일 변경, 다음 기일 재확인"
    if case_state == "유찰":
        return " — 유찰 후 다음 매각기일 재확인"
    if case_state:
        return f" — 진행 중({case_state}), 결과 확정 전까지 재확인"
    return ""


async def _run_full_httpx_with_state(
    tids: list[str],
    *,
    callback_url: str | None,
    callback_secret: str | None,
    state,
    should_stop,
) -> None:
    """세마포어로 동시 요청 수를 제한한 병렬 처리. completed/last_message는
    tid 순서가 아니라 완료되는 순서대로 갱신된다(진행률 표시 용도라 순서
    무관) — 최종 저장 결과는 순서와 무관하게 전부 반영된다."""
    total = len(tids)
    semaphore = asyncio.Semaphore(FULL_HTTPX_CONCURRENCY)

    async def process_one(client: httpx.AsyncClient, tid: str) -> None:
        async with semaphore:
            with state.lock:
                if state.stop_requested:
                    return
            check_stop(should_stop)

            # 재시도(타임아웃/연결오류 시 자동 재시도)를 넣었더니 세마포어
            # 슬롯을 오래 붙드는 태스크가 생겨, 대량 작업(수백~수천 건)에서
            # 병렬성이 무너지고 전체가 순차 처리처럼 느려졌다(실측: 969건
            # 작업에서 물건당 20~40초 소요, 2026-07-20). 재시도 없이 실패
            # 시 즉시 다음 물건으로 넘어가는 원래 동작으로 되돌린다.
            try:
                item = await crawl_one_item_full_httpx(client, tid)
            except Exception as exc:
                detail = str(exc) or type(exc).__name__
                with state.lock:
                    state.completed += 1
                    state.last_message = f"[{state.completed}/{total}] tid={tid} 실패: {detail}"
                    state.events.append(state.last_message)
                return

            valid, skip_reason = validate_crawl_item_reason(item)
            if not valid:
                with state.lock:
                    state.completed += 1
                    state.last_message = f"[{state.completed}/{total}] 저장 스킵 ({skip_reason})"
                    state.events.append(state.last_message)
                return

            try:
                api_result = await post_item_to_api(
                    client, item, callback_url=callback_url, callback_secret=callback_secret
                )
                unchanged = bool(api_result.get("skipped") and api_result.get("unchanged"))
                with state.lock:
                    state.completed += 1
                    if not unchanged:
                        state.updated += 1
                    naver_note = _naver_miss_note(item)
                    case_note = _case_state_note(api_result) if unchanged else ""
                    state.last_message = (
                        f"[{state.completed}/{total}] {item.get('auctionNo')} (변경 없음{case_note}){naver_note}"
                        if unchanged
                        else f"[{state.completed}/{total}] {item.get('auctionNo')} 저장 완료{naver_note}"
                    )
                    state.events.append(state.last_message)
            except httpx.HTTPError as exc:
                with state.lock:
                    state.completed += 1
                    state.last_message = (
                        f"[{state.completed}/{total}] {item.get('auctionNo')} 저장 실패: {exc}"
                    )
                    state.events.append(state.last_message)
            # 사람이 클릭하듯 간격을 흔들어 트래픽 패턴 탐지를 피한다
            # (queue_manager.py와 동일한 근거, 0.2~0.8초).
            await asyncio.sleep(random.uniform(0.2, 0.8))

    async with make_client() as client:
        await login(client)
        with state.lock:
            if state.stop_requested:
                state.phase = "stopped"
                state.last_message = "사용자 요청으로 조회가 중단되었습니다."
                return
        await asyncio.gather(*(process_one(client, tid) for tid in tids))

    with state.lock:
        if state.stop_requested:
            state.phase = "stopped"
            state.last_message = "사용자 요청으로 조회가 중단되었습니다."
            return
        state.phase = "done"
        state.last_message = f"조회 완료 ({state.completed}/{total})"
        state.events.append(state.last_message)


def full_httpx_crawl_worker(
    tids: list[str],
    *,
    callback_url: str | None = None,
    callback_secret: str | None = None,
    state,
    should_stop=None,
) -> None:
    """threading.Thread target — hybrid_worker.hybrid_crawl_worker와 동일한
    관례. 브라우저를 전혀 띄우지 않는 것이 이 워커의 유일한 차이."""
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
            _run_full_httpx_with_state(
                tids,
                callback_url=callback_url,
                callback_secret=callback_secret,
                state=state,
                should_stop=should_stop,
            )
        )
    except Exception as exc:
        with state.lock:
            state.phase = "error"
            state.error = str(exc)
            state.last_message = f"조회 실패: {exc}"


if __name__ == "__main__":
    import json
    import os
    import sys
    from pathlib import Path

    def _load_dotenv() -> None:
        env_path = Path(__file__).resolve().parent.parent / ".env"
        if not env_path.is_file():
            return
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if key and key not in os.environ:
                os.environ[key] = value

    _load_dotenv()

    tid = sys.argv[1] if len(sys.argv) > 1 else "13564"

    async def _main() -> None:
        results = await run_full_httpx([tid], save_to_db=False)
        out_dir = Path(__file__).resolve().parent.parent / "tests" / "crawler" / "fixtures"
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "full_httpx_sample.json").write_text(
            json.dumps(results, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
        )
        print(f"saved {len(results)} result(s)")

    asyncio.run(_main())
