"""나이스옥션 작업창 워커 — 작업목록(objId 목록) 처리 전용 1회성 스크립트.

작업목록 스테이징 도입(2026-08-07) 이후, 검색은 nice_collect.py가 먼저
맡아 작업목록을 만들고, 관리자가 그 목록을 다듬은 뒤 "조회 시작"을 누르면
백엔드(NiceCrawlerService.start())가 확정된 objId 목록을 이 스크립트에
넘겨 상세조회→저장만 수행한다(탱크옥션 crawler.service.ts의 startWorker()
와 동일하게 백엔드가 "조회 시작" 클릭 시점에 직접 spawn — 관리자가 로컬
에서 별도로 뭔가를 켜둘 필요가 없다).

사용: python nice_worker.py '<objId 문자열 JSON 배열>'
예:   python nice_worker.py '["2036587407075181196", "..."]'
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import sys

import httpx

from nice_client import fetch_obj_detail, make_client
from nice_map_to_raw import nice_obj_to_raw

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

API_BASE = os.environ.get("PRODUCTION_API_URL", "https://auction-production-2c72.up.railway.app")
CRAWLER_SECRET = os.environ.get("CRAWLER_SECRET", "local-crawler-secret")
REQUEST_DELAY_SEC = 0.8

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


async def run_once(obj_ids: list[str]) -> None:
    total = len(obj_ids)
    log(f"조회 시작 — 작업목록 {total}건")
    report(phase="fetching_details", matched=total, completed=0)

    async with make_client() as client:
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
                    log(f"[{i}/{total}] 스킵({result.get('reason')}): {label}", "warn")
                else:
                    tag = "신규" if result.get("created") else "갱신"
                    log(f"[{i}/{total}] {tag}: {label}")
            except Exception as e:  # noqa: BLE001
                log(f"[{i}/{total}] 실패(objId={obj_id}): {e}", "error")
            completed += 1
            report(phase="fetching_details", completed=completed)
            await asyncio.sleep(REQUEST_DELAY_SEC)

    log(f"완료 — {completed}건 처리")
    report(phase="idle", running=False, lastMessage=f"완료 — {completed}건 처리")


def main() -> None:
    if len(sys.argv) < 2:
        print("사용법: python nice_worker.py '<objId JSON 배열>'")
        sys.exit(1)
    try:
        obj_ids = json.loads(sys.argv[1])
        if not isinstance(obj_ids, list):
            raise ValueError("objId 배열이 아닙니다")
    except (TypeError, ValueError) as e:
        log(f"작업목록 JSON 파싱 실패: {e}", "error")
        report(phase="error", running=False, error=f"작업목록 JSON 파싱 실패: {e}")
        sys.exit(1)

    try:
        asyncio.run(run_once([str(x) for x in obj_ids]))
    except Exception as e:  # noqa: BLE001
        log(f"워커 실행 중 오류: {e}", "error")
        report(phase="error", running=False, error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
