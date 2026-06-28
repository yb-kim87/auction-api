import glob
import os
from pathlib import Path

import undetected_chromedriver as uc
from selenium.common.exceptions import InvalidSessionIdException, WebDriverException

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

_driver = None


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


def _create_chrome(options: uc.ChromeOptions):
    version_main = _chrome_major_version()
    kwargs: dict = {"options": options}
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


def close_driver():
    global _driver
    if _driver is not None:
        try:
            _driver.quit()
        except Exception:
            pass
        _driver = None


def get_driver(force_new: bool = False):
    global _driver

    if force_new:
        close_driver()
    elif _driver is not None and is_session_alive(_driver):
        return _driver
    else:
        close_driver()

    opts = uc.ChromeOptions()
    opts.add_argument("--lang=ko-KR")
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_argument(f"user-agent={UA}")

    _driver = _create_chrome(opts)
    _driver.implicitly_wait(5)
    site_url = os.environ.get("TANK_AUCTION_URL", "https://www.tankauction.com/")
    _driver.get(site_url)
    return _driver


def browser_is_ready() -> bool:
    return is_session_alive(_driver)


def ensure_driver(force_new: bool = False):
    return get_driver(force_new=force_new)
