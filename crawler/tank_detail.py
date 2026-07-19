"""탱크 caView — AuctView JSON + data-base-info DOM 바인딩."""

from __future__ import annotations

import json
import re
import time

# selenium 은 DOM 조작 함수(read_dom_base_info 등)에서만 필요하다. 이 파일은
# HTTPX 전용 경량 워커(full_httpx_worker.py 등, selenium 미설치 환경 배포용)
# 에서도 import 되므로, 모듈 최상단에서 selenium을 강제하지 않고 실제로
# 필요한 함수 내부에서만 지연 import 한다.

AUCTION_NO_PATTERN = re.compile(r"(\d{4})타경(\d+)(?:\((\d+)\))?")


def _normalize_auction_no(raw: str) -> str:
    text = (raw or "").strip().replace("\u00a0", " ")
    if not text:
        return ""
    compact = re.sub(r"\s+", "", text)
    match = AUCTION_NO_PATTERN.search(compact)
    if match:
        year, serial, pn = match.groups()
        base = f"{year}타경{serial}"
        return f"{base}({pn})" if pn else base
    dash = re.search(r"(\d{4})\s*-\s*(\d+)", text)
    if dash:
        return f"{dash.group(1)}타경{dash.group(2)}"
    return ""


def tid_from_url(url: str) -> str | None:
    match = re.search(r"[?&]tid=(\d+)", url or "")
    return match.group(1) if match else None


def _pick_str(data: dict, *keys: str) -> str:
    for key in keys:
        value = data.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text and text not in ("-", "0", "없음", "null"):
            return text
    return ""


def _safe_int(value) -> int | None:
    if value is None or value == "":
        return None
    try:
        cleaned = re.sub(r"[^\d]", "", str(value))
        return int(cleaned) if cleaned else None
    except (TypeError, ValueError):
        return None


def format_bid_date(raw: str) -> str:
    text = (raw or "").strip()
    if not text or text in ("0000-00-00", "3333-03-03", "없음"):
        return "없음"
    match = re.match(r"(\d{4})[-./](\d{1,2})[-./](\d{1,2})", text)
    if match:
        y, m, d = match.groups()
        return f"{y}.{int(m):02d}.{int(d):02d}"
    match = re.match(r"(\d{4})\.(\d{1,2})\.(\d{1,2})", text)
    if match:
        y, m, d = match.groups()
        return f"{y}.{int(m):02d}.{int(d):02d}"
    return text.split("(")[0].strip() or "없음"


def make_sa_no_from_base(base: dict) -> str:
    """API baseInfo.sn1/sn2/pn → 2025타경56916 (saNo는 클라이언트에서 조합)."""
    sa_no = _pick_str(base, "saNo", "sa_no")
    if sa_no:
        normalized = _normalize_auction_no(sa_no)
        return normalized or sa_no

    sn1 = _pick_str(base, "sn1")
    sn2 = _pick_str(base, "sn2")
    if not sn1 or not sn2:
        return ""
    pn = _safe_int(base.get("pn")) or 0
    raw = f"{sn1}타경{sn2}" + (f"({pn})" if pn > 0 else "")
    normalized = _normalize_auction_no(raw)
    return normalized or raw


def _collect_address_candidates(detail: dict) -> list[str]:
    candidates: list[str] = []
    base = detail.get("baseInfo") or detail.get("base_info") or {}
    if isinstance(base, dict):
        for key in (
            "regn_adrs",
            "regnAdrs",
            "road_adrs",
            "roadAdrs",
            "adrs",
            "addr",
            "land_adrs",
            "landAdrs",
        ):
            candidates.append(_pick_str(base, key))

    def walk(node) -> None:
        if isinstance(node, dict):
            for key in ("regn_adrs", "regnAdrs", "road_adrs", "roadAdrs", "adrs", "nm", "note"):
                candidates.append(_pick_str(node, key))
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    for section in ("lsInfo", "landInfo", "bldgInfo", "objectInfo"):
        walk(detail.get(section))

    seen: set[str] = set()
    unique: list[str] = []
    for text in candidates:
        if text and text not in seen:
            seen.add(text)
            unique.append(text)
    unique.sort(key=len, reverse=True)
    return unique


def fetch_tank_raw_detail(driver, tid: str) -> dict | None:
    if not tid:
        return None
    try:
        raw = driver.execute_async_script(
            """
            const tid = arguments[0];
            const cb = arguments[arguments.length - 1];
            fetch(`/ca/AuctView.php?tid=${encodeURIComponent(tid)}`, {
              method: 'GET',
              credentials: 'same-origin',
              headers: {
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
              },
            })
              .then(r => r.text())
              .then(text => {
                const start = text.indexOf('{');
                if (start < 0) { cb(null); return; }
                try { cb(JSON.parse(text.slice(start))); }
                catch { cb(null); }
              })
              .catch(() => cb(null));
            """,
            str(tid),
        )
        if isinstance(raw, dict):
            return raw
    except Exception:
        pass
    return None


def fetch_tank_detail_bundle(driver, tid: str) -> tuple[dict | None, dict | None]:
    """AuctView + EnvViewData 병렬 조회 (탱크→네이버 전 대기 단축)."""
    if not tid:
        return None, None
    try:
        raw = driver.execute_async_script(
            """
            const tid = arguments[0];
            const cb = arguments[arguments.length - 1];
            const headers = {
              Accept: 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
            };
            const parseJson = (text) => {
              const start = (text || '').indexOf('{');
              if (start < 0) return null;
              try { return JSON.parse(text.slice(start)); }
              catch { return null; }
            };
            Promise.all([
              fetch(`/ca/AuctView.php?tid=${encodeURIComponent(tid)}`, {
                method: 'GET', credentials: 'same-origin', headers,
              }).then(r => r.text()).then(parseJson),
              fetch('/molit/res/EnvViewData.php?' + new URLSearchParams({
                tid: String(tid), gb: '1',
              }).toString(), {
                method: 'GET', credentials: 'same-origin', headers,
              }).then(r => r.text()).then(parseJson),
            ])
              .then(([auct, env]) => cb({ auct, env }))
              .catch(() => cb({ auct: null, env: null }));
            """,
            str(tid),
        )
        if isinstance(raw, dict):
            auct = raw.get("auct")
            env = raw.get("env")
            return (
                auct if isinstance(auct, dict) else None,
                env if isinstance(env, dict) else None,
            )
    except Exception:
        pass
    return None, None


def fetch_tank_detail_bundle_with_retry(
    driver,
    tid: str,
    *,
    attempts: int = 4,
    delay: float = 0.2,
) -> tuple[dict | None, dict | None]:
    """페이지 로드 직후 API null일 때 짧게 재시도."""
    auct: dict | None = None
    env: dict | None = None
    for _ in range(max(1, attempts)):
        auct, env = fetch_tank_detail_bundle(driver, tid)
        if auct:
            return auct, env
        time.sleep(delay)
    return auct, env


