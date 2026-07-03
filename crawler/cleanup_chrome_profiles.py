"""OneDrive 구 Chrome 프로필 정리 + LocalAppData 이전 (크롤러 중지 후 실행)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "crawler"))

from chrome_profile import (  # noqa: E402
    legacy_profile_dir,
    prepare_profile,
    maintain_profile,
)


def main() -> int:
    api_root = ROOT
    print("=== Chrome 프로필 정리 ===")
    for context in ("tank", "cafe"):
        legacy = legacy_profile_dir(api_root, context)
        if legacy.is_dir():
            prefs = legacy / "Default" / "Preferences"
            if prefs.is_file():
                mb = prefs.stat().st_size / 1024 / 1024
                print(f"[legacy {context}] Preferences: {mb:.1f} MB -> {prefs}")

        profile_dir, actions = prepare_profile(api_root, context)
        print(f"[{context}] active profile: {profile_dir}")
        for line in actions:
            print(f"  - {line}")

        maintain_profile(profile_dir, prune_cache=True)
        print(f"[{context}] cache prune done")

    print("완료. 크롤러 워커를 재시작하세요.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
