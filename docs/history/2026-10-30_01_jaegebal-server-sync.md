# 재개발닷컴 구역 업데이트 — 브라우저 방식에서 서버 직접 수집(지정한 구만) + 사라진 구역 표시 + 업데이트 이력

작성일: 2026-10-30 · 이어받는 세션은 이 문서를 먼저 읽는다. (배경: [2026-10-25_01 재개발물건 탭](./2026-10-25_01_redevelopment-edit-tab-map-ui.md) §2·2-1, 2026-10-28 절)

## 0. 한눈에 보기 (현재 상태)

| 항목 | 상태 |
|---|---|
| 서버가 재개발닷컴 구역 API를 직접 호출·복호화 | **완료·운영 배포·검증** (영등포구 시험: 가져옴 300 · 신규 0 · 변경 1 · 사라짐 0) |
| 새 구역 추가 / 기존 구역 단계·사업유형·경계 갱신 | 완료 (관리자 MANUAL 수정 구역은 보호) |
| 사이트에서 사라진 구역 표시 (삭제 안 함) | 완료 (`missingSince`, 지도에서 회색 점선·"사라짐 ·" 라벨). 시뮬레이션만 검증, **실제 사라진 구역은 아직 없음** |
| 업데이트 이력 DB 누적 + 날짜별 조회 탭 | 완료·배포 (이력은 2026-10-30 오후 배포 이후 실행분부터 쌓임) |
| 25개 구 전체 수집 | 화면에서 **"전체 선택"** 후 "지금 업데이트"로 실행 가능(3개 초과는 자동으로 느린 간격, 25개 구 약 75분). 사용자 결정으로 전체를 보수적으로 시험 중 — 결과는 §8 "전체 시험 결과"에 기록. **아직 실제 실행 전** |
| 자동 업데이트(선택한 구를 주기마다 서버가 실행) | **완료**(2026-10-30 사용자 요청). 기본 **꺼짐**·**14일**, 주기·대상 구는 화면에서 설정, 켜면 한국시간 새벽 1~6시에 실행, 결과는 텔레그램 알림. 아직 켜 보지 않음 |
| 프론트 정적 지표 JSON(`jaegebal-zone-stats.json`·`jaegebal-zone-meta.json`) 갱신 | 범위 밖. 필요하면 별도 작업 |

### 사용 방법
- **화면**: 관리자 → 재개발물건 → `구역·지도` 서브탭 → "구역도 업데이트" → 구(최대 3개) 선택 → "선택한 N개 구 업데이트". 구마다 약 1분, 끝나면 지도가 자동 새로고침. 결과(가져옴/신규/변경/사라짐 표시/복구)와 변경 내역이 패널에 나온다.
- **이력**: 재개발물건 → `구역 업데이트 이력` 서브탭 → 업데이트 날짜별 목록 → 실행을 고르면 종류별 변경 내역(단계 변경·신규·사라짐·복구·사업유형)과 "구역 이력"(그 구역의 누적 타임라인).
- **Claude에게 요청**: "○○구 재개발닷컴 구역도 업데이트해줘". 단, **Claude는 관리자 인증이 없어 API를 직접 호출하지 못한다** → 화면 버튼을 안내한다. 마지막 반영 후 14일이 지나면 텔레그램 알림(`ZoneUpdateReminderService`).
- **API(관리자 전용)**: `POST /redevelopment-research/jaegebal-sync {codes:["11560"], force?}` · `GET .../jaegebal-sync/status` · `GET .../jaegebal-sync/runs?limit=` · `GET .../jaegebal-sync/runs/:id` · `GET .../jaegebal-sync/zones/:zoneKey/history`.

## 1. 배경과 결정

- 기존: Playwright로 서울 25개 구를 순회하며 `JSON.parse`를 가로채 구역을 수집(`young/_jaegebal_saved/crawl_seoul.py`). 느리고 취약하며, 사이트의 사람 확인(Human Verification) 때문에 관리자 PC에서 사람이 직접 풀어야 했다.
- **사용자 결정(2026-10-30)**: 브라우저 없이 서버가 호출하되 **수집량은 최소화** — 필요한 구만, 가끔, 간격을 크게. 자동 대량 수집 금지.
- 범위: DB 구역(경계·단계·사업유형·이름)만. 구역이 사이트에서 사라져도 **지우지 말고 "사라진 구역" 표시만**(색 다르게).
- 이후 추가 요청: 변경 사항을 DB에 누적하고, 재개발물건 탭 하위에 "구역 업데이트 이력" 탭으로 날짜별 조회.

