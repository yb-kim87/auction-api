"""나이스옥션 목록(crawler/nice_lists/_all_combined.json)과 우리 DB
(crawler/nice_lists/our_db_export.json)를 사건번호+법원으로 대조해
겹치는 물건을 찾는다. 사건번호만으로는 법원마다 독립 채번이라 안전하지
않으므로(실측 확인, 2026-07-19), 법원명까지 함께 확인한다.
"""

from __future__ import annotations

import io
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parent / "nice_lists"


def normalize_court_name(name: str) -> str:
    """법원명 비교용 정규화 — "법원"/"지방"/"지원"/공백/담당계 제거."""
    name = re.sub(r"\d+\s*계\s*$", "", name)  # "9계" 등 담당계 제거
    name = name.replace(" ", "")
    name = name.replace("지방법원", "").replace("고등법원", "")
    name = name.replace("법원", "")
    return name.strip()


def load_court_map() -> dict[int, str]:
    raw = json.loads((BASE / "_court_list.json").read_text(encoding="utf-8"))
    return {c["courtCd"]: normalize_court_name(c["courtNm"]) for c in raw["data"]}


def main() -> None:
    nice_items = json.loads((BASE / "_all_combined.json").read_text(encoding="utf-8"))
    our_rows = json.loads((BASE / "our_db_export.json").read_text(encoding="utf-8"))
    court_map = load_court_map()

    # 우리 DB: 사건번호(정규화, 괄호 물건번호 제거) -> [행 목록]
    # (법원마다 겹칠 수 있고, 같은 사건번호에 물건번호(1),(2)... 여러 건도
    # 있어 리스트로 유지한다. 괄호가 있으면 objNo도 함께 기록해 나이스
    # 목록의 objNo와 매칭에 활용한다.)
    our_by_case_no: dict[str, list[dict]] = defaultdict(list)
    obj_no_re = re.compile(r"^(.*?)\((\d+)\)$")
    for row in our_rows:
        raw_auction_no = str(row.get("auctionNo") or "").strip()
        if not raw_auction_no:
            continue
        m = obj_no_re.match(raw_auction_no)
        if m:
            case_no, obj_no = m.group(1), int(m.group(2))
        else:
            case_no, obj_no = raw_auction_no, None
        row = {**row, "_objNo": obj_no}
        our_by_case_no[case_no].append(row)

    matched: list[dict] = []
    ambiguous: list[dict] = []
    unmatched_case_no_not_found = 0

    for item in nice_items:
        sa_year = str(item.get("saYear") or "").strip()
        sa_no = str(item.get("saNo") or "").strip()
        if not sa_year or not sa_no:
            continue
        case_no = f"{sa_year}타경{int(sa_no)}"
        candidates = our_by_case_no.get(case_no)
        if not candidates:
            unmatched_case_no_not_found += 1
            continue

        court_cd = item.get("courtCd")
        nice_court_norm = court_map.get(court_cd, "")
        nice_obj_no = item.get("objNo")

        # 같은 사건번호에 여러 물건(objNo)이 있으면 먼저 objNo로 좁힌다
        # (물건번호 없는(_objNo=None) 우리 행은 단일물건 사건이라 그대로 둠).
        pool = candidates
        if len(pool) > 1 and nice_obj_no is not None:
            by_obj_no = [c for c in pool if c["_objNo"] == nice_obj_no]
            if by_obj_no:
                pool = by_obj_no

        if len(pool) == 1:
            matched.append(
                {
                    "auctionId": pool[0]["id"],
                    "auctionNo": case_no,
                    "ourCourt": pool[0]["court"],
                    "objId": item["objId"],
                    "niceCourtNm": nice_court_norm,
                    "disambiguated": len(candidates) > 1,
                }
            )
            continue
        candidates = pool

        # 여러 법원에 겹치는 사건번호 — 법원명으로 좁힌다.
        exact = [
            c for c in candidates if nice_court_norm and nice_court_norm in normalize_court_name(str(c["court"]))
        ]
        if len(exact) == 1:
            matched.append(
                {
                    "auctionId": exact[0]["id"],
                    "auctionNo": case_no,
                    "ourCourt": exact[0]["court"],
                    "objId": item["objId"],
                    "niceCourtNm": nice_court_norm,
                    "disambiguated": True,
                }
            )
        else:
            ambiguous.append(
                {
                    "auctionNo": case_no,
                    "objId": item["objId"],
                    "niceCourtNm": nice_court_norm,
                    "ourCandidates": [c["court"] for c in candidates],
                }
            )

    out = {
        "nice_total": len(nice_items),
        "our_total": len(our_rows),
        "matched_count": len(matched),
        "ambiguous_count": len(ambiguous),
        "unmatched_case_no_not_found": unmatched_case_no_not_found,
        "matched": matched,
        "ambiguous": ambiguous,
    }
    out_path = BASE / "match_result.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"나이스 목록: {len(nice_items)}건")
    print(f"우리 DB(approved): {len(our_rows)}건")
    print(f"매칭 성공: {len(matched)}건")
    print(f"모호(법원명으로도 특정 못함): {len(ambiguous)}건")
    print(f"나이스에 사건번호 자체가 없음: {unmatched_case_no_not_found}건")
    print(f"결과 저장: {out_path}")


if __name__ == "__main__":
    main()
