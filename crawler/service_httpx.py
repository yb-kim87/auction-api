"""5단계: 목록 → 상세(+EnvViewData) 전체 흐름을 하나로 묶는 오케스트레이터.

기존 server.py/crawl_worker 를 대체하지 않는다. 아직 asyncio.Queue 병렬화(6단계)
이전이라 순차 처리만 하며, DB 저장(post_item_to_api)도 연결하지 않는다
(8단계 예정). 목록과 상세가 모두 합쳐진 완성된 딕셔너리만 반환하고, 중간
불완전 상태를 절대 내보내지 않는다.
"""

from __future__ import annotations

import asyncio

import httpx

from http_client import (
    SessionInvalidError,
    fetch_detail,
    fetch_env_view_data,
    fetch_list_page,
    login,
    make_client,
)
from parsers import parse_detail_page, parse_list_page


async def crawl_one_item(client: httpx.AsyncClient, tid: str) -> dict:
    """상세 + EnvViewData 를 모두 가져와 병합된 완성 결과 하나를 반환.

    fetch_detail 실패(세션만료 등)는 그대로 위로 전파한다 — 호출자가 실패
    목록에 기록할지 재시도할지 판단(7단계에서 재시도 정책 추가 예정).
    EnvViewData 실패는 fetch_env_view_data 내부에서 이미 None 으로 흡수됨
    (교육환경 등 보조 정보이므로 상세 자체를 실패시키지 않음).
    """
    detail = await fetch_detail(client, tid)
    env_payload = await fetch_env_view_data(client, tid)
    return parse_detail_page(detail, env_payload)


async def crawl_list_and_details(
    *, page_no: int = 1, data_size: int = 20, max_items: int | None = None
) -> tuple[list[dict], list[dict]]:
    """목록 1페이지를 가져와 각 tid의 상세를 순차 조회.

    반환: (성공한 완성 결과 리스트, 실패 기록 리스트). 실패 기록은
    {"tid":..., "auctionNo":..., "error":...} 형태 — 11단계 로그 요구사항
    (사건번호/URL/식별자로 실패를 추적 가능해야 함)을 충족.
    순차 처리이며 동시성 제한/재시도는 6~7단계에서 추가.
    """
    results: list[dict] = []
    failures: list[dict] = []

    async with make_client() as client:
        await login(client)

        list_data = await fetch_list_page(client, page_no=page_no, data_size=data_size)
        list_items = parse_list_page(list_data)
        if max_items is not None:
            list_items = list_items[:max_items]

        for list_item in list_items:
            tid = list_item["tid"]
            if not tid:
                continue
            try:
                detail_result = await crawl_one_item(client, tid)
                results.append(detail_result)
            except SessionInvalidError as exc:
                failures.append(
                    {
                        "tid": tid,
                        "auctionNo": list_item.get("auctionNo"),
                        "error": str(exc),
                    }
                )
            except httpx.HTTPError as exc:
                failures.append(
                    {
                        "tid": tid,
                        "auctionNo": list_item.get("auctionNo"),
                        "error": f"HTTP 오류: {exc}",
                    }
                )

    return results, failures


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

    max_items = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    results, failures = asyncio.run(crawl_list_and_details(max_items=max_items))
    print(f"성공 {len(results)}건, 실패 {len(failures)}건")
    for r in results:
        print(f"  - {r['auctionNo']} / {r['address']}")
    for f in failures:
        print(f"  ! 실패 tid={f['tid']} auctionNo={f['auctionNo']} : {f['error']}")

    out_dir = Path(__file__).resolve().parent.parent / "tests" / "crawler" / "fixtures"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "service_httpx_sample.json").write_text(
        json.dumps({"results": results, "failures": failures}, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
