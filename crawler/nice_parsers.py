"""나이스옥션(niceauction.co.kr) 물건 상세(/api/v1/obj/{objId}) 응답을
우리 DB 스키마(주로 탱크옥션 텍스트 포맷과 호환되는 buildingRegistry/
tenantDetail)로 변환한다.

핵심 설계(2026-07-30, docs/history 참고):
- 나이스는 등기부(deunggiLst[].dataList)에 말소기준권리(is_malso_first)/
  인수여부(is_insu)/HUG 여부(is_hug) 등을 **이미 판정해서** 제공한다 —
  우리가 지금 텍스트 정규식으로 추정하는 것보다 신뢰도가 높다. 이 값들은
  build_rights_structured()로 별도 보존해 권리분석 로직이 텍스트 추정
  대신 우선 신뢰하도록 한다(텍스트 렌더링은 하위호환을 위해 계속 생성).
- 사용자 노출 문구에 "나이스"/"탱크옥션" 등 크롤링 출처가 드러나면 안
  된다는 방침(2026-07-30)에 따라, 여기서 만드는 텍스트에는 출처를
  적지 않는다(기존 탱크 포맷과 동일한 무출처 텍스트를 그대로 따른다).
"""

from __future__ import annotations

from tank_detail import format_tenant_status_text


def _amount_text(value) -> str:
    try:
        amount = int(str(value or "0").replace(",", "").strip())
    except (TypeError, ValueError):
        return ""
    return f"{amount:,}" if amount > 0 else ""


def _amount_from_korean_string(text: str) -> str:
    """"금300,000,000원" 같은 국문 금액 문자열에서 숫자만 뽑아 콤마
    포맷으로 되돌린다(chaekwun_str_mny/chaim_str_mny 등에서 사용)."""
    import re

    digits = re.sub(r"[^\d]", "", str(text or ""))
    return _amount_text(digits)


def _strip_html_br(text: str) -> str:
    import re

    return re.sub(r"<br\s*/?>", " ", str(text or "")).strip()


def _final_data_list(obj: dict) -> list[dict]:
    """등기 항목의 최종 확정 상태(말소/인수 판정 반영)는 dataList가
    아니라 finalDataList에 있다 — dataList는 이후 취소·변경된 항목까지
    포함한 원본 이력이라 is_malso_first/is_insu가 부정확할 수 있음을
    실측 확인(2025타경20901 사례, 2026-07-30). finalDataList가 없으면
    dataList로 폴백한다."""
    deunggi_lst = obj.get("deunggiLst")
    if not isinstance(deunggi_lst, list) or not deunggi_lst:
        return []
    entry = deunggi_lst[0]
    final_list = entry.get("finalDataList")
    if isinstance(final_list, list) and final_list:
        return final_list
    data_list = entry.get("dataList")
    return data_list if isinstance(data_list, list) else []


def build_building_registry_text(obj: dict) -> str:
    """deunggiLst[0].dataList(등기 원장 항목별 배열)를 기존 탱크옥션
    포맷과 같은 줄 단위 텍스트로 렌더링한다:
    "갑(11) 2025-09-05 강제경매 주택도시보증공사 329,600,295 (말소기준등기)"
    프론트의 REGISTRY_HEADER_RE(/^([갑을])\\((\\d+)\\)\\s+(\\d{4}-\\d{2}-\\d{2})\\s*(.*)$/)
    와 호환되도록 형식을 맞춘다.
    """
    data_list = _final_data_list(obj)
    if not data_list:
        return ""

    lines: list[str] = []
    for row in data_list:
        if not isinstance(row, dict):
            continue
        gbn = str(row.get("gabyl_gbn") or "").strip()
        seq = str(row.get("ranking_no") or "").strip()
        date = str(row.get("register_dt") or "")[:10]
        purpose = str(row.get("purpose") or "").strip()
        holder = str(row.get("kwunri_nm") or "").strip()
        if not (gbn and seq and date):
            continue
        amount = (
            _amount_text(row.get("chaekwun_mny"))
            or _amount_text(row.get("chaim_mny"))
            or _amount_from_korean_string(row.get("chaekwun_str_mny"))
            or _amount_from_korean_string(row.get("chaim_str_mny"))
        )
        amount_str = f"{amount}원" if amount else ""
        note_parts = []
        if row.get("is_malso_first"):
            note_parts.append("말소기준등기")
        if row.get("is_insu"):
            note_parts.append("인수")
        note = " ".join(note_parts)

        parts = [p for p in (holder, amount_str) if p]
        line = f"{gbn}({seq}) {date} {purpose}"
        if parts:
            line += " " + " ".join(parts)
        if note:
            line += f" ({note})"
        lines.append(line)
    return "\n".join(lines)


