"""Probe Tank DetailView JS for leasInfo field names."""
import re
import urllib.request

html = urllib.request.urlopen(
    urllib.request.Request(
        "https://www.tankauction.com/ca/caView.php?tid=2530537",
        headers={"User-Agent": "Mozilla/5.0"},
    ),
    timeout=20,
).read().decode("utf-8", "replace")

chunk = re.search(r"(dist/chunks/DetailView-[^\"']+\.js)", html)
if not chunk:
    print("no chunk")
    raise SystemExit(0)

url = "https://www.tankauction.com/" + chunk.group(1)
js = urllib.request.urlopen(
    urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}),
    timeout=30,
).read().decode("utf-8", "replace")

for pat in [
    r"leasInfo[^\"']{0,80}",
    r"leasNote[^\"']{0,80}",
    r"lyCnt_leas[^\"']{0,80}",
    r"기타사항[^\"']{0,80}",
    r"leas_[a-zA-Z_]+",
    r"leas[A-Z][a-zA-Z]+",
]:
    hits = sorted(set(re.findall(pat, js)))
    if hits:
        print("\n", pat, hits[:20])

for m in re.finditer(r"leasInfo.{0,200}", js):
    print("\nctx:", m.group(0)[:200].replace("\n", " "))
