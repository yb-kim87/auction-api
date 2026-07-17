"""목록 조회 프리셋(현재/아파트/공매/다가구/빌라) → AuctList.php/PubAuctList.php
쿼리파라미터 매핑.

기존 url_collect.py: apply_preset()/apply_search_config() 는 Selenium으로
검색 폼을 실제로 조작(드롭다운 선택, 체크박스 클릭)해 같은 결과를 얻는다.
이 모듈은 그 결과로 실제 탱크옥션이 호출하는 목록 API 쿼리파라미터를
브라우저 네트워크 캡처로 확인해(2026-07-17) 동일하게 재현한다.

주의: 여기 값들은 탱크옥션 화면의 드롭다운/체크박스 선택값(코드)을 그대로
옮긴 것이라 사람이 읽기 어렵지만, url_collect.py 의 프리셋 정의와 1:1
대응한다. 프리셋 정의가 바뀌면 이 파일도 함께 갱신해야 한다(기존 파일과
분리된 이유는 HTTPX 경량 워커가 selenium 없이도 프리셋을 쓸 수 있어야
하기 때문).
"""

from __future__ import annotations

import re

CA_LIST_PATH = "/api/proxy/api1.php/ca/AuctList.php"
PA_LIST_PATH = "/api/proxy/api1.php/pa/PubAuctList.php"

# 공통 파라미터(경매 목록, ca/AuctList.php) — 아파트/다가구/빌라 프리셋이 공유
_CA_COMMON = {
    "lsType": "0",
    "odrCol": "14",
    "odrAds": "0",
    "stat": "11",  # 진행물건
    "srchCase": "srchAll",
    "siCd": "0",
    "guCd": "0",
    "dnCd": "0",
    "sptArr[0][]": "0",
    "adrsEtcType": "0",
    "adrsEtc": "",
    "ctgr": "",
    "chkAllCtgr": "0",
    "sn1": "0",
    "sn2": "0",
    "pn": "0",
    "fbCntBgn": "0",
    "fbCntEnd": "0",
    "bgnDt": "",
    "endDt": "",
    "apslAmtBgn": "800000000",  # 8억
    "apslAmtEnd": "3000000000",  # 30억
    "landSqmBgn": "0",
    "landSqmEnd": "0",
    "minbAmtBgn": "0",
    "minbAmtEnd": "0",
    "bldgSqmBgn": "0",
    "bldgSqmEnd": "0",
    "totFlrBgn": "0",
    "totFlrEnd": "0",
    "prsvBgn": "2012",  # 보존등기 2012년 이후
    "prsvEnd": "0",
    "flrBgn": "0",
    "flrEnd": "0",
    "baseFlr": "0",
    "preBgnDt": "",
    "preEndDt": "",
    "dpslDvsn": "0",
    "auctType": "0",
    "minbPctBgn": "0",
    "minbPctEnd": "0",
    "maxPnBgn": "0",
    "maxPnEnd": "0",
    "local": "0",
    "line": "0",
    "station": "0",
    "distance": "0",
    "splSrchType": "4",  # 특수조건 제외
    "chkSplCdtn[]": "11",  # 위반건축물 제외
}

# 프리셋별로 다른 값: 용도 코드(chkCtgrsCd[]) — 여러 개면 리스트로 표현
_PRESETS_CA = {
    "아파트": {"chkCtgrsCd[]": ["201013"]},
    "다가구": {"chkCtgrsCd[]": ["201011,201012", "201018"]},
    "빌라": {"chkCtgrsCd[]": ["201014", "201015,201017,201021", "201022"]},
}