def _element_text(element) -> str:
    return (element.get_attribute("innerText") or element.text or "").strip()


def extract_complex_id_from_env_payload(payload: dict | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    dt_dj = payload.get("dtDj") or {}
    if not isinstance(dt_dj, dict):
        return None
    apt_row = dt_dj.get("aptRow")
    if isinstance(apt_row, dict) and not isinstance(apt_row, list):
        row = apt_row
    elif isinstance(dt_dj, dict) and "apt_code" in dt_dj:
        row = dt_dj
    else:
        row = {}
    apt_info = dt_dj.get("aptInfo") if isinstance(dt_dj.get("aptInfo"), dict) else {}
    for candidate in (
        row.get("dj_no"),
        apt_info.get("dj_no", {}).get("value") if isinstance(apt_info.get("dj_no"), dict) else apt_info.get("dj_no"),
        dt_dj.get("dj_no"),
        payload.get("dj_no"),
    ):
        if candidate is None:
            continue
        try:
            num = int(str(candidate).strip())
        except (TypeError, ValueError):
            continue
        if num > 0:
            return str(num)
    return None


def _area_text_from_node(node) -> str:
    if isinstance(node, dict):
        for key in (
            "bldg_sqm",
            "bldgSqm",
            "excl_area",
            "exclArea",
            "area",
            "sqm",
            "전용면적",
        ):
            val = node.get(key)
            if isinstance(val, dict):
                val = val.get("value") or val.get("label")
            if val is not None:
                text = str(val).strip()
                if text and text not in ("0", "-", "없음"):
                    return text
    elif isinstance(node, str):
        text = node.strip()
        if text and text not in ("0", "-", "없음"):
            return text
    return ""


def extract_building_area_from_detail(detail: dict | None) -> str:
    if not isinstance(detail, dict):
        return "0"
    base = detail.get("baseInfo") or detail.get("base_info") or {}
    if isinstance(base, dict):
        text = _area_text_from_node(base)
        if text:
            return text

    def walk(node) -> str:
        if isinstance(node, dict):
            text = _area_text_from_node(node)
            if text:
                return text
            for value in node.values():
                found = walk(value)
                if found:
                    return found
        elif isinstance(node, list):
            for item in node:
                found = walk(item)
                if found:
                    return found
        return ""

    for section in ("lsInfo", "objectInfo", "bldgInfo", "landInfo"):
        found = walk(detail.get(section))
        if found:
            return found
    return "0"


def read_dom_base_info(driver) -> dict:
    """client-top-summary data-base-info-text / data-base-info-value."""
    from selenium.webdriver.common.by import By

    out: dict = {}

    text_bindings = {
        "auctionNo": "saNo",
        "address": "regnAdrs",
        "bidDate": "bidDtm",
        "usage": "catNm",
    }
    for field, binding in text_bindings.items():
        for element in driver.find_elements(
            By.CSS_SELECTOR, f'[data-base-info-text="{binding}"]'
        ):
            text = _element_text(element)
            if text:
                out[field] = text
                break

    if out.get("auctionNo"):
        normalized = _normalize_auction_no(out["auctionNo"])
        if normalized:
            out["auctionNo"] = normalized

    if out.get("bidDate"):
        out["bidDate"] = format_bid_date(out["bidDate"])

    price_bindings = {
        "min_price": "minbAmt",
        "appraisal_price": "apslAmt",
        "sale_price": "sucbAmt",
    }
    for field, binding in price_bindings.items():
        value = None
        for selector in (
            f'[data-base-info-value="{binding}"]',
            f'.ca-inline-price[data-base-info-value="{binding}"]',
            f'[data-base-info-visible="{binding}"]',
        ):
            for element in driver.find_elements(By.CSS_SELECTOR, selector):
                value = _safe_int(_element_text(element))
                if value and value > 0:
                    break
            if value and value > 0:
                break
        if value and value > 0:
            out[field] = value

    return out


def parse_base_info_fields(detail: dict | None) -> dict:
    if not detail:
        return {}
    base = detail.get("baseInfo") or detail.get("base_info") or {}
    if not isinstance(base, dict):
        base = {}

    out: dict = {}

    auction_no = make_sa_no_from_base(base)
    if auction_no:
        out["auctionNo"] = auction_no

    addresses = _collect_address_candidates(detail)
    if addresses:
        out["address"] = addresses[0]

    bid_dt = _pick_str(base, "bid_dt", "bidDt", "bid_dtm", "bidDtm")
    formatted = format_bid_date(bid_dt)
    if formatted != "없음":
        out["bidDate"] = formatted

    min_price = _safe_int(
        base.get("minb_amt") or base.get("minbAmt") or base.get("minPrice")
    )
    if min_price and min_price > 0:
        out["min_price"] = min_price

    appraisal = _safe_int(
        base.get("apsl_amt") or base.get("apslAmt") or base.get("appraisal_price")
    )
    if appraisal and appraisal > 0:
        out["appraisal_price"] = appraisal

    sale = _safe_int(base.get("sucb_amt") or base.get("sucbAmt") or base.get("salePrice"))
    if sale and sale > 0:
        out["sale_price"] = sale

    usage = _pick_str(base, "usg_nm", "usgNm", "usage", "cat_nm", "catNm")
    if usage:
        out["usage"] = usage

    court = _make_court_label(base)
    if court:
        out["court"] = court

    return out


def _make_court_label(base: dict) -> str:
    """AuctView baseInfo.caNm(법원명)+csNm(지원 표기)+dptNm(담당계) → "OO지방법원 OO계"
    형태의 사람이 읽는 담당법원 표시. 사건번호(2025타경12336 등)는 법원마다
    독립적으로 채번되어 서로 다른 법원의 사건이 같은 번호를 쓸 수 있으므로,
    이 값을 사건번호와 함께 물건 식별에 반드시 같이 써야 한다."""
    ca_nm = _pick_str(base, "caNm", "ca_nm")
    dpt_nm = _pick_str(base, "dptNm", "dpt_nm")
    if not ca_nm and not dpt_nm:
        return ""
    parts = [p for p in (ca_nm, dpt_nm) if p]
    return " ".join(parts)


def merge_tank_fields(*sources: dict | None) -> dict:
    merged: dict = {}
    for source in sources:
        if not source:
            continue
        for key, value in source.items():
            if value is None:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            if isinstance(value, (int, float)) and value == 0 and key.endswith("_price"):
                continue
            merged[key] = value
    return merged


def fetch_env_view_data(driver, tid: str) -> dict | None:
    """탱크 /molit/res/EnvViewData.php — envInfo.envData(교육·주변), dtDj(단지) 등."""
    if not tid:
        return None
    try:
        raw = driver.execute_async_script(
            """
            const tid = arguments[0];
            const cb = arguments[arguments.length - 1];
            const params = new URLSearchParams({ tid: String(tid), gb: '1' });
            fetch('/molit/res/EnvViewData.php?' + params.toString(), {
              method: 'GET',
              credentials: 'same-origin',
              headers: {
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
              },
            })
              .then(r => r.text())
              .then(text => {
                const start = text.indexOf('{');
                if (start < 0) { cb(null); return; }
                try { cb(JSON.parse(text.slice(start))); }
                catch { cb(null); }
              })
              .catch(() => cb(null));
            """,
            str(tid),
        )
        if isinstance(raw, dict):
            return raw
    except Exception:
        pass
    return None


def _parse_json_list(value) -> list:
    if not value:
        return []
    if isinstance(value, list):
        return [item for item in value if item not in (None, "")]
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [item for item in parsed if item not in (None, "")]
        except json.JSONDecodeError:
            return [text]
    return []


def _extract_env_data(payload: dict | None) -> dict:
    if not isinstance(payload, dict):
        return {}
    env_info = payload.get("envInfo")
    if isinstance(env_info, dict):
        env_data = env_info.get("envData")
        if isinstance(env_data, dict):
            return env_data
    env_data = payload.get("envData")
    if isinstance(env_data, dict):
        return env_data
    return {}


def _format_school_distance(raw: str) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    if re.search(r"[kmKM]|미터|m", text):
        return text
    digits = re.sub(r"[^\d.]", "", text)
    if not digits:
        return text
    try:
        meters = float(digits)
    except ValueError:
        return text
    if meters >= 1000:
        km = meters / 1000
        return f"{km:.1f}km" if km < 10 else f"{int(round(km))}km"
    return f"{int(round(meters))}m"


def _format_school_entry(item) -> str:
    parts = str(item or "").split("|")
    name = (parts[0] if parts else "").strip()
    for token in ("유치원", "초등학교", "중학교", "고등학교", "대학교"):
        name = name.replace(token, "").strip()
    distance = _format_school_distance(parts[1]) if len(parts) > 1 else ""
    if name and distance:
        return f"{name} ({distance})"
    return name


SCHOOL_FIELD_LABELS: tuple[tuple[str, str], ...] = (
    ("preschool", "유치원"),
    ("elementary", "초등학교"),
    ("middle", "중학교"),
    ("high", "고등학교"),
    ("university", "대학교"),
)


def parse_education_from_env_payload(payload: dict | None) -> str:
    """신 UI client-education-environment — envInfo.envData 학교 목록."""
    env_data = _extract_env_data(payload)
    if not env_data:
        return ""

    lines: list[str] = []
    for key, label in SCHOOL_FIELD_LABELS:
        items = _parse_json_list(env_data.get(key))
        formatted = [
            entry
            for entry in (_format_school_entry(item) for item in items)
            if entry
        ]
        if formatted:
            lines.append(f"{label}: {', '.join(formatted)}")
    return "\n".join(lines)


def _pick_apt_field(source: dict | None, *keys: str) -> str:
    if not isinstance(source, dict):
        return ""
    for key in keys:
        value = source.get(key)
        if isinstance(value, dict):
            value = value.get("value") or value.get("label") or value.get("text")
        if value is None:
            continue
        text = str(value).strip()
        if text and text not in ("-", "0", "없음", "null"):
            return text
    return ""


_BUILD_YEAR_LABEL_RE = re.compile(r"사용승인(?:일|일자)?|준공(?:년월일|일)?", re.I)
_USE_APPROVAL_INLINE_RE = re.compile(
    r"사용승인(?:일|일자)?\s*[:：]?\s*(\d{4})[-./](\d{1,2})[-./](\d{1,2})"
)


def _normalize_build_year_text(text: str) -> str:
    return (
        str(text or "")
        .replace("\u00a0", " ")
        .replace("：", ":")
        .replace("\r", "\n")
    )


def normalize_build_year_value(raw: str) -> str:
    """사용승인·준공 날짜 문자열 → YYYY.MM.DD 또는 연도."""
    text = _normalize_build_year_text(raw).strip()
    if not text or text in ("-", "0", "0000-00-00", "없음", "null", "값없음"):
        return ""
    inline = _USE_APPROVAL_INLINE_RE.search(text)
    if inline:
        y, m, d = inline.groups()
        if y == "0000":
            return ""
        return f"{y}.{int(m):02d}.{int(d):02d}"
    match = re.search(r"(\d{4})[-./](\d{1,2})[-./](\d{1,2})", text)
    if match:
        y, m, d = match.groups()
        if y == "0000":
            return ""
        return f"{y}.{int(m):02d}.{int(d):02d}"
    year_match = re.search(r"(19|20)\d{2}", text)
    return year_match.group(0) if year_match else ""


def is_valid_build_year(raw: str) -> bool:
    return bool(normalize_build_year_value(raw))


def parse_build_year_from_text(text: str) -> str:
    """DOM 텍스트 — 사용승인일:1992-11-17 / 사용승인일자 1989-01-26 등."""
    normalized_text = _normalize_build_year_text(text)
    if not normalized_text:
        return ""

    inline = _USE_APPROVAL_INLINE_RE.search(normalized_text)
    if inline:
        y, m, d = inline.groups()
        return f"{y}.{int(m):02d}.{int(d):02d}"

    for label_match in _BUILD_YEAR_LABEL_RE.finditer(normalized_text):
        snippet = normalized_text[label_match.start() : label_match.start() + 80]
        parsed = normalize_build_year_value(snippet)
        if parsed:
            return parsed
    return ""


def _find_use_apr_in_dict(source: dict | None) -> str:
    if not isinstance(source, dict):
        return ""
    for key, value in source.items():
        key_text = str(key)
        if isinstance(value, dict):
            nested = _pick_apt_field({key: value}, key)
            if nested and (
                "승인" in key_text
                or "apr" in key_text.lower()
                or "준공" in key_text
            ):
                if normalize_build_year_value(nested):
                    return nested
            inner = _find_use_apr_in_dict(value)
            if inner:
                return inner
            continue
        if "승인" in key_text or "apr" in key_text.lower() or "준공" in key_text:
            text = str(value).strip()
            if text and text not in ("-", "0", "없음", "null"):
                if normalize_build_year_value(text):
                    return text
    return ""


def parse_build_year_from_detail(detail: dict | None) -> str:
    """AuctView JSON — 사용승인·준공 필드."""
    if not isinstance(detail, dict):
        return ""

    key_hints = ("use_apr", "useapr", "apr_day", "aprv_dt", "승인", "준공")

    def walk(node) -> str:
        if isinstance(node, dict):
            for key, value in node.items():
                key_l = str(key).lower()
                if any(hint in key_l for hint in key_hints) or any(
                    hint in str(key) for hint in ("승인", "준공")
                ):
                    if isinstance(value, dict):
                        text = _pick_apt_field({key: value}, key)
                    else:
                        text = str(value).strip()
                    parsed = normalize_build_year_value(text)
                    if parsed:
                        return parsed
                found = walk(value)
                if found:
                    return found
        elif isinstance(node, list):
            for item in node:
                found = walk(item)
                if found:
                    return found
        elif isinstance(node, str):
            parsed = parse_build_year_from_text(node)
            if parsed:
                return parsed
        return ""

    for section in ("addInfo", "objectInfo", "bldgInfo", "baseInfo", "envInfo"):
        found = walk(detail.get(section))
        if found:
            return found
    return walk(detail)


def extract_build_year_from_dom(driver) -> str:
    """추가내용·페이지 텍스트에서 사용승인일 추출."""
    texts: list[str] = []
    for panel_id in ("lyCnt_add", "bldg_table"):
        try:
            text = driver.execute_script(
                """
                const el = document.getElementById(arguments[0]);
                return el ? (el.innerText || el.textContent || '') : '';
                """,
                panel_id,
            )
            if text:
                texts.append(str(text))
        except Exception:
            pass

    try:
        body_text = driver.execute_script(
            "return document.body ? (document.body.innerText || '') : '';"
        )
        if body_text:
            texts.append(str(body_text))
    except Exception:
        pass

    for text in texts:
        parsed = parse_build_year_from_text(text)
        if parsed:
            return parsed
    return ""


def parse_apt_meta_from_env_payload(payload: dict | None) -> dict:
    """EnvViewData dtDj.aptInfo — 사용승인일·세대수."""
    out = {"build_year": "", "total_units": 0}
    if not isinstance(payload, dict):
        return out

    dt_dj = payload.get("dtDj") or {}
    if not isinstance(dt_dj, dict):
        return out

    apt_row = dt_dj.get("aptRow") if isinstance(dt_dj.get("aptRow"), dict) else {}
    apt_info = dt_dj.get("aptInfo") if isinstance(dt_dj.get("aptInfo"), dict) else {}
    # 일부 응답은 aptRow/aptInfo로 감싸지 않고 dtDj 최상위에 바로
    # cnt_sedae/build_date 등을 담아 내려줌 — 이 형태도 폴백으로 지원.
    apt_flat = dt_dj

    use_apr = (
        _pick_apt_field(
            apt_row, "use_apr_day", "useAprDay", "use_apr_dt", "useAprDt"
        )
        or _pick_apt_field(
            apt_info,
            "use_apr_day",
            "useAprDay",
            "use_apr_dt",
            "useAprDt",
            "사용승인일",
            "사용승인일자",
        )
        or _pick_apt_field(
            apt_flat, "build_date", "use_apr_day", "useAprDay", "use_apr_dt", "useAprDt"
        )
        or _find_use_apr_in_dict(apt_row)
        or _find_use_apr_in_dict(apt_info)
    )
    if use_apr:
        normalized = normalize_build_year_value(use_apr)
        if normalized:
            out["build_year"] = normalized

    units_raw = (
        _pick_apt_field(apt_row, "cnt_sedae", "hhldCnt", "totHhldCnt", "sedae_cnt")
        or _pick_apt_field(apt_info, "cnt_sedae", "hhldCnt", "세대수", "totHhldCnt")
        or _pick_apt_field(apt_flat, "cnt_sedae", "hhldCnt", "totHhldCnt", "sedae_cnt")
    )
    units = _safe_int(units_raw)
    if units and units > 0:
        out["total_units"] = units
    return out


TENANT_STATUS_PREFIX = "__TENANT_STATUS_V1__"


def encode_tenant_status(payload: dict) -> str:
    return TENANT_STATUS_PREFIX + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def decode_tenant_status(raw: str) -> dict | None:
    text = (raw or "").strip()
    if not text.startswith(TENANT_STATUS_PREFIX):
        return None
    try:
        data = json.loads(text[len(TENANT_STATUS_PREFIX) :])
        return data if isinstance(data, dict) else None
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def tenant_status_is_empty(payload: dict | None) -> bool:
    if not isinstance(payload, dict):
        return True
    rows = payload.get("rows")
    misc = str(payload.get("miscNotes") or "").strip()
    status_note = str(payload.get("statusNote") or "").strip()
    if misc or status_note:
        return False
    if not isinstance(rows, list) or len(rows) == 0:
        return True
    for row in rows:
        if not isinstance(row, dict):
            continue
        if row.get("sectionHeader"):
            if str(row.get("occupancy") or row.get("tenantName") or "").strip():
                return False
            continue
        if any(
            str(row.get(key) or "").strip()
            for key in ("tenantName", "depositRent", "occupancy", "dates", "opposability")
        ):
            return False
    return True


def _normalize_lease_banner_text(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(text or "").strip())
    cleaned = re.sub(r"^=+\s*|\s*=+$", "", cleaned).strip()
    return cleaned


def _format_lease_dates_from_item(item: dict) -> str:
    mfs = _pick_str(item, "mfsDtStr", "mfs_dt_str")
    if mfs:
        return mfs.replace("<br>", "\n")
    mv = _pick_str(item, "mvDt", "mv_dt", "mvinYmd", "mvn_dt", "mvnDt")
    fx = _pick_str(item, "fxDt", "fx_dt", "cfmtnYmd", "fix_dt", "fixDt")
    shr = _pick_str(item, "shrDt", "shr_dt", "divdDt", "divd_dt")
    if not mv and not fx and not shr:
        return ""
    biz_label = "사업" if str(item.get("biz") or "0").strip() in ("1", "true", "True") else "전입"

    def _fmt_date(raw: str) -> str:
        text = (raw or "").strip()
        if not text or text in ("0000-00-00", "3333-03-03", "-"):
            return "-"
        return text

    parts: list[str] = []
    if mv:
        parts.append(f"{biz_label}:{_fmt_date(mv)}")
    if fx:
        parts.append(f"확정:{_fmt_date(fx)}")
    if shr:
        parts.append(f"배당:{_fmt_date(shr)}")
    return "\n".join(parts)


def _format_lease_money_from_item(item: dict) -> str:
    money = _pick_str(item, "moneyStr", "money_str")
    if money:
        return money.replace("<br>", "\n")
    dpst = item.get("dpst") if item.get("dpst") is not None else item.get("deposit")
    m_money = item.get("mMoney")
    t_money = item.get("tMoney")
    c_dpst = item.get("cDpst")
    parts: list[str] = []
    code_map = {1: "없", 2: "불명", 3: "이상"}
    if dpst is not None and str(dpst).strip() not in ("", "0"):
        try:
            dpst_num = float(str(dpst).replace(",", ""))
            if dpst_num > 0:
                if dpst_num in code_map:
                    parts.append(f"보:{code_map[int(dpst_num)]}")
                else:
                    parts.append(f"보:{int(dpst_num):,}원")
        except (TypeError, ValueError):
            parts.append(f"보:{dpst}")
    for label, val in (("월", m_money), ("차임", t_money), ("환산", c_dpst)):
        if val is None or str(val).strip() in ("", "0"):
            continue
        try:
            num = float(str(val).replace(",", ""))
            if num > 0:
                parts.append(f"{label}:{int(num):,}원")
        except (TypeError, ValueError):
            parts.append(f"{label}:{val}")
    return "\n".join(parts)


def _strip_html(text: str) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"<br\s*/?>", "\n", str(text), flags=re.I)
    cleaned = re.sub(r"<[^>]+>", "", cleaned)
    return cleaned.replace("\u00a0", " ").strip()