## 2. 운영 원칙 (반드시 지킬 것)

1. **간격**: 구가 3개 이하면 요청 사이 30초(`REQUEST_GAP_MS`), **4개 이상(전체 포함)이면 느린 순차 모드 — 요청 사이 60초·구와 구 사이 120초(구당 약 3분, 25개 구 약 75분, 분당 0.7건)**(`ALL_REQUEST_GAP_MS`, `ALL_DISTRICT_GAP_MS`). 같은 구는 6시간 안 재수집 금지(`MIN_RESYNC_HOURS`). 첫 보안 확인에서 전체 중단, 구 오류가 연속 2번이면 중단(`ALL_MAX_CONSECUTIVE_ERRORS`).
   **자동 업데이트(사용자 요청, 2026-10-30)**: 관리자가 켠 경우에만, 설정한 주기(기본 14일)마다 한국시간 **새벽 1~6시에만** 시작한다. 실패(보안 확인·오류)하면 **하루 뒤 한 번** 다시 시도하고 바로 재시도하지 않는다. 기본은 꺼짐. 켜고 끄기·주기·대상 구는 모두 사용자가 화면에서 정한다.
2. **403/405(보안 확인)이 오면 재시도 없이 즉시 중단**한다(`BlockedError`). 사람 확인을 우회하지 않는다.
3. 행동값(behavior)은 **사람 흉내를 내지 않는다**: `1.0.0.0.0.0.0.0.0.0.0.1`(활동 0 + 자동화 표시). 브라우저 값을 복사해 쓰지 않는다.
4. 개발 PC(이 PC)에서 재개발닷컴을 대량 호출하지 않는다 — 이 PC IP는 연속 요청 뒤 WAF 보안 확인(405)에 걸린 이력이 있다. 수집은 Railway 서버에서만.
5. 자동 권한 분류기가 크롤링·운영 배포 성격의 명령을 거부할 수 있다. **거부되면 우회하지 말고 사용자에게 안내**한다(이번 작업에서 여러 번 발생, 사용자가 허용하면 재시도 가능).

## 3. 사이트 프로토콜 (역분석 결과)

### 엔드포인트 (Railway에서 쿠키·로그인 토큰 없이 HTTP 200 확인)
- `GET https://jaegebal.com/api/common/regions/{구코드}` → `{code,name,full_name,type,lat,lng,rings(경계 폴리곤)}`
- `GET https://jaegebal.com/api/develops?min_lat&max_lat&min_lng&max_lng&simplify=0.0001&include_completed=true` → 구역 배열(`id,title,description,region_code,type_display_name,detail_stage,stage,areas(MultiPolygon [폴리곤][고리][[lng,lat]]),세대수·노후도 등 지표…`)
- `?region=코드` 화면은 위 두 호출을 차례로 한 것이다(브라우저는 고정 크기 뷰포트 박스, 서버는 구 경계 범위 + 0.002 여유 박스를 쓴다).
- 홈페이지 `/`를 서명 없이 요청하면 Railway에서도 CloudFront 403 — 서명 있는 API 호출과 다르다.

### 서명 헤더
| 헤더 | 값 |
|---|---|
| `x-jdc-app-token` | 사이트 JS에 하드코딩된 고정값 |
| `x-jdc-device-id` | `web;<uuid>` (아무 값이나 가능, 응답 복호화 salt로 같은 값 사용) |
| `x-jdc-timestamp` | 현재 Unix 초 |
| `x-jdc-signature` | `hex(HMAC-SHA256(SIGNING_KEY, "{ts}\|GET\|{경로(쿼리·/api 제외)}\|{behavior}")) + "." + behavior` |

behavior 형식: `1.<경과초>.<마우스이동>.<클릭>.<이동없는클릭>.<가짜클릭>.<키입력>.<비키입력>.<스크롤>.<휠>.<터치>.<자동화플래그>`(각 칸 36진수).

### 응답 복호화 (`{"_enc": base64}`)
키 = HKDF-SHA256(ikm=SIGNING_KEY utf8, salt=device-id utf8, info=`jaegebal-enc-v1`, 32바이트) → base64 디코드 후 앞 12바이트 nonce, 끝 16바이트 인증 태그, 나머지 AES-256-GCM → gzip 해제 → JSON.

