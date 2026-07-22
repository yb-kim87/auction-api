# Fact/Strategy Tag 자동 태그 시스템 구축

날짜: 2026-07-15
관련 레포: auction, auction-api

## 배경

크롤링으로 자동 등록되는 경매 물건(및 기존 등록 물건)에 대해, 향후 AI 추천 기능의 기반이
될 규칙(Rule) 기반 자동 태그 시스템을 먼저 구축한다. AI는 나중에 Fact Tag를 입력으로 받아
Strategy Tag(투자 전략)를 생성하는 구조로 확장할 예정이므로, 지금은 Fact Tag 생성 파이프라인과
Strategy Tag를 담을 빈 구조만 만든다.

## 요청 원문 (요약)

```
크롤링된 물건 정보를 분석하여 규칙(Rule) 기반으로 태그를 자동 생성하는 구조를 만들어 주세요.

예시: 아파트+전용면적>85㎡ → [85㎡ 초과][부가세 검토 필요] / 유찰≥2회 → [2회 이상 유찰] /
재개발 구역 → [재개발] / 구축빌라 → [구축빌라] / 공장 → [공장] / 최저가율70%이하 → [저가 낙찰 가능]

태그 구조: Fact Tag(객관적 사실, 지금 구현) / Strategy Tag(AI가 Fact Tag로 생성할 투자전략,
구조만 만들고 구현은 나중). Fact Tag → AI → Strategy Tag 흐름이 되도록 확장 가능하게.

Rule Engine: 하나의 Rule 파일/매니저에서 관리, 새 태그 추가 시 코드 여러 곳 안 고치고
Rule만 추가하면 되도록.

관리자 기능: "태그 관리" 메뉴 추가, 태그명/조건/활성비활성 관리, 향후 개발자 없이 추가 가능하게.

DB: 물건에 fact_tags / strategy_tags 컬럼 분리 저장. strategy_tags는 현재 비워둠.

물건 상세페이지: 현재는 Fact Tag만 노출.

확장성: 향후 AI가 Fact Tag + 등기분석 + 권리분석 + 시세분석 + 입찰경쟁률을 종합해
추천 이유/투자전략을 자동 생성할 예정이므로 이를 고려한 구조.
```

## 설계 결정 (사전 조사 및 사용자 확인)

사전 조사로 기존 `src/ai-platform/`(Normalizer→Feature Engine→Tag Engine 파이프라인,
`item_ai_tags` 테이블)가 이미 존재함을 확인. 이 파이프라인은 하드코딩 if문 4개로 태그
("소액투자"/"실거주검토가능"/"가격메리트검토"/"대형평형검토")를 생성하는 매우 단순한
구조이고, DB 기반 규칙 정의·Fact/Strategy 2단 분류·관리자 CRUD가 전혀 없어 이번 요구사항과
근본적으로 다름.

1. **기존 ai-platform과의 관계**: 완전히 별도의 새 시스템으로 구축(통합하지 않음). 기존
   `item_ai_tags`/`가격메리트검토`는 recommendation의 동률 tie-breaker로 계속 그대로 사용.
2. **유찰횟수 규칙**: 이번 범위에서 제외(후속 작업). `Auction` 엔티티에 유찰횟수 전용
   컬럼이 없고 `bidInfo`(문자열) 파싱이 필요해 별도 작업으로 분리.
3. **재개발/구축빌라 판정**: `specialNote`/`address` 키워드 포함(contains) 연산자로 처리.
   구축빌라는 `propType`(빌라/다세대) + `builtYear` 기준연도 이상 조합으로 처리.
4. **Rule 조건식 형태**: 구조화된 필드/연산자/값 조합(`field`, `operator`, `value`).
   관리자가 드롭다운/입력란으로 작성. JSON 자유 조건식은 채택하지 않음(비개발자도 다룰 수
   있어야 하므로).

## 구현 계획

### 백엔드 (auction-api)
- `src/auctions/auction.entity.ts`: `factTags`, `strategyTags` 컬럼 추가(text, JSON 배열 문자열)
- `src/tags/` 신규 모듈
  - `tag-rule.entity.ts`: 규칙 테이블(`id, tagName, category(fact/strategy), field, operator,
    value, active, sortOrder`)
  - `rule-field-registry.ts`: 화이트리스트 필드 정의(area_sqm, min_price_ratio, usage,
    prop_type, special_note, address, built_year 등) — 관리자 UI 드롭다운과 평가 로직이
    공유하는 단일 소스
  - `rule-engine.service.ts`: Auction 1건 + 활성 규칙 목록 → Fact Tag 문자열 배열 평가
  - `tags.service.ts`: 규칙 CRUD, 물건 재계산(백필) API
  - `tags.controller.ts`: 관리자 전용 규칙 CRUD 엔드포인트, 백필 트리거 엔드포인트
