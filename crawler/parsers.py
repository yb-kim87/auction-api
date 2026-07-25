"""AuctList.php / AuctView.php JSON 응답 → crawl_item() 과 동일한 필드로 매핑하는
순수 함수 모음 (3단계).

HTML 파싱이 아니라 JSON 딕셔너리 매핑이지만, 요청받은 "파서" 역할(원본 응답 →
정제된 구조체, 네트워크/DOM 의존 없음)은 동일하게 수행한다. 저장된 fixture
JSON만으로 완전히 테스트 가능하다 (네트워크 호출 없음).

주의: 이 파일은 tid 하나에 대해 "탱크 API로 채울 수 있는 필드"만 채운다.
naver_* 필드(네이버부동산 SPA 크롤링 결과)는 이 단계의 책임 범위가 아니므로
item_crawl.py 의 crawl_item() 과 동일한 기본값(빈 문자열/None/0)으로 채워
동일한 키 집합을 유지한다. 실제 병합은 5단계(목록/상세 흐름)에서 처리한다.
"""

from __future__ import annotations

from datetime import datetime

from repository import build_extra_data
from tank_detail import (
    collect_lease_status,
    extract_building_area_from_detail,
    make_sa_no_from_base,
    merge_tank_fields,
    parse_apt_meta_from_env_payload,
    parse_appraiser_from_detail,
    parse_base_info_fields,
    parse_bid_info_from_detail,
    parse_bldg_meta_from_detail,
    parse_build_year_from_detail,
    parse_deunggi_from_detail,
    parse_education_from_env_payload,
    parse_intr_flag_from_detail,
    parse_official_land_price_from_env_payload,
    parse_special_note_from_detail,
    parse_owner_from_detail,
    parse_exclusive_area_from_env_bldg,
    normalize_build_year_value,
    is_valid_build_year,
    _state_name_from_detail,
)


def _build_tenant_info_summary(detail_response: dict) -> str:
    """leasInfo.leasMeta(임차인 수/보증금 합계) 기반 요약.

    Selenium 쪽(item_crawl.py)은 DOM(.Ltbl_list[1]) 텍스트를 그대로 잘라
    쓰므로 문자열이 완전히 같지는 않지만, API의 leasMeta가 동일한 정보
    (임차인 수, 보증금 합계)를 이미 정제된 값으로 제공하므로 이를 사용한다.
    """
    leas = detail_response.get("leasInfo") if isinstance(detail_response, dict) else None
    if not isinstance(leas, dict):
        return "임차정보없음"
    meta = leas.get("leasMeta")
    if not isinstance(meta, dict):
        return "임차정보없음"
    count = meta.get("prsnCnt") or 0
    deposit_sum = meta.get("dpstSum") or 0
    if not count and not deposit_sum:
        return "임차정보없음"
    return f"임차인: {count} 건, 임차보증금합계: {deposit_sum:,}원"


def _parse_unpaid_fee(detail_response: dict) -> dict:
    """arersInfo.items[0](체납조사) → 체납금액/비고/조사일자.

    이 조사는 탱크옥션이 관리사무소에 개별 문의해 채워넣는 수동 데이터라
    items가 빈 배열인 물건이 실제로 많다(원본 데이터 자체가 없는 정상
    케이스) — 그 경우 전부 기본값(0/빈 문자열)으로 남긴다(실측,
    2026-07-25).
    """
    arers = detail_response.get("arersInfo") if isinstance(detail_response, dict) else None
    items = arers.get("items") if isinstance(arers, dict) else None
    if not isinstance(items, list) or not items:
        return {"unpaid_fee_amount": 0, "unpaid_fee_note": "", "unpaid_fee_checked_at": ""}
    row = items[0] if isinstance(items[0], dict) else {}
    try:
        amount = int(row.get("amt") or 0)
    except (TypeError, ValueError):
        amount = 0
    return {
        "unpaid_fee_amount": amount,
        "unpaid_fee_note": str(row.get("note") or "").strip(),
        "unpaid_fee_checked_at": str(row.get("wdt") or "").strip(),
    }


def parse_list_item(raw_item: dict) -> dict:
    """AuctList.php 의 items[] 원소 하나 → 목록 화면에서 쓰던 최소 필드.

    기존 Selenium 흐름은 목록 단계에서 물건 URL만 모으고 필드는 상세에서
    채웠으므로, 여기서는 URL 조립에 필요한 식별자와 목록 API가 이미 들고
    있는 핵심 값만 뽑는다. DB 저장 형식과는 무관 (5단계에서 상세와 병합).
    """
    sn1 = raw_item.get("sn1")
    sn2 = raw_item.get("sn2")
    pn = raw_item.get("pn") or 0
    tid = raw_item.get("tid")
    return {
        "tid": str(tid) if tid is not None else "",
        "auctionNo": make_sa_no_from_base(raw_item),
        "sn1": sn1,
        "sn2": sn2,
        "pn": pn,
        "link": (
            f"https://www.tankauction.com/ca/caView.php?tid={tid}" if tid else ""
        ),
    }


