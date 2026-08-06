"""나이스옥션 물건 상세(obj) → 우리 백엔드 mapCrawledItem()이 기대하는
raw 필드 형태로 변환한다(crawler-item.mapper.ts 계약과 1:1 대응).

실측 확인한 필드(2026-08-07, objId=1965189097446179694 실제 라이브
응답으로 검증):
  court.courtNm(법원), soyujaNm(소유자), addrNoPrivacy(주소),
  gamjungAmt/minAmt/maegakAmt(감정가/최저가/매각가), saYear+saNo(사건번호),
  dspslDxdyYmd(매각기일), tojiArea/bldgArea(면적), pnuCd(19자리 PNU).

**불확실한 필드(주의)**: 나이스는 "아파트/오피스텔/연립" 같은 깔끔한
용도 텍스트를 직접 주지 않는다(yejungYongdoNm="집합건물"처럼 법적
분류만 줌). 대신 aptTradePriceLst/rhouseTradePriceLst/
officetelTradePriceLst 중 어느 게 채워져 있는지로 추정한다 — 정확도
100% 보장 못 함, 소규모 파일럿에서 반드시 육안 대조할 것.
"""

from __future__ import annotations

from nice_parsers import (
    build_building_registry_text,
    build_tenant_detail_text,
)

BASE_URL = "https://niceauction.co.kr"


def _s(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _format_bid_date(iso: str) -> str:
    """tank_detail.format_bid_date와 동일한 출력 형식(YYYY.MM.DD)."""
    text = _s(iso)
    if not text:
        return "없음"
    date_part = text.split("T")[0]
    parts = date_part.split("-")
    if len(parts) == 3:
        y, m, d = parts
        try:
            return f"{y}.{int(m):02d}.{int(d):02d}"
        except ValueError:
            return "없음"
    return "없음"


def _infer_usage(obj: dict) -> str:
    """어느 실거래가 리스트가 채워져 있는지로 물건 용도를 추정한다
    (§ 모듈 docstring의 불확실성 참고)."""
    if obj.get("aptTradePriceLst"):
        return "아파트"
    if obj.get("officetelTradePriceLst"):
        return "오피스텔"
    if obj.get("rhouseTradePriceLst"):
        return "연립다세대"
    if obj.get("shouseTradePriceLst"):
        return "단독주택"
    if obj.get("landTradePriceLst"):
        return "토지"
    # 실거래가 리스트가 전부 비어있으면(상가·오래된 건물 등) 건물명
    # 텍스트에서 흔한 키워드를 찾아본다 — 마지막 수단.
    text = f"{_s(obj.get('bldgNm'))} {_s(obj.get('addrNoPrivacy'))}"
    for kw in ["아파트", "오피스텔", "다세대", "연립", "상가", "단독주택"]:
        if kw in text:
            return kw
    return ""


def _pnu_parts(pnu: str) -> tuple[str, str]:
    """19자리 PNU → (lawdCd 5자리, umdNm은 텍스트라 PNU에서 못 뽑음 — 호출부에서 주소로 보강)."""
    pnu = _s(pnu)
    if len(pnu) < 10:
        return "", ""
    return pnu[:5], pnu[5:10]


def nice_obj_to_raw(obj: dict) -> dict:
    """mapCrawledItem(raw)에 그대로 넘길 수 있는 dict를 만든다."""
    obj_id = _s(obj.get("objId"))
    sa_year = _s(obj.get("saYear"))
    sa_no = _s(obj.get("saNo"))
    auction_no = f"{sa_year}타경{sa_no}" if sa_year and sa_no else ""

    court = obj.get("court") or {}
    court_nm = _s(court.get("courtNm"))

    addr = _s(obj.get("addrNoPrivacy"))
    building_area = _s(obj.get("bldgArea"))
    land_area = _s(obj.get("tojiArea"))

    lawd_cd, bjdong_cd = _pnu_parts(_s(obj.get("pnuCd")))

    return {
        "link": f"{BASE_URL}/auction/detail/{obj_id}",
        "auctionNo": auction_no,
        "court": court_nm,
        "address": addr,
        "usage": _infer_usage(obj),
        "area": building_area,
        "sharedArea": "",
        "bidDate": _format_bid_date(_s(obj.get("dspslDxdyYmd"))),
        "appraisedValue": obj.get("gamjungAmt"),
        "minPrice": obj.get("minAmt"),
        "salePrice": obj.get("maegakAmt") if _s(obj.get("maegakAmt")) not in ("", "0") else None,
        "owner": _s(obj.get("soyujaNm")),
        "specialNote": _s(obj.get("objEtc")) or _s(obj.get("dspslGdsRmk")),
        "landShare": land_area,
        "buildingRegistry": build_building_registry_text(obj),
        "tenantDetail": build_tenant_detail_text(obj),
        "lawdCd": lawd_cd or None,
        "umdNm": None,  # PNU만으로는 못 뽑음 — 주소 텍스트 파싱은 백엔드 cleanAddress가 처리
        "jibun": None,
        "recordTime": "",
    }