def build_tenant_detail_text(obj: dict) -> str:
    """imchainLst(임차인 현황) + maegakMyungse(매각물건명세 비고)를
    기존 탱크옥션 임차인현황 텍스트 포맷으로 렌더링한다. 실제 줄
    포맷 생성은 tank_detail.format_tenant_status_text()를 그대로
    재사용해(같은 rows 구조로 변환) 프론트/파서 양쪽과의 호환을
    보장한다.
    """
    imchain_lst = obj.get("imchainLst")
    rows: list[dict] = []
    if isinstance(imchain_lst, list):
        for i, item in enumerate(imchain_lst, start=1):
            if not isinstance(item, dict):
                continue
            occupancy_parts = [
                str(item.get("jumyouPart") or "").strip(),
                str(item.get("jumyouGigan") or "").strip(),
            ]
            occupancy = " / ".join(p for p in occupancy_parts if p)
            date_parts = []
            if item.get("jeonipDt"):
                date_parts.append(f"전입:{item['jeonipDt']}")
            if item.get("confirmDt"):
                date_parts.append(f"확정:{item['confirmDt']}")
            if item.get("baedangDt"):
                date_parts.append(f"배당:{item['baedangDt']}")
            deposit = _amount_text(item.get("bjMny"))
            deposit_str = f"보:{deposit}원" if deposit else ""
            opposability = "있음" if item.get("daehang") else "없음"
            analysis: list[str] = []
            if item.get("isHug"):
                analysis.append("HUG 승계")
            if item.get("isSgi"):
                analysis.append("SGI 승계")
            if item.get("isHf"):
                analysis.append("HF 승계")
            if item.get("excludeInsureCondition"):
                analysis.append("잔존채권 포기(인수 제외 조건 있음)")
            rows.append(
                {
                    "occupancyNo": str(item.get("no") or i),
                    "tenantName": str(item.get("jumyouNm") or "").strip(),
                    "occupancy": occupancy,
                    "dates": "\n".join(date_parts),
                    "depositRent": deposit_str,
                    "opposability": opposability,
                    "analysis": analysis,
                    "other": str(item.get("jumyouKunwon") or "").strip(),
                    "sectionHeader": False,
                }
            )

    misc_parts = []
    myungse = obj.get("maegakMyungse")
    if isinstance(myungse, dict):
        for key in ("imchaDesc", "magakDesc", "jisangDesc", "myungseDesc"):
            text = _strip_html_br(myungse.get(key))
            if text:
                misc_parts.append(text)
    misc = "\n".join(misc_parts)

    if not rows and not misc:
        return ""
    return format_tenant_status_text({"rows": rows, "miscNotes": misc})


def build_tenant_info_summary(obj: dict) -> str:
    """탱크옥션 tenantInfo("임차인 요약", 예: "임차인: 3 건, 임차보증금합계:
    175,000,000원")와 동일한 형식의 요약 텍스트를 imchainLst로 직접
    계산한다(2026-08-07, 사용자가 2024타경35803을 탱크와 실제 비교
    요청하면서 발견 — 이 필드가 나이스 임포트 물건에서 아예 비어
    있었다). 탱크는 자체 API의 별도 메타(prsnCnt/dpstSum)를 쓰지만
    나이스는 그런 메타가 없어 imchainLst 항목 수·보증금 합계를 직접
    더해 구한다(parsers.py:_build_tenant_info_summary와 동일한 문구
    포맷). 데이터가 없을 때 빈 문자열 대신 탱크와 동일하게
    "임차정보없음"을 명시적으로 반환한다(2026-08-07, 사용자에게 두
    소스의 차이를 설명하다가 발견한 불일치 — 탱크는 leasMeta가 없으면
    "임차정보없음"이라는 문구를 보여주는데 나이스는 빈 문자열이라
    화면에 아무 것도 안 떴었다)."""
    imchain_lst = obj.get("imchainLst")
    if not isinstance(imchain_lst, list) or not imchain_lst:
        return "임차정보없음"
    count = len(imchain_lst)
    deposit_sum = 0
    for item in imchain_lst:
        if not isinstance(item, dict):
            continue
        raw_value = str(item.get("bjMny") or "").strip()
        try:
            deposit_sum += int(raw_value) if raw_value else 0
        except ValueError:
            continue
    if not count and not deposit_sum:
        return "임차정보없음"
    return f"임차인: {count} 건, 임차보증금합계: {deposit_sum:,}원"


def build_rights_structured(obj: dict) -> dict:
    """권리분석 로직이 텍스트 정규식 추정 대신 우선 신뢰할 구조화 값.
    말소기준권리/인수여부/보증기관 승계 여부가 이미 판정되어 있다."""
    data_list = _final_data_list(obj)

    baseline = None
    assumed_rights: list[dict] = []
    for row in data_list:
        if not isinstance(row, dict):
            continue
        if row.get("is_malso_first") and baseline is None:
            baseline = {
                "type": row.get("purpose"),
                "date": str(row.get("register_dt") or "")[:10],
                "holder": row.get("kwunri_nm"),
            }
        if row.get("is_insu"):
            assumed_rights.append(
                {
                    "type": row.get("purpose"),
                    "date": str(row.get("register_dt") or "")[:10],
                    "holder": row.get("kwunri_nm"),
                }
            )

    imchain_lst = obj.get("imchainLst")
    tenants = []
    if isinstance(imchain_lst, list):
        for item in imchain_lst:
            if not isinstance(item, dict):
                continue
            tenants.append(
                {
                    "name": item.get("jumyouNm"),
                    "opposability": bool(item.get("daehang")),
                    "isHug": bool(item.get("isHug")),
                    "isSgi": bool(item.get("isSgi")),
                    "isHf": bool(item.get("isHf")),
                    "excludeInsureCondition": bool(item.get("excludeInsureCondition")),
                }
            )

    myungse_desc = ""
    myungse = obj.get("maegakMyungse")
    if isinstance(myungse, dict):
        myungse_desc = _strip_html_br(myungse.get("myungseDesc"))

    return {
        "baselineRight": baseline,
        "assumedRights": assumed_rights,
        "tenants": tenants,
        "specNoteFullText": myungse_desc,
        "source": "structured_registry",
    }
