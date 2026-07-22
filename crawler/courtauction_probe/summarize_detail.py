"""detail_response.json에서 picFile(base64 원본, 7MB 대부분 차지)만 제거한
경량 버전을 만든다. 네트워크 요청 없이 기존 저장 파일만 가공."""
import json
from pathlib import Path

SRC = Path(__file__).parent / "detail_response.json"
DST = Path(__file__).parent / "detail_response_no_pics.json"

with open(SRC, encoding="utf-8") as f:
    data = json.load(f)

result = data.get("data", {}).get("dma_result", {})
pics = result.get("csPicLst") or []
for pic in pics:
    pic.pop("picFile", None)

with open(DST, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"저장: {DST} ({DST.stat().st_size} bytes, 원본 {SRC.stat().st_size} bytes)")
