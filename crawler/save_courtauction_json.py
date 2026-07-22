"""verify_courtauction_httpx.py와 동일한 목록/상세 API를 딱 1회씩 호출해
전체 JSON 응답을 파일로 저장한다(필드 구조 분석용, 재요청 없이 이 파일만
계속 참고하기 위함). 사용자 지침(2026-07-23): 접근은 최소한으로."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx

from verify_courtauction_httpx import BASE_URL, DETAIL_PATH, HEADERS, LIST_PATH

OUT_DIR = Path(__file__).resolve().parent / "courtauction_probe"

LIST_PAYLOAD = {
    "dma_pageInfo": {
        "pageNo": 1,
        "pageSize": 10,
        "bfPageNo": "",
        "startRowNo": "",
        "totalCnt": "",
        "totalYn": "Y",
        "groupTotalCount": "",
    },
    "dma_srchGdsDtlSrchInfo": {
        "rletDspslSpcCondCd": "",
        "bidDvsCd": "000331",
        "mvprpRletDvsCd": "00031R",
        "cortAuctnSrchCondCd": "0004601",
        "rprsAdongSdCd": "",
        "rprsAdongSggCd": "",
        "rprsAdongEmdCd": "",
        "rdnmSdCd": "",
        "rdnmSggCd": "",
        "rdnmNo": "",
        "mvprpDspslPlcAdongSdCd": "",
        "mvprpDspslPlcAdongSggCd": "",
        "mvprpDspslPlcAdongEmdCd": "",
        "rdDspslPlcAdongSdCd": "",
        "rdDspslPlcAdongSggCd": "",
        "rdDspslPlcAdongEmdCd": "",
        "cortOfcCd": "",
        "jdbnCd": "",
        "execrOfcDvsCd": "",
        "lclDspslGdsLstUsgCd": "20000",
        "mclDspslGdsLstUsgCd": "20100",
        "sclDspslGdsLstUsgCd": "",
        "cortAuctnMbrsId": "",
        "aeeEvlAmtMin": "",
        "aeeEvlAmtMax": "",
        "lwsDspslPrcRateMin": "",
        "lwsDspslPrcRateMax": "",
        "flbdNcntMin": "",
        "flbdNcntMax": "",
        "objctArDtsMin": "",
        "objctArDtsMax": "",
        "mvprpArtclKndCd": "",
        "mvprpArtclNm": "",
        "mvprpAtchmPlcTypCd": "",
        "notifyLoc": "off",
        "lafjOrderBy": "",
        "pgmId": "PGJ151F01",
        "csNo": "",
        "cortStDvs": "1",
        "statNum": 1,
        "bidBgngYmd": "20260719",
        "bidEndYmd": "20260802",
        "dspslDxdyYmd": "",
        "fstDspslHm": "",
        "scndDspslHm": "",
        "thrdDspslHm": "",
        "fothDspslHm": "",
        "dspslPlcNm": "",
        "lwsDspslPrcMin": "",
        "lwsDspslPrcMax": "",
        "grbxTypCd": "",
        "gdsVendNm": "",
        "fuelKndCd": "",
        "carMdyrMax": "",
        "carMdyrMin": "",
        "carMdlNm": "",
        "sideDvsCd": "",
    },
}


async def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    async with httpx.AsyncClient(base_url=BASE_URL, headers=HEADERS, timeout=20) as client:
        print("[1] 목록 API 호출 (1회)")
        list_resp = await client.post(LIST_PATH, json=LIST_PAYLOAD)
        list_body = list_resp.json()
        (OUT_DIR / "list_response.json").write_text(
            json.dumps(list_body, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"    status={list_resp.status_code}, 저장: courtauction_probe/list_response.json")

        items = list_body.get("data", {}).get("dlt_srchResult", [])
        if not items:
            print("    목록이 비어있어 상세 API는 호출하지 않습니다.")
            return

        first = items[0]
        detail_payload = {
            "dma_srchGdsDtlSrch": {
                "csNo": first.get("srnSaNo", ""),
                "cortOfcCd": first.get("boCd", ""),
                "dspslGdsSeq": first.get("mokmulSer", "1"),
                "pgmId": "PGJ151F01",
                "srchInfo": LIST_PAYLOAD["dma_srchGdsDtlSrchInfo"],
            }
        }
        print("\n[2] 상세 API 호출 (1회)")
        detail_resp = await client.post(DETAIL_PATH, json=detail_payload)
        detail_body = detail_resp.json()
        (OUT_DIR / "detail_response.json").write_text(
            json.dumps(detail_body, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"    status={detail_resp.status_code}, 저장: courtauction_probe/detail_response.json")

    print("\n완료 — 이후 필드 분석은 저장된 JSON 파일로만 진행합니다(재요청 없음).")


if __name__ == "__main__":
    asyncio.run(main())
