import glob
import os
import threading
import time
from pathlib import Path

import undetected_chromedriver as uc
from selenium.common.exceptions import InvalidSessionIdException, WebDriverException

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

CONTEXT_TANK = "tank"
CONTEXT_CAFE = "cafe"

NAVER_LOGIN_URL = "https://nid.naver.com/nidlogin.login"

_drivers: dict[str, object] = {}
_driver_lock = threading.RLock()


def _api_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _chrome_major_version() -> int | None:
    env = os.environ.get("CHROME_VERSION_MAIN", "").strip()
    if env.isdigit():
        return int(env)

    try:
        import winreg

        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Google\Chrome\BLBeacon",
        )
        version, _ = winreg.QueryValueEx(key, "version")
        winreg.CloseKey(key)
        return int(str(version).split(".")[0])
    except OSError:
        return None


def _resolve_chromedriver_path() -> str | None:
    home = Path.home()
    patterns = [
        home / ".wdm" / "drivers" / "chromedriver" / "win64" / "*" / "chromedriver.exe",
        home / ".wdm" / "drivers" / "chromedriver" / "win64" / "*" / "chromedriver-win32" / "chromedriver.exe",
        home / ".wdm" / "drivers" / "chromedriver" / "win32" / "*" / "chromedriver.exe",
    ]
    candidates: list[Path] = []
    for pattern in patterns:
        candidates.extend(Path(p) for p in glob.glob(str(pattern)))

    if not candidates:
        return None

    return str(max(candidates, key=lambda path: path.stat().st_mtime))


def _profile_dir(context: str) -> str:
    env_key = (
        "CRAWLER_CHROME_PROFILE_CAFE"
        if context == CONTEXT_CAFE
        else "CRAWLER_CHROME_PROFILE_TANK"
    )
    override = os.environ.get(env_key, "").strip()
    if override:
        return override

    folder = "chrome-profile-cafe" if context == CONTEXT_CAFE else "chrome-profile-tank"
    return str(_api_root() / "data" / "crawler" / folder)


def _create_chrome(options: uc.ChromeOptions):
    version_main = _chrome_major_version()
    kwargs: dict = {"options": options, "use_subprocess": False}
    if version_main is not None:
        kwargs["version_main"] = version_main

    try:
        return uc.Chrome(**kwargs)
    except OSError as first_exc:
        driver_path = _resolve_chromedriver_path()
        if not driver_path:
            raise RuntimeError(
                "ChromeDriver를 시작할 수 없습니다. Chrome 브라우저 설치를 확인해 주세요."
            ) from first_exc

        kwargs["driver_executable_path"] = driver_path
        return uc.Chrome(**kwargs)


def is_session_alive(driver) -> bool:
    if driver is None:
        return False
    try:
        driver.execute_script("return 1")
        _ = driver.window_handles
        return True
    except (InvalidSessionIdException, WebDriverException):
        return False


def _focus_driver(driver) -> None:
    try:
        handles = driver.window_handles
        if handles:
            driver.switch_to.window(handles[-1])
    except Exception:
        pass


def _close_context_unlocked(context: str) -> None:
    driver = _drivers.pop(context, None)
    if driver is not None:
        try:
            # 카페: quit 전 잠시 대기 → 프로필(쿠키) 디스크 flush
            if context == CONTEXT_CAFE:
                time.sleep(0.5)
            driver.quit()
        except Exception:
            pass


def close_driver(context: str | None = None) -> None:
    with _driver_lock:
        if context:
            _close_context_unlocked(context)
            return
        for key in list(_drivers.keys()):
            _close_context_unlocked(key)


def get_existing_driver(context: str = CONTEXT_TANK):
    with _driver_lock:
        driver = _drivers.get(context)
        if driver is not None and is_session_alive(driver):
            return driver
        if driver is not None:
            _close_context_unlocked(context)
        return None


def get_driver(
    force_new: bool = False,
    *,
    context: str = CONTEXT_TANK,
    navigate: str | None = None,
):
    """컨텍스트별 싱글톤 Chrome (탱크 / 카페 분리)."""
    with _driver_lock:
        if force_new:
            _close_context_unlocked(context)

        driver = _drivers.get(context)
        if not force_new and driver is not None and is_session_alive(driver):
            _focus_driver(driver)
            if navigate:
                current = (driver.current_url or "").strip()
                target = navigate.strip()
                if current.rstrip("/") != target.rstrip("/"):
                    driver.get(navigate)
            return driver

        if driver is not None:
            _close_context_unlocked(context)

        profile_dir = _profile_dir(context)
        os.makedirs(profile_dir, exist_ok=True)

        opts = uc.ChromeOptions()
        opts.add_argument("--lang=ko-KR")
        opts.add_argument("--window-size=1920,1080")
        opts.add_argument("--disable-blink-features=AutomationControlled")
        opts.add_argument(f"user-agent={UA}")
        # 로그인 쿠키 유지 — 이 폴더를 삭제하면 네이버 재로그인 필요
        opts.add_argument(f"--user-data-dir={profile_dir}")
        opts.add_argument("--profile-directory=Default")
        opts.add_argument("--no-first-run")
        opts.add_argument("--no-default-browser-check")
        opts.add_argument("--disable-session-crashed-bubble")

        driver = _create_chrome(opts)
        driver.implicitly_wait(5)
        _drivers[context] = driver

        if navigate:
            driver.get(navigate)
        elif context == CONTEXT_CAFE:
            # 저장된 세션(쿠키) 확인용 — 로그인 페이지로 보내지 않음
            driver.get("https://www.naver.com")
            time.sleep(0.8)
        else:
            site_url = os.environ.get(
                "TANK_AUCTION_URL", "https://www.tankauction.com/"
            )
            driver.get(site_url)

        return driver


def browser_is_ready(context: str = CONTEXT_TANK) -> bool:
    with _driver_lock:
        driver = _drivers.get(context)
        return is_session_alive(driver)


def ensure_driver(
    force_new: bool = False,
    *,
    context: str = CONTEXT_TANK,
    navigate: str | None = None,
):
    return get_driver(force_new=force_new, context=context, navigate=navigate)


def profile_dir_for(context: str) -> str:
    """외부 안내용 — 로그인 유지 프로필 경로."""
    return _profile_dir(context)


def ensure_cafe_driver(*, navigate: str | None = None, force_new: bool = False):
    return get_driver(force_new=force_new, context=CONTEXT_CAFE, navigate=navigate)
