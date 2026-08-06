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

---

## 追記 (2026-08-06) — 구역 수정(트레이싱) 도구 버그 수정 및 위치 조정 개선

프론트(`auction`) 단독 변경. API/스키마 변경 없음.

### 1. 다른 구역을 눌러도 이전 구역 화면이 남던 버그
`RedevelopmentImageTraceTool`이 이미지 URL·추출 결과·기준점을 내부 state로
보유해, 도구가 열린 상태에서 다른 구역의 "구역 수정"을 누르면 props만 바뀌고
화면은 그대로였다(위 지도는 새 구역으로 이동, 아래 도구는 이전 구역).
`RedevelopmentTab`에서 `key={editingZone.id}`를 줘 구역이 바뀌면 리마운트.

### 2. 현재 저장된 경계 표시
`existingPolygon` prop을 추가해 오른쪽 지도에 회색 점선으로 함께 그린다.
새로 잡은 경계(보라)와 겹쳐 보여 어긋난 정도를 바로 판단할 수 있다.
`zoneName` prop으로 패널 제목에 편집 중인 구역명도 표시.

### 3. 위치 보정: 클릭 이동 → 드래그 + 방향키
클릭 이동은 한 번에 크게 튀어 미세 조정이 불가능했다.
- 폴리곤 `mousedown`으로 드래그 시작(잡은 지점↔중심 오프셋 유지),
  지도 `mousemove`로 추적(폴리곤은 이동마다 재생성되므로 지도 이벤트를 씀),
  `window` mouseup으로 종료. 드래그 중 `map.setDraggable(false)`.
- 드래그 직후 카카오가 흘리는 click으로 다시 튀지 않게 250ms 가드.
- 방향키 1m / Shift+방향키 10m 미세 조정(input/textarea 포커스 시 무시).
- 기준점을 찍어 맞춘 경우엔 그 짝이 위치를 결정하므로 이동 비활성(`canReposition`).

### 4. "이 경계로 확정"이 저장되지 않던 문제
확정은 `pendingPoints`에 임시 보관만 하고, 실제 저장은 화면 위쪽 폼의 저장
버튼을 눌러야 했다. 도구를 화면 하단으로 옮긴 뒤로는 확정만 누르고 끝내기
쉬워 "반영이 안 된다"는 리포트로 이어졌다. 기존 구역 수정 중이면
`handleFinishImageTrace`에서 곧바로 `updateRedevelopmentZone`(polygon,
boundaryType=MANUAL)을 호출하고 목록을 새로고침한다. 새 구역 생성 흐름은
구역명 입력이 필요하므로 기존대로 폼으로 넘긴다.

---

## 追記 (2026-08-06, 2차) — 구역 수정 도구 조작성 개선과 경계 추출 알고리즘 개편

앞의 追記(1차) 이후 이어진 작업. 프론트(`auction`) 중심이며, 마지막 항목만
API 변경(신규 테이블)이 있다.

### 5. 구역 드래그가 동작하지 않던 문제 — 카카오 이벤트 → DOM 이벤트
드래그 시작을 카카오 폴리곤의 `mousedown`으로 잡았는데, 그 시점엔 지도가
이미 같은 mousedown으로 패닝을 시작한 뒤라 `setDraggable(false)`가 진행 중인
제스처엔 먹지 않았다. 결과적으로 드래그가 지도 패닝에 먹혀 아무 동작도
하지 않았다(1차 追記 시점에는 검증 없이 "동작한다"고 보고했고, 사용자가
"드래그는 아직도 안돼"로 지적).

카카오 마우스 이벤트를 전부 걷어내고 표준 DOM 이벤트로 재구현:
- 지도 컨테이너의 **캡처 단계 `mousedown`**으로 먼저 가로채고, 커서가 구역
  안쪽이면 `stopPropagation()` → 카카오가 이벤트를 못 받아 패닝이 시작되지 않음
- 이동/종료는 `window`의 `mousemove`/`mouseup`(지도 밖으로 나가도 안 끊김)
- 커서 픽셀 → 위경도 변환에만 `map.getProjection()` 사용
- 안쪽 판정은 ray casting, 오목 다각형 포함 단위 테스트 7/7 통과

방향키(1m, Shift 10m) 미세 조정도 함께 추가했다.

**검증 한계**: `vercel env pull`이 카카오 앱키를 `[SENSITIVE]`로 마스킹해
로컬에서 SDK를 띄울 수 없어 실브라우저 확인은 못 했다. 대신 검증 불가능한
동작(라이브러리 내부 이벤트 처리)에 의존하지 않는 구조로 바꾸는 쪽을 택했다.
사용자가 이후 "드래그는 이제 잘되고"로 확인해 줬다.

### 6. 꼭짓점 개별 편집
구역 전체 이동만으로는 이미지와 실제 필지의 모양 차이를 못 맞춘다는 요청.
지도에 꼭짓점 손잡이를 띄우고 개별 드래그를 지원한다.

핵심 설계: 손보정을 **절대좌표가 아니라 "변환식 결과 대비 차이(offset)"로**
저장한다. 절대좌표로 두면 구역 전체를 옮길 때 손본 점만 제자리에 남아 모양이
찌그러진다. 차이로 두면 전체 이동·기준점 재설정에도 손본 모양이 따라온다.
- mousedown에서 꼭짓점 히트테스트(화면 11px)를 전체 이동보다 먼저 본다
- 손본 꼭짓점은 주황색, "꼭짓점 원래대로" 버튼으로 되돌린다
- 오버레이는 생성과 위치갱신을 분리해 드래그 중 DOM 교체를 피한다

