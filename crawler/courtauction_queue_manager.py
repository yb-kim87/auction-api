"""법원경매정보 목록→상세 크롤링 파이프라인.

queue_manager.py(탱크옥션용)와 동일한 asyncio.Queue 기반 생산자-소비자
구조를 재사용한다. 차이점:
  - 로그인이 필요 없다(법원경매정보는 물건 조회에 로그인 불필요).
  - task 하나 = 목록에서 얻은 물건 식별자(csNo/cortOfcCd/dspslGdsSeq).
"""

from __future__ import annotations

import asyncio
import os
import random
from dataclasses import dataclass, field

import httpx

from courtauction_client import (
    build_detail_payload,
    build_list_payload,
    fetch_detail,
    fetch_list_page,
    make_client,
)
from courtauction_parsers import parse_detail, parse_list_item
from exceptions import NonRetryableError, RetryableError
from repository import post_item_to_api

CRAWL_CONCURRENCY = int(os.environ.get("CRAWL_CONCURRENCY", "5"))
CRAWL_REQUEST_DELAY_MIN = float(os.environ.get("CRAWL_REQUEST_DELAY_MIN", "0.2"))
CRAWL_REQUEST_DELAY_MAX = float(os.environ.get("CRAWL_REQUEST_DELAY_MAX", "0.8"))
CRAWL_MAX_RETRIES = int(os.environ.get("CRAWL_MAX_RETRIES", "3"))


@dataclass
class DetailTask:
    sequence: int
    cs_no: str
    cort_ofc_cd: str
    dspsl_gds_seq: str
    srch_info: dict
    retry_count: int = 0


@dataclass
class DetailResult:
    task: DetailTask
    success: bool
    data: dict | None = None
    error: str | None = None


def _backoff_delay(retry_count: int, *, base_delay: float = 0.5) -> float:
    return base_delay * (2**retry_count) + random.uniform(0, 0.5)


async def collect_list_items(
    client: httpx.AsyncClient,
    *,
    bid_bgng_ymd: str,
    bid_end_ymd: str,
    mcls_usg_cd: str = "20100",
    scls_usg_cd: str = "",
    max_pages: int = 5,
    page_size: int = 40,
) -> tuple[list[dict], dict]:
    """목록 API를 페이지네이션하며 물건 원소를 모두 모은다.
    반환값: (물건 리스트, 마지막으로 쓴 검색조건 dict — 상세 조회 시 srchInfo로 재사용)"""
    all_items: list[dict] = []
    srch_info: dict = {}
    for page_no in range(1, max_pages + 1):
        payload = build_list_payload(
            page_no=page_no,
            page_size=page_size,
            bid_bgng_ymd=bid_bgng_ymd,
            bid_end_ymd=bid_end_ymd,
            mcls_usg_cd=mcls_usg_cd,
            scls_usg_cd=scls_usg_cd,
        )
        srch_info = payload["dma_srchGdsDtlSrchInfo"]
        data = await fetch_list_page(client, payload)
        items = data.get("dlt_srchResult", [])
        all_items.extend(items)

        total_cnt = int(data.get("dma_pageInfo", {}).get("totalCnt", 0) or 0)
        if len(all_items) >= total_cnt or not items:
            break
        await asyncio.sleep(random.uniform(CRAWL_REQUEST_DELAY_MIN, CRAWL_REQUEST_DELAY_MAX))

    return all_items, srch_info


async def _process_detail_task(
    client: httpx.AsyncClient, task: DetailTask, *, max_retries: int
) -> DetailResult:
    while True:
        try:
            payload = build_detail_payload(
                cs_no=task.cs_no,
                cort_ofc_cd=task.cort_ofc_cd,
                dspsl_gds_seq=task.dspsl_gds_seq,
                srch_info=task.srch_info,
            )
            dma_result = await fetch_detail(client, payload)
            data = parse_detail(dma_result)
            return DetailResult(task=task, success=True, data=data)
        except RetryableError as exc:
            if task.retry_count >= max_retries:
                return DetailResult(
                    task=task, success=False, error=f"재시도 {max_retries}회 초과: {exc}"
                )
            delay = exc.retry_after if exc.retry_after else _backoff_delay(task.retry_count)
            task.retry_count += 1
            await asyncio.sleep(delay)
            continue
        except NonRetryableError as exc:
            return DetailResult(task=task, success=False, error=str(exc))


