"""tid별 AuctView leasInfo + DOM 진단."""
import json
import sys

from browser import ensure_driver, selenium_lock
from item_crawl import (
    _ensure_tank_detail_panels_ready,
    _panel_inner_text,
    _tid_from_url,
    _wait_lycnt_leas,
)
from tank_detail import (
    collect_lease_status,
    extract_lease_status_from_dom,
    fetch_tank_detail_bundle_with_retry,
    _parse_lease_status_rows_from_detail,
)
from tank_login import ensure_login

URL = sys.argv[1] if len(sys.argv) > 1 else "https://www.tankauction.com/ca/caView.php?tid=2530537"


def main():
    tid = _tid_from_url(URL)
    with selenium_lock:
        driver = ensure_driver()
        ensure_login(driver)
        driver.get(URL)
        raw, env = fetch_tank_detail_bundle_with_retry(driver, tid or "")
        _ensure_tank_detail_panels_ready(driver)
        _wait_lycnt_leas(driver, timeout=4.0)

        report = {"tid": tid, "url": URL}
        if raw:
            leas = raw.get("leasInfo")
            report["leasInfo_type"] = type(leas).__name__
            if isinstance(leas, dict):
                report["leasInfo_keys"] = list(leas.keys())
                items = leas.get("items")
                report["items_len"] = len(items) if isinstance(items, list) else 0
                if isinstance(items, list) and items:
                    report["first_item_keys"] = list(items[0].keys())[:40]
                    report["first_item_sample"] = {
                        k: items[0].get(k)
                        for k in list(items[0].keys())[:20]
                    }
                report["leasNote_len"] = len(str(leas.get("leasNote") or ""))
            top_keys = [k for k in raw.keys() if "leas" in k.lower() or "ocpy" in k.lower() or "lsd" in k.lower()]
            report["top_lease_keys"] = top_keys
            for k in top_keys[:8]:
                v = raw.get(k)
                if isinstance(v, list):
                    report[f"{k}_len"] = len(v)
                elif isinstance(v, dict):
                    report[f"{k}_keys"] = list(v.keys())[:15]

        api_rows, api_misc = _parse_lease_status_rows_from_detail(raw)
        report["api_rows"] = len(api_rows)
        report["api_misc_len"] = len(api_misc)
        report["panel_text_len"] = len(_panel_inner_text(driver, "lyCnt_leas"))
        report["panel_snippet"] = _panel_inner_text(driver, "lyCnt_leas")[:500]

        page_leas = driver.execute_script(
            """
            const paths = [
              () => window.detailView?.getActiveDetail?.()?.leasInfo,
              () => window.detailView?.rawDetail?.leasInfo,
              () => window.__DETAIL_VIEW__?.getActiveDetail?.()?.leasInfo,
            ];
            for (const fn of paths) {
              try {
                const leas = fn();
                if (leas && (leas.items?.length || leas.leasNote)) {
                  return {
                    source: 'page',
                    itemLen: Array.isArray(leas.items) ? leas.items.length : 0,
                    leasNoteLen: String(leas.leasNote || '').length,
                    first: Array.isArray(leas.items) && leas.items[0] ? leas.items[0] : null,
                  };
                }
              } catch (e) {}
            }
            const panel = document.getElementById('lyCnt_leas');
            return {
              trCount: panel ? panel.querySelectorAll('tr.leasInfoTr').length : 0,
              tblRows: panel ? panel.querySelectorAll('table.Ltbl_list tbody tr').length : 0,
              htmlLen: panel ? panel.innerHTML.length : 0,
              text: panel ? (panel.innerText || '').slice(0, 400) : '',
            };
            """
        )
        report["page_leas"] = page_leas
        dom = extract_lease_status_from_dom(driver)
        report["dom_rows"] = len(dom.get("rows", [])) if dom else 0
        report["dom_misc_len"] = len(dom.get("miscNotes", "")) if dom else 0
        report["collect"] = collect_lease_status(raw, driver)
        report["collect_len"] = len(report["collect"] or "")

        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
