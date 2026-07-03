import os
import time

from browser import selenium_lock
from selenium.common.exceptions import ElementClickInterceptedException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

SITE_URL = os.environ.get("TANK_AUCTION_URL", "https://www.tankauction.com/")
LOGIN_TIMEOUT = 12
PAGE_READY_TIMEOUT = 20

HEADER_LOGIN_SELECTOR = ".loginSt.hdr-login-area [data-action='loginDivBtn']"

# 2026-07 리뉴얼: 헤더 로그인은 <span data-action="loginDivBtn"> + AJAX 플로팅 모달
LOGIN_OPEN_SELECTORS = [
    (By.CSS_SELECTOR, HEADER_LOGIN_SELECTOR),
    (By.CSS_SELECTOR, ".loginSt.hdr-login-area span.hand[data-action='loginDivBtn']"),
    (By.XPATH, "//span[contains(@class,'loginSt')]//span[@data-action='loginDivBtn']"),
    # legacy
    (By.CSS_SELECTOR, "a.fleft.loginSt"),
    (By.CSS_SELECTOR, "a.loginSt"),
    (By.XPATH, "//a[contains(normalize-space(.),'로그인')]"),
]

LOGGED_IN_SELECTORS = [
    (By.CSS_SELECTOR, "#logoutBtn"),
    (By.ID, "logoutBtn"),
    (By.CSS_SELECTOR, "[data-action='logoutBtn']"),
    (By.XPATH, "//a[contains(normalize-space(.),'로그아웃')]"),
    (By.XPATH, "//a[contains(@href,'logout') or contains(@href,'Logout')]"),
    (By.XPATH, "//*[contains(@class,'logout')]"),
]

SUBMIT_SELECTORS = [
    (By.CSS_SELECTOR, "#loginBtn"),
    (By.CSS_SELECTOR, "#fmLOGIN #loginBtn"),
    (By.CSS_SELECTOR, "button.button.btn_white.bigrounded"),
    (By.CSS_SELECTOR, "button.btn_white.bigrounded"),
    (By.XPATH, "//button[contains(normalize-space(.),'로그인')]"),
    (By.XPATH, "//span[@id='loginBtn' and contains(@class,'btn_white')]"),
]


def _credentials(user_id: str | None = None, user_pw: str | None = None):
    uid = (user_id or os.environ.get("TANK_AUCTION_USER") or "zgamez").strip()
    pw = (user_pw or os.environ.get("TANK_AUCTION_PASSWORD") or "young1!").strip()
    if not uid or not pw:
        raise RuntimeError("탱크옥션 ID와 비밀번호를 입력해 주세요.")
    return uid, pw


def _is_displayed(element) -> bool:
    try:
        return element.is_displayed() and element.is_enabled()
    except Exception:
        return False


def _find_clickable(driver, selectors):
    for by, value in selectors:
        try:
            for element in driver.find_elements(by, value):
                if _is_displayed(element):
                    return element
        except Exception:
            continue
    return None


class _AnyClickable:
    def __init__(self, selectors):
        self.selectors = selectors

    def __call__(self, driver):
        return _find_clickable(driver, self.selectors)


def _safe_click(driver, element):
    driver.execute_script(
        "arguments[0].scrollIntoView({block:'center', inline:'nearest'});",
        element,
    )
    try:
        element.click()
    except ElementClickInterceptedException:
        driver.execute_script("arguments[0].click();", element)


def _click_first(driver, timeout: float, selectors, label: str):
    wait = WebDriverWait(driver, timeout, poll_frequency=0.15)
    try:
        element = wait.until(_AnyClickable(selectors))
        _safe_click(driver, element)
    except Exception as exc:
        raise RuntimeError(
            f"탱크옥션 {label}을(를) 찾을 수 없습니다. ({exc})"
        ) from exc


def _wait_visible(driver, by, value, timeout: float = LOGIN_TIMEOUT):
    return WebDriverWait(driver, timeout, poll_frequency=0.15).until(
        EC.visibility_of_element_located((by, value))
    )


def _header_login_button_visible(driver) -> bool:
    for el in driver.find_elements(By.CSS_SELECTOR, HEADER_LOGIN_SELECTOR):
        if _is_displayed(el):
            return True
    return False


def _floating_login_visible(driver) -> bool:
    for el in driver.find_elements(By.CSS_SELECTOR, "#FLOATING_CONTENT #client_id"):
        if _is_displayed(el):
            return True
    return False


def _session_active_via_js(driver) -> bool | None:
    """탱크 프론트(localStorage) 기준 로그인 여부. None이면 판단 불가."""
    try:
        result = driver.execute_script(
            """
            (function () {
                try {
                    const raw = localStorage.getItem('settings');
                    if (raw && raw.length > 4 && raw !== 'null' && raw !== '{}') {
                        return true;
                    }
                } catch (e) {}
                const form = document.querySelector('#FLOATING_CONTENT #client_id');
                if (form && form.offsetParent !== null) return false;
                const btn = document.querySelector(
                    '.loginSt.hdr-login-area [data-action="loginDivBtn"]'
                );
                if (btn) {
                    const st = window.getComputedStyle(btn);
                    if (
                        st.display !== 'none' &&
                        st.visibility !== 'hidden' &&
                        btn.offsetParent !== null
                    ) {
                        return false;
                    }
                }
                return null;
            })();
            """
        )
        if result is True:
            return True
        if result is False:
            return False
    except Exception:
        pass
    return None