def _format_lease_analysis_from_item(item: dict, detail: dict | None = None) -> list[str]:
    lines: list[str] = []
    variants = item.get("dstbAnalyLineVariants")
    if isinstance(variants, dict):
        masked = bool(
            (detail or {}).get("specialInfo", {}).get("isAlreadyMasked")
            if isinstance((detail or {}).get("specialInfo"), dict)
            else False
        )
        bucket = variants.get("masked" if masked else "raw")
        if isinstance(bucket, list):
            lines.extend(str(v).strip() for v in bucket if str(v).strip())
    for key in ("dstbAnaly", "analy", "analyText", "analysis"):
        val = item.get(key)
        if val and str(val).strip():
            chunk = _strip_html(str(val))
            if chunk:
                lines.extend(part.strip() for part in chunk.split("\n") if part.strip())
    hints = item.get("dstbRiskHints")
    if isinstance(hints, list):
        for hint in hints:
            text = _strip_html(str(hint))
            if text:
                lines.append(text)
    deduped: list[str] = []
    seen: set[str] = set()
    for line in lines:
        if line not in seen:
            seen.add(line)
            deduped.append(line)
    return deduped


def _pick_leas_field(item: dict, *keys: str) -> str:
    if not isinstance(item, dict):
        return ""
    for key in keys:
        val = item.get(key)
        if val is not None and str(val).strip() not in ("", "-", "0", "null"):
            return str(val).strip()
    raw = item.get("rawRow")
    if isinstance(raw, dict):
        for key in keys:
            val = raw.get(key)
            if val is not None and str(val).strip() not in ("", "-", "0", "null"):
                return str(val).strip()
    return ""


