"""Chrome 크롤러 프로필 — OneDrive 밖 기본 경로, Preferences/캐시 정리."""

from __future__ import annotations

import json
import logging
import os
import shutil
from pathlib import Path

log = logging.getLogger(__name__)

PREFERENCES_MAX_BYTES = 10 * 1024 * 1024
PROFILE_NAME_MAX_LEN = 256
MIGRATION_MARKER = ".migrated_from_project_data"

CACHE_DIR_NAMES = (
    "Cache",
    "Code Cache",
    "GPUCache",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "GrShaderCache",
    "ShaderCache",
)

SESSION_FILES = (
    "Cookies",
    "Cookies-journal",
    "Login Data",
    "Login Data-journal",
    "Web Data",
    "Web Data-journal",
)


def local_profile_root() -> Path:
    local = os.environ.get("LOCALAPPDATA", "").strip()
    if not local:
        local = str(Path.home() / "AppData" / "Local")
    return Path(local) / "auction-crawler" / "profiles"


def legacy_profile_dir(api_root: Path, context: str) -> Path:
    folder = "chrome-profile-cafe" if context == "cafe" else "chrome-profile-tank"
    return api_root / "data" / "crawler" / folder


def profile_folder_name(context: str) -> str:
    return "chrome-profile-cafe" if context == "cafe" else "chrome-profile-tank"


def default_profile_dir(api_root: Path, context: str) -> str:
    return str(local_profile_root() / profile_folder_name(context))


def _copy_session_files(src_default: Path, dst_default: Path) -> list[str]:
    copied: list[str] = []
    dst_default.mkdir(parents=True, exist_ok=True)
    for name in SESSION_FILES:
        src = src_default / name
        dst = dst_default / name
        if not src.is_file() or dst.exists():
            continue
        try:
            shutil.copy2(src, dst)
            copied.append(name)
        except OSError as exc:
            log.warning("session copy failed %s: %s", name, exc)
    return copied


def migrate_legacy_profile(api_root: Path, context: str, new_profile_dir: Path) -> list[str]:
    """OneDrive data/crawler 프로필 → LocalAppData (쿠키만 이전, 1회)."""
    actions: list[str] = []
    legacy = legacy_profile_dir(api_root, context)
    if not legacy.is_dir():
        return actions

    marker = new_profile_dir / MIGRATION_MARKER
    if marker.exists():
        return actions

    new_profile_dir.mkdir(parents=True, exist_ok=True)
    legacy_default = legacy / "Default"
    new_default = new_profile_dir / "Default"
    if legacy_default.is_dir():
        copied = _copy_session_files(legacy_default, new_default)
        if copied:
            actions.append(f"migrated session files: {', '.join(copied)}")

    marker.write_text(str(legacy.resolve()), encoding="utf-8")
    actions.append(f"migration marker written ({new_profile_dir})")
    return actions


def remove_legacy_profile_tree(api_root: Path, context: str) -> list[str]:
    """OneDrive 쪽 구 프로필 폴더 삭제 — 동기화 부하 제거."""
    actions: list[str] = []
    legacy = legacy_profile_dir(api_root, context)
    if not legacy.is_dir():
        return actions

    default = legacy / "Default"
    prefs = default / "Preferences"
    if prefs.is_file():
        try:
            size = prefs.stat().st_size
            if size > PREFERENCES_MAX_BYTES:
                prefs.unlink(missing_ok=True)
                actions.append(
                    f"legacy Preferences removed ({size / 1024 / 1024:.1f} MB)"
                )
        except OSError:
            pass

    if default.is_dir():
        actions.extend(
            f"legacy {line}"
            for line in _prune_cache_dirs(default)
        )

    try:
        size_mb = sum(
            f.stat().st_size for f in legacy.rglob("*") if f.is_file()
        ) / (1024 * 1024)
        shutil.rmtree(legacy, ignore_errors=True)
        if legacy.is_dir():
            actions.append(
                f"legacy profile partly remains ({size_mb:.0f} MB) - "
                "Chrome/crawler 종료 후 cleanup_chrome_profiles.py 재실행"
            )
        else:
            actions.append(f"removed legacy profile ({size_mb:.0f} MB): {legacy}")
    except OSError as exc:
        actions.append(f"legacy profile remove skipped: {exc}")
    return actions


