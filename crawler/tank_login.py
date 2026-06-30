import os
import time

from selenium.common.exceptions import ElementClickInterceptedException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

SITE_URL = os.environ.get("TANK_AUCTION_URL", "https://www.tankauction.com/")
LOGIN_TIMEOUT = 2

LOGIN_OPEN_SELECTORS = [
    (By.CSS_SELECTOR, "a.fleft.loginSt"),
    (By.CSS_SELECTOR, ".fleft.loginSt"),
    (By.CSS_SELECTOR, "a.loginSt"),
    (By.CSS_SELECTOR, ".loginSt"),
    (By.XPATH, "//a[contains(@class,'loginSt')]"),
    (By.XPATH, "//a[contains(normalize-space(.),'로그인')]"),
    (By.XPATH, "//span[contains(normalize-space(.),'로그인')]/ancestor::a[1]"),
]

HEADER_LOGIN_SELECTORS = [
    (By.CSS_SELECTOR, "a.fleft.loginSt"),
    (By.CSS_SELECTOR, ".fleft.loginSt"),
    (By.CSS_SELECTOR, "a.loginSt"),
    (By.CSS_SELECTOR, ".loginSt"),
]

LOGGED_IN_SELECTORS = [
    (By.XPATH, "//a[contains(normalize-space(.),'로그아웃')]"),
    (By.XPATH, "//a[contains(@href,'logout') or contains(@href,'Logout')]"),
    (By.XPATH, "//*[contains(@class,'logout')]"),
]

SUBMIT_SELECTORS = [
    (By.CSS_SELECTOR, "button.button.btn_white.bigrounded"),
    (By.CSS_SELECTOR, "button.btn_white.bigrounded"),
    (By.CSS_SELECTOR, ".button.btn_white.bigrounded"),
    (By.XPATH, "//button[contains(@class,'btn_white') and contains(@class,'bigrounded')]"),
    (By.XPATH, "//button[contains(normalize-space(.),'로그인')]"),
    (By.XPATH, "//input[@type='submit' and contains(@value,'로그인')]"),
]


def _credentials(user_id: str | None = None, user_pw: str | None = None):
    uid = (user_id or os.environ.get("TANK_AUCTION_USER") or "zgamez").strip()
    pw = (user_pw or os.environ.get("TANK_AUCTION_PASSWORD") or "young1!").strip()
    if not uid or not pw:
        raise RuntimeError("탱크옥션 ID와 비밀번호를 입력해 주세요.")
    return uid, pw


def _find_clickable(driver, selectors):
    for by, value in selectors:
        try:
            for element in driver.find_elements(by, value):
                if element.is_displayed() and element.is_enabled():
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
    wait = WebDriverWait(driver, timeout, poll_frequency=0.1)
    try:
        element = wait.until(_AnyClickable(selectors))
        _safe_click(driver, element)
    except Exception as exc:
        raise RuntimeError(
            f"탱크옥션 {label}을(를) 찾을 수 없습니다. ({exc})"
        ) from exc


def _switch_to_login_frame(driver):
    driver.switch_to.default_content()
    for frame in driver.find_elements(By.TAG_NAME, "iframe"):
        try:
            driver.switch_to.frame(frame)
            if driver.find_elements(By.ID, "client_id"):
                return True
            driver.switch_to.default_content()
        except Exception:
            driver.switch_to.default_content()
    return False


def _wait_visible(driver, by, value, timeout: float = LOGIN_TIMEOUT):
    return WebDriverWait(driver, timeout, poll_frequency=0.1).until(
        EC.visibility_of_element_located((by, value))
    )


def is_logged_in(driver) -> bool:
    try:
        driver.switch_to.window(driver.window_handles[-1])
        driver.switch_to.default_content()
        driver.implicitly_wait(0)

        current = driver.current_url or ""
        if "tankauction.com" not in current:
            return False

        for by, value in LOGGED_IN_SELECTORS:
            for element in driver.find_elements(by, value):
                if element.is_displayed() and element.is_enabled():
                    return True

        if driver.find_elements(By.ID, "client_id"):
            return False

        if _find_clickable(driver, HEADER_LOGIN_SELECTORS):
            return False

        return True
    except Exception:
        return False
    finally:
        try:
            driver.implicitly_wait(5)
            driver.switch_to.default_content()
        except Exception:
            pass


def ensure_login(driver, user_id: str | None = None, user_pw: str | None = None) -> str:
    if is_logged_in(driver):
        return "탱크옥션 로그인 상태입니다."
    return login(driver, user_id=user_id, user_pw=user_pw)


def login(driver, user_id: str | None = None, user_pw: str | None = None) -> str:
    uid, pw = _credentials(user_id, user_pw)

    driver.switch_to.window(driver.window_handles[-1])
    driver.implicitly_wait(0)

    try:
        current = driver.current_url or ""
        if "tankauction.com" not in current:
            driver.get(SITE_URL)

        _click_first(driver, LOGIN_TIMEOUT, LOGIN_OPEN_SELECTORS, "로그인 열기 버튼")

        if not driver.find_elements(By.ID, "client_id"):
            _switch_to_login_frame(driver)

        client_id_input = _wait_visible(driver, By.ID, "client_id")
        client_id_input.clear()
        client_id_input.send_keys(uid)

        passwd_input = _wait_visible(driver, By.ID, "passwd")
        passwd_input.clear()
        passwd_input.send_keys(pw)

        _click_first(driver, LOGIN_TIMEOUT, SUBMIT_SELECTORS, "로그인 제출 버튼")
        time.sleep(0.3)

        driver.switch_to.default_content()
        if not is_logged_in(driver):
            raise RuntimeError(
                "탱크옥션 로그인에 실패했습니다. ID/비밀번호를 확인하거나 "
                "브라우저에서 직접 로그인해 주세요."
            )
    finally:
        driver.implicitly_wait(5)
        driver.switch_to.default_content()

    return f"탱크옥션 로그인 완료 ({uid})"