def _extract_leas_items_and_note(detail: dict) -> tuple[list, str, bool]:
    misc = _strip_html(
        str(
            detail.get("leasNote")
            or detail.get("leas_note")
            or detail.get("attnNote")
            or ""
        )
    )
    leas = detail.get("leasInfo")
    items: list = []
    ls_no_flag = False

    if isinstance(leas, dict):
        raw_items = leas.get("items")
        if isinstance(raw_items, list):
            items = raw_items
        misc = _strip_html(
            str(leas.get("leasNote") or leas.get("leas_note") or misc)
        )
        ls_no_flag = str(leas.get("lsNoFlag") or "0").strip().lower() in (
            "1",
            "true",
            "y",
        )
    elif isinstance(leas, list):
        items = leas

    if not items:
        for key in (
            "leasInfList",
            "leas_inf_list",
            "ocpyInfo",
            "ocpyRelList",
            "lsdInfo",
            "dtLeas",
        ):
            arr = detail.get(key)
            if isinstance(arr, list) and arr:
                items = arr
                break

    return items, misc, ls_no_flag


def _lease_item_to_row(
    item: dict,
    detail: dict | None,
    seq: int,
    ls_no_flag: bool,
) -> dict | None:
    if not isinstance(item, dict):
        return None

    if str(item.get("ownOcpyFlag") or "0").strip().lower() in ("1", "true", "y"):
        return {
            "occupancyNo": "",
            "tenantName": "",
            "occupancy": _strip_html(_pick_leas_field(item, "ocpy", "dvsn_nm", "dvsnNm")),
            "dates": "",
            "depositRent": "",
            "opposability": "",
            "analysis": [],
            "other": "",
            "sectionHeader": True,
        }

    tenant = _pick_leas_field(
        item,
        "prsn",
        "irps_nm",
        "irpsNm",
        "intrpsNm",
        "acpmPrptBondDclFlnm",
        "acpmPrptOcpyIrpsFlnm",
    )
    occupancy = _pick_leas_field(
        item,
        "ocpy",
        "dvsn_nm",
        "dvsnNm",
        "lesPartCtt",
        "lsdPartCont",
        "auctnLesUsgNm",
        "auctnLesUsgCdNm",
    )
    deposit = _format_lease_money_from_item(item)
    if not deposit:
        tdps = _pick_leas_field(item, "tdps_amt", "tdpsAmt", "bidGrteeAmt")
        if tdps:
            deposit = f"보:{tdps}"

    dates = _format_lease_dates_from_item(item)
    if not dates:
        mvn = _pick_leas_field(item, "mvn_dt", "mvnDt", "mvinYmd")
        fix = _pick_leas_field(item, "fix_dt", "fixDt", "cfmtnYmd")
        parts = [p for p in (f"전입:{mvn}" if mvn else "", f"확정:{fix}" if fix else "") if p]
        dates = "\n".join(parts)

    occupancy_no = str(_pick_leas_field(item, "lsNo", "ls_no") or seq) if ls_no_flag else str(seq)
    opposability = _strip_html(
        _pick_leas_field(item, "dstbOpwr", "dstb_opwr", "opwr", "opposability")
    )
    other = _strip_html(_pick_leas_field(item, "note", "rmk", "etc"))

    if not any(
        (
            tenant,
            occupancy,
            deposit,
            dates,
            opposability,
            other,
            _format_lease_analysis_from_item(item, detail),
        )
    ):
        return None

    return {
        "occupancyNo": occupancy_no,
        "tenantName": _strip_html(tenant),
        "occupancy": _strip_html(occupancy),
        "dates": dates,
        "depositRent": deposit,
        "opposability": opposability,
        "analysis": _format_lease_analysis_from_item(item, detail),
        "other": other,
        "sectionHeader": False,
    }


