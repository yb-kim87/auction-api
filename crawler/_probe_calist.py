"""Probe caList.php DOM for url_collect selectors."""
import re
import urllib.request

CA_LIST = "https://www.tankauction.com/ca/caList.php"

req = urllib.request.Request(
    CA_LIST,
    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0"},
)
html = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", errors="replace")
print("len", len(html))
for kw in [
    "chk_idx",
    "saNo_",
    "mgmtNo_",
    "btnSrch",
    "btn_power",
    "btnSrch",
    "dataSize_s",
    "stat",
    "chk_ment",
    "BtnAddSer_0",
    "splSrchType4",
    "caView.php",
    "btn_tank",
]:
    print(f"  {kw}: {html.count(kw)}")

# save snippet around chk_idx
idx = html.find("chk_idx")
print("chk_idx idx", idx)
if idx >= 0:
    print(html[max(0, idx - 200) : idx + 400])

for m in re.finditer(r'id="(btn[^"]+)"', html):
    print("btn id:", m.group(1))

for m in re.finditer(r'name="(stat|dataSize_s|apslAmt[^"]*)"', html):
    print("select name:", m.group(0)[:80])
