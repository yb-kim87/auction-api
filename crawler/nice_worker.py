"""나이스옥션 작업창 워커 — 1회성 실행 스크립트.

탱크옥션 워커(crawler.service.ts의 startWorker())는 백엔드가 관리자의
"조회 시작" 클릭 시점에 파이썬 프로세스를 직접 spawn한다 — 관리자가 로컬
에서 별도로 뭔가를 켜둔 적이 없다(사용자 확인, 2026-08-07). 이 워커도
같은 방식으로 바꿨다: 처음엔 상시 폴링 데몬으로 만들었었는데, 그러면
관리자가 로컬 PC에서 계속 띄워둬야 해서 탱크와 동작 방식이 달랐다.

이제는 백엔드(NiceCrawlerService)가 "조회 시작"을 누르는 순간
`python nice_worker.py '<NiceSearchConfig JSON>'` 형태로 1회 실행하고,
이 스크립트는 검색→objId 수집→상세조회→저장까지 끝내고 종료한다.
나이스는 로그인도 브라우저도 필요 없어(httpx만으로 충분) 탱크처럼
상시 떠 있는 서버(runner.py serve)를 둘 이유가 없다 — 매번 짧게 실행하고
끝내는 쪽이 더 단순하고 좀비 프로세스 걱정도 없다.

사용: python nice_worker.py '<NiceSearchConfig JSON 문자열>'
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import sys

import httpx

from nice_client import fetch_obj_detail, make_client, search_advanced
from nice_map_to_raw import nice_obj_to_raw

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

API_BASE = os.environ.get("PRODUCTION_API_URL", "https://auction-production-2c72.up.railway.app")
CRAWLER_SECRET = os.environ.get("CRAWLER_SECRET", "local-crawler-secret")
REQUEST_DELAY_SEC = 0.8
SEARCH_PAGE_SIZE = 100

HEADERS = {"x-crawler-secret": CRAWLER_SECRET}


def log(message: str, level: str = "info") -> None:
    prefix = {"info": " ", "warn": "!", "error": "X"}.get(level, " ")
    print(f"[{prefix}] {message}", flush=True)
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
        print(f"[!] progress 보고 실패: {e}", flush=True)


def build_search_params(config: dict) -> dict:
    """NiceSearchConfig → 나이스 검색 API 쿼리 파라미터."""
    params: dict = {}
    if config.get("yongdoCd"):
        params["yongdoCd"] = ",".join(config["yongdoCd"])
    if config.get("objProgStatusCd"):
        params["objProgStatusCd"] = ",".join(config["objProgStatusCd"])
    if config.get("objTypes"):
        params["objTypes"] = config["objTypes"]
    if config.get("specialObjCd"):
        params["specialObjCd"] = ",".join(config["specialObjCd"])
        params["specialObjCdMode"] = config.get("specialObjCdMode") or "exclude"
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
    if len(sys.argv) < 2:
        print("사용법: python nice_worker.py '<NiceSearchConfig JSON>'")
        sys.exit(1)
    try:
        config = json.loads(sys.argv[1])
    except (TypeError, ValueError) as e:
        log(f"검색조건 JSON 파싱 실패: {e}", "error")
        report(phase="error", running=False, error=f"검색조건 JSON 파싱 실패: {e}")
        sys.exit(1)

    try:
        asyncio.run(run_once(config))
    except Exception as e:  # noqa: BLE001
        log(f"워커 실행 중 오류: {e}", "error")
        report(phase="error", running=False, error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