def _parse_lease_status_rows_from_detail(detail: dict | None) -> tuple[list[dict], str]:
    if not isinstance(detail, dict):
        return [], ""
    items, misc, ls_no_flag = _extract_leas_items_and_note(detail)
    rows: list[dict] = []
    seq = 0
    for item in items:
        if str(item.get("ownOcpyFlag") or "0").strip().lower() in ("1", "true", "y"):
            header = _lease_item_to_row(item, detail, seq, ls_no_flag)
            if header:
                rows.append(header)
            continue
        seq += 1
        row = _lease_item_to_row(item, detail, seq, ls_no_flag)
        if row:
            rows.append(row)
    return rows, misc


EXTRACT_LEASE_STATUS_JS = """
const panel = document.getElementById('lyCnt_leas');
if (!panel) return null;

function parseLeaseRow(tr) {
  if (!tr.classList.contains('leasInfoTr')) return null;
  const cells = tr.querySelectorAll('td');
  if (cells.length < 8) return null;
  const tenantEl = cells[1].querySelector('.dtLeasP, .leasInfoP');
  const tenantName = tenantEl
    ? (tenantEl.innerText || tenantEl.textContent || '').trim()
    : (cells[1].innerText || '').trim();
  const analysis = (cells[6].innerText || '').split(/\\n+/).map(s => s.trim()).filter(Boolean);
  const row = {
    occupancyNo: (cells[0].innerText || '').trim(),
    tenantName,
    occupancy: (cells[2].innerText || '').trim(),
    dates: (cells[3].innerText || '').trim(),
    depositRent: (cells[4].innerText || '').trim(),
    opposability: (cells[5].innerText || '').trim(),
    analysis,
    other: (cells[7].innerText || '').trim(),
    sectionHeader: false,
  };
  if (!row.tenantName && !row.depositRent && !row.occupancy && !row.dates) return null;
  return row;
}

const rows = [];
const seen = new Set();
for (const tr of panel.querySelectorAll('tr.leasInfoTr')) {
  const row = parseLeaseRow(tr);
  if (!row) continue;
  const key = [row.tenantName, row.depositRent, row.occupancy].join('|');
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push(row);
}

function normalizeBannerText(text) {
  return String(text || '').replace(/\\s+/g, ' ').trim().replace(/^=+\\s*|\\s*=+$/g, '');
}

for (const tr of panel.querySelectorAll('table.Ltbl_list tbody tr')) {
  if (tr.classList.contains('leasInfoTr') || tr.querySelector('th')) continue;
  const cell = tr.querySelector('td[colspan], td');
  if (!cell) continue;
  const banner = normalizeBannerText(cell.innerText || cell.textContent || '');
  if (!banner) continue;
  const key = 'banner|' + banner;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push({
    occupancyNo: '',
    tenantName: '',
    occupancy: banner,
    dates: '',
    depositRent: '',
    opposability: '',
    analysis: [],
    other: '',
    sectionHeader: true,
  });
}

let miscNotes = '';
for (const table of panel.querySelectorAll('table.Btbl_list')) {
  const th = table.querySelector('th');
  if (!th) continue;
  const label = (th.innerText || '').replace(/\\s+/g, '');
  if (!label.includes('기타사항')) continue;
  const noteEl = table.querySelector('td .leasInfoP, td span, td');
  miscNotes = noteEl ? (noteEl.innerText || '').trim() : '';
  break;
}

return { version: 1, rows, miscNotes };
"""


