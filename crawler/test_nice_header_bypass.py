"""사용자가 실제 브라우저(Chrome 146, macOS)에서 캡처한 요청 헤더/쿠키를
그대로 httpx에 넣어 20건 순차 호출했을 때 12건 하드 리밋
(2026-07-31 확인, docs/niceauction-integration-research.md 참고)이
여전한지 재검증한다.

주의: 이전 오판 사례(2026-07-30) — HTTP 상태코드만 보면 프론트엔드
JS 자동 재시도로 인해 "안 막힌 것처럼" 보일 수 있으므로, 반드시 응답
바디의 code 필드까지 확인한다(code == 0 이면 정상, 그 외는 차단/에러).
"""

from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

import httpx

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

OBJ_IDS = json.loads(Path("_browser_test_objids.json").read_text(encoding="utf-8"))[:100]

# 사용자가 캡처한 실제 브라우저 요청 그대로 (Referer는 objId별로 갱신)
HEADERS = {
    "Host": "niceauction.co.kr",
    "Cookie": (
        "_ga=GA1.1.157066428.1785904692; "
        "_ga_MGNYXFKQXH=GS2.1.s1785904691$o1$g1$t1785904860$j13$l0$h0"
    ),
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Accept": "application/json, text/plain, */*",
    "Sec-Ch-Ua": '"Not-A.Brand";v="24", "Chromium";v="146"',
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
    ),
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Priority": "u=1, i",
}

BASE_URL = "https://niceauction.co.kr"


def main() -> None:
    results = []
    with httpx.Client(base_url=BASE_URL, headers=HEADERS, http2=True, timeout=30.0) as client:
        for i, obj_id in enumerate(OBJ_IDS, start=1):
            headers = {
                "Referer": (
                    f"{BASE_URL}/auction/detail/{obj_id}"
                    f"?standAlone=true&auctionSearchKey=auctionSearch:{int(time.time()*1000)}"
                )
            }
            obj = None
            try:
                resp = client.get(
                    f"/api/v1/obj/{obj_id}", params={"privacy": "true"}, headers=headers
                )
                status = resp.status_code
                try:
                    body = resp.json()
                    code = body.get("code")
                    msg = body.get("msg")
                    obj = body.get("data", {}).get("obj")
                except ValueError:
                    code = None
                    msg = "<non-json body>"
            except httpx.HTTPError as exc:
                status = None
                code = None
                msg = f"<request error: {exc}>"

            ok = code == 0 and bool(obj)
            summary = None
            if obj:
                summary = {
                    "saYear": obj.get("saYear"),
                    "saNo": obj.get("saNo"),
                    "addr": obj.get("addrNoPrivacy") or obj.get("addr"),
                    "bldgNm": obj.get("bldgNm"),
                    "gamjungAmt": obj.get("gamjungAmt"),
                    "minAmt": obj.get("minAmt"),
                    "courtNm": (obj.get("court") or {}).get("courtNm") if isinstance(obj.get("court"), dict) else None,
                    "fieldCount": len(obj),
                }
            print(
                f"[{i}/{len(OBJ_IDS)}] objId={obj_id} httpStatus={status} "
                f"bodyCode={code} ok={ok} -> {summary}",
                flush=True,
            )
            results.append(
                {
                    "i": i,
                    "objId": obj_id,
                    "httpStatus": status,
                    "bodyCode": code,
                    "ok": ok,
                    "msg": msg,
                    "summary": summary,
                }
            )
            time.sleep(1.0)

    Path("nice_header_bypass_result_100.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    ok_count = sum(1 for r in results if r["ok"])
    first_fail = next((r["i"] for r in results if not r["ok"]), None)
    print("\n=== 요약 ===")
    print(f"총 {len(results)}건 중 성공 {ok_count}건")
    print(f"첫 실패 지점: {first_fail}번째" if first_fail else "실패 없음(전부 성공)")


if __name__ == "__main__":
    main()