- `src/auctions/auctions.service.ts`: 물건 생성/수정(크롤링 등록 포함) 시 RuleEngine으로
  factTags 자동 재계산해 저장

### 프론트 (auction)
- `src/app/admin/TagRulesTab.tsx` 신규: 태그 규칙 목록/추가/수정/활성화 토글 UI
  (`LoanPolicyTab.tsx` 패턴 참고)
- `src/components/AuctionDetailModal.tsx`: Fact Tag 배지 노출(Strategy Tag 자리는 비워둠,
  빈 배열이면 자연히 안 보임)

## 구현 완료 내역

### 백엔드 (auction-api)
- `src/auctions/auction.entity.ts`: `factTags`/`strategyTags`(JSON 배열 문자열 컬럼) 추가.
  `@AfterLoad`에서 파싱한 `factTagsList`/`strategyTagsList`(DB 컬럼 아님, 응답 직렬화용)도 함께 노출
- `src/migrations/1752940000000-AddFactStrategyTags.ts`: 위 컬럼 + `tag_rules` 테이블 생성
- `src/tags/` 신모듈
  - `tag-rule.entity.ts`: `id, tagName, category(fact/strategy), field, operator, value, active, sortOrder`
  - `rule-field-registry.ts`: 화이트리스트 필드(`area_sqm, min_price_ratio, built_year, usage,
    prop_type, city, district, address, special_note`) + 연산자(`gt/gte/lt/lte/eq/neq/contains`)
    정의 — 새 필드가 필요하면 이 배열에만 추가
  - `rule-engine.service.ts`: 활성 fact 규칙을 Auction 1건에 순차 평가해 태그명 배열 생성
  - `tags.service.ts`: 규칙 CRUD, 전체 물건 일괄 재계산(`backfillFactTags`), 최초 배포 시
    기본 규칙 5개 자동 시딩(`onModuleInit`, 이미 규칙이 있으면 건너뜀)
  - `tags.controller.ts`: `GET/POST /tag-rules`, `PATCH/DELETE /tag-rules/:id`,
    `GET /tag-rules/fields`, `POST /tag-rules/backfill`(모두 관리자 인증)
- `src/auctions/auctions.service.ts`: 물건 생성/수정의 공통 경로인 `upsertOne`에서 저장 직후
  `syncFactTags()`를 호출해 factTags를 자동 재계산·저장(크롤러/엑셀업로드/수동등록/수정
  모두 이 경로를 거치므로 별도 훅 불필요)
- 순환 의존성 없이 `AuctionsModule`이 `TagsModule`을 import해서 `TagsService`를 주입받는 구조

### 프론트 (auction)
- `src/lib/api.ts`: `fetchTagRules/fetchTagRuleFields/createTagRule/updateTagRule/
  removeTagRule/backfillTagRules` 추가
- `src/app/admin/TagRulesTab.tsx` 신규: 태그명 입력 + 필드/연산자 드롭다운 + 값 입력으로
  규칙 추가, 목록에서 활성 토글/삭제, "기존 물건 태그 일괄 재계산" 버튼(`LoanPolicyTab.tsx`
  패턴 참고)
- 관리자 콘솔 탭에 "태그 관리" 추가(대출정책 탭 옆). 기존 "AI Platform > Tag 관리"(다른
  시스템, 하드코딩 태그 4종)와 이름 혼동 방지를 위해 별도 탭명 사용
- `AuctionDetailModal.tsx`의 "기본 물건 정보" 카드 상단에 Fact Tag 배지 노출. Strategy Tag는
  `strategyTagsList`가 항상 빈 배열이라 지금은 아무것도 안 보이며, AI가 채우기 시작하면
  같은 자리(또는 별도 섹션)에 자연히 노출 가능한 구조

## 기본 시드 규칙 (최초 배포 시 자동 생성)

| 태그명 | 필드 | 연산자 | 값 |
|---|---|---|---|
| 85㎡ 초과 | 전용면적(㎡) | 초과 | 85 |
| 부가세 검토 필요 | 전용면적(㎡) | 초과 | 85 |
| 재개발 | 특이사항 | 포함 | 재개발 |
| 구축 | 사용승인년도 | 미만 | 2006 |
| 공장 | 물건 용도 | 같음 | 공장 |
| 저가 낙찰 가능 | 최저가/감정가 비율(%) | 이하 | 70 |