def extract_lease_status_from_dom(driver) -> dict | None:
    from selenium.webdriver.common.by import By

    try:
        payload = driver.execute_script(f"return ({EXTRACT_LEASE_STATUS_JS});")
        if isinstance(payload, dict):
            payload.setdefault("version", 1)
            payload.setdefault("rows", [])
            payload.setdefault("miscNotes", "")
            if payload.get("rows") or payload.get("miscNotes"):
                return payload
    except Exception:
        pass

    try:
        panels = driver.find_elements(By.ID, "lyCnt_leas")
        if not panels:
            return None
        panel = panels[0]
        rows: list[dict] = []
        for tr in panel.find_elements(By.CSS_SELECTOR, "tr.leasInfoTr"):
            cells = tr.find_elements(By.TAG_NAME, "td")
            if len(cells) < 8:
                continue
            tenant_el = cells[1].find_elements(
                By.CSS_SELECTOR, ".dtLeasP, .leasInfoP"
            )
            tenant_name = (
                (tenant_el[0].text or "").strip()
                if tenant_el
                else (cells[1].text or "").strip()
            )
            analysis = [
                line.strip()
                for line in (cells[6].text or "").split("\n")
                if line.strip()
            ]
            row = {
                "occupancyNo": (cells[0].text or "").strip(),
                "tenantName": tenant_name,
                "occupancy": (cells[2].text or "").strip(),
                "dates": (cells[3].text or "").strip(),
                "depositRent": (cells[4].text or "").strip(),
                "opposability": (cells[5].text or "").strip(),
                "analysis": analysis,
                "other": (cells[7].text or "").strip(),
                "sectionHeader": False,
            }
            if any(
                row.get(k)
                for k in ("tenantName", "depositRent", "occupancy", "dates")
            ):
                rows.append(row)

        for tr in panel.find_elements(
            By.CSS_SELECTOR, "table.Ltbl_list tbody tr:not(.leasInfoTr)"
        ):
            if tr.find_elements(By.TAG_NAME, "th"):
                continue
            cells = tr.find_elements(By.TAG_NAME, "td")
            if not cells:
                continue
            banner = _normalize_lease_banner_text(cells[0].text or "")
            if not banner:
                continue
            if any(r.get("occupancy") == banner for r in rows if r.get("sectionHeader")):
                continue
            rows.append(
                {
                    "occupancyNo": "",
                    "tenantName": "",
                    "occupancy": banner,
                    "dates": "",
                    "depositRent": "",
                    "opposability": "",
                    "analysis": [],
                    "other": "",
                    "sectionHeader": True,
                }
            )

        misc_notes = ""
        for table in panel.find_elements(By.CSS_SELECTOR, "table.Btbl_list"):
            headers = table.find_elements(By.TAG_NAME, "th")
            if not headers or "기타사항" not in (headers[0].text or ""):
                continue
            note_els = table.find_elements(By.CSS_SELECTOR, "td .leasInfoP, td")
            if note_els:
                misc_notes = (note_els[0].text or "").strip()
            break

        if rows or misc_notes:
            return {"version": 1, "rows": rows, "miscNotes": misc_notes}
    except Exception:
        pass
    return None


def _merge_lease_status_payload(
    api_rows: list[dict],
    api_misc: str,
    dom_payload: dict | None,
) -> dict:
    rows = list(api_rows)
    misc = api_misc
    if not isinstance(dom_payload, dict):
        return {"version": 1, "rows": rows, "miscNotes": misc}

    dom_rows = dom_payload.get("rows") if isinstance(dom_payload.get("rows"), list) else []
    dom_misc = str(dom_payload.get("miscNotes") or "").strip()

    def _row_key(row: dict) -> tuple:
        return (
            row.get("tenantName"),
            row.get("depositRent"),
            row.get("occupancy"),
            row.get("sectionHeader"),
        )

    if dom_rows:
        rows = list(dom_rows)
        seen = {_row_key(row) for row in rows}
        for api_row in api_rows:
            key = _row_key(api_row)
            if key not in seen:
                rows.append(api_row)
                seen.add(key)

    if dom_misc and (not misc or len(dom_misc) > len(misc)):
        misc = dom_misc

    return {"version": 1, "rows": rows, "miscNotes": misc}


