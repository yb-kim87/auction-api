import time, os, tempfile
os.environ.setdefault("TANKAUCTION_ID", "zgamez")
os.environ.setdefault("TANKAUCTION_PW", "young1!")
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
import tank_login

profile_dir = tempfile.mkdtemp()
opts = uc.ChromeOptions()
opts.add_argument("--lang=ko-KR")
opts.add_argument("--window-size=1920,1080")
opts.add_argument(f"--user-data-dir={profile_dir}")

driver = uc.Chrome(options=opts, use_subprocess=True, version_main=150)
try:
    driver.get("https://www.tankauction.com/")
    time.sleep(2)
    result = tank_login.ensure_login(driver)
    print("login result:", result)
    time.sleep(1)

    driver.get("https://www.tankauction.com/ca/caView.php?tid=2341347")
    time.sleep(6)
    body_text = driver.find_element(By.TAG_NAME, "body").text
    with open("tank_case_history_body.txt", "w", encoding="utf-8") as f:
        f.write(body_text)
    print("saved, len:", len(body_text))
finally:
    driver.quit()
