# 재개발 구역도 관리 + 경매물건 구역 포함 여부 판별 (2026-08-04)

## 배경
사용자 요청: "현재 경매코치 프로젝트에 카카오맵 연동이 되어 있고,
매도분석 물건들이 주소 기반 좌표로 변환되어 지도에 마커로 표시되고
있어. 이 기존 카카오맵 기능을 활용해서 '재개발 구역도 관리 및 경매물건
구역 포함 여부 판별 기능'을 추가하고 싶어. 물건작업 → 매도분석 옆에
재개발물건 탭을 하나 만들어서" — 요구사항 7가지:
1. 관리자가 카카오맵 위에서 다각형으로 구역 경계를 직접 그릴 수 있어야 함
2. (Claude가 구역도를 받아 직접 그릴 수 있는지 질문 — 좌표 데이터를
   주면 정확히 입력 가능하지만, 이미지/PDF만 주면 자동 추출 불가하고
   지도와 대조한 추정만 가능하다고 안내)
3. 다각형 꼭짓점 위도·경도를 DB에 저장
4. 재개발 구역명·지역명·사업단계·메모 저장
5. 기존 경매물건 좌표가 구역 Polygon 내부에 있는지 판별
6. 구역 내부 물건은 지도에서 별도 색상/배지로 표시
7. 구역 클릭 시 포함된 물건 목록 표시
8. 기존 구역 경계 수정/삭제 가능

## 설계
- **좌표 재사용**: 새로 지오코딩하지 않고, 매도분석 지도 기능이 이미
  `auctions.latitude/longitude`에 캐싱해 둔 좌표를 그대로 재사용
  (`WHERE latitude IS NOT NULL`). 새로 지오코딩할 필요가 없어 VWorld
  API 호출/Railway 연결 이슈와 무관.
- **점-다각형 판별**: 표준 레이 캐스팅(ray casting) 알고리즘을 백엔드
  서비스에 직접 구현(외부 GIS 라이브러리 없이 순수 함수).
- **경계 수정 UX 단순화**: 꼭짓점 드래그 편집(Kakao 벡터 편집 API가
  별도 유료/복잡한 플러그인 없이는 제공되지 않음) 대신 "경계 다시
  그리기"(전체 재작성) 방식 채택 — 기존 경계는 점선 참고선으로 지도에
  같이 표시해 준다.

## 백엔드
- `RedevelopmentZone` 엔티티(신규, `redevelopment_zones` 테이블):
  `name`, `region`, `stage`(자유 텍스트), `memo`, `polygon`(simple-json,
  `{lat,lng}[]`), `color`(선택).
- `RedevelopmentService`: CRUD + `isPointInPolygon()`(레이 캐스팅) +
  `getMapData()`(전체 구역 + 좌표 있는 경매물건에 소속 구역ID 배열을
  붙여 반환) + `getAuctionsInZone()`(특정 구역 내 물건 상세 목록).
- `RedevelopmentController`: `GET/POST /redevelopment/zones`,
  `PATCH/DELETE /redevelopment/zones/:id`, `GET /redevelopment/map-data`,
  `GET /redevelopment/zones/:id/auctions`. 전부 `requireAdmin`.
- 마이그레이션: `1784271000000-CreateRedevelopmentZones`(raw SQL,
  기존 관례와 동일하게 `gen_random_uuid()` PK).

## 프론트엔드
- **공유 카카오맵 로더 분리**: 기존 `ResaleMatchMapView.tsx`에만 있던
  `loadKakaoMaps`/`window.kakao` 타입 선언을 `src/lib/kakao-maps.ts`로
  추출(모듈 스코프 `loadPromise` 캐시 공유 — 두 컴포넌트가 각자
  스크립트를 중복 삽입하지 않도록). `Polygon`/`Polyline`/
  `CustomOverlay` 타입도 새로 추가. `ResaleMatchMapView.tsx`는 이
  공유 모듈을 쓰도록 리팩터(동작 변화 없음).
- `RedevelopmentMapView.tsx`(신규): 구역 다각형 표시(클릭 가능),
  경매물건 마커(구역 포함=빨강 20px, 미포함=회색 14px), 그리기 모드
  (지도 클릭마다 꼭짓점 추가 → 실시간 폴리라인 미리보기 → "완료"/
  "마지막 점 취소" 컨트롤 오버레이).
- `RedevelopmentTab.tsx`(신규): 구역 목록(정보 수정/경계 다시 그리기/
  삭제) + 새 구역 그리기 시작 버튼 + 그리기 완료 후 이름/지역/단계/
  메모 입력 폼 + 구역 클릭 시 포함 물건 목록 패널.
- `CrawlerWorkPanel.tsx`: "매도분석" 옆에 "재개발물건" 서브탭 추가.
- `src/lib/api.ts`: `RedevelopmentZone`/`RedevelopmentMapAuction` 타입 +
  CRUD 함수 6개 추가.

## 변경 파일
`src/redevelopment/entities/redevelopment-zone.entity.ts`(신규),
`src/redevelopment/redevelopment.service.ts`(신규),
`src/redevelopment/redevelopment.controller.ts`(신규),
`src/redevelopment/redevelopment.module.ts`(신규),
`src/migrations/1784271000000-CreateRedevelopmentZones.ts`(신규),
`src/app.module.ts`, `src/typeorm.config.ts` (auction-api);
`src/lib/kakao-maps.ts`(신규), `src/app/admin/RedevelopmentMapView.tsx`
(신규), `src/app/admin/RedevelopmentTab.tsx`(신규),
`src/app/admin/ResaleMatchMapView.tsx`(공유 모듈 사용하도록 리팩터),
`src/app/admin/CrawlerWorkPanel.tsx`, `src/lib/api.ts` (auction).

## 테스트 결과
양쪽 `tsc --noEmit` + `npm run build` 클린. 실제 다각형 그리기/저장/
포함 판별 동작은 배포 후 관리자가 직접 구역을 하나 그려서 확인
필요(미확인).
