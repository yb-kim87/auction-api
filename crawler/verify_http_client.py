"""2단계 검증 스크립트: 로그인 없이 목록 1페이지, 필요하면 로그인 후 상세 1건을 호출해
콘솔에 결과를 요약하고 응답 원본을 tests/crawler/fixtures/ 에 저장한다.

실행: python verify_http_client.py [tid]
  tid 를 안 주면 목록 1페이지만 검증한다.
"""

from __future__ import annotations

import asyncio
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

from http_client import (
    LoginCredentialsMissing,
    SessionInvalidError,
    fetch_detail,
    fetch_list_page,
    login,
    make_client,
)

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "tests" / "crawler" / "fixtures"


def _save_fixture(name: str, payload: dict) -> Path:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    path = FIXTURE_DIR / name
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


async def main() -> None:
    tid = sys.argv[1] if len(sys.argv) > 1 else None

    async with make_client() as client:
        print("[1/3] 로그인 시도...")
        try:
            await login(client)
        except LoginCredentialsMissing as exc:
            print(f"  -> 실패: {exc}")
            print("     .env 에 TANKAUCTION_ID / TANKAUCTION_PW 를 설정한 뒤 다시 실행하세요.")
            return
        except SessionInvalidError as exc:
            print(f"  -> 실패: {exc}")
            return
        print("  -> 로그인 성공, access_token 쿠키 확보")

        print("[2/3] 목록 API 요청...")
        list_data = await fetch_list_page(client, page_no=1, data_size=5)
        items = list_data.get("items") or []
        print(
            f"  -> resultCode={list_data.get('resultCode')} "
            f"totalCount={list_data.get('totalCount')} items={len(items)}건"
        )
        path = _save_fixture("list_page1.json", list_data)
        print(f"  -> 저장: {path}")

        if not tid:
            print("[안내] tid 인자를 주면 상세 API도 검증합니다.")
            print("       예: python verify_http_client.py 1935310")
            return

        print(f"[3/3] 상세 API 요청 (tid={tid})...")
        try:
            detail = await fetch_detail(client, tid)
        except SessionInvalidError as exc:
            print(f"  -> 실패: {exc}")
            return
        base = detail.get("baseInfo") or {}
        print(
            f"  -> resultCode={base.get('rsltCd')} "
            f"auctionNo={base.get('sn1')}타경{base.get('sn2')} "
            f"필드수={len(base)}"
        )
        path = _save_fixture(f"detail_{tid}.json", detail)
        print(f"  -> 저장: {path}")


if __name__ == "__main__":
    asyncio.run(main())
