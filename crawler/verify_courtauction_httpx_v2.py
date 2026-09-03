"""캡처한 실제 브라우저 요청(2026-09-03, Playwright 캡처)을 그대로 재현해
httpx로도 성공하는지 검증한다. 이전 400 원인 후보(법원코드 미지정, 오래된
UA/헤더 누락)를 실제 캡처값으로 교체해서 딱 1회만 호출한다.
"""
from __future__ import annotations

import asyncio
import json

import httpx

BASE_URL = "https://www.courtauction.go.kr"
LIST_PATH = "/pgj/pgjsearch/searchControllerMain.on"

# 2026-09-03 Playwright로 캡처한 실제 요청 헤더 그대로.
HEADERS = {
    "Content-Type": "application/json;charset=UTF-8",
    "Accept": "application/json",
    "Referer": f"{BASE_URL}/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml",
    "submissionid": "mf_wfm_mainFrame_sbm_selectGdsDtlSrch",
    "sc-userid": "SYSTEM",
    "sec-ch-ua-platform": '"Windows"',
    "sec-ch-ua": '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
    "sec-ch-ua-mobile": "?0",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
    ),
}

# 캡처한 실제 요청 본문 그대로(법원코드 B000210 포함).
LIST_PAYLOAD = {
    "dma_pageInfo": {"pageNo": 1, "pageSize": 10, "bfPageNo": "", "startRowNo": "", "totalCnt": "", "totalYn": "Y", "groupTotalCount": ""},
    "dma_srchGdsDtlSrchInfo": {
        "rletDspslSpcCondCd": "", "bidDvsCd": "000331", "mvprpRletDvsCd": "00031R",
        "cortAuctnSrchCondCd": "0004601", "rprsAdongSdCd": "", "rprsAdongSggCd": "",
        "rprsAdongEmdCd": "", "rdnmSdCd": "", "rdnmSggCd": "", "rdnmNo": "",
        "mvprpDspslPlcAdongSdCd": "", "mvprpDspslPlcAdongSggCd": "", "mvprpDspslPlcAdongEmdCd": "",
        "rdDspslPlcAdongSdCd": "", "rdDspslPlcAdongSggCd": "", "rdDspslPlcAdongEmdCd": "",
        "cortOfcCd": "B000210", "jdbnCd": "", "execrOfcDvsCd": "",
        "lclDspslGdsLstUsgCd": "", "mclDspslGdsLstUsgCd": "", "sclDspslGdsLstUsgCd": "",
        "cortAuctnMbrsId": "", "aeeEvlAmtMin": "", "aeeEvlAmtMax": "",
        "lwsDspslPrcRateMin": "", "lwsDspslPrcRateMax": "", "flbdNcntMin": "", "flbdNcntMax": "",
        "objctArDtsMin": "", "objctArDtsMax": "", "mvprpArtclKndCd": "", "mvprpArtclNm": "",
        "mvprpAtchmPlcTypCd": "", "notifyLoc": "off", "lafjOrderBy": "", "pgmId": "PGJ151F01",
        "csNo": "", "cortStDvs": "1", "statNum": 1,
        "bidBgngYmd": "20260903", "bidEndYmd": "20260917",
        "dspslDxdyYmd": "", "fstDspslHm": "", "scndDspslHm": "", "thrdDspslHm": "", "fothDspslHm": "",
        "dspslPlcNm": "", "lwsDspslPrcMin": "", "lwsDspslPrcMax": "", "grbxTypCd": "", "gdsVendNm": "",
        "fuelKndCd": "", "carMdyrMax": "", "carMdyrMin": "", "carMdlNm": "", "sideDvsCd": "",
    },
}


async def main() -> None:
    async with httpx.AsyncClient(base_url=BASE_URL, headers=HEADERS, timeout=20) as client:
        resp = await client.post(LIST_PATH, json=LIST_PAYLOAD)
        print(f"status={resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            total = body.get("data", {}).get("dma_pageInfo", {}).get("totalCnt")
            items = body.get("data", {}).get("dlt_srchResult", [])
            print(f"totalCnt={total}, items={len(items)}")
            if items:
                print("첫 항목 사건번호:", items[0].get("srnSaNo"))
        else:
            print(resp.text[:500])


if __name__ == "__main__":
    asyncio.run(main())