### 키 출처와 교체
`SIGNING_KEY`·`APP_TOKEN`은 사이트 JS 청크(`_next/static/chunks/6245-*.js` 서명, `4792.*.js` 복호화)에 하드코딩된 공개 값이다. 사이트 배포로 바뀌어 복호화 실패/403이 나면 청크를 다시 읽어 확인하고, 서버는 **환경변수 `JDC_SIGNING_KEY`·`JDC_APP_TOKEN`·`JDC_DEVICE_ID`로 재배포 없이 교체**할 수 있다(코드의 기본값은 현재 값).

## 4. 서버 구현 (auction-api)

| 파일 | 역할 |
|---|---|
| `src/redevelopment-research/jaegebal-zone-sync.service.ts` | 서명·복호화·수집·반영·사라짐 표시·이력 저장. 변환 함수 `toZoneRecords` 공개 |
| `src/redevelopment-research/redevelopment-research.controller.ts` | 위 API 5개 (관리자 전용 `requireAdmin`) |
| `src/redevelopment-research/entities/redevelopment-zone-sync-run.entity.ts` · `redevelopment-zone-change.entity.ts` | 이력 엔티티 (**`typeorm.config.ts` 전역 목록 + 모듈 forFeature 양쪽 등록**) |
| `src/redevelopment/entities/redevelopment-zone.entity.ts` | `missingSince` 컬럼 추가 |
| `src/migrations/1784312000000-AddZoneMissingSince.ts` · `1784313000000-CreateZoneSyncHistory.ts` | 마이그레이션(`migrationsRun=true`로 배포 시 자동 적용) |
| `src/redevelopment-research/zone-update-reminder.service.ts` | 2주 알림 문구를 "구를 지정해 요청" 방식으로 수정 |

### 변환 규칙 (기존 import와 동일 — `jaegebal-seoul-zones.json` 2006건과 이름·지역·사업유형·단계·경계 **0건 차이**로 검증)
- 이름=`title`(앞뒤 공백 제거), 지역=`region_code`→구 이름 표(설명 문구에 구 이름이 없는 구역이 있어 `description`은 쓰지 않음), 사업유형=`type_display_name`, 단계=`detail_stage`.
- 경계=각 하위 폴리곤의 **바깥 고리**, 좌표 6자리 반올림, 닫힘 점 제거, 3점 미만이면 건너뜀.
- **하위 폴리곤이 여럿이면 폴리곤마다 별도 구역**: 첫 번째 `sourceKey=jaegebal-<id>`, 이후 `jaegebal-<id>-2`, `-3`…, 이름 뒤에 ` (2)`, ` (3)`.
- 구역 식별: `sourceDatasetId="jaegebal"`, `sourceKey`. 기존 행 조회는 `source` 값에 의존하지 않는다(기존 import의 `source` 값을 확인하지 못했기 때문). 신규는 `source=PUBLIC_API`, `boundaryType=EXACT`.

### 반영 규칙
- 없으면 생성, 있으면 단계·사업유형·이름·지역·경계를 갱신. 앞뒤 공백 차이와 좌표 2e-6도(약 20cm) 이내 차이는 변경으로 보지 않는다(불필요한 갱신·이력 방지).
- `boundaryType==="MANUAL"`이고 관리자가 자동 갱신 이후 수정한 구역은 건너뜀(`skippedManual`, 기존 bulk-upsert와 같은 보호 규칙).
- **사라진 구역**: 같은 구(`region`)의 재개발닷컴 구역 중 이번 응답에 없는 것에 `missingSince`를 찍는다(삭제 안 함). 다시 나타나면 null로 복구(이력에 "복구"). **안전장치**: 그 구의 기존 구역이 10개 이상인데 응답에서 절반 미만만 보이면 부분 응답으로 보고 표시하지 않고 경고만 남긴다.
- **느린 순차 모드**(구 4개 이상 또는 `all:true`): 구마다 `saveProgress`가 실행 행에 결과를 저장해 중간에 끊겨도 어디까지 했는지 남는다. 최근 6시간 안에 성공한 구는 **메모리뿐 아니라 DB 실행 기록으로 판단**해 건너뛰므로(서버 재시작 후에도) 재실행하면 끝낸 구는 건너뛰고 이어서 한다. 서버가 시작될 때 `running`으로 남은 실행 행은 `interrupted`(서버 재시작으로 중단)로 정리한다(`onModuleInit`). 느린 순차 중에는 서버 배포·재시작을 피한다.
- 박스에 인접 구 구역이 함께 들어오므로 인접 구 구역도 같이 갱신된다(정상, id 기준 병합).

