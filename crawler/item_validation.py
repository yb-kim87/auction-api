"""crawl_item() 결과 유효성 검증 — item_crawl.py(validate_crawl_item_reason,
is_valid_crawl_item)에서 selenium 의존 없이 그대로 복제.

item_crawl.py는 naver_crawl.py(Selenium)를 import하므로, v3(완전 HTTPX,
브라우저 없는 서버 배포용) 워커가 Chrome/selenium 없이도 뜨려면 이 검증
로직만 별도 모듈로 분리해야 한다. 원본(item_crawl.py)은 기존 Selenium
경로에서 계속 쓰이므로 삭제하지 않고 그대로 둔다 — 이 파일은 로직을
복제한 것이며, 두 파일의 검증 기준이 달라지지 않도록 원본 수정 시 이
파일도 함께 갱신해야 한다.
"""

from __future__ import annotations

import re

from tank_detail import _normalize_auction_no

_INVALID_AUCTION_HINTS = (
    "MY위젯",
    "도움말",
    "위젯",
    "로그아웃",
    "로그인",
)


def validate_crawl_item_reason(item: dict) -> tuple[bool, str]:
    raw_no = str(item.get("auctionNo") or item.get("auction_no") or "").strip()
    if any(hint in raw_no for hint in _INVALID_AUCTION_HINTS):
        return False, f"로그인/위젯 페이지로 수집됨 (경매번호: {raw_no[:40]})"

    auction_no = _normalize_auction_no(raw_no)
    if not auction_no:
        return False, f"경매번호 추출 실패 (수집값: {raw_no or '없음'})"

    address = str(item.get("address") or "").strip()
    if not address or address in ("없음", "값없음"):
        return False, "주소 추출 실패 (regnAdrs·AuctView API 미수집)"

    link = str(item.get("link") or "").strip()
    if link:
        if "tankauction.com" not in link:
            return False, f"탱크 링크 아님: {link[:60]}"
        if not re.search(r"/(ca|pa)/(caView|paView)\.php", link):
            return False, f"상세 URL 형식 아님: {link[:60]}"

    return True, ""


def is_valid_crawl_item(item: dict) -> bool:
    valid, _ = validate_crawl_item_reason(item)
    return valid