async def _worker(
    queue: "asyncio.Queue[DetailTask | None]",
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    results: list[DetailResult],
    results_lock: asyncio.Lock,
    *,
    max_retries: int,
    save_to_db: bool,
) -> None:
    while True:
        task = await queue.get()
        if task is None:
            queue.task_done()
            break
        try:
            async with semaphore:
                result = await _process_detail_task(client, task, max_retries=max_retries)
                if result.success and save_to_db and result.data:
                    try:
                        await post_item_to_api(client, result.data)
                    except httpx.HTTPError as save_exc:
                        result = DetailResult(
                            task=task, success=False, error=f"DB 저장 실패: {save_exc}"
                        )
                await asyncio.sleep(
                    random.uniform(CRAWL_REQUEST_DELAY_MIN, CRAWL_REQUEST_DELAY_MAX)
                )
            async with results_lock:
                results.append(result)
        except Exception as exc:  # noqa: BLE001
            async with results_lock:
                results.append(DetailResult(task=task, success=False, error=f"미분류 오류: {exc}"))
        finally:
            queue.task_done()


async def run_courtauction_crawl(
    *,
    bid_bgng_ymd: str,
    bid_end_ymd: str,
    mcls_usg_cd: str = "20100",
    scls_usg_cd: str = "",
    max_pages: int = 5,
    page_size: int = 40,
    concurrency: int = CRAWL_CONCURRENCY,
    worker_count: int = 5,
    max_retries: int = CRAWL_MAX_RETRIES,
    save_to_db: bool = False,
) -> list[DetailResult]:
    async with make_client() as client:
        list_items, srch_info = await collect_list_items(
            client,
            bid_bgng_ymd=bid_bgng_ymd,
            bid_end_ymd=bid_end_ymd,
            mcls_usg_cd=mcls_usg_cd,
            scls_usg_cd=scls_usg_cd,
            max_pages=max_pages,
            page_size=page_size,
        )

        queue: asyncio.Queue[DetailTask | None] = asyncio.Queue()
        for i, item in enumerate(list_items):
            parsed = parse_list_item(item)
            queue.put_nowait(
                DetailTask(
                    sequence=i,
                    cs_no=parsed["cs_no"],
                    cort_ofc_cd=parsed["cort_ofc_cd"],
                    dspsl_gds_seq=parsed["dspsl_gds_seq"],
                    srch_info=srch_info,
                )
            )

        semaphore = asyncio.Semaphore(concurrency)
        results: list[DetailResult] = []
        results_lock = asyncio.Lock()

        workers = [
            asyncio.create_task(
                _worker(
                    queue,
                    client,
                    semaphore,
                    results,
                    results_lock,
                    max_retries=max_retries,
                    save_to_db=save_to_db,
                )
            )
            for _ in range(worker_count)
        ]

        await queue.join()
        for _ in workers:
            queue.put_nowait(None)
        await asyncio.gather(*workers)

    results.sort(key=lambda r: r.task.sequence)
    return results


if __name__ == "__main__":
    import sys
    from datetime import date, timedelta

    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    today = date.today()
    bgng = today.strftime("%Y%m%d")
    end = (today + timedelta(days=14)).strftime("%Y%m%d")

    async def _main() -> None:
        results = await run_courtauction_crawl(
            bid_bgng_ymd=bgng,
            bid_end_ymd=end,
            max_pages=1,
            page_size=n,
            save_to_db=False,
        )
        ok = [r for r in results if r.success]
        fail = [r for r in results if not r.success]
        print(f"총 {len(results)}건, 성공 {len(ok)}건, 실패 {len(fail)}건")
        for r in ok[:3]:
            print(" -", r.data.get("auctionNo"), r.data.get("address"), r.data.get("appraisedValue"))
        for r in fail:
            print("  ! 실패:", r.task.cs_no, r.error)

    asyncio.run(_main())