"구축"은 원래 요청("구축빌라")이 propType=빌라 AND 건축연도 조건의 AND 조합이 필요했으나,
현재 규칙 구조가 단일 조건만 지원해 건축연도 기준으로만 단순화했다(사용자 확인 완료).
AND/OR 복합 조건과 유찰횟수 기반 규칙은 후속 작업으로 분리.

## 후속 작업 후보 (이번 범위 밖)
- 유찰횟수 필드 확보(Auction에 전용 컬럼 추가 또는 `bidInfo` 파싱) 후 유찰 관련 규칙 추가
- 규칙 조건의 AND/OR 복합 조합 지원(현재는 단일 조건만)
- Strategy Tag를 실제로 채우는 AI 파이프라인(Fact Tag + 등기분석 + 권리분석 + 시세분석 +
  입찰경쟁률 종합)

## 추가: 3계층 구조로 재설계 — Fact는 비노출, Strategy만 사용자 노출 (2026-07-15 追記)

### 배경
최초 구현은 Fact Tag(예: "85㎡ 초과")를 상세페이지에 배지로 직접 노출했다. 사용자가
"85㎡ 초과"는 사용자에게 보여주기 위한 태그가 아니라 내부 Rule 판단용 Fact 데이터이고,
사용자에게는 그 Fact를 근거로 한 투자 전략/추천 이유("경쟁이 적은 물건" 등)만 노출되어야
한다고 정정. 구조를 다음처럼 3계층으로 재설계:

```
전용면적 > 85㎡  (원본 데이터)
  ↓
Fact 코드: AREA_OVER_85  (내부 판단용, 비노출)
  ↓
Rule(Strategy 규칙): AREA_OVER_85 + USAGE_APARTMENT → COMPETITION_LOW_POSSIBLE
  ↓
사용자 노출 문구: "경쟁이 적은 투자" + 설명  (StrategyLabel)
```

### 사용자가 설명해준 도메인 지식(예시 Strategy 문구에 반영)
"85㎡ 초과 아파트는 매도할 때 부가세 부담이 있어서 입찰경쟁이 낮고, 부가세 계산이
어려워서 실제로 안전마진을 많이 확보(=저렴하게 낙찰받을 가능성이 높음)해 단기 투자에도
좋고 중장기 투자에도 좋은 물건"이라는 설명을 그대로 `COMPETITION_LOW_POSSIBLE`의
description에 반영했다.

### 변경 내용 (auction-api)
- `TagRule`에 `tagCode` 추가(StrategyRule이 참조하는 안정적 코드, 예: `AREA_OVER_85`).
  `tagName`은 관리자 화면 표시용 한글 라벨로만 남김
- `StrategyRule` 엔티티 신규: `requiredFactCodes`(JSON 배열, AND 조건) 모두 만족 시
  `strategyCode` 부여
- `StrategyLabel` 엔티티 신규: `strategyCode` → `label`/`description`/`icon`(사용자 노출
  문구). 코드와 문구를 분리해 향후 AI가 strategyCode만 채우면 되고 문구는 관리자가
  자유롭게 다듬을 수 있게 함
- `RuleEngineService`: `computeFactCodes`(Fact 판정) + `computeStrategyCodes`(Fact 조합
  → Strategy) 로 분리
- `Auction.strategyTags`를 코드 배열이 아니라 `{code,label,description,icon}[]` 객체
  배열로 저장(프론트가 그대로 렌더링 가능한 형태)
- 기본 시드: `85㎡ 초과 + 아파트` → `COMPETITION_LOW_POSSIBLE` → "경쟁이 적은 투자"
- 마이그레이션 `1752950000000-AddStrategyTagTables`: `tag_rules.tagCode` 컬럼 추가,
  `strategy_rules`/`strategy_labels` 테이블 신설

### 배포 중 발생한 문제와 교훈
1. **엔티티 등록 누락으로 서버 크래시**: `TagRule`을 `TypeOrmModule.forFeature()`에는
   등록했지만 전역 `typeorm.config.ts`/`data-source.ts`의 `entities` 배열에 추가하는 걸
   빠뜨려 `EntityMetadataNotFoundError`로 배포 직후 크래시(`railway logs`로 확인, 재배포로
   복구). **엔티티를 새로 만들 때는 반드시 3곳(엔티티 파일, 모듈의 forFeature, 전역
   typeorm.config.ts + data-source.ts)을 모두 등록해야 한다** — 이번에 `StrategyRule`/
   `StrategyLabel` 추가 시에는 이 체크리스트를 지켜 재발하지 않았다.