def format_tenant_status_text(payload: dict | None) -> str:
    if tenant_status_is_empty(payload):
        return ""
    rows = payload.get("rows") if isinstance(payload, dict) else []
    misc = str((payload or {}).get("miscNotes") or "").strip()
    blocks: list[str] = []

    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            if row.get("sectionHeader"):
                status = _normalize_lease_banner_text(
                    str(row.get("occupancy") or row.get("tenantName") or "").strip()
                )
                if status:
                    blocks.append(status)
                continue
            lines: list[str] = []
            label_parts = [
                str(row.get("occupancyNo") or "").strip(),
                str(row.get("tenantName") or "").strip(),
            ]
            label = " ".join(p for p in label_parts if p)
            if label:
                lines.append(f"임차인: {label}")
            occupancy = str(row.get("occupancy") or "").strip()
            if occupancy:
                lines.append(f"점유: {occupancy.replace(chr(10), ' / ')}")
            dates = str(row.get("dates") or "").strip()
            if dates:
                lines.append(f"전입/확정/배당: {dates.replace(chr(10), ' / ')}")
            deposit = str(row.get("depositRent") or "").strip()
            if deposit:
                lines.append(f"보증금/차임: {deposit.replace(chr(10), ' / ')}")
            opposability = str(row.get("opposability") or "").strip()
            if opposability:
                lines.append(f"대항력: {opposability}")
            analysis = row.get("analysis")
            if isinstance(analysis, list):
                analysis_text = " / ".join(str(v).strip() for v in analysis if str(v).strip())
                if analysis_text:
                    lines.append(f"분석: {analysis_text}")
            other = str(row.get("other") or "").strip()
            if other:
                lines.append(f"기타: {other}")
            if lines:
                blocks.append("\n".join(lines))

    if misc:
        blocks.append(f"[기타사항]\n{misc}")
    return "\n\n".join(blocks)


def collect_lease_status(detail: dict | None, driver=None) -> str:
    dom_payload = extract_lease_status_from_dom(driver) if driver is not None else None
    api_rows, api_misc = _parse_lease_status_rows_from_detail(detail)
    payload = _merge_lease_status_payload(api_rows, api_misc, dom_payload)
    return format_tenant_status_text(payload)


def parse_lease_from_detail(detail: dict | None) -> str:
    """API 기반 임차인 현황 JSON (DOM 없음)."""
    return collect_lease_status(detail, driver=None)


def parse_lease_from_detail_legacy_plain(detail: dict | None) -> str:
    if not isinstance(detail, dict):
        return ""
    leas = detail.get("leasInfo") or {}
    if not isinstance(leas, dict):
        return ""
    items = leas.get("items") if isinstance(leas.get("items"), list) else []
    note = str(leas.get("leasNote") or "").strip()
    chunks: list[str] = []
    for item in items:
        if isinstance(item, dict):
            text = " | ".join(
                str(v).strip()
                for v in item.values()
                if v not in (None, "") and str(v).strip()
            )
        else:
            text = str(item).strip()
        if text:
            chunks.append(text)
    if note:
        chunks.append(note)
    return ", ".join(chunks)


def _format_detail_section_items(section) -> str:
    if not section:
        return ""
    if isinstance(section, list):
        items = section
        note = ""
    elif isinstance(section, dict):
        items = section.get("items") if isinstance(section.get("items"), list) else []
        if not items and isinstance(section.get("list"), list):
            items = section.get("list")
        note = str(section.get("note") or section.get("rmk") or section.get("leasNote") or "").strip()
    else:
        return str(section).strip()

    chunks: list[str] = []
    for item in items:
        if isinstance(item, dict):
            text = " | ".join(
                str(v).strip()
                for v in item.values()
                if v not in (None, "") and str(v).strip()
            )
        else:
            text = str(item).strip()
        if text:
            chunks.append(text)
    if isinstance(section, dict) and not chunks:
        for key in ("text", "content", "summary", "desc"):
            val = section.get(key)
            if val and str(val).strip():
                chunks.append(str(val).strip())
    if note:
        chunks.append(note)
    return ", ".join(chunks)


def _pick_from_base(detail: dict | None, *keys: str) -> str:
    if not isinstance(detail, dict):
        return ""
    base = detail.get("baseInfo") or detail.get("base_info") or {}
    if isinstance(base, dict):
        for key in keys:
            val = _pick_str(base, key)
            if val:
                return val
    return ""


def parse_owner_from_detail(detail: dict | None) -> str:
    val = _pick_from_base(
        detail, "ownr_nm", "ownrNm", "owner_nm", "ownerNm", "owner", "ownr"
    )
    if val:
        return val
    ls = detail.get("lsInfo") if isinstance(detail, dict) else None
    if isinstance(ls, dict):
        for key in ("ownr_nm", "ownrNm", "owner", "ownr"):
            val = _pick_str(ls, key)
            if val:
                return val
    return ""


def _parse_appraiser_label_text(text: str) -> str:
    if not text or "감정원" not in text:
        return ""
    normalized = text.replace("\u00a0", " ")
    patterns = (
        r"감정원\s*[：:]\s*['\"']?([^/\n\"']+?)['\"']?\s*(?:/|$|\n)",
        r"감정원\s*[''']([^''']+)[''']",
        r"감정원\s+([^\s/\n]+)",
    )
    for pattern in patterns:
        match = re.search(pattern, normalized)
        if not match:
            continue
        val = match.group(1).strip().strip("'\"")
        if val and val not in ("-", "없음", "값없음"):
            return val
    return ""


APPRAISER_DOM_BINDINGS = (
    "apslNm",
    "apslOffc",
    "apsl_nm",
    "apslOffcNm",
    "apslOffcNm1",
    "juteukNm",
    "juteuk",
    "appraiserNm",
    "appraiser",
)


def extract_appraiser_from_dom(driver) -> str:
    """data-base-info 바인딩·spanBox·본문에서 감정원(약칭 포함) 추출."""
    from selenium.webdriver.common.by import By

    for binding in APPRAISER_DOM_BINDINGS:
        for attr in ("data-base-info-text", "data-base-info-value"):
            for element in driver.find_elements(
                By.CSS_SELECTOR, f'[{attr}="{binding}"]'
            ):
                text = _element_text(element)
                if text and text not in ("-", "없음", "값없음", "0"):
                    return text

    for element in driver.find_elements(
        By.CSS_SELECTOR, '[data-base-info-text*="apsl"], [data-base-info-value*="apsl"]'
    ):
        binding = (
            element.get_attribute("data-base-info-text")
            or element.get_attribute("data-base-info-value")
            or ""
        )
        if "Amt" in binding or "amt" in binding:
            continue
        text = _element_text(element)
        if text and text not in ("-", "없음", "값없음", "0"):
            return text

    for element in driver.find_elements(By.CLASS_NAME, "spanBox"):
        parsed = _parse_appraiser_label_text(_element_text(element))
        if parsed:
            return parsed

    try:
        body_text = _element_text(driver.find_element(By.TAG_NAME, "body"))
        parsed = _parse_appraiser_label_text(body_text[:6000])
        if parsed:
            return parsed
    except Exception:
        pass
    return ""