### DB
- `redevelopment_zones.missingSince timestamptz null`
- `redevelopment_zone_sync_runs`: 실행 1회(시작·종료, `state` running|done|blocked|failed, 요청 구 코드, 구별 결과 JSON, 중단 사유, 유형별 건수). **변경이 없던 실행도 한 줄 남는다.**
- `redevelopment_zone_changes`: 변경 한 건(runId, 시각, `zoneKey`, 이름, 구, 종류 new|stage|projectType|missing|restored, 이전 값, 새 값). **삭제하지 않는다.** 인덱스: runId, changedAt, zoneKey.
- 이력 저장이 실패해도 수집은 멈추지 않는다(로그만). 종료 시 `finalizeRun` 후 `running=false`가 되므로 화면이 곧바로 이력을 조회해도 최신이다.
- 진행 상태(`status`)와 구별 재수집 제한(`lastSyncAt`)은 **서버 메모리**라 재시작하면 초기화된다. 영구 기록은 위 두 테이블.

## 5. 프론트 (auction)

| 파일 | 역할 |
|---|---|
| `src/app/admin/RedevelopmentSection.tsx` | 재개발물건 탭의 하위 탭(구역·지도 / 구역 업데이트 이력). `AdminPageClient.tsx`가 이걸 렌더 |
| `src/app/admin/RedevelopmentJaegebalSync.tsx` | "구역도 업데이트" 패널: 구 선택(최대 3), 실행, 5초 폴링, 결과·변경 내역, 끝나면 `load`로 지도 새로고침 |
| `src/app/admin/RedevelopmentUpdateHistory.tsx` | 한국시간 날짜별 실행 목록 + 실행별 종류별 변경 내역 + 필터 + 구역별 이력 타임라인 |
| `src/lib/zone-stage-style.ts` | 사라진 구역 회색 점선(`MISSING_ZONE_COLOR`), 새 구역·갱신 구역 색 계산, 하위 폴리곤 키 meta 조회 수정 |
| `src/lib/api.ts` | `missingSince`, 수집·이력 API 함수/타입 |
| `RedevelopmentEditMapView.tsx`·`RedevelopmentEditSelectedZone.tsx`·`RedevelopmentEditTab.tsx` | "사라짐 ·" 라벨·범례, 상세 안내문, 패널 연결 |

- 색·점선 판정: 저장된 `jaegebal-zone-meta.json`이 기본. **meta에 없는 새 구역과 meta 작성(`META_SNAPSHOT_UNTIL=2026-10-29`) 이후 서버가 갱신한 구역은 현재 단계(키워드표)·사업유형(`projectType`)에서 계산**한다. (meta의 단계 그룹과 키워드 계산이 2045건 일치·44건 불일치·64건 판정 불가라 기존 구역 표시를 바꾸지 않으려는 것.) 하위 폴리곤 키 `jaegebal-<id>-N`이 끝 숫자 `N`으로 meta를 잘못 찾던 문제도 수정.
- 하위 탭을 전환하면 구역·지도 화면은 다시 불러온다(언마운트 방식).

## 6. 검증 기록

- 사이트: Railway(외부 IP 152.55.177.168, 리전 sfo) 컨테이너에서 서명 헤더만으로 `/api/develops`·`/api/common/regions/{코드}` HTTP 200(쿠키·토큰 없이), 행동값 `1.0.0.0.0.0.0.0.0.0.0.1`로도 통과. 홈페이지 `/`는 403. 이 PC에서는 토큰 만료·연속 요청 뒤 `x-amzn-waf-action: captcha`(405).
- 저장 raw(`young/_jaegebal_saved/seoul_all_raw.json`, 2153건)와 Railway 수집(영등포구 300건): id 300/300·폴리곤 점수 300/300 일치.
- 변환 규칙: 기존 import 2006건과 0건 차이. raw에서 변환하면 2270레코드(기존 2006 + 264 = 이후 생긴 구역, 서울 전체 기준).
- 반영 로직(sql.js 인메모리 DB, 마포구 시나리오): 단계 변경 1건 갱신 / 응답에서 뺀 2건에 `missingSince`(삭제 없음) / 다시 나타나면 복구 / 응답 5건뿐이면 표시 생략. 이력 시뮬레이션: 3회 연속 실행 → 실행 3건(변경 없는 실행 포함), 변경 6건 누적, 구역별 이력 시간 역순.
- 운영 배포: auction-api Railway Online, 로그에 `migrationsRun=true`·Nest 정상 기동·라우트 5개 등록, 인증 없이 호출 시 401. 프론트는 새 패널이 화면에 나타남을 사용자가 확인.
- 전체 순차 모드 시뮬레이션(`fetch` 가짜 응답, 대기는 즉시 통과): 25개 구 완주(요청 50건, 대기 간격은 60초·120초뿐) / 재시작 흉내 후 재실행 시 25개 구 모두 DB 기록으로 건너뜀(요청 0건) / 3번째 구에서 405 → 전체 중단(요청 6건, 상태 blocked, 진행 3건 저장) / 구 오류 2번 연속 → 중단 / `running` 행은 시작 시 interrupted 처리 / 일반 모드에서 4개 구는 거부.
- 운영 시험: 영등포구 1개 구 — 가져옴 300 · 신규 0 · 변경 1(상도동 246-18 A-1 추진준비 → 사업시행자지정, 인접 동작구 구역) · 사라짐 0 · 복구 0. (이 실행은 이력 테이블 생성 전이라 이력에 없다.)