# 공매(pa/PubAuctList.php) — ca 프리셋과 파라미터 이름 자체가 다름
_PA_PRESET = {
    "lsType": "0",
    "odrCol": "14",
    "odrAds": "1",
    "stat": "99",  # 기타
    "srchCase": "srchAll",
    "siCd": "0",
    "guCd": "0",
    "dnCd": "0",
    "adrsEtcType": "0",
    "adrsEtc": "",
    "cmgmtNo": "",
    "bgnDt": "",
    "clsDt": "",
    "orgDvsn": "0",
    "dpslCd": "1",
    "ctgr": "",
    "chkCtgrsCd[]": ["100010010005", "100010010015"],  # 다가구주택, 상가주택
    "chkAllCtgr": "0",
    "apslAmtBgn": "800000000",
    "apslAmtEnd": "3000000000",
    "minbAmtBgn": "0",
    "minbAmtEnd": "0",
    "prptDvsn": "",
    "noticeOrgNm": "",
    "landSqmBgn": "0",
    "landSqmEnd": "0",
    "minbPctBgn": "0",
    "minbPctEnd": "0",
    "bldgSqmBgn": "0",
    "bldgSqmEnd": "0",
    "trustCmpny": "",
    "preBgnDt": "",
    "preEndDt": "",
    "local": "0",
    "line": "0",
    "station": "0",
    "distance": "0",
    "splSrchType": "4",
    "chkSplCdtn[]": "7",
}


class UnsupportedPresetError(RuntimeError):
    """프리셋에 대응하는 HTTPX 쿼리파라미터가 아직 정의되지 않음."""


def resolve_preset_request(preset: str) -> tuple[str, dict]:
    """프리셋 이름 → (API 경로, 쿼리파라미터 딕셔너리).

    "현재"는 미리 정의된 검색조건이 아니라 관리자가 화면(검색조건 탭)에서
    직접 입력한 값을 쓰는 프리셋이다. build_query_from_search_config()로
    별도 처리한다 — 이 함수는 아파트/다가구/빌라/공매처럼 고정된 조건에만
    쓴다.
    """
    if preset in _PRESETS_CA:
        params = {**_CA_COMMON, **_PRESETS_CA[preset]}
        return CA_LIST_PATH, params
    if preset == "공매":
        return PA_LIST_PATH, dict(_PA_PRESET)
    raise UnsupportedPresetError(
        f"'{preset}' 프리셋은 HTTPX 경로에서 아직 지원하지 않습니다."
    )


# 관리자 화면 "검색조건" 탭의 용도(propertyTypes) 라벨 → chkCtgrsCd[] 코드.
# 브라우저 네트워크 캡처로 실제 확인(2026-07-17). 관리자 화면
# (auction/src/app/admin/CrawlerSearchTab.tsx: PROPERTY_OPTIONS)의 라벨과
# 정확히 일치해야 한다 — 라벨이 바뀌면 이 표도 함께 갱신할 것.
#
# 실측 완료: 아파트, 다가구주택, 상가주택, 연립주택, 다세대주택,
#           도시형생활주택, 근린상가
# 미실측(추정치, 사용 전 재검증 권장): 오피스텔, 토지
PROPERTY_TYPE_CODES: dict[str, list[str]] = {
    "아파트": ["201013"],  # 실측
    "다가구주택": ["201011,201012"],  # 실측(다가구 프리셋에서 확인)
    "상가주택": ["201018"],  # 실측(다가구 프리셋에서 확인)
    "오피스텔": ["201016"],  # 미실측 추정치
    "연립주택": ["201014"],  # 실측(빌라 프리셋에서 확인)
    "다세대주택": ["201015,201017,201021"],  # 실측(빌라 프리셋에서 확인)
    "도시형생활주택": ["201022"],  # 실측(빌라 프리셋에서 확인)
    "근린상가": ["201130"],  # 실측
    "토지": ["203000"],  # 미실측 추정치
}

# 관리자 화면 STATUS_OPTIONS 라벨 → stat 코드(select option 값 실측, 2026-07-17).
# 옵션 텍스트를 그대로 읽어 확인한 값 — chkCtgrsCd 와 달리 검색 실행 없이도
# select option 목록에서 바로 확인 가능했음.
STATUS_CODES: dict[str, str] = {
    "진행물건": "11",
    "기타": "13",  # "진행외물건"에 대응(공매 stat=99와는 다른 체계)
    "매각": "12",  # "매각전부"
    "유찰": "1111",
}

