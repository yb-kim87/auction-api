"""법원경매정보 API 응답을 기존 NestJS UpdateAuctionDto 필드 형태로 변환.

parsers.py(탱크옥션용)와 동일한 역할 — courtauction_client.fetch_list_page()/
fetch_detail()이 반환한 raw dict를 받아 repository.post_item_to_api()가
그대로 보낼 수 있는 payload를 만든다.
"""

from __future__ import annotations

import re


def _to_int(value) -> int:
    if value is None:
        return 0
    try:
        return int(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return 0


def _ymd_to_dash(ymd: str | None) -> str:
    """"20260730" → "2026-07-30". 형식이 안 맞으면 원문 그대로 둔다."""
    if not ymd or not re.fullmatch(r"\d{8}", str(ymd)):
        return str(ymd or "")
    s = str(ymd)
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"


def parse_list_item(item: dict) -> dict:
    """목록 API dlt_srchResult 원소 하나 → 상세 조회에 필요한 식별자 + 미리보기 필드.

    srnSaNo는 "2008타경25092"처럼 사람이 읽는 사건번호 표시값이고,
    boCd(법원코드)/mokmulSer(물건순번)와 함께 상세 API 파라미터로 그대로 쓴다.
    """
    return {
        "cs_no": item.get("srnSaNo", ""),
        "cort_ofc_cd": item.get("boCd", ""),
        "dspsl_gds_seq": item.get("mokmulSer", "1"),
        "auction_no": item.get("srnSaNo", ""),
        "appraised_value": _to_int(item.get("gamevalAmt")),
        "min_price": _to_int(item.get("minmaePrice")),
        "bid_date": _ymd_to_dash(item.get("maeGiil")),
    }


def build_address(objct: dict) -> str:
    """gdsDspslObjctLst 원소에서 표시용 전체 주소를 만든다.
    userPrintSt가 이미 완성된 주소 문자열을 제공하면 그걸 우선 사용한다."""
    printed = (objct.get("userPrintSt") or "").strip()
    if printed:
        return printed
    parts = [
        objct.get("adongSdNm"),
        objct.get("adongSggNm"),
        objct.get("adongEmdNm"),
        objct.get("rprsLtnoAddr"),
        objct.get("bldDtlDts"),
    ]
    return " ".join(p for p in parts if p)


def parse_detail(dma_result: dict) -> dict:
    """상세 API dma_result → UpdateAuctionDto 필드로 매핑.

    법원경매정보는 등기부 요약(rgltLandLstAll)·건물구조(bldSdtrDtlLstAll)를
    각각 배열로 주므로, 텍스트로 이어붙여 buildingRegistry에 담는다.
    """
    base = dma_result.get("csBaseInfo", {}) or {}
    dxdy = dma_result.get("dspslGdsDxdyInfo", {}) or {}
    objct = dma_result.get("gdsDspslObjctLst", {}) or {}
    if isinstance(objct, list):
        objct = objct[0] if objct else {}

    land_list = dma_result.get("rgltLandLstAll") or []
    bld_list = dma_result.get("bldSdtrDtlLstAll") or []

    building_registry_lines = []
    for row in bld_list:
        detail = (row.get("bldSdtrDtlDts") or "").strip()
        if detail:
            building_registry_lines.append(detail)
    building_registry = "\n\n".join(building_registry_lines)

    land_share = ""
    if land_list:
        first_land = land_list[0]
        land_share = f"{first_land.get('landArDts', '')} ({first_land.get('landLdcgDts', '')})"

    area = (objct.get("pjbBuldList") or "").strip()
    # pjbBuldList 예: "철근콘크리트조\n67.87㎡" — 마지막 줄(면적)만 area로 사용
    area_match = re.search(r"([\d.]+)\s*㎡", area)
    area_text = f"{area_match.group(1)}㎡" if area_match else area

    special_note_parts = [
        dxdy.get("gdsSpcfcRmk"),
        dxdy.get("tprtyRnkHypthcStngDts"),
    ]
    special_note = "\n".join(p for p in special_note_parts if p)

    return {
        "auctionNo": base.get("userCsNo") or base.get("csNo", ""),
        "address": build_address(objct),
        "usage": objct.get("rletDvsDts") or "",
        "area": area_text,
        "bidDate": _ymd_to_dash(dxdy.get("dspslDxdyYmd")),
        "appraisedValue": _to_int(dxdy.get("aeeEvlAmt")),
        "minPrice": _to_int(dxdy.get("fstPbancLwsDspslPrc")),
        "landShare": land_share,
        "buildingRegistry": building_registry,
        "specialNote": special_note,
        "bidInfo": dxdy.get("dspslPlcNm") or "",
        "recordTime": "",
    }