def _sanitize_preferences_file(prefs: Path) -> list[str]:
    actions: list[str] = []
    if not prefs.is_file():
        return actions

    size = prefs.stat().st_size
    if size > PREFERENCES_MAX_BYTES:
        try:
            prefs.unlink(missing_ok=True)
            actions.append(
                f"deleted bloated Preferences ({size / 1024 / 1024:.1f} MB)"
            )
        except OSError as exc:
            actions.append(f"Preferences delete failed: {exc}")
        return actions

    if size < 1024 * 1024:
        return actions

    try:
        with prefs.open(encoding="utf-8") as handle:
            data = json.load(handle)
        profile = data.get("profile")
        if not isinstance(profile, dict):
            return actions
        name = profile.get("name")
        if isinstance(name, str) and len(name) > PROFILE_NAME_MAX_LEN:
            profile["name"] = "Default"
            with prefs.open("w", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
            actions.append(
                f"reset corrupted profile.name ({len(name)} chars → Default)"
            )
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        if size > PREFERENCES_MAX_BYTES:
            try:
                prefs.unlink(missing_ok=True)
                actions.append("deleted unreadable Preferences")
            except OSError as exc:
                actions.append(f"Preferences delete failed: {exc}")

    return actions


def _prune_cache_dirs(default_dir: Path) -> list[str]:
    actions: list[str] = []
    if not default_dir.is_dir():
        return actions
    for name in CACHE_DIR_NAMES:
        target = default_dir / name
        if not target.exists():
            continue
        try:
            shutil.rmtree(target, ignore_errors=True)
            actions.append(f"pruned cache: {name}")
        except OSError as exc:
            actions.append(f"cache prune skipped ({name}): {exc}")
    sw_cache = default_dir / "Service Worker" / "CacheStorage"
    if sw_cache.is_dir():
        try:
            shutil.rmtree(sw_cache, ignore_errors=True)
            actions.append("pruned cache: Service Worker/CacheStorage")
        except OSError as exc:
            actions.append(f"cache prune skipped (Service Worker): {exc}")
    return actions


def maintain_profile(profile_dir: str, *, prune_cache: bool = False) -> list[str]:
    """Chrome 시작 전 Preferences 비정상 크기·캐시 정리."""
    actions: list[str] = []
    base = Path(profile_dir)
    default_dir = base / "Default"
    prefs = default_dir / "Preferences"
    actions.extend(_sanitize_preferences_file(prefs))
    if prune_cache:
        actions.extend(_prune_cache_dirs(default_dir))
    return actions


def prepare_profile(
    api_root: Path,
    context: str,
    *,
    prune_cache_on_start: bool | None = None,
) -> tuple[str, list[str]]:
    """
    프로필 경로 확정 + 구 OneDrive 프로필 이전 + 정리.
    prune_cache_on_start: None이면 환경변수 CRAWLER_CHROME_PRUNE_CACHE=1 일 때만.
    """
    if prune_cache_on_start is None:
        prune_cache_on_start = os.environ.get(
            "CRAWLER_CHROME_PRUNE_CACHE", ""
        ).strip().lower() in ("1", "true", "yes")

    profile_dir = Path(default_profile_dir(api_root, context))
    actions: list[str] = []

    actions.extend(migrate_legacy_profile(api_root, context, profile_dir))
    actions.extend(maintain_profile(str(profile_dir), prune_cache=prune_cache_on_start))

    remove_legacy = os.environ.get(
        "CRAWLER_REMOVE_LEGACY_ONEDRIVE_PROFILE", "1"
    ).strip().lower() not in ("0", "false", "no")
    if remove_legacy and (profile_dir / MIGRATION_MARKER).exists():
        actions.extend(remove_legacy_profile_tree(api_root, context))

    return str(profile_dir), [a for a in actions if a]
