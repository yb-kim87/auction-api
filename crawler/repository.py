"""8단계: 기존 DB 저장 경로(NestJS POST /crawler/import-item) 연동.

기존 server.py: post_item_to_api() 와 동일한 콜백 인터페이스를 그대로
재사용한다 — Python이 DB에 직접 접근하지 않는다는 기존 원칙을 유지.
차이는 HTTPX 비동기 클라이언트를 쓴다는 것뿐이며, 요청 payload 형태(필드명,
X-Crawler-Secret 인증)는 기존과 동일하게 맞춘다.

새로 발견된 필드(img, rThings, fileInfo, rcaseInfo, hit, x, y, histCnt)는
정식 컬럼에 얹지 않고 "extraData" 키 하나에 모아 보낸다 — NestJS
UpdateAuctionDto.extraData(JSONB 컬럼)로 저장된다(사용자 확정 정책).
"""

from __future__ import annotations

import os

import httpx

EXTRA_DATA_KEYS = ("img", "rThings", "fileInfo", "rcaseInfo", "hit", "x", "y", "histCnt")


def _resolve_callback(
    callback_url: str | None = None, callback_secret: str | None = None
) -> dict:
    return {
        "url": (
            callback_url
            or os.environ.get(
                "CRAWLER_CALLBACK_URL", "http://127.0.0.1:3001/crawler/import-item"
            )
        ).strip(),
        "secret": (
            callback_secret or os.environ.get("CRAWLER_SECRET", "local-crawler-secret")
        ).strip(),
    }


def build_extra_data(raw_detail: dict | None) -> dict | None:
    """AuctView.php 원본 baseInfo에서 신규 발견 필드만 추려 extraData로 구성."""
    if not isinstance(raw_detail, dict):
        return None
    base = raw_detail.get("baseInfo") or {}
    extra: dict = {}
    for key in EXTRA_DATA_KEYS:
        value = base.get(key) if key in base else raw_detail.get(key)
        if value not in (None, "", []):
            extra[key] = value
    return extra or None


async def post_item_to_api(
    client: httpx.AsyncClient,
    item: dict,
    *,
    callback_url: str | None = None,
    callback_secret: str | None = None,
) -> dict:
    """완성된 크롤 결과 하나를 기존 NestJS 콜백으로 전송.

    item 은 parsers.parse_detail_page() 가 반환한, 기존 crawl_item() 과
    동일한 키 집합의 딕셔너리(+선택적으로 extraData 키 포함 가능).
    """
    cfg = _resolve_callback(callback_url, callback_secret)
    payload = {**item, "submittedBy": "crawler-httpx"}
    resp = await client.post(
        cfg["url"],
        json=payload,
        headers={
            "X-Crawler-Secret": cfg["secret"],
            "Content-Type": "application/json",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()