### 7. 다시 열면 저장된 경계 대신 이미지 추출 결과가 나오던 문제
도구를 열 때마다 이미지 로드 시점에 자동 추출이 무조건 다시 돌아, 손본
결과가 덮였다. `boundaryType`이 MANUAL/IMAGE_AUTO인(이미 손본) 구역은 저장된
경계를 그대로 불러와 이어서 고치는 모드(`savedBase`)를 추가했다. 자동 추출은
건너뛰고, 그 경계 위에서 전체 드래그·방향키·꼭짓점 편집이 모두 동작한다.
"① 경계 자동 추출"을 다시 누르면 이미지 기준으로 되돌아간다.
원 근사(CONVEX_HULL_APPROX 등)는 고칠 만한 모양이 아니므로 기존대로
이미지 추출에서 시작한다.

또한 "이 경계로 확정"이 기존 구역 수정 시 곧바로 저장되게 했다(이전에는
임시 보관만 하고 화면 위쪽 폼의 저장 버튼을 따로 눌러야 반영).

### 8. 경계 자동 추출 알고리즘 개편 — 17장 중 9장 성공 → 17장 전부 성공
사용자가 "이렇게 나오는 구역도는 경계자동 추출이 안된다"고 보고(서부연립
신사동 241-2). **은평구청 원본 이미지 17장을 전부 내려받아 전수 검사**했더니
9장만 성공하고 8장이 실패했다. 원인이 하나가 아니라 셋이었다.

| 원인 | 해당 도면 | 내용 |
|---|---|---|
| 구역이 빨갛게 **칠해진** 도면 | 갈현1(cts1111), 신사170-12(cts1153) | 내부까지 빨간 픽셀이라 "선에 둘러싸인 빈 공간"이 존재하지 않음 |
| 구역 안에 **빨간 라벨**이 있는 도면 | 응암동 755(cts6427) | 글자가 내부를 조각내 largestComponent가 일부만 집음 |
| 구역이 **아주 작은** 도면 | 서부연립(cts1154, 1,362㎡) | 정확히 찾아놓고도 최소 면적 3% 기준에 걸려 버려짐(실제 0.23%) |

수정:
1. **내부를 찾는 대신 여집합을 쓴다.** 테두리에서 닿는 바깥을 flood fill로
   구하고 그 여집합을 구역으로 본다(`fillFromOutside`). 여집합에는 벽·내부·
   내부에 얹힌 글자가 모두 포함되므로 위 1·2번이 한 번에 해결된다. 팽창분은
   `erode`로 되돌린다.
2. **최소 면적 하한 3% → 0.15%.** 글자 속 구멍은 0.05% 미만이라 구분된다.
3. **컴포넌트를 하나만 보지 않는다.** 큰 것부터 4개까지 후보로 만든다
   (`topComponents`) — 도면 테두리 액자가 통째로 잡히면 진짜 구역을 놓친다.
4. **후보 선택 규칙 변경.** "작은 반경 우선"은 점선이 닫히기 전의 오검출을
   집고(응암1 cts1124), "넓이 우선"은 팽창분만큼 늘 부풀린다(불광8 cts1120이
   2.5%→4.5%로 과대). 그래서 **최대 넓이로 대상 크기를 먼저 정하고, 그 60%
   이상인 후보 중 가장 작은 반경**을 쓴다.

**검증**: 17/17 추출 성공. "찾았다"만으로는 맞다고 볼 수 없어, 추출 폴리곤을
원본 이미지에 겹쳐 렌더링해 17장 전부 육안 확인했다 — 작은 사각형(241-2),
위성사진 위 반투명 빨간 구역(신사동 200·237), 점선 경계(응암1), 빨간 라벨이
들어앉은 구역(응암동 755) 모두 실제 구역선과 일치.

부수 효과: 녹번1구역이 예전에는 10.9%(세 지구 중 하나만)를 잡았는데 이제
28.2%(1-1·1-2·1-3 전체)를 잡는다. 고시 구역 기준으로는 이쪽이 맞다.

### 9. 추출 실패 로그 (API 변경 있음)
사용자 요청: "앞으로 추출 실패하는 부분이 발생하면 저장되는 로그를 만들고
이유를 보고하고 수정이 가능하면 수정해달라". 8번 개선도 실패 유형을 나눈
뒤에야 고칠 수 있었으므로, 그 과정을 상시화한다.

- `traceRedBoundaryDetailed()`가 실패 시 원인 코드와 진단 수치를 반환한다.
  원인은 **NO_RED / NOT_ENCLOSED / TOO_SMALL / TOO_LARGE** 네 가지 —
  8번에서 실제로 관측된 유형을 그대로 코드화한 것이고, 유형만 알면 대응이
  정해진다(색 임계값 / 팽창 반경 / 넓이 기준).
- 신규 테이블 `redevelopment_trace_failures`
  (마이그레이션 `1784281000000-CreateRedevelopmentTraceFailures`).
  `imageUrl` 유니크 — 같은 이미지의 반복 실패는 행을 쌓지 않고 `occurrences`만
  올린다(관리자가 같은 구역을 여러 번 여는 게 자연스러운 흐름이라, 그때마다
  새 행이 생기면 목록이 금방 쓸모없어진다).
- 엔티티는 `typeorm.config.ts` 전역 배열과 모듈 `forFeature` 양쪽에 등록했다
  (2026-07-25 CrawlerLogRow 크래시 사례 재발 방지).
- 엔드포인트: `GET/POST /redevelopment/trace-failures`,
  `PATCH .../:id/resolve`, `DELETE .../:id` (모두 관리자 전용).
- 관리자 화면에 실패 목록 패널(`RedevelopmentTraceFailurePanel`)을 붙였다.
  원인 라벨·대응 안내·반경별 후보 넓이(진단 JSON)·이미지 링크를 함께 보여줘,
  이미지를 다시 받지 않고도 원인을 좁힐 수 있게 했다.
