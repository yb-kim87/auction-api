"""7단계: 재시도 가능/불가능 오류를 명확히 구분하는 예외 타입.

요청 지침의 오류 유형별 차등 처리 기준:
- 타임아웃/일시적 서버오류(500/502/503/504) → 재시도
- 429 → Retry-After 확인 후 재시도
- 파싱오류 → HTML/JSON 원문 저장 후 실패 처리(재시도 안 함)
- 인증/세션만료 → 즉시 명확한 오류(재시도 안 함, 재로그인은 상위 계층이 판단)
- 존재하지 않는 페이지(404) → 재시도 안 함
"""

from __future__ import annotations


class CrawlError(RuntimeError):
    """모든 크롤링 오류의 기반 클래스."""


class RetryableError(CrawlError):
    """재시도하면 성공할 가능성이 있는 오류(타임아웃, 5xx, 429)."""

    def __init__(self, message: str, *, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class NonRetryableError(CrawlError):
    """재시도해도 결과가 바뀌지 않는 오류(404, 파싱 실패 등)."""


class SessionExpiredError(CrawlError):
    """인증/세션 만료 — 같은 요청 재시도가 아니라 재로그인이 필요."""