# 관리자 화면 SPECIAL_EXCLUDE 라벨 → chkSplCdtn[] 코드.
# splSrchType=4(제외 모드)와 함께 사용. "위반건축물"만 실측 확인(1단계
# 아파트 프리셋에서 chkSplCdtn[]=11 로 확인). 나머지 3개는 화면 표시
# 순서 기준 추정치 — 실제 선택 전 반드시 재검증할 것(틀리면 엉뚱한
# 조건으로 검색될 위험이 있음).
SPECIAL_CONDITION_CODES: dict[str, str] = {
    "위반건축물": "11",  # 실측
    "법정지상권": "12",  # 미실측 추정치
    "선순위임차": "13",  # 미실측 추정치
    "대지권미등기": "14",  # 미실측 추정치
}


def _flatten_multi(values: list[str]) -> list[str]:
    """PROPERTY_TYPE_CODES 값처럼 콤마로 묶인 코드 그룹을 그대로 리스트에 담는다
    (탱크옥션 자체가 "201011,201012" 같은 묶음 코드를 하나의 chkCtgrsCd[] 항목으로
    받으므로 추가로 분리하지 않음)."""
    return list(values)


def build_query_from_search_config(config: dict) -> tuple[str, dict]:
    """CrawlerSearchConfig(관리자 화면 "검색조건" 탭 + "현재" 프리셋)를
    쿼리파라미터로 변환. url_collect.py: apply_search_config()의 HTTPX 버전.

    config 키는 crawler.types.ts: CrawlerSearchConfig 와 동일한 이름을
    camelCase 그대로 받는다(백엔드에서 별도 변환 없이 그대로 전달).
    """
    list_type = config.get("listType", "auction")

    if list_type == "public":
        params = dict(_PA_PRESET)
        params["apslAmtBgn"] = _amount_to_won(config.get("appraisalMin", "")) or "0"
        params["apslAmtEnd"] = _amount_to_won(config.get("appraisalMax", "")) or "0"
        params["adrsEtc"] = config.get("addressKeyword") or ""
        params["minbAmtBgn"] = config.get("minPriceMin") or "0"
        params["minbAmtEnd"] = config.get("minPriceMax") or "0"
        params["siCd"] = config.get("regionSiCd") or "0"
        params["guCd"] = config.get("regionGuCd") or "0"
        params["dnCd"] = config.get("regionDnCd") or "0"
        property_types = config.get("propertyTypes") or []
        codes: list[str] = []
        for label in property_types:
            codes.extend(PROPERTY_TYPE_CODES.get(label, []))
        if codes:
            params["chkCtgrsCd[]"] = codes
        return PA_LIST_PATH, params

    params = dict(_CA_COMMON)
    params["apslAmtBgn"] = _amount_to_won(config.get("appraisalMin", "")) or "0"
    params["apslAmtEnd"] = _amount_to_won(config.get("appraisalMax", "")) or "0"
    params["adrsEtc"] = config.get("addressKeyword") or ""
    params["minbAmtBgn"] = config.get("minPriceMin") or "0"
    params["minbAmtEnd"] = config.get("minPriceMax") or "0"
    params["minbPctBgn"] = config.get("minPricePctMin") or "0"
    params["minbPctEnd"] = config.get("minPricePctMax") or "0"
    params["landSqmBgn"] = config.get("landAreaMin") or "0"
    params["landSqmEnd"] = config.get("landAreaMax") or "0"
    params["bldgSqmBgn"] = config.get("buildingAreaMin") or "0"
    params["bldgSqmEnd"] = config.get("buildingAreaMax") or "0"
    params["totFlrBgn"] = config.get("totalFloorMin") or "0"
    params["totFlrEnd"] = config.get("totalFloorMax") or "0"
    params["fbCntBgn"] = config.get("failCountMin") or "0"
    params["fbCntEnd"] = config.get("failCountMax") or "0"
    params["bgnDt"] = config.get("bidDateFrom") or ""
    params["endDt"] = config.get("bidDateTo") or ""
    params["sn1"] = config.get("caseYear") or "0"
    params["sn2"] = config.get("caseSerial") or "0"
    params["pn"] = config.get("itemNumber") or "0"
    params["siCd"] = config.get("regionSiCd") or "0"
    params["guCd"] = config.get("regionGuCd") or "0"
    params["dnCd"] = config.get("regionDnCd") or "0"
    params["auctType"] = config.get("auctionType") or "0"
    params["dpslDvsn"] = config.get("saleDivision") or "0"

    status_label = config.get("status")
    if status_label:
        params["stat"] = STATUS_CODES.get(status_label, "11")

    preserve = config.get("preserveRegistryFrom")
    params["prsvBgn"] = preserve if preserve else "0"

    property_types = config.get("propertyTypes") or []
    codes = []
    for label in property_types:
        codes.extend(PROPERTY_TYPE_CODES.get(label, []))
    if codes:
        params["chkCtgrsCd[]"] = codes

    exclude = config.get("excludeSpecialConditions") or []
    excl_codes = [SPECIAL_CONDITION_CODES[label] for label in exclude if label in SPECIAL_CONDITION_CODES]
    if excl_codes:
        params["splSrchType"] = "4"
        params["chkSplCdtn[]"] = excl_codes
    else:
        params["splSrchType"] = "0"
        params.pop("chkSplCdtn[]", None)

    return CA_LIST_PATH, params


