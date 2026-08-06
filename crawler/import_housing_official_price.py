"""국토교통부_주택 공시가격 정보(data.go.kr 3073746) 연 1회 CSV 배치를
읽어 housing_official_price 테이블에 적재한다.

나이스옥션이 공시가격을 매칭하는 방식(관리건축물대장PK 연계, 2026-08-06
조사)을 우리도 직접 재현하려는 것 — 부동산공시가격알리미는 공식 API가
없지만, 국토부가 같은 원본 데이터를 이 CSV로 무료·비로그인 배포한다.

파일은 https://www.data.go.kr/data/3073746/fileData.do 에서 관리자가
브라우저로 직접 다운로드해야 한다(자동화 시도했으나 다운로드 버튼이
JS/세션 기반이라 실패, 2026-08-06). 1,500만 건 이상의 대용량 CSV라
스트리밍으로 읽고, 청크 단위로 API에 올린다.

실행 예:
    python import_housing_official_price.py /path/to/주택공시가격.csv

컬럼명은 배포 회차마다 표기가 조금씩 다를 수 있어(예: "housingLedgerPk"
vs "관리건축물대장PK") 후보 이름 목록으로 매칭한다 — 실제 파일을 받아
`--dry-run`으로 먼저 헤더를 확인하는 걸 권장한다.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys

import httpx

API_BASE = os.environ.get("PRODUCTION_API_URL", "https://auction-production-2c72.up.railway.app")
CRAWLER_SECRET = os.environ.get("CRAWLER_SECRET", "local-crawler-secret")
CHUNK_SIZE = 2000

# 실제 필드명은 파일을 받아봐야 확정되므로, 후보를 여러 개 둔다.
COLUMN_CANDIDATES: dict[str, list[str]] = {
    "housingLedgerPk": ["관리건축물대장PK", "관리건축물대장pk", "housingLedgerPk", "mgmBldrgstPk", "PK"],
    "sigunguCd": ["시군구코드", "sigunguCd", "SIGUNGU_CD"],
    "bjdongCd": ["법정동코드", "bjdongCd", "BJDONG_CD"],
    "mainBun": ["본번", "mainBun", "MAIN_BUN", "지번본번"],
    "subBun": ["부번", "subBun", "SUB_BUN", "지번부번"],
    "complexNm": ["단지명", "건물명", "complexNm", "BLD_NM"],
    "dongNm": ["동명", "동", "dongNm", "DONG_NM"],
    "hoNm": ["호명", "호", "hoNm", "HO_NM"],
    "exclusiveArea": ["전용면적", "exclusiveArea", "EXCLU_AR"],
    "postedPrice": ["공시가격", "주택가격", "postedPrice", "POSTED_PRICE", "가격"],
    "stdYear": ["기준연도", "공시기준연도", "stdYear", "STD_YEAR"],
}


def detect_columns(header: list[str]) -> dict[str, str]:
    """헤더 행에서 각 필드에 대응하는 실제 컬럼명을 찾는다."""
    mapping: dict[str, str] = {}
    normalized = {h.strip(): h for h in header}
    for field, candidates in COLUMN_CANDIDATES.items():
        for cand in candidates:
            if cand in normalized:
                mapping[field] = normalized[cand]
                break
    return mapping


def to_int(value: str | None) -> int | None:
    if not value:
        return None
    cleaned = value.replace(",", "").strip()
    if not cleaned or not cleaned.lstrip("-").isdigit():
        return None
    return int(cleaned)


def to_float(value: str | None) -> float | None:
    if not value:
        return None
    cleaned = value.replace(",", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return None


def row_to_payload(row: dict[str, str], mapping: dict[str, str]) -> dict | None:
    def get(field: str) -> str:
        col = mapping.get(field)
        return (row.get(col) or "").strip() if col else ""

    posted_price = to_int(get("postedPrice"))
    std_year = get("stdYear")
    ho_nm = get("hoNm")
    if posted_price is None or not std_year or not ho_nm:
        return None

    return {
        "housingLedgerPk": get("housingLedgerPk") or None,
        "sigunguCd": get("sigunguCd"),
        "bjdongCd": get("bjdongCd"),
        "mainBun": get("mainBun"),
        "subBun": get("subBun"),
        "complexNm": get("complexNm") or None,
        "dongNm": get("dongNm"),
        "hoNm": ho_nm,
        "exclusiveArea": to_float(get("exclusiveArea")),
        "postedPrice": posted_price,
        "stdYear": std_year,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", help="다운로드한 CSV 파일 경로")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="헤더 컬럼 매칭 결과와 처음 3건만 출력하고 종료(업로드 안 함)",
    )
    parser.add_argument(
        "--encoding",
        default="utf-8-sig",
        help="파일 인코딩(기본 utf-8-sig, 안 맞으면 cp949로 재시도)",
    )
    args = parser.parse_args()

    try:
        f = open(args.csv_path, "r", encoding=args.encoding, newline="")
        reader = csv.DictReader(f)
        header = reader.fieldnames or []
    except UnicodeDecodeError:
        f = open(args.csv_path, "r", encoding="cp949", newline="")
        reader = csv.DictReader(f)
        header = reader.fieldnames or []

    mapping = detect_columns(list(header))
    missing = [k for k in COLUMN_CANDIDATES if k not in mapping]
    print(f"헤더 {len(header)}개 컬럼 중 매칭: {mapping}")
    if missing:
        print(f"⚠️  매칭 못한 필드: {missing} — COLUMN_CANDIDATES에 실제 헤더명을 추가해야 합니다.")
        print(f"   실제 헤더 전체: {header[:30]}")
        if not args.dry_run:
            sys.exit(1)

    if args.dry_run:
        print("\n--dry-run: 처음 3건 미리보기")
        for i, row in enumerate(reader):
            if i >= 3:
                break
            print(row_to_payload(row, mapping))
        return

    client = httpx.Client(timeout=60.0)
    batch: list[dict] = []
    total = 0
    skipped = 0

    def flush():
        nonlocal batch, total
        if not batch:
            return
        resp = client.post(
            f"{API_BASE}/housing-price/import",
            json={"rows": batch},
            headers={"x-crawler-secret": CRAWLER_SECRET},
        )
        resp.raise_for_status()
        total += len(batch)
        print(f"  적재 {total:,}건...", end="\r")
        batch = []

    for row in reader:
        payload = row_to_payload(row, mapping)
        if payload is None:
            skipped += 1
            continue
        batch.append(payload)
        if len(batch) >= CHUNK_SIZE:
            flush()
    flush()
    f.close()

    print(f"\n완료 — 적재 {total:,}건, 건너뜀(필수값 누락) {skipped:,}건")


if __name__ == "__main__":
    main()
