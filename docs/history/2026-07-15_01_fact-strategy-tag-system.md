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