def _wait_site_ready(driver) -> None:
    """페이지 JS 로드 완료, 또는 이미 로그인된 상태."""

    def ready(d):
        if "tankauction.com" not in (d.current_url or ""):
            return False
        if _is_logged_in_unlocked(d):
            return True
        return _find_clickable(d, LOGIN_OPEN_SELECTORS) is not None

    WebDriverWait(driver, PAGE_READY_TIMEOUT, poll_frequency=0.25).until(ready)
    time.sleep(0.3)


def _open_login_modal(driver) -> None:
    _click_first(driver, LOGIN_TIMEOUT, LOGIN_OPEN_SELECTORS, "로그인 열기 버튼")
    _wait_visible(driver, By.CSS_SELECTOR, "#FLOATING_CONTENT #client_id", LOGIN_TIMEOUT)


def _fill_input(element, value: str) -> None:
    element.clear()
    element.send_keys(value)


def _read_login_error(driver) -> str:
    try:
        for selector in ("#loginError", "#FLOATING_CONTENT #loginError"):
            for el in driver.find_elements(By.CSS_SELECTOR, selector):
                if not _is_displayed(el):
                    continue
                msg = (el.text or "").strip()
                if msg and msg != " ":
                    return msg
                inner = el.find_elements(By.CSS_SELECTOR, ".login-error-message")
                if inner:
                    msg = (inner[0].text or "").strip()
                    if msg:
                        return msg
    except Exception:
        pass
    return ""


def _cert_modal_visible(driver) -> bool:
    try:
        for el in driver.find_elements(By.CSS_SELECTOR, "#FLOATING_CONTENT #fmCert, #fmCert"):
            if _is_displayed(el):
                return True
    except Exception:
        pass
    return False


def _wait_login_outcome(driver, timeout: float = 25) -> None:
    """로그인 제출 후: 리로드·모달 닫힘·오류·본인인증 중 하나를 기다림."""
    deadline = time.time() + timeout
    last_error = ""

    while time.time() < deadline:
        if _is_logged_in_unlocked(driver):
            return

        if _cert_modal_visible(driver):
            raise RuntimeError(
                "탱크옥션 휴대폰 인증이 필요합니다. "
                "Chrome 창에서 인증을 완료한 뒤 다시 시도해 주세요."
            )

        last_error = _read_login_error(driver)
        if last_error:
            raise RuntimeError(f"탱크옥션 로그인 오류: {last_error}")

        time.sleep(0.25)

    if last_error:
        raise RuntimeError(f"탱크옥션 로그인 오류: {last_error}")
    raise RuntimeError(
        "탱크옥션 로그인에 실패했습니다. ID/비밀번호를 확인하거나 "
        "브라우저에서 직접 로그인해 주세요."
    )


def is_logged_in(driver) -> bool:
    with selenium_lock:
        return _is_logged_in_unlocked(driver)


def _is_logged_in_unlocked(driver) -> bool:
    try:
        driver.switch_to.default_content()
        driver.implicitly_wait(0)

        current = driver.current_url or ""
        if "tankauction.com" not in current:
            return False

        for by, value in LOGGED_IN_SELECTORS:
            for element in driver.find_elements(by, value):
                if _is_displayed(element):
                    return True

        if _floating_login_visible(driver):
            return False

        js_state = _session_active_via_js(driver)
        if js_state is True:
            return True
        if js_state is False:
            return False

        # 헤더 「로그인」 버튼이 없으면 로그인된 상태 (리뉴얼 UI)
        if not _header_login_button_visible(driver):
            return True

        return False
    except Exception:
        return False
    finally:
        try:
            driver.implicitly_wait(5)
            driver.switch_to.default_content()
        except Exception:
            pass


def ensure_login(driver, user_id: str | None = None, user_pw: str | None = None) -> str:
    with selenium_lock:
        if _is_logged_in_unlocked(driver):
            return "탱크옥션 로그인 상태입니다."
        return _login_unlocked(driver, user_id=user_id, user_pw=user_pw)


def login(driver, user_id: str | None = None, user_pw: str | None = None) -> str:
    with selenium_lock:
        if _is_logged_in_unlocked(driver):
            return "탱크옥션 로그인 상태입니다."
        return _login_unlocked(driver, user_id=user_id, user_pw=user_pw)


def _login_unlocked(driver, user_id: str | None = None, user_pw: str | None = None) -> str:
    uid, pw = _credentials(user_id, user_pw)

    driver.switch_to.default_content()
    driver.implicitly_wait(0)

    try:
        current = driver.current_url or ""
        if "tankauction.com" not in current:
            driver.get(SITE_URL)

        _wait_site_ready(driver)

        if _is_logged_in_unlocked(driver):
            return "탱크옥션 로그인 상태입니다."

        _open_login_modal(driver)

        client_id_input = _wait_visible(
            driver, By.CSS_SELECTOR, "#FLOATING_CONTENT #client_id"
        )
        _fill_input(client_id_input, uid)

        passwd_input = _wait_visible(
            driver, By.CSS_SELECTOR, "#FLOATING_CONTENT #passwd"
        )
        _fill_input(passwd_input, pw)

        _click_first(driver, LOGIN_TIMEOUT, SUBMIT_SELECTORS, "로그인 제출 버튼")
        _wait_login_outcome(driver)

    finally:
        driver.implicitly_wait(5)
        driver.switch_to.default_content()

    return f"탱크옥션 로그인 완료 ({uid})"