## 7. 함정 / 주의 (실제로 겪은 것)

- Railway 컨테이너에는 **Node 20·Python 3.11이 있으나 pip가 없다**(`ModuleNotFoundError`). Python httpx는 설치 불가 → 서버 구현은 Node `crypto`/`zlib`/`fetch`로 의존성 없이 작성했다.
- 컨테이너 일회성 실행: `railway ssh -- "sh -c '...'"`. Windows PowerShell 파이프(`| Out-File`)를 거치면 **한글이 깨져** JSON이 망가진다 → 한글 데이터는 파이프하지 말고 서버 안에서 처리하거나 ASCII로 전달.
- Git Bash에서 `sed`로 백슬래시 경로를 치환하면 `\a`가 제어문자로 바뀐다. 경로 수정은 Edit 도구로. `curl`에 `/경로`를 주면 Git Bash가 경로로 변환하므로 `MSYS_NO_PATHCONV=1`을 붙인다.
- 프론트 배포(Vercel)는 git push로 자동 배포되지만 `vercel ls`에 반영이 늦게 보일 수 있다(화면 새로고침으로 확인).
- 프론트 push는 이전에 로컬에만 있던 커밋도 함께 올린다(이번에 106개 객체).

## 8. 남은 일 / 제안

1. **전체 시험**: 화면에서 "전체 선택" → "지금 업데이트"(약 75분)를 실행하고, 결과(보안 확인에 걸렸는지, 어느 구에서 오류가 났는지, 신규·변경·사라짐 건수)를 §8 "전체 시험 결과"에 기록한 뒤 자동 업데이트에 전체를 넣을지 결정한다. 보안 확인에 걸리면 몇 시간 뒤 재실행(끝낸 구는 건너뜀).
2. 실제로 사이트에서 빠진 구역이 생기면 회색 점선 표시와 이력 탭의 "사라짐"을 실물로 확인(아직 시뮬레이션만).
3. 프론트 지표 JSON(세대수·노후도·전세가율 등)은 이번에 갱신하지 않았다 — 새 구역은 지표가 비어 있을 수 있다. 필요하면 지표도 DB로 옮기는 별도 작업.
4. 정기 운영 전에 재개발닷컴 측에 데이터 제공/API 사용 가능 여부를 문의하는 것을 권장.
5. 보안 확인에 걸리면 몇 시간 뒤 재시도(서버가 자동 재시도하지 않음).

## 9. 관련 커밋

- auction-api: `9255e53`(서버 직접 수집 + 사라진 구역 표시) · `c2192cb`(문서) · `e316106`(이력 테이블·API)
- auction(프론트): `5d8266d`(업데이트 패널·사라진 구역 표시) · `4fed8bc`(구역 업데이트 이력 탭)
- 개발 PC에 남은 실험 도구(운영에는 쓰지 않음): `E:\OneDrive\auctiondev\jaegebal_client.py`(Python httpx 최소 수집 클라이언트), `jaegebal_fetch.js`(Node 단독 스크립트), `JAEGEBAL_HTTPX_HANDOFF.md`(초기 인수인계 — 이 문서가 최신)

## 10. 전체 선택 + 자동 업데이트 (2026-10-30 추가 요청)