def parse_appraiser_from_detail(detail: dict | None) -> str:
    val = _pick_from_base(
        detail,
        "apsl_nm",
        "apslNm",
        "appraiser",
        "apsl_offc",
        "apslOffc",
        "apsl_offc_nm",
        "apslOffcNm",
        "juteuk_nm",
        "juteukNm",
        "apsl_offc_snm",
        "apslOffcSnm",
    )
    if val:
        return val
    if not isinstance(detail, dict):
        return ""
    base = detail.get("baseInfo") or detail.get("base_info") or {}
    if not isinstance(base, dict):
        return ""
    for key, raw in base.items():
        key_lower = str(key).lower()
        if "amt" in key_lower or "dt" in key_lower:
            continue
        if not any(token in key_lower for token in ("apsl", "juteuk", "appr")):
            continue
        text = str(raw).strip()
        if text and text not in ("-", "0", "없음", "null", "0000-00-00"):
            return text
    return ""


# AuctView baseInfo/histInfo.items[].sta(sta2와 동일 체계) 상태 코드 — 목록
# API의 sta1(대분류)/sta2(소분류)와 histInfo 항목별 sta는 같은 코드 체계를
# 쓴다(실측: 2025타경35392/부천지원3계, tid=2482618, 2026-07-20).
_BID_HIST_STATE_LABELS: dict[int, str] = {
    1111: "유찰",
    1110: "진행",
    1210: "매각",
    1212: "차순위매수신고",
    1230: "대금지급기한",
    1211: "매각허가결정",
}


def _fmt_bid_amount(amt) -> str:
    try:
        n = int(amt)
    except (TypeError, ValueError):
        return ""
    if n <= 0:
        return ""
    return f"{n:,}원"


def parse_bid_info_from_detail(detail: dict | None) -> str:
    """histInfo.items[]를 차수별 한 줄 요약으로 변환. 각 항목은
    "N차 YYYY-MM-DD 상태 금액 (부가정보)" 형태 — 낙찰 회차는 입찰자수·
    낙찰자명을, 차순위 회차는 2위금액을 부가정보로 붙인다."""
    if not isinstance(detail, dict):
        return ""
    section = detail.get("histInfo")
    items: list = []
    if isinstance(section, list):
        items = section
    elif isinstance(section, dict):
        for key in ("items", "list", "rows", "histList"):
            raw = section.get(key)
            if isinstance(raw, list):
                items = raw
                break
    if not items:
        return ""

    lines: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        seq = _pick_str(item, "seq")
        date = _pick_str(item, "bid_dt", "bidDt", "bid_dtm", "bidDtm", "date")
        sta = item.get("sta")
        try:
            sta_int = int(sta)
        except (TypeError, ValueError):
            sta_int = None
        state_label = _BID_HIST_STATE_LABELS.get(sta_int, "") if sta_int is not None else ""

        amount = _fmt_bid_amount(item.get("amt"))
        extras: list[str] = []
        if sta_int == 1210:
            bidr_cnt = item.get("bidr_cnt")
            if bidr_cnt:
                extras.append(f"입찰 {bidr_cnt}명")
            sucb_nm = _pick_str(item, "sucb_nm", "sucbNm")
            if sucb_nm:
                extras.append(f"낙찰자 {sucb_nm}")
        elif sta_int == 1212 and amount:
            extras.append(f"2위금액 {amount}")
            amount = ""

        parts = [p for p in (f"{seq}차" if seq else "", date, state_label, amount) if p]
        if extras:
            parts.append(f"({', '.join(extras)})")
        if parts:
            lines.append(" ".join(parts))

    return "\n".join(lines)


def _format_rg_info_items(section) -> str:
    """rgBldgInfo/rgLandInfo.items[] — 이미 정제된 필드(sectRank/rcDt/rcNo/
    rgNm/prsn/note)만 사용해 간결한 한 줄씩 요약. rawRow(원본 dict)는 제외."""
    if not isinstance(section, dict):
        return ""
    items = section.get("items")
    if not isinstance(items, list) or not items:
        return ""
    lines: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        parts = [
            str(item.get("sectRank") or "").strip(),
            str(item.get("rcDt") or "").strip(),
            str(item.get("rgNm") or "").strip(),
            str(item.get("prsn") or "").strip(),
        ]
        note = str(item.get("note") or "").strip()
        line = " ".join(p for p in parts if p)
        if note:
            line = f"{line} ({note})" if line else note
        if line:
            lines.append(line)
    return "\n".join(lines)


def parse_deunggi_from_detail(detail: dict | None) -> str:
    if not isinstance(detail, dict):
        return ""

    for section_key in ("rgBldgInfo", "rgLandInfo"):
        text = _format_rg_info_items(detail.get(section_key))
        if text:
            return text

    for section_key in (
        "rgstInfo",
        "registInfo",
        "dtReg",
        "regInfo",
        "bldgRgst",
        "rgstBldgInfo",
    ):
        section = detail.get(section_key)
        text = _format_detail_section_items(section)
        if text:
            return text
    return ""


def parse_bldg_meta_from_detail(detail: dict | None) -> dict:
    out = {"elevator": "", "parking": ""}
    if not isinstance(detail, dict):
        return out
    bldg = detail.get("bldgInfo") or detail.get("bldg_info") or {}
    if not isinstance(bldg, dict):
        return out

    def walk(node) -> None:
        if isinstance(node, dict):
            for key, val in node.items():
                key_l = str(key).lower()
                text = ""
                if isinstance(val, dict):
                    text = str(val.get("value") or val.get("label") or "").strip()
                elif val not in (None, ""):
                    text = str(val).strip()
                if not text:
                    walk(val)
                    continue
                if (
                    not out["elevator"]
                    and ("elev" in key_l or "승강" in text or "elv" in key_l)
                    and not text.isdigit()
                ):
                    out["elevator"] = text
                if (
                    not out["parking"]
                    and ("park" in key_l or "주차" in text)
                    and not text.isdigit()
                ):
                    out["parking"] = text
                walk(val)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(bldg)
    return out


def parse_intr_flag_from_detail(detail: dict | None) -> bool:
    """유치권(interest) 존재 여부 — dtIntr.exist."""
    if not isinstance(detail, dict):
        return False
    dt_intr = detail.get("dtIntr") or {}
    if isinstance(dt_intr, dict):
        exist = dt_intr.get("exist")
        if exist in (True, 1, "1", "Y", "y"):
            return True
    special = detail.get("specialInfo") or {}
    if isinstance(special, dict):
        dt_dspsl = special.get("dtDspsl") or {}
        if isinstance(dt_dspsl, dict):
            note = str(dt_dspsl.get("note") or dt_dspsl.get("rmk") or "")
            if "유치권" in note:
                return True
    return False
