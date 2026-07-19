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
# ca/caList.php 검색 폼 HTML의 #ctgr select 옵션 전체(75개, 대분류 6종 +
# 하위 물건종류 전부)를 직접 파싱해 실측 완료(2026-07-17). 관리자 화면
# (auction/src/app/admin/CrawlerSearchPanel.tsx: PROPERTY_OPTIONS)의
# 라벨과 정확히 일치해야 한다 — 라벨이 바뀌면 이 표도 함께 갱신할 것.
#
# 대분류(주거용/상업 및 산업용/토지/차량 및 중장비/기타)는 select 값
# 그대로는 검색이 걸리지 않아(토지 실측: totalCount=0) 각 대분류에 속한
# 하위 코드를 모두 콤마로 묶어서 사용한다.
PROPERTY_TYPE_CODES: dict[str, list[str]] = {
    # 주거용
    "아파트": ["201013"],
    "연립주택": ["201014"],
    "다세대주택": ["201015,201017,201021"],
    "오피스텔(주거)": ["201020"],
    "단독주택": ["201010"],
    "다가구주택": ["201011,201012"],
    "도시형생활주택": ["201022"],
    "기숙사": ["201016"],
    "상가주택": ["201018"],
    # 상업 및 산업용
    "근린생활시설": ["201110,201120,201124"],
    "오피스텔(상업)": ["201111,201019"],
    "근린상가": ["201130"],
    "숙박시설": ["201122"],
    "숙박(콘도등)": ["201123"],
    "목욕탕": ["201131"],
    "업무시설": ["201121"],
    "노유자시설": ["201118"],
    "문화및집회시설": ["201112"],
    "종교시설": ["201113"],
    "의료시설": ["201116"],
    "교육연구시설": ["201117"],
    "묘지관련시설": ["201128"],
    "기타시설": [
        "201132,201115,201119,201125,201126,201127,201129,201310,201311,201312,201114"
    ],
    "공장": ["201210"],
    "지식산업센터": ["201216"],
    "창고시설": ["201211"],
    "위험물저장및처리": ["201212"],
    "자동차관련": ["201213"],
    "동물및식물관련": ["201214"],
    "분뇨및쓰레기처리": ["201215"],
    # 토지
    "전": ["101010"],
    "답": ["101011"],
    "과수원": ["101012"],
    "임야": ["101014"],
    "대지": ["101017"],
    "잡종지": ["101037"],
    "도로": ["101023"],
    "주차장": ["101020"],
    "공원": ["101031"],
    "유원지": ["101033"],
    "사적지": ["101035"],
    "묘지": ["101036"],
    "목장용지": ["101013"],
    "공장용지": ["101018"],
    "학교용지": ["101019"],
    "주유소용지": ["101021"],
    "창고용지": ["101022"],
    "철도용지": ["101024"],
    "수도용지": ["101030"],
    "체육용지": ["101032"],
    "종교용지": ["101034"],
    "제방": ["101025"],
    "하천": ["101026"],
    "구거": ["101027"],
    "광천지": ["101015"],
    "염전": ["101016"],
    "유지": ["101028"],
    "양어장": ["101029"],
    # 차량 및 중장비
    "승용차": ["301010"],
    "승합차": ["301011"],
    "버스": ["301012"],
    "화물차": ["301013"],
    "기타차량": ["301014"],
    "덤프트럭": ["301110"],
    "기타중기": ["301113,301111,301112"],
    # 기타
    "선박": ["301210"],
    "어업권": ["401010"],
    "광업권": ["401011"],
    "기타권리": ["401110,301310,301410,401012"],
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

# 관리자 화면 특수조건 라벨 → chkSplCdtn[] 코드. splSrchType(0=적용안함/
# 1=1개이상포함/2=모두포함/4=제외)과 함께 사용. ca/caList.php 검색 폼
# HTML의 input[name=chkSpl] 체크박스 전체(46개, 6개 그룹)를 직접 파싱해
# 실측 완료(2026-07-17). 그룹 순서/라벨은 탱크옥션 화면과 동일.
SPECIAL_CONDITION_GROUPS: list[tuple[str, dict[str, str]]] = [
    ("권리", {
        "유치권": "1",
        "유치권 배제": "2",
        "법정지상권": "3",
        "분묘기지권": "4",
        "선순위 가등기": "14",
        "선순위 가처분": "15",
        "지분입찰 물건": "121",
    }),
    ("임차인", {
        "임차인우선매수신고": "13",
        "선순위 전세권 설정": "16",
        "선순위 임차권 설정": "17",
        "임차권 등기": "18",
        "대항력 있는 임차인": "19",
        "전세권만 매각": "112",
        "HUG 임차권 인수조건변경": "31",
        "HF 임차권 인수조건변경": "32",
    }),
    ("물건현황", {
        "맹지": "8",
        "위반건축물": "11",
        "오늘 공고된 신건": "101",
        "재매각 물건": "102",
        "반값 경매물건": "103",
        "토지건물 일괄매각": "105",
        "대지권미등기": "116",
        "토지별도등기 있는 물건": "117",
        "토지별도등기인수조건": "118",
        "건물만 입찰 물건": "119",
        "토지만 입찰 물건": "120",
        "감정시점 1년 지난 물건": "130",
        "경매/공매 동시 (진행/과거)": "131",
        "최근 2주 주요변동 물건": "132",
        "NPL 물건": "21",
        "공고보다 빠른 신건": "133",
        "공고임박 예정물건(주소만 검색)": "134",
    }),
    ("자격", {
        "공유자우선매수": "5",
        "농지취득자격증명": "6",
        "채권자매수청구": "7",
        "대위변제": "9",
        "항고사건": "10",
        "임금채권자": "12",
    }),
    ("형식적경매", {
        "유치권에 의한 형식적경매": "122",
        "공유물분할을 위한 형식적경매": "123",
        "청산을 위한 형식적경매": "124",
        "기타 형식적경매": "125",
    }),
    ("공시가격(주거용)", {
        "공시가 1억 이하": "20",
        "공시가 1~2억 이하": "22",
        "공시가 2~3억 이하": "23",
        "공시가 3~4억 이하": "24",
    }),
]

SPECIAL_CONDITION_CODES: dict[str, str] = {
    label: code for _, group in SPECIAL_CONDITION_GROUPS for label, code in group.items()
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
        adr_plural = config.get("regionAdrPlural")
        if adr_plural:
            params["adrPlural"] = adr_plural
            params["adrPlural_cnt"] = str(len(adr_plural.split(",")))
            params["guCd"] = "0"
        else:
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
    adr_plural = config.get("regionAdrPlural")
    if adr_plural:
        # 즐겨찾기가 여러 지역을 동시 선택한 조건인 경우(탱크옥션
        # adrPlural) — guCd 단일값보다 우선한다. 실측(2026-07-17): guCd
        # 단일값만 쓰면 검색이 지나치게 좁아져 0건이 나옴.
        params["adrPlural"] = adr_plural
        params["adrPlural_cnt"] = str(len(adr_plural.split(",")))
        params["guCd"] = "0"
    else:
        params["guCd"] = config.get("regionGuCd") or "0"
    params["dnCd"] = config.get("regionDnCd") or "0"
    params["auctType"] = config.get("auctionType") or "0"
    params["dpslDvsn"] = config.get("saleDivision") or "0"

    status_label = config.get("status")
    if status_label:
        params["stat"] = STATUS_CODES.get(status_label, "11")

    preserve = config.get("preserveRegistryFrom")
    params["prsvBgn"] = preserve if preserve else "0"
    preserve_to = config.get("preserveRegistryTo")
    params["prsvEnd"] = preserve_to if preserve_to else "0"

    # 탱크옥션 "해당층" API 코드는 100+층수(예: 1층→101, 3층→103) 형식이지만,
    # 관리자 화면/설정에는 사람이 읽는 순수 층수("1", "3")로 저장한다.
    floor_min = config.get("objectFloorMin")
    params["flrBgn"] = str(int(floor_min) + 100) if floor_min else "0"
    floor_max = config.get("objectFloorMax")
    params["flrEnd"] = str(int(floor_max) + 100) if floor_max else "0"

    property_types = config.get("propertyTypes") or []
    codes = []
    for label in property_types:
        codes.extend(PROPERTY_TYPE_CODES.get(label, []))
    if codes:
        params["chkCtgrsCd[]"] = codes

    selected = config.get("excludeSpecialConditions") or []
    sel_codes = [SPECIAL_CONDITION_CODES[label] for label in selected if label in SPECIAL_CONDITION_CODES]
    mode_to_spl_srch_type = {"include-any": "1", "include-all": "2", "exclude": "4"}
    if sel_codes:
        mode = config.get("specialConditionMode") or "exclude"
        params["splSrchType"] = mode_to_spl_srch_type.get(mode, "4")
        params["chkSplCdtn[]"] = sel_codes
    else:
        params["splSrchType"] = "0"
        params.pop("chkSplCdtn[]", None)

    return CA_LIST_PATH, params


FAVORITE_SEARCH_LIST_PATH = "/ca/res/mySearchCase.php"

_STATUS_CODE_TO_LABEL = {v: k for k, v in STATUS_CODES.items()}
_SPECIAL_CODE_TO_LABEL = {v: k for k, v in SPECIAL_CONDITION_CODES.items()}
_PROPERTY_CODE_GROUP_TO_LABEL = {
    ",".join(codes): label for label, codes in PROPERTY_TYPE_CODES.items()
}


def parse_favorite_search_param(param_json: dict) -> dict:
    """탱크옥션 "즐겨쓰는 검색" 항목의 param(JSON 문자열을 파싱한 dict) →
    CrawlerSearchConfig(Partial) 역매핑.

    getFavoriteSearch API(POST /ca/res/mySearchCase.php,
    mode=getFavoriteSearch) 응답의 item[].param 이 그대로 탱크옥션 검색
    폼(#siCd, #ctgr, #stat 등)의 필드명과 값을 담고 있어, 여기 있는
    코드→라벨 역매핑 테이블(PROPERTY_TYPE_CODES/STATUS_CODES/
    SPECIAL_CONDITION_CODES)로 CrawlerSearchConfig 필드를 복원한다.
    실측(2026-07-17)한 실제 사용자 즐겨찾기 데이터로 필드 이름을 확인함.
    """
    config: dict = {"listType": "auction"}

    stat = str(param_json.get("stat", "")).strip()
    if stat in _STATUS_CODE_TO_LABEL:
        config["status"] = _STATUS_CODE_TO_LABEL[stat]

    # ctgr(단일 코드) 또는 chkCtgrsCd("201014|201015,201017,201021|201022"
    # 형태로 '|' 구분) 둘 다 관측됨 — 둘 다 처리.
    property_types: list[str] = []
    ctgr = str(param_json.get("ctgr", "")).strip()
    if ctgr:
        for label, codes in PROPERTY_TYPE_CODES.items():
            if ctgr in codes:
                property_types.append(label)
    chk_ctgrs = str(param_json.get("chkCtgrsCd", "")).strip()
    if chk_ctgrs:
        for group in chk_ctgrs.split("|"):
            label = _PROPERTY_CODE_GROUP_TO_LABEL.get(group)
            if label and label not in property_types:
                property_types.append(label)
    if property_types:
        config["propertyTypes"] = property_types

    if param_json.get("apslAmtBgn") is not None:
        config["appraisalMin"] = str(param_json["apslAmtBgn"])
    if param_json.get("apslAmtEnd") is not None:
        config["appraisalMax"] = str(param_json["apslAmtEnd"])
    if param_json.get("minbAmtBgn") is not None:
        config["minPriceMin"] = str(param_json["minbAmtBgn"])
    if param_json.get("minbAmtEnd") is not None:
        config["minPriceMax"] = str(param_json["minbAmtEnd"])
    if param_json.get("minbPctBgn") is not None:
        config["minPricePctMin"] = str(param_json["minbPctBgn"])
    if param_json.get("minbPctEnd") is not None:
        config["minPricePctMax"] = str(param_json["minbPctEnd"])
    if param_json.get("bldgSqmBgn") is not None:
        config["buildingAreaMin"] = str(param_json["bldgSqmBgn"])
    if param_json.get("bldgSqmEnd") is not None:
        config["buildingAreaMax"] = str(param_json["bldgSqmEnd"])
    if param_json.get("landSqmBgn") is not None:
        config["landAreaMin"] = str(param_json["landSqmBgn"])
    if param_json.get("landSqmEnd") is not None:
        config["landAreaMax"] = str(param_json["landSqmEnd"])
    if param_json.get("totFlrBgn") is not None:
        config["totalFloorMin"] = str(param_json["totFlrBgn"])
    if param_json.get("totFlrEnd") is not None:
        config["totalFloorMax"] = str(param_json["totFlrEnd"])
    if param_json.get("fbCntBgn") is not None:
        config["failCountMin"] = str(param_json["fbCntBgn"])
    if param_json.get("fbCntEnd") is not None:
        config["failCountMax"] = str(param_json["fbCntEnd"])
    if param_json.get("prsvBgn") is not None:
        config["preserveRegistryFrom"] = str(param_json["prsvBgn"])
    if param_json.get("prsvEnd") is not None:
        config["preserveRegistryTo"] = str(param_json["prsvEnd"])
    # flrBgn/flrEnd는 100+층수 코드(101=1층)이므로 화면에는 순수 층수로 역변환.
    flr_bgn = param_json.get("flrBgn")
    if flr_bgn is not None:
        try:
            config["objectFloorMin"] = str(int(flr_bgn) - 100)
        except (TypeError, ValueError):
            pass
    flr_end = param_json.get("flrEnd")
    if flr_end is not None:
        try:
            config["objectFloorMax"] = str(int(flr_end) - 100)
        except (TypeError, ValueError):
            pass
    if param_json.get("sn1") is not None:
        config["caseYear"] = str(param_json["sn1"])
    if param_json.get("sn2") is not None:
        config["caseSerial"] = str(param_json["sn2"])
    if param_json.get("pn") is not None:
        config["itemNumber"] = str(param_json["pn"])
    if param_json.get("siCd") is not None:
        config["regionSiCd"] = str(param_json["siCd"])
    if param_json.get("guCd") is not None:
        config["regionGuCd"] = str(param_json["guCd"])
    if param_json.get("dnCd") is not None:
        config["regionDnCd"] = str(param_json["dnCd"])
    if param_json.get("adrPlural"):
        config["regionAdrPlural"] = str(param_json["adrPlural"])
    if param_json.get("adrsEtc"):
        config["addressKeyword"] = str(param_json["adrsEtc"])
    if param_json.get("bgnDt"):
        config["bidDateFrom"] = str(param_json["bgnDt"])
    if param_json.get("endDt"):
        config["bidDateTo"] = str(param_json["endDt"])
    if param_json.get("auctType") is not None:
        config["auctionType"] = str(param_json["auctType"])
    if param_json.get("dpslDvsn") is not None:
        config["saleDivision"] = str(param_json["dpslDvsn"])

    chk_spl = str(param_json.get("chkSplCdtn", "")).strip()
    if chk_spl:
        selected_labels = [
            _SPECIAL_CODE_TO_LABEL[code]
            for code in chk_spl.split(",")
            if code in _SPECIAL_CODE_TO_LABEL
        ]
        if selected_labels:
            config["excludeSpecialConditions"] = selected_labels
            spl_srch_type = str(param_json.get("splSrchType", "")).strip()
            mode_by_spl_srch_type = {"1": "include-any", "2": "include-all", "4": "exclude"}
            config["specialConditionMode"] = mode_by_spl_srch_type.get(spl_srch_type, "exclude")

    if param_json.get("dataSize") is not None:
        config["pageSize"] = str(param_json["dataSize"])

    return config


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
