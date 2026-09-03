"""대법원 법원경매정보(courtauction.go.kr) 작업목록 수집 스크립트 — 나이스
옥션 nice_collect.py와 동일한 계약(백엔드가 동기 실행해 표준출력 마지막
줄의 JSON 한 줄만 파싱한다. 진행 로그는 표준에러로 보낸다).

2026-09-03 실측: cortOfcCd(법원코드)가 반드시 있어야 목록 API가 400을
내지 않는다(docs/history/2026-07-19_01_courtauction-httpx-exploration.md
追記 참고) — 이 스크립트는 호출부(courtauction-crawler.service.ts)에서
이미 검증한 뒤 넘겨준다고 가정하되, 방어적으로 한 번 더 확인한다.

목록 API 한 번으로 화면에 필요한 핵심 필드(주소/용도/감정가/최저가/매각
기일 등) 대부분을 이미 받아오므로, 나이스와 달리 이 단계에서 objId만
따로 뽑지 않고 **물건 raw 전체를 그대로 작업목록에 담는다** — 이후
"조회 시작" 단계가 추가 사이트 요청 없이 서버에서 바로 저장할 수 있게
하기 위함(대법원 사이트 접근 최소화 원칙).

사용: python courtauction_collect.py '<CourtAuctionSearchConfig JSON>'
출력(stdout, 마지막 줄): {"items": [{"docid": "...", "label": "...", "raw": {...}}], "total": N}
"""

from __future__ import annotations

import asyncio
import io
import json
import sys

from courtauction_client import build_list_payload, fetch_list_page, make_client

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

PAGE_SIZE = 40
PAGE_DELAY_SEC = 0.5


def elog(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def _item_label(item: dict) -> str:
    parts = [
        str(item.get("srnSaNo") or ""),
        " ".join(
            p
            for p in [item.get("hjguSido"), item.get("hjguSigu"), item.get("hjguDong")]
            if p
        ),
    ]
    return " · ".join(p for p in parts if p).strip()


async def collect(config: dict) -> dict:
    cort_ofc_cd = str(config.get("cortOfcCd") or "").strip()
    if not cort_ofc_cd:
        raise ValueError("법원을 선택해 주세요(cortOfcCd 필수).")
    max_items = int(config.get("maxItems") or 40)

    items: list[dict] = []
    total = 0
    async with make_client() as client:
        page = 1
        while len(items) < max_items:
            page_size = min(PAGE_SIZE, max_items - len(items))
            payload = build_list_payload(
                page_no=page,
                page_size=page_size,
                bid_bgng_ymd=str(config.get("bidBgngYmd") or ""),
                bid_end_ymd=str(config.get("bidEndYmd") or ""),
                lcls_usg_cd=str(config.get("lclDspslGdsLstUsgCd") or ""),
                mcls_usg_cd=str(config.get("mclDspslGdsLstUsgCd") or ""),
                scls_usg_cd=str(config.get("sclDspslGdsLstUsgCd") or ""),
                cort_ofc_cd=cort_ofc_cd,
            )
            data = await fetch_list_page(client, payload)
            total = int(data.get("dma_pageInfo", {}).get("totalCnt") or 0)
            batch = data.get("dlt_srchResult", [])
            if not batch:
                break
            for item in batch:
                docid = str(item.get("docid") or item.get("groupmaemulser") or "")
                items.append({"docid": docid, "label": _item_label(item), "raw": item})
            elog(f"검색 결과 {total:,}건 중 {len(items)}건 수집(페이지 {page})")
            if len(batch) < page_size:
                break
            page += 1
            await asyncio.sleep(PAGE_DELAY_SEC)

    return {"items": items, "total": total}


def main() -> None:
    if len(sys.argv) < 2:
        elog("사용법: python courtauction_collect.py '<CourtAuctionSearchConfig JSON>'")
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