2. **크래시 이전에 이미 생성된 Fact 규칙과 코드 불일치**: 첫 배포(크래시 버전)에서 Fact
   규칙 6개가 이미 DB에 저장됐고, 이후 마이그레이션이 그 기존 행들에 `tagCode`를 임의
   슬러그(예: `85_초과_ea36d2b1`)로 채웠다. 반면 `onModuleInit`은 `count > 0`이면 시딩을
   건너뛰므로, 의도했던 `AREA_OVER_85` 같은 표준 코드로 재시딩되지 않았다. 결과적으로
   Strategy 규칙(`requiredFactCodes: ["AREA_OVER_85","USAGE_APARTMENT"]`)이 실제 Fact
   코드와 전혀 매칭되지 않아 어떤 물건에도 Strategy 배지가 뜨지 않는 문제가 발생. 관리자
   화면에서 "85㎡ 초과" Fact 규칙을 삭제 후 재생성(신규 생성 시엔 코드가 정확히
   `AREA_OVER_85`로 슬러그화됨)하고 "아파트" Fact 규칙을 추가, Strategy 규칙의 필요
   Fact 태그를 다시 체크해 저장하는 방식으로 관리자가 직접 복구.
   → **배포 순서가 꼬여 시드 데이터가 일부만 만들어진 경우, `onModuleInit`의 "이미 있으면
   건너뛴다" 로직만으로는 복구되지 않는다는 점**을 기억해둘 것. 필요시 코드값을 검증하는
   별도 정합성 체크나 관리자 화면에서 "코드 재동기화" 기능을 추가하는 것도 고려할 만하다.

### 변경 내용 (auction)
- `AuctionDetailModal.tsx`: Fact 배지 제거, `strategyTagsList`를 카드 형태(💎 아이콘 +
  라벨 + 설명, 보라색 톤)로 표시
- `StrategyTagsTab.tsx` 신규: 1단계(Fact 태그 체크박스 조합 → Strategy 규칙 생성),
  2단계(Strategy 코드 → 노출 라벨/설명 입력) 2단 관리 UI. 관리자 콘솔에 "Strategy 태그"
  탭으로 추가
- `TagRulesTab.tsx`: Fact 태그가 비노출 내부 코드라는 안내 문구로 수정, 목록에 `tagCode`
  함께 표시(Strategy 규칙 작성 시 참조용)

### 추가: 홈 화면 리스트에도 Strategy 배지 노출
상세페이지에만 있던 Strategy 배지를 추천물건 목록(그리드 카드/리스트뷰)에도 추가.
- 그리드 카드: 주소/면적 정보와 최소투자금 박스 사이
- 리스트뷰: 주소 하단(면적·입찰일 아래) 작은 배지
- 둘 다 `title` 속성으로 hover 시 설명 문구 노출, 상세페이지와 동일한 보라색 톤 사용

### 결과
- 관리자가 화면에서 직접 값을 확인·복구할 수 있음(브라우저 쿠키의 JWT로 API를 조회해
  Fact/Strategy 규칙의 실제 코드값을 대조하는 방식으로 원인 진단)
- "85㎡ 초과 + 아파트" 물건이 목록/상세 양쪽에서 "경쟁이 적은 투자" 배지로 정상 노출됨

## 추가: 같은 라벨을 쓰는 서로 다른 전략의 뱃지 중복 표시 수정 (2026-07-22 追記)

사용자가 물건 카드에 "경쟁이 적은 투자" 뱃지가 완전히 똑같이 2개 찍히는 걸 발견.
`대형평수_아파트`와 `구축빌라`(서로 다른 strategyCode)가 한 물건에 동시에 매칭됐는데,
관리자가 둘 다 같은 라벨("경쟁이 적은 투자")을 선택해둔 상태였음 — 데이터/규칙 설정
자체가 원인이라 렌더링 단계에서 라벨 기준 dedupe 처리.

- `src/types/auction.ts`: `dedupeStrategyTagsByLabel()` 신규(같은 label이면 첫 번째
  항목만 유지).
- `src/app/page.tsx`(홈 그리드/리스트뷰 2곳), `src/components/AuctionDetailModal.tsx`
  (상세 모달)에 적용.

## 추가: 전략 규칙이 실제로 매칭되는지 확인할 방법이 없던 문제 (2026-07-22 追記)

### 발단
사용자가 관리자 화면(전략 관리 탭)을 보며 "수도권_공시가_1억이하", "지방_공시가_2억이하_아파트"
전략이 실제로 물건에 붙는지 확인해달라고 요청. 화면 스크린샷만으로는 매칭 여부를 알 수
없어 운영 DB(Railway Postgres, `DATABASE_PUBLIC_URL`로 로컬에서 직접 접근 — `railway run`은
내부 호스트(`postgres.railway.internal`)라 로컬에서 접속 불가, Public 프록시
(`reseau.proxy.rlwy.net:27149`)를 써야 함)를 임시 Node 스크립트로 직접 조회해 실측 검증.

