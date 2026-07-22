"""법원경매정보 목록/상세 API가 로그인 없이 순수 HTTPX 요청만으로도 동작하는지
검증한다. Chrome DevTools로 캡처한 실제 요청 파라미터를 그대로 재현해서
호출해보고, 정상 JSON이 오는지 확인한다.
"""

from __future__ import annotations

import asyncio
import json

import httpx

BASE_URL = "https://www.courtauction.go.kr"
LIST_PATH = "/pgj/pgjsearch/searchControllerMain.on"
DETAIL_PATH = "/pgj/pgj15B/selectAuctnCsSrchRslt.on"

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


async def main() -> None:
    async with httpx.AsyncClient(base_url=BASE_URL, headers=HEADERS, timeout=20) as client:
        list_payload = {
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

        print("[1] 목록 API 호출(로그인 없이, 세션 쿠키 없이)")
        resp = await client.post(LIST_PATH, json=list_payload)
        print(f"    status={resp.status_code}")
        try:
            body = resp.json()
            total = body.get("data", {}).get("dma_pageInfo", {}).get("totalCnt")
            items = body.get("data", {}).get("dlt_srchResult", [])
            print(f"    totalCnt={total}, 이번 페이지 items={len(items)}")
            if items:
                first = items[0]
                print(
                    f"    첫 항목: saNo={first.get('saNo')} "
                    f"hjguSido={first.get('hjguSido')} "
                    f"gamevalAmt={first.get('gamevalAmt')} "
                    f"minmaePrice={first.get('minmaePrice')}"
                )
        except Exception as exc:  # noqa: BLE001
            print(f"    ! JSON 파싱 실패: {exc}")
            print(f"    응답 일부: {resp.text[:300]}")

        if resp.status_code == 200 and items:
            first = items[0]
            detail_payload = {
                "dma_srchGdsDtlSrch": {
                    "csNo": first.get("srnSaNo", ""),
                    "cortOfcCd": first.get("boCd", ""),
                    "dspslGdsSeq": first.get("mokmulSer", "1"),
                    "pgmId": "PGJ151F01",
                    "srchInfo": list_payload["dma_srchGdsDtlSrchInfo"],
                }
            }
            print("\n[2] 상세 API 호출(방금 목록에서 얻은 첫 물건으로)")
            detail_resp = await client.post(DETAIL_PATH, json=detail_payload)
            print(f"    status={detail_resp.status_code}")
            try:
                detail_body = detail_resp.json()
                base_info = detail_body.get("data", {}).get("dma_result", {}).get(
                    "csBaseInfo", {}
                )
                print(f"    csNm={base_info.get('csNm')} cortOfcNm={base_info.get('cortOfcNm')}")
            except Exception as exc:  # noqa: BLE001
                print(f"    ! JSON 파싱 실패: {exc}")
                print(f"    응답 일부: {detail_resp.text[:300]}")


if __name__ == "__main__":
    asyncio.run(main())
