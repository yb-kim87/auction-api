# 아임웹 유입경로 추적 스크립트 설치 가이드

카카오 소셜 로그인 자동가입 구조에서, 광고/링크를 통해 들어온 방문자가
어떤 캠페인을 보고 가입했는지 추정하기 위한 스크립트입니다.

흐름: **랜딩페이지 방문 → (UTM/광고클릭 정보 기록) → 카카오 로그인 →
가입완료 페이지 도착 → ("방금 가입 완료" 신호 전송)**

## 1. 랜딩페이지에 삽입할 스크립트

광고/링크가 최초로 도착하는 페이지(보통 메인 페이지 또는 특정 랜딩페이지)에
삽입합니다. 아임웹 관리자 화면 → **디자인 → 페이지 편집 → 해당 페이지 →
"코드 위젯"** 또는 **환경설정 → SEO → 고급 설정 → 공통 코드 삽입(Body Code)**
중 하나에 아래 스크립트를 넣습니다. 특정 랜딩페이지에만 필요하면 코드 위젯을,
사이트 전체에 필요하면 공통 코드 삽입을 사용하세요.

```html
<script>
(function () {
  var API_BASE = "https://auction-production-2c72.up.railway.app"; // 운영 API 주소

  function getParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || "";
  }

  function genVisitId() {
    return "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // 이미 이 브라우저에서 방문 기록을 남겼으면 재사용(같은 세션 내 중복 방지)
  var visitId = localStorage.getItem("_akv_visit_id");
  if (!visitId) {
    visitId = genVisitId();
    localStorage.setItem("_akv_visit_id", visitId);
  }

  var payload = {
    visitId: visitId,
    utmSource: getParam("utm_source"),
    utmMedium: getParam("utm_medium"),
    utmCampaign: getParam("utm_campaign"),
    utmContent: getParam("utm_content"),
    fbclid: getParam("fbclid"),
    landingUrl: window.location.href,
    referrer: document.referrer || "",
  };

  fetch(API_BASE + "/public/kakao-notify/landing-visit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(function () {});
})();
</script>
```

## 2. 가입완료(환영) 페이지에 삽입할 스크립트

카카오 로그인 완료 후 사용자가 도착하는 페이지에 삽입합니다(아임웹
관리자에서 "회원가입 완료 시 이동할 페이지" 설정을 확인하세요).

```html
<script>
(function () {
  var API_BASE = "https://auction-production-2c72.up.railway.app";
  var visitId = localStorage.getItem("_akv_visit_id");
  if (!visitId) return; // 랜딩페이지를 거치지 않고 직접 들어온 경우 등

  fetch(API_BASE + "/public/kakao-notify/landing-visit/confirm-signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitId: visitId }),
    keepalive: true,
  }).catch(function () {});
})();
</script>
```

## 3. 가입완료 페이지의 "카톡방 참여하기" 버튼 클릭 추적(선택)

실제 오픈채팅방 입장 여부는 카카오 API가 공개되어 있지 않아 확인할 수
없지만, "버튼을 눌렀는지"까지는 추적할 수 있습니다. 2번 스크립트와 같은
가입완료 페이지에 아래를 **추가로** 넣으세요(2번 스크립트는 그대로 두고
이 스크립트를 이어서 넣으면 됩니다).

카톡방 버튼의 링크 주소를 알아야 합니다. 버튼을 우클릭 → "검사(Inspect)"로 실제
`href` 값을 확인하세요. **오픈채팅 주소(`open.kakao.com/o/...`)가 아니라
`bit.ly`처럼 단축 URL로 걸려있는 경우가 많으니, 반드시 실제 href 값을 확인하고
그에 맞는 공통 부분을 아래 `KAKAO_ROOM_URL_PART`에 넣어야 합니다.**

```html
<script>
(function () {
  var API_BASE = "https://auction-production-2c72.up.railway.app";
  var KAKAO_ROOM_URL_PART = "bit.ly/couchEnd"; // 카톡방 버튼의 실제 href(단축 URL)에 맞춘 값

  document.addEventListener("click", function (e) {
    var link = e.target.closest ? e.target.closest("a") : null;
    if (!link || !link.href || link.href.indexOf(KAKAO_ROOM_URL_PART) === -1) return;

    var visitId = localStorage.getItem("_akv_visit_id");
    if (!visitId) return;

    fetch(API_BASE + "/public/kakao-notify/landing-visit/kakao-room-click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitId: visitId }),
      keepalive: true,
    }).catch(function () {});
  });
})();
</script>
```

이 스크립트는 페이지 안의 모든 링크 클릭을 감시하다가, href에
`KAKAO_ROOM_URL_PART` 문자열이 포함된 링크(카톡방 버튼)를 클릭했을 때만
기록을 남깁니다. 버튼의 실제 링크 형태가 다르면 이 값을 그에 맞게 바꿔주세요.

> **실제 사례**: 아임웹에서 버튼을 `open.kakao.com`으로 바로 연결하지 않고
> `bit.ly/xxxxx` 같은 단축 URL로 걸어두는 경우가 있습니다. 이 경우
> `KAKAO_ROOM_URL_PART`를 `"open.kakao.com"`으로 두면 조건이 절대 만족되지
> 않아 클릭이 하나도 기록되지 않습니다(전부 "클릭 안 함"으로 표시됨). 반드시
> 버튼을 우클릭 → 검사(Inspect)로 실제 `href` 값을 확인한 뒤 그 값에 맞게
> 설정하세요.

## 확인 방법

1. 광고 링크 형태로 `?utm_source=instagram&utm_campaign=테스트` 를 붙여
   랜딩페이지에 접속해봅니다.
2. 브라우저 개발자도구(F12) → Network 탭에서 `landing-visit` 요청이
   200으로 성공하는지 확인합니다.
3. 카카오 로그인으로 회원가입을 완료하고 가입완료 페이지에 도착합니다.
4. Network 탭에서 `confirm-signup` 요청이 200으로 성공하는지 확인합니다.
5. 관리자 화면(알림톡 관리)에서 방금 가입한 리드의 상세보기를 열어
   "유입 캠페인(추정)"에 utm_source/utm_campaign 값이 채워졌는지 확인합니다
   (아임웹 API로 회원 정보가 수집되는 다음 자동발송 주기 이후에 반영됩니다).
6. (3번 스크립트를 넣었다면) 가입완료 페이지에서 카톡방 버튼을 클릭한 뒤,
   같은 리드 상세보기의 "카톡방 버튼 클릭"에 시각이 채워졌는지 확인합니다.

## 정확도에 대한 참고

이 방식은 아임웹이 회원 데이터와 유입정보를 직접 연결해주지 않기 때문에,
"가입완료 신호가 온 시각"과 "아임웹이 알려주는 가입시각(join_time)"이
30분 이내로 가까운 경우 매칭하는 방식입니다. 카카오 인증 절차 자체가
짧게 끝나므로 대부분 수 초~수십 초 이내로 매칭되지만, 100% 정확한
1:1 매칭은 아니라는 점을 감안해 주세요.
