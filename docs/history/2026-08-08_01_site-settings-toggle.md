# 사이트 전역 설정 토글 — 등기·임차인 정보 노출 제어

## 배경

2026-08-07에 물건 상세 "등기·임차인 정보" 섹션을 수강생 이하 등급에게
숨기는 기능을 하드코딩(role Set)으로 넣었는데, 사용자가 다음날
"해당 부분을 토글 버튼으로 조정할 수 있게 관리자 페이지에도
만들어줘"라고 요청해 설정으로 옮겼다.

## 구현

- `app_settings` 싱글톤 테이블(id="singleton" 고정 행) — `nice_crawler_state`
  등 기존 싱글톤 행 패턴 재사용. 첫 컬럼은
  `hideRegistryTenantForStudents boolean default true`(기존 하드코딩
  동작과 동일한 기본값).
- `GET /settings`(로그인 회원 누구나 — 물건 상세를 보는 모든 화면이
  이 값을 읽어야 함) / `PATCH /settings`(관리자 전용).
- 프론트: `AuctionDetailModal.tsx`가 마운트 시 설정을 조회해
  `hideRegistryTenantForStudents`가 true일 때만 기존 role 기반 숨김
  로직(`REGISTRY_TENANT_VISIBLE_ROLES`)을 적용한다. 설정 조회 실패 시
  안전한 기본값(숨김)을 유지.
- 관리자 페이지 "회원 권한 관리" 탭에 `SiteSettingsPanel.tsx` 토글
  카드 추가. 설정이 늘어나면 이 컴포넌트에 항목만 추가하면 된다.
