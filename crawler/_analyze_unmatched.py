import io, json, re, sys
from collections import defaultdict
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = Path("nice_lists")

nice_items = json.loads((BASE / "_all_combined.json").read_text(encoding="utf-8"))
our_rows = json.loads((BASE / "our_db_export.json").read_text(encoding="utf-8"))

nice_case_nos = set()
for item in nice_items:
    sa_year = str(item.get("saYear") or "").strip()
    sa_no = str(item.get("saNo") or "").strip()
    if sa_year and sa_no:
        nice_case_nos.add(f"{sa_year}타경{int(sa_no)}")

unmatched_rows = [r for r in our_rows if str(r.get("auctionNo") or "").strip() not in nice_case_nos]
print("나이스 목록에 사건번호 자체가 아예 없는 우리 물건:", len(unmatched_rows))
for r in unmatched_rows[:20]:
    print(" -", r.get("auctionNo"), "|", r.get("court"), "|", (r.get("address") or "")[:40])
