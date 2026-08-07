"""나이스옥션 작업목록 수집 전용 스크립트 — 탱크옥션의 "주소 추가"에
대응한다(작업목록 스테이징 도입, 2026-08-07). nice_worker.py는 검색부터
상세조회·저장까지 한 번에 끝내는 1회성 스크립트였는데, 탱크와 동일하게
"검색으로 목록을 먼저 만들고 다듬은 뒤 조회 시작" 흐름을 만들려면 검색만
따로 떼어낼 스크립트가 필요했다.

백엔드(NiceCrawlerService.collect())가 이 스크립트를 동기적으로 실행하고
표준출력의 마지막 줄(JSON 한 줄)만 파싱한다 — 진행 로그는 표준에러로
보내 표준출력을 순수 JSON으로만 유지한다.

사용: python nice_collect.py '<NiceSearchConfig JSON 문자열>'
출력(stdout, 마지막 줄): {"items": [{"objId": "...", "label": "..."}], "total": N}
"""

from __future__ import annotations

import asyncio
import io
import json
import sys

from nice_client import build_search_params, make_client, obj_label, search_advanced

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

SEARCH_PAGE_SIZE = 100


def elog(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


async def collect(config: dict) -> dict:
    max_items = int(config.get("maxItems") or 50)
    params = build_search_params(config)
    items: list[dict] = []
    total = 0
    async with make_client() as client:
        page = 1
        while len(items) < max_items:
            page_size = min(SEARCH_PAGE_SIZE, max_items - len(items))
            batch, total = await search_advanced(client, params, page, page_size)
            if not batch:
                break
            for item in batch:
                items.append({"objId": str(item["objId"]), "label": obj_label(item)})
            elog(f"검색 결과 {total:,}건 중 {len(items)}건 수집(페이지 {page})")
            if len(batch) < page_size:
                break
            page += 1
            await asyncio.sleep(0.3)
    return {"items": items, "total": total}


def main() -> None:
    if len(sys.argv) < 2:
        elog("사용법: python nice_collect.py '<NiceSearchConfig JSON>'")
        sys.exit(1)
    try:
        config = json.loads(sys.argv[1])
    except (TypeError, ValueError) as e:
        elog(f"검색조건 JSON 파싱 실패: {e}")
        print(json.dumps({"error": f"검색조건 JSON 파싱 실패: {e}"}), flush=True)
        sys.exit(1)

    try:
        result = asyncio.run(collect(config))
    except Exception as e:  # noqa: BLE001
        elog(f"수집 중 오류: {e}")
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)

    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
