"""나이스옥션 작업창 — 상시 폴링 워커.

관리자 UI(나이스 작업창)의 "시작" 버튼을 누르면 백엔드가
nice_crawler_state.running=true + searchConfig를 저장한다. 이 스크립트는
그 상태를 주기적으로 폴링하다가 running=true를 보면:
  1. searchConfig로 나이스 상세검색 API를 페이지네이션 호출해 objId를
     maxItems까지 수집
  2. 각 objId 상세 조회 → nice_map_to_raw로 변환 → /nice-crawler/import-item
     으로 저장
  3. 완료되면 running=false로 되돌리고 다시 대기

탱크옥션 작업창의 로컬 워커(항상 켜둔 채 폴링)와 동일한 운영 방식이다.

사용: python nice_worker.py
      (포그라운드로 계속 실행 — Ctrl+C로 중지)

안전장치: searchConfig.maxItems가 항상 상한이다(기본 50). 2026-08-06
주택공시가격 대량 임포트로 운영 DB가 다운된 사고 이후, 이 워커는 절대
무제한으로 돌지 않는다 — 한 번 시작에 처리할 건수를 관리자가 UI에서
직접 정한다.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import sys
import time

import httpx

from nice_client import fetch_obj_detail, make_client, search_advanced
from nice_map_to_raw import nice_obj_to_raw

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

API_BASE = os.environ.get("PRODUCTION_API_URL", "https://auction-production-2c72.up.railway.app")
CRAWLER_SECRET = os.environ.get("CRAWLER_SECRET", "local-crawler-secret")
POLL_INTERVAL_SEC = 5
REQUEST_DELAY_SEC = 0.8
SEARCH_PAGE_SIZE = 100

HEADERS = {"x-crawler-secret": CRAWLER_SECRET}


def log(message: str, level: str = "info") -> None:
    prefix = {"info": " ", "warn": "!", "error": "X"}.get(level, " ")
    print(f"[{prefix}] {message}")
    try:
        httpx.post(
            f"{API_BASE}/nice-crawler/worker-log",
            json={"message": message, "level": level},
            headers=HEADERS,
            timeout=10.0,
        )
    except Exception:  # noqa: BLE001
        pass  # 로그 전송 실패는 워커 진행을 막지 않는다.


def report(**patch) -> None:
    try:
        httpx.post(
            f"{API_BASE}/nice-crawler/progress",
            json=patch,
            headers=HEADERS,
            timeout=10.0,
        )
    except Exception as e:  # noqa: BLE001
        print(f"[!] progress 보고 실패: {e}")


def get_worker_status() -> dict | None:
    try:
        resp = httpx.get(f"{API_BASE}/nice-crawler/worker-status", headers=HEADERS, timeout=10.0)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:  # noqa: BLE001
        print(f"[!] 상태 조회 실패: {e}")
        return None


def build_search_params(config: dict) -> dict:
    """NiceSearchConfig → 나이스 검색 API 쿼리 파라미터."""
    params: dict = {}
    if config.get("yongdoCd"):
        params["yongdoCd"] = ",".join(config["yongdoCd"])
    if config.get("objProgStatusCd"):
        params["objProgStatusCd"] = ",".join(config["objProgStatusCd"])
    if config.get("objTypes"):
        params["objTypes"] = config["objTypes"]
    for key in (
        "caseYear",
        "caseSerial",
        "courtCd",
        "pnuCd",
        "dspslDxdyYmdStart",
        "dspslDxdyYmdEnd",
        "uchalCntStart",
        "uchalCntEnd",
        "gamjungAmtStart",
        "gamjungAmtEnd",
        "minAmtStart",
        "minAmtEnd",
        "gamjungAmtRateStart",
        "gamjungAmtRateEnd",
        "tojiAreaStart",
        "tojiAreaEnd",
        "bldgAreaStart",
        "bldgAreaEnd",
        "initRegYmdStart",
        "initRegYmdEnd",
        "gamjungCompanyNm",
        "soyujaNm",
        "chamujaNm",
        "chaeonjaNm",
    ):
        value = config.get(key)
        if value not in (None, ""):
            params[key] = value
    return params


async def collect_obj_ids(client: httpx.AsyncClient, config: dict, max_items: int) -> list[str]:
    """상세검색 결과에서 objId를 max_items까지 페이지네이션 수집."""
    params = build_search_params(config)
    obj_ids: list[str] = []
    page = 1
    while len(obj_ids) < max_items:
        page_size = min(SEARCH_PAGE_SIZE, max_items - len(obj_ids))
        items, total = await search_advanced(client, params, page, page_size)
        if not items:
            break
        obj_ids.extend(str(item["objId"]) for item in items)
        report(phase="collecting_objids", totalObjIds=total)
        log(f"검색 결과 {total:,}건 중 {len(obj_ids)}건 수집(페이지 {page})")
        if len(items) < page_size:
            break
        page += 1
        await asyncio.sleep(0.3)
    return obj_ids[:max_items]


async def run_once(config: dict) -> None:
    max_items = int(config.get("maxItems") or 50)
    log(f"검색 시작 — 최대 {max_items}건")
    report(phase="collecting_objids", totalObjIds=0, matched=0, completed=0)

    async with make_client() as client:
        obj_ids = await collect_obj_ids(client, config, max_items)
        report(phase="fetching_details", matched=len(obj_ids))
        log(f"상세 조회 대상 {len(obj_ids)}건")

        import_client = httpx.Client(timeout=30.0)
        completed = 0
        for i, obj_id in enumerate(obj_ids, start=1):
            try:
                obj = await fetch_obj_detail(client, obj_id)
                raw = nice_obj_to_raw(obj)
                resp = import_client.post(
                    f"{API_BASE}/nice-crawler/import-item",
                    json=raw,
                    headers=HEADERS,
                )
                resp.raise_for_status()
                result = resp.json()
                label = raw.get("auctionNo") or obj_id
                if result.get("skipped"):
                    log(f"[{i}/{len(obj_ids)}] 스킵({result.get('reason')}): {label}", "warn")
                else:
                    tag = "신규" if result.get("created") else "갱신"
                    log(f"[{i}/{len(obj_ids)}] {tag}: {label}")
            except Exception as e:  # noqa: BLE001
                log(f"[{i}/{len(obj_ids)}] 실패(objId={obj_id}): {e}", "error")
            completed += 1
            report(phase="fetching_details", completed=completed)
            await asyncio.sleep(REQUEST_DELAY_SEC)

    log(f"완료 — {completed}건 처리")
    report(phase="idle", running=False, lastMessage=f"완료 — {completed}건 처리")


def main() -> None:
    print(f"나이스 작업창 워커 시작 — API_BASE={API_BASE}, {POLL_INTERVAL_SEC}초마다 상태 폴링")
    while True:
        status = get_worker_status()
        if status and status.get("running") and status.get("searchConfig"):
            try:
                config = json.loads(status["searchConfig"])
            except (TypeError, ValueError):
                log("searchConfig 파싱 실패", "error")
                report(phase="error", running=False, error="searchConfig 파싱 실패")
                time.sleep(POLL_INTERVAL_SEC)
                continue
            try:
                asyncio.run(run_once(config))
            except Exception as e:  # noqa: BLE001
                log(f"워커 실행 중 오류: {e}", "error")
                report(phase="error", running=False, error=str(e))
        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n중지됨")