### 발견 1: 오피스텔 전략이 완전히 죽어있었음
`tag_rules`의 `오피스텔` fact 규칙이 `usage eq "오피스텔"`(정확일치)인데, 실제 저장된
`usage` 값은 항상 `"오피스텔(주거)"`(808건)/`"오피스텔(상업)"`(17건)이라 단 한 건도
매칭되지 않았음. 사용자가 관리자 화면에서 직접 연산자를 `contains_any`로 수정
(값: `오피스텔,오피스텔(상업),오피스텔(주거)`).

### 발견 2: 규칙을 고쳐도 매칭 결과가 갱신 안 됨
`auctions.factTags/strategyTags`는 물건이 저장/수정될 때만 재계산되고, 관리자가 규칙
자체를 바꿔도 자동으로 다시 계산되지 않는 구조였음 — 그래서 "규칙은 맞는데 화면엔
반영이 안 되는" 혼란이 반복됨(지방_공시가_2억이하_아파트가 실측 이론값 1996건인데 저장된
값 기준 11건으로 나오는 등 크게 어긋남).

### 해결
1. **자동 재계산**: `TagsService.createRule/updateRule/removeRule`,
   `createStrategyRule/updateStrategyRule/removeStrategyRule` 전부 저장 직후
   `backfillTags()`를 자동 호출하도록 변경(`src/tags/tags.service.ts`) — 이후로는 규칙
   변경 시점에 항상 전체 물건이 재계산됨. 다만 이 자동화가 배포되기 **이전**에 사용자가
   이미 오피스텔 규칙을 고친 상태였어서, 그 변경분은 자동 재계산 대상이 아니었음 — 관리자
   화면의 기존 "기존 물건 태그 일괄 재계산" 버튼(`POST /tag-rules/backfill`)을 사용자가
   직접 눌러 반영.
2. **매칭 건수 표시**: `GET /tag-rules/match-counts` 신규 — 매 요청마다 규칙 엔진을
   재실행하지 않고 `auctions.factTags`에 저장된 코드 배열만 집계(물건 수가 늘어나도
   빠름). **`strategyTags` 컬럼은 집계에 쓰지 않음** — `buildStrategyItemsForCodes`가
   같은 라벨을 쓰는 여러 strategyCode를 병합하며 `code` 필드 하나만 남기므로, 저장된
   `strategyTags`만 보면 실제 매칭된 strategyCode 중 일부가 누락돼 있음. 대신
   `strategyRule.requiredFactCodes`를 `factTags` 집합에 직접 대조해서 정확히 셈.
   프론트(`StrategyTagsTab.tsx`) 전략 테이블에 "매칭 건수" 컬럼 추가, 0건이면 빨간색
   강조.
3. **버그**: 배포 직후 `/tag-rules/match-counts`가 항상 500 에러. 원인은
   `Auction.@AfterLoad`(`normalizeDisplayFields`)가 select 여부와 무관하게 `address`
   등 여러 필드에 접근하는데, `getRuleMatchCounts()`가 `find({ select: ["factTags"] })`로
   일부 컬럼만 로드해 `address`가 `undefined`가 되어 `cleanAddress()` 내부에서
   `Cannot read properties of undefined (reading 'replace')` 예외 발생. 부분 select를
   제거하고 전체 컬럼 로드로 수정(운영 로그로 원인 확인, 2026-07-22).
4. 헤더 "매칭 건수"(4자)가 좁은 컬럼 폭에서 2줄로 줄바꿈되던 문제 — 컬럼 폭 비율 재조정
   + `whitespace-nowrap` 추가.

### 교훈
- 엔티티에 `@AfterLoad`/`@BeforeInsert` 등 라이프사이클 훅이 있으면, TypeORM의 부분
  `select` 옵션을 쓸 때 그 훅이 접근하는 모든 필드가 함께 select됐는지 반드시 확인해야
  한다 — 아니면 프로덕션에서만 조용히 500 에러가 난다(로컬 sql.js에서는 재현 안 될 수도
  있음, 검증 필요).
- 저장된 파생 컬럼(`strategyTags`처럼 여러 원본을 병합해서 만든 값)은 "그 컬럼이 정확히
  무엇을 표현하는지" 재확인 없이 통계 집계에 재사용하면 안 된다 — 병합 과정에서 정보가
  소실될 수 있다.
