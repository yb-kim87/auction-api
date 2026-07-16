"""10단계 후속: 완전 HTTPX(목록/상세/네이버 전부 브라우저 없음) vs Selenium
완전 경로를 표본을 늘려 비교. compare_selenium_httpx.py와 비교 로직은
같지만, HTTPX 쪽 실행을 queue_manager(네이버 미포함) 대신
full_httpx_worker(네이버부동산까지 curl_cffi로 처리)로 바꾼 버전.

아파트만 대상으로 한다(사용자 지정, 2026-07-17).
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import sys
import time
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

IGNORE_FIELDS = {"record_time", "recordTime", "views"}
LOOSE_FIELDS = {"address"}
HTTPX_ONLY_FIELDS = {"extraData"}
KNOWN_FORMAT_DIFF_FIELDS = {"deunggi_info", "lease_info"}

# 네이버부동산 매물은 실시간으로 계속 바뀌므로(신규 등록/삭제), 완전히 같은
# 순간에 조회하지 않는 한 매물 목록 텍스트 자체는 달라질 수 있다. 핵심
# 지표(최저호가/갭투자 계산값/실거래건수)만 정확히 맞으면 되고, 매물
# 상세 텍스트 나열 차이는 "포맷 차이"가 아니라 "시점 차이"로 별도 분류.
TIME_SENSITIVE_FIELDS = {"naver_price_detail", "transaction_prices"}

TARGET_USAGE_KEYWORDS = ("아파트",)


def _is_target_usage(cat_nm: str | None) -> bool:
    text = str(cat_nm or "")
    return any(keyword in text for keyword in TARGET_USAGE_KEYWORDS)


def _load_dotenv() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv()
sys.path.insert(0, str(Path(__file__).resolve().parent))


def run_selenium_batch(tids: list[str]) -> dict[str, dict]:
    from browser import CONTEXT_TANK, ensure_driver
    from item_crawl import crawl_item
    from tank_login import is_logged_in, login

    driver = ensure_driver(CONTEXT_TANK)
    if not is_logged_in(driver):
        uid = os.environ.get("TANKAUCTION_ID")
        pw = os.environ.get("TANKAUCTION_PW")
        login(driver, uid, pw)
        time.sleep(1)

    results: dict[str, dict] = {}
    for tid in tids:
        url = f"https://www.tankauction.com/ca/caView.php?tid={tid}"
        try:
            results[tid] = crawl_item(driver, url)
        except Exception as exc:
            results[tid] = {"__error__": str(exc)}
    return results


async def run_full_httpx_batch(tids: list[str]) -> dict[str, dict]:
    from full_httpx_worker import crawl_one_item_full_httpx
    from http_client import login, make_client

    out: dict[str, dict] = {}
    async with make_client() as client:
        await login(client)
        for tid in tids:
            try:
                out[tid] = await crawl_one_item_full_httpx(client, tid)
            except Exception as exc:
                out[tid] = {"__error__": str(exc)}
    return out


def _type_name(value) -> str:
    return "None" if value is None else type(value).__name__


def compare_one(tid: str, sel: dict, htp: dict) -> dict:
    if "__error__" in sel or "__error__" in htp:
        return {
            "tid": tid, "status": "error",
            "seleniumError": sel.get("__error__"), "httpxError": htp.get("__error__"),
        }

    all_keys = set(sel.keys()) | set(htp.keys())
    missing_in_httpx = sorted(k for k in sel.keys() if k not in htp)
    missing_in_selenium = sorted(k for k in htp.keys() if k not in sel and k not in HTTPX_ONLY_FIELDS)

    value_diffs: list[dict] = []
    type_diffs: list[dict] = []
    format_diffs: list[dict] = []
    time_sensitive_diffs: list[dict] = []
    for key in sorted(all_keys):
        if key in IGNORE_FIELDS or key in HTTPX_ONLY_FIELDS:
            continue
        if key not in sel or key not in htp:
            continue
        sv, hv = sel[key], htp[key]
        if _type_name(sv) != _type_name(hv):
            type_diffs.append({"field": key, "seleniumType": _type_name(sv), "httpxType": _type_name(hv)})
            continue
        if key in LOOSE_FIELDS:
            if bool(str(sv).strip()) != bool(str(hv).strip()):
                value_diffs.append({"field": key, "selenium": sv, "httpx": hv})
            continue
        if str(sv) != str(hv):
            entry = {"field": key, "selenium": sv, "httpx": hv}
            if key in TIME_SENSITIVE_FIELDS:
                time_sensitive_diffs.append(entry)
            elif key in KNOWN_FORMAT_DIFF_FIELDS:
                format_diffs.append(entry)
            else:
                value_diffs.append(entry)

    image_url_diff = None
    if sel.get("link", "") != htp.get("link", ""):
        image_url_diff = {"selenium": sel.get("link"), "httpx": htp.get("link")}

    date_amount_fields = ("bidDate", "builtYear", "appraisal_price", "min_price", "sale_price")
    date_amount_diffs = [d for d in value_diffs if d["field"] in date_amount_fields]

    # 네이버 핵심 지표(최저호가/갭/실거래건수)는 별도로 강조 표시
    naver_core_fields = ("naver_lowest_price", "naver_id", "gap_margin", "gap_margin_sold_price", "new_case_gap_margin")
    naver_core_diffs = [d for d in value_diffs if d["field"] in naver_core_fields]

    status = "match" if not (missing_in_httpx or missing_in_selenium or value_diffs or type_diffs) else "diff"

    return {
        "tid": tid, "status": status,
        "missingInHttpx": missing_in_httpx, "missingInSelenium": missing_in_selenium,
        "valueDiffs": value_diffs, "typeDiffs": type_diffs, "formatDiffs": format_diffs,
        "timeSensitiveDiffs": time_sensitive_diffs, "naverCoreDiffs": naver_core_diffs,
        "imageUrlDiff": image_url_diff, "dateAmountNormalizationDiffs": date_amount_diffs,
    }


def print_report(comparisons: list[dict]) -> None:
    print("=" * 60)
    print("Selenium(완전경로) vs 완전 HTTPX(네이버 curl_cffi 포함) 비교 리포트")
    print("=" * 60)

    total = len(comparisons)
    matched = sum(1 for c in comparisons if c["status"] == "match")
    errored = sum(1 for c in comparisons if c["status"] == "error")
    diffed = total - matched - errored
    success_rate = (total - errored) / total * 100 if total else 0.0
    print(f"\n[상세성공률] {total - errored}/{total} ({success_rate:.1f}%) — 완전일치 {matched}건, 차이있음 {diffed}건, 오류 {errored}건")

    naver_core_mismatch_count = sum(1 for c in comparisons if c.get("naverCoreDiffs"))
    print(f"[네이버 핵심지표 불일치] {naver_core_mismatch_count}건 / {total}건")

    for c in comparisons:
        if c["status"] == "match":
            continue
        print(f"\n--- tid={c['tid']} status={c['status']} ---")
        if c["status"] == "error":
            print(f"  seleniumError: {c.get('seleniumError')}")
            print(f"  httpxError: {c.get('httpxError')}")
            continue
        if c["missingInHttpx"]:
            print(f"  [필드 누락 - HTTPX에 없음] {c['missingInHttpx']}")
        if c["missingInSelenium"]:
            print(f"  [필드 누락 - Selenium에 없음] {c['missingInSelenium']}")
        if c["typeDiffs"]:
            print(f"  [타입 차이] {c['typeDiffs']}")
        if c["imageUrlDiff"]:
            print(f"  [이미지URL 차이] {c['imageUrlDiff']}")
        if c["dateAmountNormalizationDiffs"]:
            print(f"  [날짜/금액 정규화 차이] {c['dateAmountNormalizationDiffs']}")
        if c.get("naverCoreDiffs"):
            print(f"  [!! 네이버 핵심지표 불일치 - 확인 필요] {c['naverCoreDiffs']}")
        if c.get("formatDiffs"):
            print(f"  [알려진 포맷 차이 - 내용은 동일, 표현만 다름] {[d['field'] for d in c['formatDiffs']]}")
        if c.get("timeSensitiveDiffs"):
            print(f"  [시점 차이로 추정 - 매물/실거래 텍스트, 조회 시각 다름] {[d['field'] for d in c['timeSensitiveDiffs']]}")
        other_diffs = [
            d for d in c["valueDiffs"]
            if d not in c["dateAmountNormalizationDiffs"] and d not in c.get("naverCoreDiffs", [])
        ]
        if other_diffs:
            print(f"  [값 차이 - 확인 필요] {other_diffs}")

    print("\n" + "=" * 60)
    if naver_core_mismatch_count == 0 and errored == 0:
        print("결론: 네이버 핵심 지표(호가/갭/단지ID) 전건 일치. 완전 HTTPX 전환 가능성 확인.")
    else:
        print("결론: 네이버 핵심 지표에 불일치가 있습니다. 원인 확인 필요.")
    print("=" * 60)


async def _collect_target_tids(n: int) -> list[str]:
    from http_client import fetch_detail, fetch_list_page, login, make_client
    from parsers import parse_list_page

    tids: list[str] = []
    async with make_client() as client:
        await login(client)
        page_no = 1
        while len(tids) < n and page_no <= 15:
            list_data = await fetch_list_page(client, page_no=page_no, data_size=20)
            list_items = parse_list_page(list_data)
            if not list_items:
                break
            for item in list_items:
                if len(tids) >= n:
                    break
                tid = item["tid"]
                if not tid:
                    continue
                detail = await fetch_detail(client, tid)
                cat_nm = detail.get("baseInfo", {}).get("catNm")
                if _is_target_usage(cat_nm):
                    tids.append(tid)
            page_no += 1
    return tids


async def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10

    print(f"아파트 물건 {n}건을 목록에서 탐색 중...")
    tids = await _collect_target_tids(n)
    print(f"비교 대상 tid {len(tids)}건: {tids}")

    print("\n[1/2] Selenium 크롤러(완전 경로) 실행 중...")
    selenium_results = run_selenium_batch(tids)

    print("[2/2] 완전 HTTPX 크롤러(네이버 curl_cffi 포함) 실행 중...")
    httpx_results = await run_full_httpx_batch(tids)

    comparisons = [
        compare_one(tid, selenium_results.get(tid, {"__error__": "no result"}), httpx_results.get(tid, {"__error__": "no result"}))
        for tid in tids
    ]

    print_report(comparisons)

    out_dir = Path(__file__).resolve().parent.parent / "tests" / "crawler" / "fixtures"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "compare_full_httpx_report.json").write_text(
        json.dumps(comparisons, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )


if __name__ == "__main__":
    asyncio.run(main())
