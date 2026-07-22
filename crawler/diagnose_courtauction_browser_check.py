"""브라우저(실제 크롬)로 법원경매정보 검색이 지금 정상 작동하는지 사람이
직접 눈으로 확인할 수 있도록 창을 띄운다. HTTPX가 400을 계속 반환하는
원인이 IP 차단인지, 아니면 다른 문제인지 구분하기 위한 최종 확인용."""

from __future__ import annotations

import time

import undetected_chromedriver as uc

MAIN_URL = "https://www.courtauction.go.kr/pgj/index.on"
WAIT_SECONDS = 60


def _build_options() -> uc.ChromeOptions:
    opts = uc.ChromeOptions()
    opts.add_argument("--lang=ko-KR")
    opts.add_argument("--window-size=1600,1000")
    return opts


def main() -> None:
    driver = uc.Chrome(options=_build_options())
    try:
        driver.get(MAIN_URL)
        print(
            f"[안내] {WAIT_SECONDS}초 동안 직접 '물건상세검색' → 검색을 눌러보고,\n"
            "정상적으로 물건 목록이 뜨는지 확인해 주세요.\n"
            "(같은 IP인데 브라우저로는 되고 HTTPX만 400이면 봇 차단, 브라우저도 안 되면 사이트/네트워크 문제)"
        )
        time.sleep(WAIT_SECONDS)
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