**요청**: 구 선택에 "전체 선택"을 만들고, 선택한 구를 **자동으로 업데이트하는 버튼**(주기를 사용자가 입력, 최초 2주)을 만든다. "선택한 구 업데이트"는 자동과 **별개로** 지금 바로 실행한다. 자동 버튼은 **알림톡 탭의 "자동 반복 발송" 스위치와 같은 디자인(켜지면 초록색)**.

**화면** (`RedevelopmentJaegebalSync.tsx`, 재개발물건 → 구역·지도 → 구역도 업데이트)
- 구 선택 버튼 + **전체 선택/전체 해제**. 선택 개수 제한 없음(3개 초과면 서버가 느린 간격 사용, 확인창에 예상 소요 시간 표시).
- **선택한 N개 구 지금 업데이트**: 즉시 실행(자동 설정과 무관).
- **자동 업데이트 스위치**(알림톡 `KakaoNotifyPanel`의 `schedulerEnabled` 블록과 동일: 켜지면 `border-emerald-300 bg-emerald-50`·깜빡이는 초록 점·`bg-emerald-500` 스위치, 꺼지면 회색). 켤 때 대상 구가 없으면 지금 선택한 구를 대상으로 저장. 설명 줄에 대상 구·주기·다음 예정·마지막 자동 실행 표시.
- **업데이트 주기(일)** 입력(1~365, 기본 14) + "적용", **자동 업데이트 대상** 표시 + "선택한 구를 대상으로 저장".
- 이력 탭의 자동 실행에는 "자동" 배지, 진행 중 문구에 "[자동]".

**서버**
- 테이블 `redevelopment_zone_auto_sync`(단일 행 id=`jaegebal`: `enabled`, `intervalDays`, `codes`, `lastRunAt`, `nextRunAt`), `redevelopment_zone_sync_runs.triggeredBy`(manual|auto) — 마이그레이션 `1784314000000-CreateZoneAutoSync`. 엔티티는 `typeorm.config.ts` 전역 목록 + 모듈 forFeature 등록.
- API(관리자): `GET jaegebal-sync/auto`, `PUT jaegebal-sync/auto { enabled?, intervalDays?(1~365), codes? }`. 켜면 `nextRunAt = (마지막 자동 실행 ?? 지금) + 주기`, 끄면 null, 주기를 바꾸면 재계산. 켤 때 대상 구가 없으면 거부.
- 스케줄러(`JaegebalZoneSyncService.tickAuto`): 10분마다 확인 → 켜져 있고 `nextRunAt`이 지났고 **한국시간 1~6시**이고 다른 실행이 없으면 `start(codes, false, false, "auto")`. 실행이 끝나면(`finishAutoRun`) `lastRunAt` 기록, 성공 시 `nextRunAt = 시작 + 주기`, **실패(보안 확인·오류) 시 +24시간(한 번만 재시도)**, 텔레그램(`REDEVELOPMENT_TELEGRAM_CHAT_ID`)으로 결과 알림. 시작 자체가 실패해도 24시간 뒤로 미룬다. 서버 재시작 후에도 DB 설정으로 이어진다.
- 2주 알림(`ZoneUpdateReminderService`): 기준 시각에 **성공한 업데이트 실행(수동·자동)의 시각**을 포함하도록 수정(구역 `updatedAt`은 바뀐 구역에서만 갱신되어, 변경 없는 성공 실행에도 알림이 울리던 문제 방지).

**검증(가짜 응답 시뮬레이션)**: 기본값 꺼짐·14일·대상 없음 / 대상 없이 켜기·주기 0·잘못된 구 코드 거부 / 켜면 다음 실행 14일 뒤 / **예정 전에는 실행 안 함, 도래해도 한국시간 0·6·12·23시에는 안 함, 1~5시에 실행(`triggeredBy=auto`)** / 실행 후 `lastRunAt`·다음 예정 14일 뒤·텔레그램 알림 / 6시간 안 재실행은 요청 없이 건너뜀 / 보안 확인으로 중단되면 다음 예정 +1일·"중단" 알림 / 주기 변경 시 다음 실행 재계산, 끄면 null / 구 3개는 30초, 4개는 60·120초 간격.

**주의**: 자동 업데이트를 켜 두면 서버가 사람 없이 사이트를 호출한다. 기본은 꺼짐이며, 보안 확인이 한 번이라도 오면 중단하고 하루 뒤에만 다시 시도한다. 자동 실행 결과·실패 여부는 텔레그램과 이력 탭("자동" 배지)에서 확인한다.