_AMOUNT_UNIT_MAP = {"억": 100_000_000, "천만": 10_000_000, "백만": 1_000_000}


def list_response_to_url_entries(list_response: dict, *, is_public: bool) -> list[dict]:
    """목록 API(AuctList.php/PubAuctList.php) 응답 → url_collect.py 의
    collect_urls() 와 동일한 {"label": ..., "url": ...} 엔트리 리스트로 변환.

    url_collect.py: _collect_page_entries() 의 HTTPX 버전. Selenium은
    caView.php?tid=...&chkNo=...&TotNo=... 형식의 URL을 label로 쓰므로
    (뒤 쿼리는 페이지네이션 표시용, tid 파싱에는 영향 없음 — tid_from_url()
    참고) 이 함수도 동일한 형식을 재현한다.
    """
    items = list_response.get("items")
    if not isinstance(items, list):
        return []

    entries: list[dict] = []
    for index, raw in enumerate(items, start=1):
        if not isinstance(raw, dict):
            continue
        if is_public:
            item_id = raw.get("cltrNo") or raw.get("cltr_no")
            if not item_id:
                continue
            case_num = str(raw.get("mgmtNo") or raw.get("mgmt_no") or item_id)
            url = (
                f"https://www.tankauction.com/pa/paView.php?cltrNo={item_id}"
                f"&chkNo=1&TotNo={index}"
            )
        else:
            item_id = raw.get("tid")
            if not item_id:
                continue
            case_num = _make_sa_no(raw) or str(item_id)
            url = (
                f"https://www.tankauction.com/ca/caView.php?tid={item_id}"
                f"&chkNo=1&TotNo={index}"
            )
        label = f"{case_num}_{url}"
        entries.append({"label": label, "url": label})

    return entries


def _make_sa_no(raw_item: dict) -> str:
    """tank_detail.make_sa_no_from_base() 와 동일한 로직(순환 import 방지를
    위해 여기서 최소 형태로 재구현). "2025타경56916" 형식."""
    sn1 = raw_item.get("sn1")
    sn2 = raw_item.get("sn2")
    if not sn1 or not sn2:
        return ""
    pn = raw_item.get("pn") or 0
    try:
        pn = int(pn)
    except (TypeError, ValueError):
        pn = 0
    raw = f"{sn1}타경{sn2}" + (f"({pn})" if pn > 0 else "")
    return raw


def _amount_to_won(label: str) -> str:
    """관리자 화면 APPRAISAL_OPTIONS 라벨("8억" 등)을 원 단위 숫자 문자열로.
    이미 숫자 문자열이면 그대로 반환(향후 프론트가 원 단위로 직접 보낼 수도 있음)."""
    text = (label or "").strip()
    if not text:
        return ""
    if text.isdigit():
        return text
    for unit, multiplier in _AMOUNT_UNIT_MAP.items():
        if text.endswith(unit):
            number_part = text[: -len(unit)].strip()
            try:
                return str(int(float(number_part) * multiplier))
            except ValueError:
                return ""
    return ""
