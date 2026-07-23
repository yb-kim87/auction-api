"""Selenium 네트워크 관찰로 발견한 코드표 API들을 httpx로 재현해 응답을
저장한다(브라우저 재접속 없이, 이미 알아낸 엔드포인트만 순수 httpx 요청).
사용자 지침(2026-07-23): 접근 최소화, 결과는 파일로 저장해 재요청 방지."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx

BASE_URL = "https://www.courtauction.go.kr"
OUT_DIR = Path(__file__).resolve().parent / "courtauction_probe"

HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Referer": f"{BASE_URL}/pgj/index.on",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
}

# Selenium 네트워크 캡처(diagnose_courtauction_request_bodies.py, 삭제됨)로
# 확인한 정확한 요청 body를 그대로 재현.
REQUESTS = [
    ("cort_ofc_list", "/pgj/pgj002/selectCortOfcLst.on", {"cortExecrOfcDvsCd": "00079B"}),
    ("lcl_list", "/pgj/pgj002/selectLclLst.on", {"dsignUsgDvsCd": ""}),
    ("sccd_stg_systm_cd", "/pgj/scframe/lib/sccd/list.on", {"intgGrpCdLst": "STG-SYSTM_CD"}),
    ("sccd_bid_dvs_cd", "/pgj/scframe/lib/sccd/list.on", {"intgGrpCdLst": "PGJ-BID_DVS_CD"}),
    (
        "sccd_rlet_dspsl_spc_cond_cd",
        "/pgj/scframe/lib/sccd/list.on",
        {"intgGrpCdLst": "PGJ-RLET_DSPSL_SPC_COND_CD"},
    ),
]


async def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    async with httpx.AsyncClient(base_url=BASE_URL, headers=HEADERS, timeout=20) as client:
        for name, path, payload in REQUESTS:
            print(f"[요청] {path} payload={payload}")
            try:
                resp = await client.post(path, json=payload)
                print(f"    status={resp.status_code}")
                try:
                    body = resp.json()
                    out_path = OUT_DIR / f"{name}.json"
                    out_path.write_text(
                        json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8"
                    )
                    print(f"    저장: {out_path}")
                except Exception as exc:
                    print(f"    ! JSON 파싱 실패: {exc}, 응답 일부: {resp.text[:200]!r}")
            except Exception as exc:
                print(f"    ! 요청 실패: {exc}")
            await asyncio.sleep(2)  # 연속 요청 사이 최소 간격


if __name__ == "__main__":
    asyncio.run(main())
