"""조회 작업 중단 — 워커·item_crawl·naver_crawl 공통."""

from __future__ import annotations

import time
from typing import Callable, Optional

# selenium 은 wait_until()(Selenium WebDriverWait 대체)에서만 필요하다.
# check_stop/CrawlStoppedError는 HTTPX 전용 경량 워커(selenium 미설치
# 환경)에서도 쓰이므로 모듈 최상단에서 selenium을 강제하지 않는다.

ShouldStop = Optional[Callable[[], bool]]


class CrawlStoppedError(Exception):
    """사용자가 조회 중단을 요청한 경우."""


def check_stop(should_stop: ShouldStop) -> None:
    if should_stop and should_stop():
        raise CrawlStoppedError()


def wait_until(
    driver,
    predicate,
    timeout: float = 6,
    should_stop: ShouldStop = None,
    poll: float = 0.15,
) -> bool:
    """WebDriverWait 대체 — 폴링 중 should_stop 확인."""
    from selenium.common.exceptions import TimeoutException

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        check_stop(should_stop)
        try:
            if predicate(driver):
                return True
        except Exception:
            pass
        time.sleep(poll)
    raise TimeoutException()