def parse_list_page(list_response: dict) -> list[dict]:
    """AuctList.php 응답 전체 → parse_list_item() 결과 리스트."""
    items = list_response.get("items")
    if not isinstance(items, list):
        return []
    return [parse_list_item(item) for item in items if isinstance(item, dict)]


def parse_detail_page(
    detail_response: dict,
    env_payload: dict | None = None,
    env_bldg_payload: dict | None = None,
) -> dict:
    """AuctView.php(+ EnvViewData.php) 응답 → crawl_item() 과 동일한 키 집합의
    딕셔너리.

    driver/DOM 의존 없이 raw_detail(JSON) 만으로 채울 수 있는 필드는 API
    파서로 채운다. env_payload(EnvViewData.php 응답)를 주면 교육환경/
    준공연도·세대수 보강에 사용한다(5단계). env_payload 가 없으면 해당
    필드는 빈 값으로 남는다 — 이 함수는 순수 함수이므로 네트워크 호출은
    호출자(service 레이어)가 담당한다.
    """
    if not isinstance(detail_response, dict):
        detail_response = {}

    base = detail_response.get("baseInfo") or {}
    tank_fields = merge_tank_fields(parse_base_info_fields(detail_response))

    auction_no = tank_fields.get("auctionNo") or make_sa_no_from_base(base)
    address = tank_fields.get("address") or "없음"
    usage = tank_fields.get("usage") or "없음"

    building_area = extract_building_area_from_detail(detail_response)

    build_year = parse_build_year_from_detail(detail_response)
    total_units = 0
    education_setup = ""
    official_land_price = 0
    if env_payload:
        apt_meta = parse_apt_meta_from_env_payload(env_payload)
        if not is_valid_build_year(build_year) and apt_meta.get("build_year"):
            build_year = apt_meta["build_year"]
        total_units = apt_meta.get("total_units") or 0
        education_setup = parse_education_from_env_payload(env_payload)
        official_land_price = parse_official_land_price_from_env_payload(env_payload) or 0

    if is_valid_build_year(build_year):
        build_year = normalize_build_year_value(build_year) or build_year
    else:
        build_year = "값없음"

    bid_info = parse_bid_info_from_detail(detail_response) or "없음"
    case_state = _state_name_from_detail(detail_response)
    owner = parse_owner_from_detail(detail_response) or "값없음"
    appraiser = parse_appraiser_from_detail(detail_response) or "값없음"
    deunggi_info = parse_deunggi_from_detail(detail_response) or "값없음"
    lease_info = collect_lease_status(detail_response, driver=None) or "값없음"
    tenant_info = _build_tenant_info_summary(detail_response)

    bldg_meta = parse_bldg_meta_from_detail(detail_response)
    elevator = bldg_meta.get("elevator") or "없음"
    parking = bldg_meta.get("parking") or "없음"

    special_note = parse_special_note_from_detail(detail_response)
    unpaid_fee = _parse_unpaid_fee(detail_response)

    tid = base.get("tid")
    link = f"https://www.tankauction.com/ca/caView.php?tid={tid}" if tid else ""

    shared_area = ""
    if env_bldg_payload:
        shared_area = parse_exclusive_area_from_env_bldg(env_bldg_payload).get(
            "shared_area", ""
        )

    return {
        "memo": "",
        "link": link,
        "views": int(base.get("hit") or 0),
        "auctionNo": auction_no,
        "court": tank_fields.get("court") or "",
        "caseState": case_state,
        "address": address,
        "totalUnits": total_units,
        "usage": usage,
        "area": building_area,
        "builtYear": build_year,
        "sharedArea": shared_area,
        "bidDate": tank_fields.get("bidDate") or "없음",
        "appraisal_price": tank_fields.get("appraisal_price") or 0,
        "min_price": tank_fields.get("min_price") or 0,
        "sale_price": tank_fields.get("sale_price"),
        "naver_lowest_price": 0,
        "gap_margin_sold_price": None,
        "gap_margin": None,
        "new_case_gap_margin": None,
        "real_trade_count": "",
        "bid_info": bid_info,
        "owner": owner,
        "appraiser": appraiser,
        "official_land_price": official_land_price,
        "tenant_info": tenant_info,
        "special_note": special_note,
        "unpaid_fee_amount": unpaid_fee["unpaid_fee_amount"],
        "unpaid_fee_note": unpaid_fee["unpaid_fee_note"],
        "unpaid_fee_checked_at": unpaid_fee["unpaid_fee_checked_at"],
        "elevator": elevator,
        "parking": parking,
        "land_area": str(base.get("rt_sqm") or "없음"),
        "deunggi_info": deunggi_info,
        "education_setup": education_setup,
        "lease_info": lease_info,
        "naver_price_detail": "",
        "transaction_prices": "",
        "naver_id": "",
        "record_time": datetime.now().isoformat(timespec="seconds"),
        "extraData": build_extra_data(detail_response),
    }
