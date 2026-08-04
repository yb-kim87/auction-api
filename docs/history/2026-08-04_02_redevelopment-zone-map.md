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

## 追記 (2026-08-04) — 배포 확인

`auction-api`: `railway status`로 Online 확인, `curl .../users` → 401
(정상 헬스체크). `auction`: `git push` 후 `vercel --prod --yes`
CLI가 배포 완료 후 후속 프롬프트에서 5분 타임아웃으로 멎었으나,
`vercel ls`/`vercel inspect auction-seven-tan.vercel.app`로 확인한 결과
실제 배포(`auction-881rreo9z...`)는 Ready 상태였고 프로덕션 alias도
이미 그 배포를 가리키고 있어 정상 반영 확인(curl 307).

## 追記 (2026-08-04) — 구역도 이미지 좌표 보정 트레이싱 도구

사용자 질문(한남뉴타운 재정비촉진구역 위치도 이미지 첨부): "이런식으로
준다고 하면 그릴 수 있을까? 그리진 말고 어떻게하면 정확도를 높여서
그릴 수 있는지 방법을 기획해줘". 3가지 방법을 제시:
1순위 공식 좌표 데이터(클린업시스템/VWorld/LURIS) 확보 — WebSearch로
찾아봤으나 이번 사례는 바로 못 찾음(정비구역 경계 데이터는 검색만으로
접근하기 어려운 폐쇄형 GIS 시스템에 있는 경우가 많음). 2순위 랜드마크
기준점 좌표 변환. 3순위 이미지 오버레이 후 실제 지도에서 수작업
트레이싱. 사용자가 "진행하자"로 승인 → 3순위(재사용 가능한 인프라)를
구현.

### 구현
- `src/lib/affine-transform.ts`(신규): 이미지 픽셀 좌표 3쌍과 실제
  위경도 3쌍으로 어파인 변환식(`lat=a·x+b·y+c`, `lng=d·x+e·y+f`)을
  정확히 푸는 3×3 선형연립방정식 solver(외부 라이브러리 없이 직접
  구현 — 여인수/역행렬).
- `RedevelopmentImageTraceTool.tsx`(신규): 구역도 이미지를 업로드하면
  좌우 2단 레이아웃(왼쪽=이미지, 오른쪽=실제 카카오맵)으로 표시.
  1단계(좌표 보정): 이미지에서 알아볼 수 있는 랜드마크 클릭 → 지도에서
  같은 곳 클릭, 3번 반복해 변환식 확보. 2단계(경계 그리기): 이미지
  위에서 구역 경계 꼭짓점을 순서대로 클릭하면 변환식으로 즉시 실제
  좌표로 환산되고, 오른쪽 지도에 실시간 폴리곤 미리보기가 그려져
  정확도를 눈으로 검증할 수 있다. "이 경계로 확정" → 기존 "새 구역
  그리기"와 동일한 이름/지역/단계/메모 입력 폼으로 이어짐.
- `RedevelopmentTab.tsx`: "+ 이미지로 구역 그리기" 버튼 추가, 완료 시
  기존 `pendingPoints` 저장 흐름 재사용(코드 중복 없음).

### 정확도에 대한 안내
3점 어파인 변환은 랜드마크 3곳이 이미지 안에서 서로 멀리 떨어져 있고
일직선에 가깝지 않을수록 정확해진다(삼각형이 찌그러지면 오차 증가) —
도구 안내 문구에도 명시. 공식 좌표 데이터가 있으면 이 도구 없이 바로
DB에 입력하는 게 여전히 가장 정확하다.

### 변경 파일
`src/lib/affine-transform.ts`(신규),
`src/app/admin/RedevelopmentImageTraceTool.tsx`(신규),
`src/app/admin/RedevelopmentTab.tsx` (auction).

### 테스트 결과
`tsc --noEmit` + `npm run build` 클린. 배포 후 `vercel --skip-domain`
플래그로 배포하니 기본 alias(auction-seven-tan.vercel.app)가 자동
연결 안 돼(다른 alias로 감) `vercel alias set`으로 수동 연결 후
curl 307 확인. 실제 보정 정확도는 관리자가 실제 이미지로 테스트해봐야
확인 가능(미확인).
