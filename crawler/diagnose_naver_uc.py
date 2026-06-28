import json
import time
import undetected_chromedriver as uc

URL = (
    "https://fin.land.naver.com/complexes/25142"
    "?tradeTypes=A1&sortingType=%EB%82%AE%EC%9D%80%EA%B0%80%EA%B2%A9%EC%88%9C&tab=article"
)

opts = uc.ChromeOptions()
opts.add_argument("--lang=ko-KR")
driver = uc.Chrome(options=opts, version_main=149)
try:
    driver.get(URL)
    time.sleep(5)
    info = driver.execute_script(
        """
        return {
          url: location.href,
          title: document.title,
          cdcCount: Object.keys(window).filter(k => k.startsWith('cdc_')).length,
          webdriver: navigator.webdriver,
          body: (document.body && document.body.innerText || '').slice(0, 500)
        };
        """
    )
    print(json.dumps(info, ensure_ascii=False, indent=2))
finally:
    driver.quit()
