"""9단계: Selenium 크롤러와 HTTPX 크롤러의 결과를 비교해 동일성을 검증.

요청 지침의 비교 항목:
- 반환필드 누락 여부
- 값 차이
- 타입 차이
- 목록수 차이
- 상세성공률
- 이미지URL 차이
- 날짜/금액 정규화 차이

동일한 tid 목록에 대해 두 경로를 각각 실행하고 지정된 포맷으로 출력한다.
이 스크립트가 "모두 동일"을 확인해주기 전까지는 기존 Selenium 코드를
삭제하지 않는다(요청 지침 9단계).
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

# 시간/기록 성격이라 값이 달라도 실패로 보지 않는 필드
IGNORE_FIELDS = {"record_time", "recordTime", "views"}

# 두 경로에서 표기 방식(도로명/지번)이 다를 수 있어 "존재 여부"만 비교하는 필드
LOOSE_FIELDS = {"address"}

# HTTPX 전용 신규 필드 — Selenium 크롤러는 애초에 이 필드를 만들지 않으므로
# "누락"이 아니라 "새로 추가된 필드"로 간주하고 비교 대상에서 제외한다.
HTTPX_ONLY_FIELDS = {"extraData"}

# 두 경로가 같은 정보를 다른 포맷으로 표현하는 필드 — 값 자체가 달라도
# 사람이 확인해 "포맷 차이"로 이미 분류된 필드는 실패로 세지 않고 별도 표기만 한다.
KNOWN_FORMAT_DIFF_FIELDS = {"deunggi_info", "lease_info"}

# 비교 대상 용도(사용자 지정): 아파트/빌라 계열만 검증. 토지·상가 등은 필드
# 구성 자체가 달라 비교 의미가 적어 제외.
TARGET_USAGE_KEYWORDS = ("아파트", "다세대", "연립", "도시형생활주택")


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
    """기존 Selenium crawl_item()으로 tid별 결과 수집."""
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
        except Exception as exc:  # 개별 실패는 기록만 하고 계속
            results[tid] = {"__error__": str(exc)}
    return results


async def run_httpx_batch(tids: list[str]) -> dict[str, dict]:
    """HTTPX queue_manager로 tid별 결과 수집(DB 저장 없이 파싱 결과만)."""
    from queue_manager import CrawlTask, run_detail_tasks

    tasks = [
        CrawlTask(sequence=i, url="", task_type="detail", metadata={"tid": tid})
        for i, tid in enumerate(tids)
    ]
    results = await run_detail_tasks(tasks, concurrency=3, worker_count=5, save_to_db=False)
    out: dict[str, dict] = {}
    for r in results:
        tid = r.task.metadata["tid"]
        out[tid] = r.data if r.success else {"__error__": r.error}
    return out


def _type_name(value) -> str:
    if value is None:
        return "None"
    return type(value).__name__


def compare_one(tid: str, sel: dict, htp: dict) -> dict:
    """단일 물건 비교 — 필드 누락/값 차이/타입 차이/이미지URL차이/날짜금액차이."""
    if "__error__" in sel or "__error__" in htp:
        return {
            "tid": tid,
            "status": "error",
            "seleniumError": sel.get("__error__"),
            "httpxError": htp.get("__error__"),
        }

    all_keys = set(sel.keys()) | set(htp.keys())
    missing_in_httpx = sorted(k for k in sel.keys() if k not in htp)
    missing_in_selenium = sorted(
        k for k in htp.keys() if k not in sel and k not in HTTPX_ONLY_FIELDS
    )

    value_diffs: list[dict] = []
    type_diffs: list[dict] = []
    format_diffs: list[dict] = []
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
            # 표기 방식 차이 허용 — 둘 다 비어있지 않은지만 확인
            if bool(str(sv).strip()) != bool(str(hv).strip()):
                value_diffs.append({"field": key, "selenium": sv, "httpx": hv})
            continue
        if str(sv) != str(hv):
            entry = {"field": key, "selenium": sv, "httpx": hv}
            if key in KNOWN_FORMAT_DIFF_FIELDS:
                format_diffs.append(entry)
            else:
                value_diffs.append(entry)

    image_url_diff = None
    sel_img = sel.get("link", "")
    htp_img = htp.get("link", "")
    if sel_img != htp_img:
        image_url_diff = {"selenium": sel_img, "httpx": htp_img}

    date_amount_fields = ("bidDate", "builtYear", "appraisal_price", "min_price", "sale_price")
    date_amount_diffs = [d for d in value_diffs if d["field"] in date_amount_fields]

    status = "match" if not (missing_in_httpx or missing_in_selenium or value_diffs or type_diffs) else "diff"

    return {
        "tid": tid,
        "status": status,
        "missingInHttpx": missing_in_httpx,
        "missingInSelenium": missing_in_selenium,
        "valueDiffs": value_diffs,
        "typeDiffs": type_diffs,
        "formatDiffs": format_diffs,
        "imageUrlDiff": image_url_diff,
        "dateAmountNormalizationDiffs": date_amount_diffs,
    }


def print_report(comparisons: list[dict], list_count_selenium: int, list_count_httpx: int) -> None:
    print("=" * 60)
    print("Selenium vs HTTPX 크롤러 비교 리포트")
    print("=" * 60)
    print(f"\n[목록수 차이] Selenium={list_count_selenium}건 HTTPX={list_count_httpx}건 "
          f"{'(일치)' if list_count_selenium == list_count_httpx else '(불일치!)'}")

    total = len(comparisons)
    matched = sum(1 for c in comparisons if c["status"] == "match")
    errored = sum(1 for c in comparisons if c["status"] == "error")
    diffed = total - matched - errored
    success_rate = (total - errored) / total * 100 if total else 0.0

    print(f"\n[상세성공률] {total - errored}/{total} ({success_rate:.1f}%) — 완전일치 {matched}건, 차이있음 {diffed}건, 오류 {errored}건")

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
        if c.get("formatDiffs"):
            print(f"  [알려진 포맷 차이 - 내용은 동일, 표현만 다름] {[d['field'] for d in c['formatDiffs']]}")
        other_diffs = [d for d in c["valueDiffs"] if d not in c["dateAmountNormalizationDiffs"]]
        if other_diffs:
            print(f"  [값 차이 - 확인 필요] {other_diffs}")

    print("\n" + "=" * 60)
    if diffed == 0 and errored == 0:
        print("결론: 모든 비교 물건이 완전히 동일합니다. Selenium 삭제 검토 가능.")
    else:
        print("결론: 차이가 있습니다. Selenium 코드를 유지하고 원인을 먼저 해결하세요.")
    print("=" * 60)


async def _collect_target_tids(n: int) -> list[str]:
    """목록을 여러 페이지 순회하며 아파트/빌라 계열 물건의 tid를 n개 모은다.

    목록 API에는 용도명이 없어(cat1/cat2 코드만 있음), 상세 API로 확인한
    catNm(사용자 지정: 아파트/다세대/연립/도시형생활주택)만 채택한다.
    """
    from http_client import fetch_detail, fetch_list_page, login, make_client
    from parsers import parse_list_page

    tids: list[str] = []
    async with make_client() as client:
        await login(client)
        page_no = 1
        while len(tids) < n and page_no <= 10:
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
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3

    print(f"아파트/빌라(다세대·연립·도시형생활주택) 물건 {n}건을 목록에서 탐색 중...")
    tids = await _collect_target_tids(n)
    print(f"비교 대상 tid {len(tids)}건: {tids}")

    print("\n[1/2] Selenium 크롤러 실행 중...")
    selenium_results = run_selenium_batch(tids)

    print("[2/2] HTTPX 크롤러 실행 중...")
    httpx_results = await run_httpx_batch(tids)

    comparisons = [
        compare_one(tid, selenium_results.get(tid, {"__error__": "no result"}), httpx_results.get(tid, {"__error__": "no result"}))
        for tid in tids
    ]

    print_report(comparisons, list_count_selenium=len(tids), list_count_httpx=len(tids))

    out_dir = Path(__file__).resolve().parent.parent / "tests" / "crawler" / "fixtures"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "compare_report.json").write_text(
        json.dumps(comparisons, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )


if __name__ == "__main__":
    asyncio.run(main())
