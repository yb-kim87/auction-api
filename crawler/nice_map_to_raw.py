"""나이스옥션 물건 상세(obj) → 우리 백엔드 mapCrawledItem()이 기대하는
raw 필드 형태로 변환한다(crawler-item.mapper.ts 계약과 1:1 대응).

실측 확인한 필드(2026-08-07, objId=1965189097446179694 실제 라이브
응답으로 검증):
  court.courtNm(법원), soyujaNm(소유자), addrNoPrivacy(주소),
  gamjungAmt/minAmt/maegakAmt(감정가/최저가/매각가), saYear+saNo(사건번호),
  dspslDxdyYmd(매각기일), tojiArea/bldgArea(면적), pnuCd(19자리 PNU).

**용도(usage) 필드**: 처음엔 "나이스가 깔끔한 용도 텍스트를 안 준다"고
오판해서(yejungYongdoNm이 "집합건물" 같은 법적 분류만 줌) 실거래가
리스트 종류로 추정하는 휴리스틱을 썼었다. 사용자가 실제 화면 캡처로
"아파트" 배지가 분명히 보인다고 지적해(2026-08-07) 다시 찾아보니,
`yongdoCd`(예: 2020104)가 정확히 그 값이었고, `/api/v1/code/list`
API가 코드→텍스트 변환표(예: 2020104→"아파트")를 공개로 제공하고
있었다. 이 표를 `nice_yongdo_code_map.json`로 미리 받아두고 조회한다
(96개, 자주 안 바뀌는 코드 체계라 매 요청마다 API를 부르지 않는다).
"""

from __future__ import annotations

import json
from pathlib import Path

from nice_parsers import (
    build_building_registry_text,
    build_tenant_detail_text,
    build_tenant_info_summary,
)

BASE_URL = "https://niceauction.co.kr"

_YONGDO_MAP_PATH = Path(__file__).resolve().parent / "nice_yongdo_code_map.json"
_YONGDO_CODE_MAP: dict[str, str] = json.loads(_YONGDO_MAP_PATH.read_text(encoding="utf-8"))

_PROGSTATUS_MAP_PATH = Path(__file__).resolve().parent / "nice_progstatus_code_map.json"
_PROGSTATUS_CODE_MAP: dict[str, str] = json.loads(_PROGSTATUS_MAP_PATH.read_text(encoding="utf-8"))


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
    """yongdoCd를 코드표로 직접 변환한다(2026-08-07 수정 — 예전엔 실거래가
    리스트 종류로 추정하는 휴리스틱을 썼는데, 사용자가 화면에 "아파트"
    배지가 뜨는 걸 보고 재확인을 요청해 yongdoCd가 정확한 값임을 확인함).
    코드표에 없는 값이면(신규 코드 추가 등) 빈 문자열을 반환한다 — 억지로
    추정하지 않는다."""
    yongdo_cd = obj.get("yongdoCd")
    if yongdo_cd is None:
        return ""
    return _YONGDO_CODE_MAP.get(str(yongdo_cd), "")


def _case_state(obj: dict) -> str:
    """objProgStatusCd(진행상태 코드) → 탱크 caseState와 같은 텍스트
    (신건/유찰/재진행/변경/취하 등). yongdoCd와 같은 방식(코드표 조회)."""
    code = obj.get("objProgStatusCd")
    if code is None:
        return ""
    return _PROGSTATUS_CODE_MAP.get(str(code), "")


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
        "caseState": _case_state(obj),
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
        "tenantInfo": build_tenant_info_summary(obj),
        "lawdCd": lawd_cd or None,
        "umdNm": None,  # PNU만으로는 못 뽑음 — 주소 텍스트 파싱은 백엔드 cleanAddress가 처리
        "jibun": None,
        "recordTime": "",
    }
