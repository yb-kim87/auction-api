"""6~7단계: asyncio.Queue 기반 생산자-소비자 병렬 처리 + 재시도/속도제한/
오류 유형별 차등 처리.

FIFO 순서, 여러 worker, 동시요청수 제한(Semaphore), task_done()/queue.join(),
개별 실패가 전체 중단으로 이어지지 않게 하는 구조.

오류 유형별 정책(요청 지침 5단계 그대로):
- RetryableError(타임아웃/5xx/429) → exponential backoff+jitter로 재시도
- NonRetryableError(404, 파싱실패) → 즉시 실패 처리, 파싱실패는 원문 저장
- SessionExpiredError → 재로그인 1회 시도 후 재시도, 반복 재로그인은 하지 않음
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

from exceptions import NonRetryableError, RetryableError, SessionExpiredError
from http_client import fetch_env_view_data, fetch_detail, login, make_client
from parsers import parse_detail_page
from repository import post_item_to_api

CRAWL_CONCURRENCY = int(os.environ.get("CRAWL_CONCURRENCY", "5"))
CRAWL_REQUEST_DELAY = float(os.environ.get("CRAWL_REQUEST_DELAY", "0.2"))
CRAWL_TIMEOUT = float(os.environ.get("CRAWL_TIMEOUT", "20"))
CRAWL_MAX_RETRIES = int(os.environ.get("CRAWL_MAX_RETRIES", "3"))

FAILED_RESPONSE_DIR = Path(__file__).resolve().parent.parent / "logs" / "crawler_failed_responses"


@dataclass
class CrawlTask:
    sequence: int
    url: str
    task_type: str
    metadata: dict
    retry_count: int = 0


@dataclass
class CrawlResult:
    task: CrawlTask
    success: bool
    data: dict | None = None
    error: str | None = None


_SENTINEL = None


def _backoff_delay(retry_count: int, *, base_delay: float = 0.5) -> float:
    """exponential backoff + jitter — 요청 지침의 공식 그대로."""
    return base_delay * (2**retry_count) + random.uniform(0, 0.5)


def _save_failed_response(tid: str, raw_text: str, reason: str) -> str:
    """파싱 실패 시 원문을 저장(요청 지침: 파싱오류는 HTML 저장 후 실패처리)."""
    FAILED_RESPONSE_DIR.mkdir(parents=True, exist_ok=True)
    path = FAILED_RESPONSE_DIR / f"{int(time.time())}_{tid}.txt"
    path.write_text(f"# reason: {reason}\n\n{raw_text}", encoding="utf-8")
    return str(path)


async def _process_task(
    client: httpx.AsyncClient,
    task: CrawlTask,
    *,
    max_retries: int,
    relogin_state: dict,
    save_to_db: bool,
) -> CrawlResult:
    """단일 task 처리 — 오류 유형에 따라 재시도하거나 즉시 실패로 확정.

    relogin_state: {"attempted": bool} — 세션만료 시 재로그인은 이번 task
    처리 동안 최대 1회만 시도(반복 재로그인 금지, 요청 지침).
    save_to_db: True 면 파싱까지 끝난 완성 결과를 기존 NestJS
    /crawler/import-item 콜백으로 저장(8단계). False 면 파싱 결과만 반환
    (기존 6~7단계 동작 그대로, 회귀 없음 유지).
    """
    tid = task.metadata.get("tid")
    if not tid:
        return CrawlResult(task=task, success=False, error="metadata에 tid 없음")

    while True:
        try:
            detail = await fetch_detail(client, tid)
            env_payload = await fetch_env_view_data(client, tid)
            data = parse_detail_page(detail, env_payload)
            if save_to_db:
                try:
                    await post_item_to_api(client, data)
                except httpx.HTTPError as save_exc:
                    return CrawlResult(
                        task=task, success=False, error=f"DB 저장 실패: {save_exc}"
                    )
            return CrawlResult(task=task, success=True, data=data)

        except SessionExpiredError as exc:
            if relogin_state.get("attempted"):
                return CrawlResult(
                    task=task, success=False, error=f"세션만료(재로그인 후에도 실패): {exc}"
                )
            relogin_state["attempted"] = True
            try:
                await login(client)
            except Exception as login_exc:
                return CrawlResult(
                    task=task, success=False, error=f"재로그인 실패: {login_exc}"
                )
            # 재로그인 성공 시 이번 task는 한 번 더 시도(재시도 횟수에 포함하지 않음)
            continue

        except RetryableError as exc:
            if task.retry_count >= max_retries:
                return CrawlResult(
                    task=task,
                    success=False,
                    error=f"재시도 {max_retries}회 초과: {exc}",
                )
            delay = exc.retry_after if exc.retry_after else _backoff_delay(task.retry_count)
            task.retry_count += 1
            await asyncio.sleep(delay)
            continue

        except NonRetryableError as exc:
            saved_path = ""
            try:
                saved_path = _save_failed_response(tid, str(exc), reason="parsing_or_not_found")
            except OSError:
                pass
            suffix = f" (원문 저장: {saved_path})" if saved_path else ""
            return CrawlResult(task=task, success=False, error=f"{exc}{suffix}")


async def _worker(
    queue: "asyncio.Queue[CrawlTask | None]",
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    results: list[CrawlResult],
    results_lock: asyncio.Lock,
    *,
    max_retries: int,
    request_delay: float,
    relogin_state: dict,
    save_to_db: bool,
) -> None:
    while True:
        task = await queue.get()
        if task is _SENTINEL:
            queue.task_done()
            break
        try:
            async with semaphore:
                result = await _process_task(
                    client,
                    task,
                    max_retries=max_retries,
                    relogin_state=relogin_state,
                    save_to_db=save_to_db,
                )
                if request_delay > 0:
                    await asyncio.sleep(request_delay)
            async with results_lock:
                results.append(result)
        except Exception as exc:  # 예상 못한 예외도 worker를 죽이지 않음
            async with results_lock:
                results.append(CrawlResult(task=task, success=False, error=f"미분류 오류: {exc}"))
        finally:
            queue.task_done()


async def run_detail_tasks(
    tasks: list[CrawlTask],
    *,
    concurrency: int = CRAWL_CONCURRENCY,
    worker_count: int = 5,
    max_retries: int = CRAWL_MAX_RETRIES,
    request_delay: float = CRAWL_REQUEST_DELAY,
    save_to_db: bool = False,
) -> list[CrawlResult]:
    queue: asyncio.Queue[CrawlTask | None] = asyncio.Queue()
    for task in tasks:
        queue.put_nowait(task)

    semaphore = asyncio.Semaphore(concurrency)
    results: list[CrawlResult] = []
    results_lock = asyncio.Lock()
    relogin_state: dict = {"attempted": False}

    async with make_client() as client:
        await login(client)

        workers = [
            asyncio.create_task(
                _worker(
                    queue,
                    client,
                    semaphore,
                    results,
                    results_lock,
                    max_retries=max_retries,
                    request_delay=request_delay,
                    relogin_state=relogin_state,
                    save_to_db=save_to_db,
                )
            )
            for _ in range(worker_count)
        ]

        await queue.join()

        for _ in workers:
            queue.put_nowait(_SENTINEL)
        await asyncio.gather(*workers)

    results.sort(key=lambda r: r.task.sequence)
    return results


if __name__ == "__main__":
    import sys

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

    async def _main() -> None:
        from http_client import fetch_list_page
        from parsers import parse_list_page

        n = int(sys.argv[1]) if len(sys.argv) > 1 else 6
        async with make_client() as client:
            await login(client)
            list_data = await fetch_list_page(client, page_no=1, data_size=n)
        list_items = parse_list_page(list_data)[:n]

        tasks = [
            CrawlTask(
                sequence=i,
                url=item["link"],
                task_type="detail",
                metadata={"tid": item["tid"], "auctionNo": item["auctionNo"]},
            )
            for i, item in enumerate(list_items)
        ]

        results = await run_detail_tasks(tasks, concurrency=3, worker_count=5)
        ok = [r for r in results if r.success]
        fail = [r for r in results if not r.success]
        print(f"총 {len(tasks)}건, 성공 {len(ok)}건, 실패 {len(fail)}건")
        print("처리 순서(sequence):", [r.task.sequence for r in results])
        for r in fail:
            print(f"  ! 실패 seq={r.task.sequence} tid={r.task.metadata.get('tid')}: {r.error}")

        out_dir = Path(__file__).resolve().parent.parent / "tests" / "crawler" / "fixtures"
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "queue_manager_sample.json").write_text(
            json.dumps(
                {
                    "order": [r.task.sequence for r in results],
                    "success_count": len(ok),
                    "fail_count": len(fail),
                    "results": [r.data for r in ok],
                    "failures": [
                        {"sequence": r.task.sequence, "tid": r.task.metadata.get("tid"), "error": r.error}
                        for r in fail
                    ],
                },
                ensure_ascii=False,
                indent=2,
                default=str,
            ),
            encoding="utf-8",
        )

    asyncio.run(_main())
