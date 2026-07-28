# 낙찰물건 매도 추정(재판매 매칭) 기능 설계

날짜: 2026-07-26
상태: **설계안 — 구현 전, 코드 작성 없음**
적용 범위: **아파트·오피스텔만** (빌라는 현재 네이버 호가/실거래 수집 대상이
아니므로 이번 기능에서 제외 — `crawler/full_httpx_worker.py` 등의
`_is_apartment_usage()` 필터와 동일한 범위)

## 0. 목표와 설계 원칙

**목표**: 낙찰된 물건이 이후 실제로 얼마에 매도됐는지를, 국토부/네이버
실거래 데이터와 대조해 자동으로 추정해 사용자에게 보여준다.

**최우선 원칙 — 정확도 > 매칭률**:
> "확률이 애매한 것은 차라리 표시하지 않는다."

이 원칙은 설계 전체를 관통한다. 구체적으로:
- 후보가 여러 개인데 1등과 2등 점수 차이가 작으면(모호함) → 표시 안 함
- 하드 필터(단지·면적·기간)를 통과 못 하면 애초에 후보에도 안 넣음
- 임계 점수 미달이면 → 표시 안 함(굳이 "낮음" 배지도 안 보여줌, 아예 비노출)
- 자동 매칭은 항상 **추정**이라는 사실을 UI 문구에 명시("매도 추정", "~로 추정됩니다")

**설계 원칙**:
1. 규칙 기반(rule-based) 가중합 스코어링으로 시작 — 투명하고 감사(audit)
   가능해야 하며, 나중에 라벨(관리자 확인/사용자 피드백)이 쌓이면 학습
   기반으로 교체 가능한 구조로 둔다.
2. 매칭은 **1회성 계산이 아니라 지속 관찰**이다 — 낙찰 후 몇 년까지 계속
   후보 실거래를 찾아야 하므로 배치(주기 실행) 구조가 기본이다.
3. 모든 후보 평가 과정을 **저장**한다(1등만 저장하지 않음) — 나중에
   왜 이렇게 매칭됐는지 감사·튜닝·재계산이 가능해야 한다.

---

## 1. 기준일(날짜) 정의와 활용 원칙

사용자가 제시한 6개 날짜를 아래처럼 정리한다.

| 날짜 | 의미 | 현재 보유 여부 | 역할 |
|---|---|---|---|
| **낙찰일** | 매각기일(입찰 진행일), 낙찰 확정된 그 날 | ✅ `auctions.bidDate`(caseState가 매각 계열일 때) | 매물 등록 감시 시작점 |
| **매각허가결정일** | 낙찰 후 이의신청 기간 지나 법원이 매각을 허가 확정한 날(통상 낙찰일+7일) | ❌ 미보유 — 신규 컬럼 필요 | 소유권 이전 절차 진행 확정 시점(참고용) |
| **매각대금완납일** | 매수인이 잔금을 완납해 **실제 소유권을 취득**하는 날 | ❌ 미보유 — 신규 컬럼 필요, **이번 설계의 기준일(anchor date)** | 실거래 매칭의 **주 기준일** |
| **네이버 매물 최초 등록일** | 매수인(또는 대리한 공인중개사)이 되팔기 위해 네이버부동산에 매물을 올린 날 | ❌ 미보유 — 스냅샷 이력 테이블 필요(2단계) | 완납 전 선매물 등록 감지, 물건-매물 연결고리 |
| **실거래 계약일** | 매매계약을 체결한 날(국토부 신고 기준 "계약일") | 🟡 부분 보유 — 현재는 특정 물건(auction) 크롤링 시점에 텍스트 블록(`tradingDetail`)으로만 스냅샷, 이력 누적 안 됨 | 매칭의 핵심 시간축 |
| **실거래 신고일** | 계약 후 정부에 신고한 날(계약일+30일 이내 의무) | ❌ 별도 필드로 명시 보유 안 함 — 필요 시 "우리 시스템이 그 거래를 최초 관측한 시각"으로 근사 | 데이터 신선도 참고용(매칭 로직에 직접 관여 안 함) |

### 1.1 날짜 활용 파이프라인

```
낙찰일(bidDate) ─────────────────────────────────────────────► 시간축
     │
     ├─▶ [감시 시작] 이 시점부터 "동일 단지·동·층·면적" 네이버 매물 등록 여부를
     │    확인 가능(잔금 전 선매물 등록 케이스 포착용, 2단계 기능)
     │
매각대금완납일(paymentCompletedAt) ◄── 신규 컬럼, 소유권 취득의 실질 기준일
     │
     ├─▶ [주 필터] 원칙적으로 이 날짜 **이후 계약분(계약일 ≥ 완납일)**만
     │    "정상 신뢰도" 매칭 후보로 채택
     │
     └─▶ [예외 허용, 감점] 완납일 **이전** 계약(잔금 전 매매계약 체결 케이스)도
          후보에 포함은 하되:
            - 기본 신뢰도 점수에 큰 페널티(-25~35점) 적용
            - 반드시 보강 증거(네이버 매물 이력 등)가 있어야 최종 노출 임계를
              넘을 수 있도록 설계 → 증거 없으면 사실상 노출 안 됨
```

**"완납일을 모르는 경우"(신규 컬럼이 아직 안 채워진 과거/현재 물건)의 폴백**:
`매각허가결정일 + 통상 완납 소요기간(정책상 약 30~45일, 설정값으로 관리)`을
추정 완납일로 대체 사용한다. 그마저 없으면 `낙찰일 + 45일`을 최후 폴백으로
쓰되, 이 경우 **폴백을 썼다는 사실 자체를 신뢰도 점수에 소폭 반영**(-5점
정도)해 "정확한 완납일 기준 매칭보다는 근사치"임을 구분한다.

---

## 2. 후보 실거래 선정 (하드 필터 — Candidate Generation)

스코어링 이전에, 아예 후보군에도 못 들어가는 **필수 조건**(하나라도 어긋나면
후보 제외, 예외 없음)을 먼저 정의한다.

| 필터 | 조건 | 근거 |
|---|---|---|
| 물건 유형 | 아파트/오피스텔만 (`usage`가 아파트·오피스텔·업무시설 계열) | 빌라는 시세 데이터 없음(범위 밖) |
| 동일 단지 | **`LAWD_CD`(법정동코드 5자리) + `umdNm`(읍면동) + `jibun`(지번, 본번-부번)** 일치 | **(2026-07-28 수정)** 단지명(`aptNm`) 텍스트 매칭은 동명이인 위험이 있다(같은 구 안에 "래미안"·"푸르지오" 등 같은 브랜드명 단지가 여러 곳 존재 가능 — 실제로 이번 조사 중 담당자가 콘솔 인코딩 문제로 서로 다른 두 단지명을 혼동한 사례 있음). 지번은 국토부 API(`jibun`)와 탱크옥션 `baseInfo`(`m_adrs_no`+`s_adrs_no` 조합)에 **동일한 형식으로 이미 존재**해 정확히 조인 가능 — 단지명은 매칭 조건에서 제외하고 표시·감사용으로만 별도 저장 |
| 전용면적 | `abs(거래 전용면적 - 물건 전용면적) ≤ 0.5㎡` (또는 상대오차 0.5% 중 큰 쪽) | 등기부/네이버 표기 오차 허용 범위. 이 이상 벌어지면 아예 다른 타입 |
| 계약일 하한 | `계약일 ≥ 낙찰일` (절대 하한, 예외 없음) | 낙찰 전 계약은 물리적으로 이 물건과 무관 |
| 계약일 상한(기간 제한) | `계약일 ≤ 낙찰일 + N개월` (기본 N=36개월, 설정 가능) | 너무 오래 지난 거래는 그사이 다른 목적(임대 후 매도, 재매입 등)일 가능성 ↑. 3년을 넘기면 사실상 이 기능의 의미(경매 회전 투자 분석)가 옅어짐 |
| **계약 해제 제외** | `cdealType`(국토부 API 필드)가 비어 있을 것 | **실측 확인**: 표본 100건 중 4건이 실제 해제(취소)된 계약이었고 `cdealType="O"`+`cdealDay`(해제일)까지 정확히 공개됨. 해제된 계약은 매매 자체가 무효화된 것이므로 반드시 하드 제외 |
| 물건 상태 | 물건의 `caseState`가 **매각 완료(종결)** 상태일 것 | 취하·기각·변경된 사건은 애초에 낙찰 자체가 무효/미확정이므로 대상에서 제외 |
| 중복 소진 배제 | 이미 다른 auction에 CONFIRMED(확정) 매칭된 `actual_trade` row는 후보 풀에서 제외 | 하나의 실거래는 하나의 물건에만 귀속(1:1 원칙, 아래 6장) |

이 단계를 통과한 거래들이 "후보"가 된다. **동(building)은 하드 필터에
넣지 않는다** — 국토부 API도 동 필드가 부분적으로만 채워지므로(3.2절
실측 수치), 필수 조건으로 쓰면 상당수 정상 거래가 후보에서 배제된다.
대신 4.2절 가점/반증 로직으로 처리한다.

---

## 3. 스코어링에 넣을 요소와 "동" 매칭 신뢰도

### 3.1 실거래 데이터 소스 확정 — 국토교통부 공식 API

**(2026-07-28 갱신)** 실측 조사([data-findings 문서](./auction-resale-matching-data-findings.md)
8~9장) 결과, 이번 기능의 `actual_trade` 주 소스를 **국토교통부 공식
실거래가 API(`RTMSDataSvcAptTrade`, data.go.kr)로 확정**한다. 아래
사유로 네이버 스크래핑보다 우선한다:

- 기존에 부가세계산기용으로 등록해둔 `BUILDING_REGISTER_API_KEY`
  (data.go.kr 계정)를 **같은 키 그대로 재사용** 가능(별도 API 키
  발급 불필요, "아파트매매 실거래가 자료" 상품만 추가 활용신청, 대부분
  즉시 자동승인).
- 동일 물건(2025타경811)의 실거래 14건을 탱크옥션 프록시와 1:1
  대조한 결과 계약일·층·면적·금액이 **전부 일치**했고, **동(棟)
  정보는 공식 API 쪽이 같거나 더 많았다**(1건은 탱크 쪽이 빈 값인데
  공식 API는 정확한 동 값을 제공).
- 네이버에 없는 **계약 해제 여부(`cdealType`)**, **등기접수일
  (`rgstDate`)**, **매수/매도자 개인·법인 구분(`buyerGbn`/`slerGbn`)**
  까지 추가로 제공 — 아래 2장 하드필터·4장 스코어링에 바로 반영한다.
- 네이버 실거래 스크래핑은 **동 정보가 원천적으로 없음**(계약일·층·
  면적·가격만) — 보조 소스로 격하하고, 매물 이력(`exposureStartDate`
  등, 5장) 확보용으로만 계속 활용한다.

### 3.2 동(棟) 정보 커버리지 — 정량 수치(실측)

우리 경매 물건(auction) 쪽은 주소 파싱으로 **동·층·호**를 전부 안다.
국토부 공식 API는 동 필드(`aptDong`)를 제공하지만 **모든 거래에
채워지는 건 아니다**:

| 표본 | 동 채움 비율 |
|---|---|
| 단일 단지, 2024년 이전 거래(309건) | 0% |
| 단일 단지, 2024년 이후 거래(26건) | 50% |
| 시군구 전체(인천 계양구) 최근 1개월, 100건 | 75% |

**결론**: 2024년 이후 계약 건은 절반 이상 확률로 동을 확보할 수
있지만, 여전히 100%가 아니고 오래된 거래는 사실상 없다. 따라서 동은
**있으면 강한 가점(4.2절 확증 신호)으로 쓰되, 하드 필터·필수 조건으로는
쓰지 않는다** — 이 원칙 자체는 유지한다. 다만 실측으로 "가점의 신뢰도"가
꽤 높다는 게 확인됐으므로(정부 공식 신고 데이터라 오기 가능성 낮음),
4.2절의 "동 일치 가점" 계수를 기존 설계보다 더 크게 반영해도 안전하다.

### 3.3 A/B 타입 구분은 이미 부분적으로 가능

네이버부동산은 같은 전용면적이라도 구조가 다르면 "123A"/"123B"처럼
평형 라벨을 구분해둔다. 우리 크롤러(`naver_httpx.py`
`_resolve_pyeong_numbers` → `matched_area_label`)는 **경매 물건 자신의
전용면적에 맞는 라벨을 이미 찾아내고 있다.** 실거래 후보 쪽도 동일한
방식으로 라벨을 함께 저장하면(3단계 데이터 확장, 5장 참고),
"전용면적 숫자만 같고 실제로는 다른 구조(A vs B타입)"인 오탐을 원천
차단할 수 있다. **현재는 면적 수치만 비교하지만, 라벨까지 저장하도록
확장하면 이 오탐 유형은 거의 사라진다** — 우선순위 높은 데이터 확장
항목(7장).

### 3.4 "동일 층·동일 면적 세대 수"에 의한 사전확률 보정

핵심 통계적 아이디어: **후보가 특정될수록(단지 내 유일할수록) 신뢰도가
올라가고, 흔할수록 내려간다.**

```
UniquenessScore = 1 / max(1, 해당 단지에서 같은 면적·같은 층수를 가진 세대 수)
```

예: 어느 단지가 10개 동, 각 동 15층 모두 같은 면적 타입이 1세대씩 있다면
"12층·84㎡"라는 조건만으로는 10개 세대 중 하나 — 사전확률 1/10로
출발해야 한다. 반대로 1개 동짜리 나홀로 단지면 사전확률은 1(=거의 확정).

이 세대 수는 K-apt/건축물대장 정보(우리가 이미 부가세계산기용으로
확보 중인 `vatGroundFloors`, 향후 K-apt 연동 시 `kaptDongCnt` 등)로
근사 계산하거나, 단순하게는 **해당 단지·해당 면적 타입의 최근 N개월
네이버 매물/실거래 층 분포**로 경험적으로 추정해도 충분하다(별도
공식 API 연동 없이도 시작 가능).

---

## 4. 매칭 스코어링 알고리즘 (0~100점)

### 4.1 서브스코어 구성 (하드 필터 통과 후보에 한해 계산)

| 서브스코어 | 가중치 | 계산 방식 |
|---|---|---|
| **면적 정합도** `AreaScore` | 25% | 면적 라벨(A/B타입)이 있고 일치 → 1.0 / 라벨 없이 수치만 근접 → `1 - (면적차 / 0.5㎡)`, 0~1로 클램프 |
| **층 정합도** `FloorScore` | 20% | 층 정보 있고 정확히 일치 → 1.0 / 인접층(±1) → 0.5 / 불일치 또는 층 정보 없음 → 0 |
| **시간 정합도** `TimeScore` | 15% | 완납일 기준 경과월 `t`에 대해 감쇠함수 `exp(-t / τ)` (τ=12개월 기본) — 완납 직후~수개월 이내 거래일수록 점수 ↑, 오래될수록 완만히 감소 |
| **가격 합리성** `PriceScore` | 15% | `(거래가 - 낙찰가) / 낙찰가` 수익률이 해당 단지·시기의 통상 시세 변동폭(±지역 평균 변동률) 안에 들면 1.0, 벗어날수록 감점(지나치게 낮거나 비정상적으로 높은 차익은 다른 세대일 가능성 신호로 보고 감점) |
| **고유성(사전확률)** `UniquenessScore` | 15% | 3.3절 공식, 0~1 |
| **선행 매물 이력 연결** `ListingLinkScore` | 10%(있을 때만, 없으면 이 항목 제외하고 나머지 가중치 재정규화) | 5장 확장 데이터 — 동일 동·층·면적 네이버 매물이 완납 전후로 등록→삭제되고 삭제 시점이 계약일과 가깝다면 강한 가점 |

```
BaseScore = Σ(가중치 × 서브스코어)  → 0~1 범위
```

### 4.2 페널티/보정 (BaseScore에 곱연산으로 적용, 감사 로그에 각각 기록)

| 보정 항목 | 조건 | 효과 |
|---|---|---|
| **완납 전 계약 페널티** | `계약일 < 매각대금완납일` | ×0.6 (강한 페널티) — 4.4절 참고, ListingLinkScore로 뒷받침되면 상쇄 가능 |
| **완납일 추정치(폴백) 페널티** | 실제 완납일이 아니라 추정치로 계산했을 때 | ×0.95 |
| **동(棟) 일치 가점** | 실거래에 동 정보가 있고(MOLIT API 등) 실제 일치 | ×1.15 (최대 1.0로 clamp 전에 적용, 사실상 강한 확증 신호) |
| **동 불일치(정보 있는데 다름)** | 동 정보가 있는데 다른 동 | ×0 — 즉시 탈락(이건 하드 필터급 반증 증거) |
| **모호성(동률 후보) 페널티** | 상위 1·2등 점수 차이 < 8점 | 최종 결과를 "모호" 처리 → **비노출**(4.5절) |

### 4.3 최종 점수

```
FinalScore(0~100) = round(BaseScore × 모든 보정계수 × 100)
```

### 4.4 "완납 전 계약" 케이스를 위한 특별 규칙 (사용자 핵심 요구사항)

사용자가 강조한 시나리오 — *"잔금 완납 전 매물 등록 → 완납 후 매물
삭제 → 비슷한 시기·금액 실거래"* — 를 명시적으로 처리한다.

1. 계약일이 완납일보다 이른 후보는 기본적으로 ×0.6 페널티(4.2)를 받아
   BaseScore가 크게 깎인다.
2. 다만 아래 **보강 증거**가 있으면 페널티를 완화(×0.6 → ×0.85까지 상향):
   - 동일 동·층·면적 네이버 매물이 **낙찰일 이후, 완납일 이전**에
     등록된 기록이 있다(`ListingLinkScore` 확보).
   - 그 매물이 **완납일 근처(±2주)에서 삭제**됐다(거래완료 추정 신호).
   - 매물 호가와 실거래가의 차이가 통상 범위(예: -3%~+2%) 안이다.
3. 보강 증거가 **없으면** 완납 전 계약 후보는 페널티가 그대로 유지돼
   대부분 임계점(4.5) 미달로 자동 비노출된다 — "증거 없는 완납 전 후보는
   기본적으로 숨긴다"는 원칙이 자연스럽게 지켜진다.

이 로직은 2단계(네이버 매물 이력 저장, 5장)가 있어야 완전히 동작한다.
1단계(이력 저장 전)에서는 보강 증거를 만들 수 없으므로, 완납 전 계약
후보는 사실상 전부 임계 미달로 숨겨지는 게 정상 동작이다 — **보수적으로
시작하는 것 자체가 오탐 방지 원칙에 부합**한다.

### 4.5 신뢰도 등급 및 노출 정책

| 점수 구간 | 등급 | 사용자 노출 |
|---|---|---|
| 85~100 | **매우 높음** | "매도 완료로 추정됩니다" + 금액/날짜 노출 |
| 70~84 | **높음** | "매도된 것으로 추정됩니다"(단, 톤을 한 단계 낮춤) |
| 55~69 | 중간 | **기본 비노출**(관리자 화면에서만 "검토 대상"으로 노출, QA 큐) |
| 0~54 | 낮음 | 완전 비노출, DB에는 감사용으로만 보존 |
| 상위 1·2위 점수차 < 8점 | **모호** | 등급과 무관하게 강제 비노출("확실한 후보 없음"으로 처리) |

**중요**: 55~84 구간 중 "70 미만"은 일반 사용자에게 절대 보여주지
않는다. 다만 55~69는 관리자가 QA 화면에서 확인해 수동으로
CONFIRMED 처리할 수 있게 남겨둔다(이 확인 기록이 향후 알고리즘 튜닝의
라벨 데이터가 된다 — 10장 참고).

---

## 5. 현재 데이터로 가능한 부분 vs. 데이터 추가 시 개선 효과

### 5.1 지금 바로 시작 가능한 것 (1단계) — (2026-07-28 갱신)

- **국토부 공식 API 연동 완료** — 단지 식별은 `naverId`가 아니라
  `LAWD_CD+umdNm+jibun`(2장 갱신) 기준, `BUILDING_REGISTER_API_KEY`
  재사용, 신규 설정 불필요
- **매각대금완납일 확보 경로 확인 완료** — 탱크옥션 `histInfo`
  sta=1216(표본 검증 완료, [data-findings 2장](./auction-resale-matching-data-findings.md))
- 전용면적·낙찰일/완납일 기준 하드 필터
- 4.1의 Area/Floor/Time/Price/Uniqueness 서브스코어 전부 계산 가능
  (동은 부분적으로 확보되므로 4.2 동 일치 가점도 즉시 가동 가능)
- 완납 전 계약 페널티 로직(단, 매물 이력 없이는 보강 증거를 못 만들어
  페널티만 적용되는 보수적 버전)

→ **즉 이제 별도 전제조건 없이 바로 1단계(스키마+수집 배치) 구현에
착수할 수 있는 상태다.** 0단계였던 두 항목(완납일, 국토부 API)이
전부 실측 검증 완료됐다.

### 5.2 추가하면 정확도가 더 오르는 것 (우선순위 순, 갱신)

| 추가 데이터 | 효과 | 우선순위 |
|---|---|---|
| **네이버 매물 이력 저장**(등록/변경/삭제 스냅샷) | 4.4의 "완납 전 계약" 특별 규칙을 완전히 가동시킴. 매물 삭제 시점↔실거래 계약일 근접도라는 강력한 독립 신호 확보. **남은 항목 중 가장 효과 큰 단일 항목** | ★★★★★ |
| **매물 삭제 시점** (위와 세트) | "언제 팔렸는지"의 대리 신호. 실거래 신고보다 보통 더 빠르게(신고는 최대 30일 지연) 감지 가능 | ★★★★★ |
| **평형 A/B 타입 라벨 확장**(3.3절) | 동일 면적·다른 구조 오탐을 원천 차단. 네이버 매물 API의 `nameType`으로 확보 가능(실측 확인) | ★★★★ |
| 방향(향) | 같은 라인 내 세대 구분에 보조적으로 도움(라인별 향이 다른 경우) — 네이버 매물 API의 `direction` 필드로 확보 가능(실측 확인, 코드값 디코딩 테이블 필요) | ★★ |
| K-apt 연동(관리사무소 연락처 등) | 사용자가 직접 관리비 확인할 때 참고용, 매칭 정확도 자체엔 간접적 | ★★ |

~~국토부 실거래가 API 연동~~ / ~~잔금일 정식 수집~~ — **완료됨(3.1절,
0단계)**, 더 이상 대기 항목이 아니다. ~~등기 변경~~도 국토부 API의
`rgstDate` 필드로 이미 확보됐다([data-findings 8.3절](./auction-resale-matching-data-findings.md)).

**결론**: 0단계 완료로 우선순위가 재편됐다. 이제 남은 **단일 최대
요인은 "네이버 매물 이력 저장"**(완납 전 계약 케이스를 제대로
잡아내는 유일한 방법) 하나다.

---

## 6. DB 스키마 제안

### 6.1 `auctions` 테이블에 추가할 컬럼

```sql
ALTER TABLE auctions
  ADD COLUMN "saleConfirmedAt" date NULL,      -- 매각허가결정일
  ADD COLUMN "paymentCompletedAt" date NULL,   -- 매각대금완납일 (핵심 anchor)
  ADD COLUMN "paymentCompletedAtIsEstimated" boolean NOT NULL DEFAULT false,
  -- 아래 3개는 배치 매칭 결과를 빠른 목록 조회용으로 비정규화(denormalize)
  ADD COLUMN "resaleMatchedTradeId" uuid NULL,
  ADD COLUMN "resaleMatchScore" integer NULL,
  ADD COLUMN "resaleMatchTier" text NULL;      -- VERY_HIGH/HIGH/... (4.5 등급)

CREATE INDEX "IDX_auctions_payment_completed_pending"
  ON auctions ("paymentCompletedAt")
  WHERE "paymentCompletedAt" IS NOT NULL AND "resaleMatchedTradeId" IS NULL;
  -- 배치가 "완납됐는데 아직 매칭 안 된" 물건을 빠르게 조회하는 큐 역할
```

### 6.2 `actual_trade` — 정규화된 실거래 기록 (append-only, 중복 방지)

**(2026-07-28 갱신)** 주 소스를 국토부 공식 API로 확정하고, 단지
식별을 단지명(`aptNm`) 텍스트가 아니라 **지번 기반**(`lawdCd`+
`umdNm`+`jibun`)으로 바꾼다 — 동명이인 단지 오매칭을 원천 차단하기
위함(2장 하드필터 갱신 사유와 동일). `aptNm`은 매칭 조건에서 빠지고
표시·감사용 컬럼으로만 남는다.

```sql
CREATE TABLE actual_trade (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "lawdCd" text NOT NULL,                  -- 법정동코드 5자리 (예: '28245')
  "umdNm" text NOT NULL,                   -- 읍면동 (예: '서운동')
  "jibun" text NOT NULL,                   -- 지번(본번-부번), 국토부 API 원문 그대로 (예: '178')
  "aptNm" text NOT NULL,                   -- 단지명(표시·감사용, 매칭 조건 아님)
  "naverComplexId" text NULL,              -- 네이버 매물 이력 연결용(있으면), auctions.naverId와 동일 체계
  "buildingDong" text NULL,                -- aptDong — 2024년 이후 계약만 부분 채움(50~75%), 그 외 NULL
  floor integer NULL,
  "exclusiveArea" numeric(7,4) NOT NULL,   -- 국토부 API 소수점 정밀도 반영(예: 101.8427)
  "areaTypeLabel" text NULL,               -- 네이버 매물 API의 nameType 기반(예: "A"), 국토부는 미제공이라 매물 연결로만 채움
  "dealAmount" bigint NOT NULL,            -- 원 (국토부 응답은 만원 단위 문자열 "42,000" → 파싱 시 ×10000)
  "contractDate" date NOT NULL,            -- 계약일(dealYear/Month/Day 조합)
  "registeredAt" date NULL,                -- rgstDate(등기접수일) — 국토부 API 직접 제공, 완납일 검증에 활용
  "buyerType" text NULL,                   -- buyerGbn: '개인'|'법인' (실명 아님, 개인정보 미포함 — 실측 확인)
  "sellerType" text NULL,                  -- slerGbn: '개인'|'법인'
  "dealingType" text NULL,                 -- dealingGbn: '중개거래'|'직거래' — 직거래는 PriceScore 리스크 신호
  "isCancelled" boolean NOT NULL DEFAULT false, -- cdealType 존재 여부 — true면 하드필터에서 이미 제외되지만 감사용으로 보존
  "cancelledAt" date NULL,                 -- cdealDay
  "sourceType" text NOT NULL DEFAULT 'MOLIT_API', -- 'MOLIT_API' | 'NAVER_TRADE' | 'MANUAL'
  "sourceRaw" jsonb NULL,                  -- 원본 응답 스냅샷(감사용)
  "createdAt" timestamp NOT NULL DEFAULT now()
);

-- 동일 거래 중복 수집 방지(일별 재크롤링 대비)
CREATE UNIQUE INDEX "UQ_actual_trade_natural_key" ON actual_trade (
  "lawdCd", "umdNm", "jibun", floor, "exclusiveArea", "contractDate", "dealAmount"
);
CREATE INDEX "IDX_actual_trade_address" ON actual_trade ("lawdCd", "umdNm", "jibun");
CREATE INDEX "IDX_actual_trade_naver_complex_area_date"
  ON actual_trade ("naverComplexId", "exclusiveArea", "contractDate");
```

### 6.3 `naver_listing_snapshot` — 매물 이력 (2단계, 우선순위 최상위 확장)

```sql
CREATE TABLE naver_listing_snapshot (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "complexNaverId" text NOT NULL,
  "articleId" text NOT NULL,               -- 네이버 매물 고유 ID
  "buildingDong" text NULL,
  floor integer NULL,
  "exclusiveArea" numeric(6,2) NOT NULL,
  "areaTypeLabel" text NULL,
  "askPrice" bigint NOT NULL,
  "firstSeenAt" date NOT NULL,
  "lastSeenAt" date NOT NULL,              -- 매일 갱신(살아있으면 오늘 날짜로 갱신)
  "isActive" boolean NOT NULL DEFAULT true,-- false가 되는 순간 = "삭제 감지"
  "removedAt" date NULL,                   -- isActive가 false로 바뀐 날짜
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "UQ_naver_listing_article" ON naver_listing_snapshot ("articleId");
CREATE INDEX "IDX_naver_listing_complex_dong_floor"
  ON naver_listing_snapshot ("complexNaverId", "buildingDong", floor, "exclusiveArea");
```

### 6.4 `auction_trade_match` — 매칭 결과(후보 전부 저장, 감사 가능)

```sql
CREATE TABLE auction_trade_match (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "auctionId" uuid NOT NULL REFERENCES auctions(id),
  "actualTradeId" uuid NOT NULL REFERENCES actual_trade(id),
  "listingSnapshotId" uuid NULL REFERENCES naver_listing_snapshot(id),
  "candidateRank" integer NOT NULL,        -- 1 = 최고점 후보
  "scoreTotal" integer NOT NULL,           -- 0~100
  "scoreBreakdown" jsonb NOT NULL,         -- {area:.., floor:.., time:.., price:.., uniqueness:.., listingLink:.., penalties:[...]}
  "confidenceTier" text NOT NULL,          -- VERY_HIGH/HIGH/MEDIUM/LOW
  "isPreCompletion" boolean NOT NULL DEFAULT false, -- 완납 전 계약 여부
  "isDisplayed" boolean NOT NULL DEFAULT false,     -- 사용자 화면 노출 여부(4.5 정책 반영 결과)
  status text NOT NULL DEFAULT 'CANDIDATE', -- CANDIDATE/CONFIRMED/REJECTED/SUPERSEDED
  "reviewedBy" text NULL,
  "reviewedAt" timestamp NULL,
  "computedAt" timestamp NOT NULL DEFAULT now(),
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "UQ_auction_trade_match_pair"
  ON auction_trade_match ("auctionId", "actualTradeId");
CREATE INDEX "IDX_auction_trade_match_displayed"
  ON auction_trade_match ("auctionId") WHERE "isDisplayed" = true;
```

### 6.5 `resale_match_run_log` — 배치 실행 이력 (선택, 기존 `crawler_log` 패턴 재사용 권장)

기존에 이미 만들어둔 `crawler_log` 테이블(스케줄러 실행 로그 영속화,
2026-07-25 작업)과 동일한 패턴을 그대로 재사용하는 것을 권장한다.
`scheduler` 컬럼처럼 `jobType='RESALE_MATCH'` 태그를 붙여 기존 "매일
작업 실행 로그" 패널에 함께 노출되게 하면 새 테이블/새 UI 없이도
운영 가시성을 확보할 수 있다.

---

## 7. NestJS + PostgreSQL 아키텍처

### 7.1 배치 vs 실시간 — **배치(스케줄) 방식 채택**

실시간 계산을 하지 않는 이유:
- 후보 탐색이 단지 전체 실거래를 스캔해야 해서(가벼워도 매물/거래
  이력이 쌓이면 무겁다) 요청마다 계산하면 목록 페이지가 느려진다.
- 실거래·매물 데이터 자체가 "매일 1회 크롤링" 주기로만 갱신되므로,
  요청 시점 계산이 더 최신 정보를 주는 것도 아니다.
- 목록 화면에서 다수 사용자가 같은 물건을 반복 조회 — 매번 재계산은
  낭비다.

**따라서 결과를 `auctions` 테이블에 비정규화 저장(6.1)해두고, 조회는
단순 컬럼 읽기로 처리한다.** 이 패턴은 이미 이 코드베이스에
`vatPnu`/`vatStructureName`(부가세계산 캐싱) 등으로 확립돼 있다 —
동일 철학을 재사용.

### 7.2 배치 파이프라인 구성

기존 크롤러가 이미 `@nestjs/schedule` 기반 스케줄러(`CrawlerService.
tickScheduler`, `KakaoNotifyScheduler` 등)를 쓰고 있으므로 동일 패턴으로
`ResaleMatchModule`을 신설한다.

```
Stage A) 실거래/매물 수집 (주기: 1일 1회, 새벽 시간대)
  - **주 소스: 국토교통부 공식 API**(`RTMSDataSvcAptTrade`,
    data.go.kr). 기존 `BUILDING_REGISTER_API_KEY` 재사용, 신규 키
    발급 불필요(2026-07-28 실측 확인, [data-findings 8장](./auction-resale-matching-data-findings.md)).
  - 대상 스코프: "완납일이 설정돼 있고 아직 CONFIRMED 매칭이 없는
    auctions"의 `(LAWD_CD, 최근 N개월)` 조합만 조회(전국 전체 단지를
    매일 훑지 않음 — 비용·API 트래픽 통제). 이 API는 시군구+월
    단위로만 조회 가능하고 단지 단위 필터가 없으므로, 응답을 받은
    뒤 **`umdNm`+`jibun`(지번) 일치하는 행만** 걸러 저장한다(2장
    갱신 사유 — 단지명 텍스트 매칭은 동명이인 위험).
  - **API 트래픽 주의**: data.go.kr 개발계정 기본 일일 트래픽
    한도 10,000건(운영 전환 시 활용사례 등록으로 증량 가능) — 시군구
    단위 조회라 스코프 관리가 곧 트래픽 관리다. 감시 대상 시군구 수를
    추적해 한도 내로 유지해야 한다.
  - 응답을 `actual_trade`에 upsert(자연키 중복 방지, 6.2). `cdealType`
    이 채워진 행은 `isCancelled=true`로 저장하되 2장 하드필터에서
    후보 선정 시 제외한다.
  - 보조 소스: 네이버 실거래 스크래핑(기존 `naver_httpx.py`)은
    당분간 병행 가능(교차검증용, `sourceType='NAVER_TRADE'`)하되
    필수는 아니다.
  - (2단계) 동일 스코프의 네이버 매물 목록도 스냅샷 → naver_listing_snapshot
    upsert, 사라진 매물은 isActive=false 전환

Stage B) 매칭 계산 (주기: Stage A 직후, 또는 별도 1일 1회)
  - 대상: "paymentCompletedAt IS NOT NULL AND resaleMatchedTradeId IS
    NULL"인 auctions (6.1의 인덱스로 빠르게 조회)
  - 완납 후 경과 개월수에 따라 재확인 빈도를 줄인다(멀어질수록
    성공 확률 낮아지므로 자원 절약):
      완납 후 0~3개월: 매일 재확인
      3~12개월: 주 1회
      12~36개월: 월 1회
      36개월 초과: 더 이상 확인 안 함(감시 종료, "매칭 안 됨"으로 확정)
  - 각 auction에 대해 2장 하드필터 → 4장 스코어링 → auction_trade_match
    upsert(전체 후보) → 최고점 후보가 4.5 기준을 통과하면 auctions에
    비정규화 반영

Stage C) 정리/알림 (선택)
  - 새로 VERY_HIGH/HIGH로 확정된 건에 대해 관리자 텔레그램 알림
    (기존 CrawlerTelegramService 패턴 재사용 가능)
```

### 7.3 캐싱

- **Redis 등 별도 캐시 레이어는 불필요**하다고 판단 — 결과 자체를
  `auctions` 컬럼에 비정규화해뒀으므로 일반 조회는 이미 "캐시된 값"을
  읽는 것과 같다.
- 관리자 QA 화면(후보 목록+스코어 브레이크다운)처럼 무거운 조회는
  캐싱보다 인덱스(6.4의 `IDX_auction_trade_match_displayed`)로 충분히
  빠르게 처리 가능한 규모로 예상됨.
- 트래픽이 늘어 목록 API가 실제로 병목이 되면, 그때 서비스 레이어에
  짧은 TTL(수분) 인메모리 캐시를 추가하는 정도로 충분 — 지금 단계에서
  미리 설계할 필요 없음(과설계 방지).

### 7.4 멱등성/재계산 안전성

- Stage B는 언제 다시 돌려도 안전해야 한다 — `auction_trade_match`는
  `(auctionId, actualTradeId)` 유니크 upsert이므로 재실행 시 점수만
  갱신되고 중복 행이 생기지 않는다.
- 알고리즘 가중치를 바꾸면(4장 튜닝) 과거 계산분을 전부 재평가할 수
  있어야 하므로, `status='CONFIRMED'`(관리자가 수동 확정한 것)는
  재계산으로 덮어쓰지 않고 보존한다(수동 확정은 최종 판단으로 존중).

---

## 8. 오탐(False Positive) 최소화 — 설계 전체를 관통하는 안전장치 정리

이미 각 장에 흩어져 있는 장치들을 한곳에 모아 정리:

1. **하드 필터 우선**(2장) — 단지·면적·기간·상태가 안 맞으면 애초에
   점수 계산도 안 함.
2. **동 불일치는 즉시 탈락**(4.2) — 정보가 있는데 다르면 반증으로 취급.
3. **완납 전 계약은 기본 페널티, 보강 증거 없으면 사실상 숨김**(4.4).
4. **모호성(1·2위 점수차 <8점)이면 등급 무관 강제 비노출**(4.5) —
   "확신이 없으면 아무것도 안 보여준다"는 원칙의 직접 구현.
5. **1개 실거래 = 1개 물건**(2장 "중복 소진 배제") — 한 실거래가
   여러 낙찰 물건과 동시에 매칭되는 것을 원천 차단.
6. **임계 점수 미달(70점 미만)은 일반 사용자에게 아예 안 보임**, 55~69점만
   관리자 검토 큐에 남김 — 등급 배지를 낮게라도 보여주지 않는다(사용자가
   "낮은 신뢰도"라도 낚일 위험 자체를 차단).
7. **감사 가능성** — 모든 후보와 서브스코어를 저장(`scoreBreakdown`
   jsonb)하므로, 오탐이 실제 발견되면 정확히 어느 서브스코어가
   잘못됐는지 역추적해 가중치를 튜닝할 수 있다.
8. **감시 기간 상한(36개월)** — 너무 오래된 거래를 억지로 끌어다
   맞추지 않는다.

---

## 9. 확장 아이디어 (사용자가 요청하지 않았지만 제안)

### 9.1 매도 손익 자동 계산 (자연스러운 최우선 확장)
매칭이 확정되면, 이미 존재하는 수익계산기 인프라(`profit-calculator.ts`,
`ProfitCalculatorPanel.tsx`)와 바로 연결할 수 있다:
```
실현 손익 = 매도가(actual_trade.dealAmount)
          - 취득원가(낙찰가 + 취득세 + 법무비 등, 기존 계산 로직 재사용)
          - 보유비용 추정(대출이자 등)
          - 양도소득세 추정(보유기간에 따른 세율 자동 판정)
```
"이 물건은 실제로 8개월 보유해 세전 6,200만원, 세후 4,800만원의 수익을
냈습니다" 같은 카드를 자동 생성할 수 있다 — 이 기능의 진짜 가치는
매칭 자체보다 **이 후속 손익 리포트**에 있을 가능성이 크다.

### 9.2 보유기간 기반 양도세 중과 자동 판정
완납일↔계약일 gap을 이미 계산하므로(4.1 TimeScore), 1년/2년 단기양도
중과 여부를 자동 태깅해 9.1의 세금 추정에 바로 활용 가능.

### 9.3 전략 태그별 매도 성과 통계 대시보드
`strategyTags`(기존 투자전략 자동 태깅 시스템)와 결합해 "이 전략
태그가 붙은 물건들의 평균 회수기간·평균 수익률"을 집계 — 신규
투자자에게 "어떤 유형의 물건이 실제로 잘 팔리고 얼마나 남았는지"를
데이터로 보여주는 것은 다른 경매 플랫폼에 없는 강력한 차별화 지점이
될 수 있다.

### 9.4 사용자 피드백 루프 (저비용·고가치)
매도 추정 배지 옆에 "이 추정이 맞나요? 👍/👎" 버튼을 두는 것만으로,
비용 거의 없이 라벨 데이터를 모을 수 있다. 이 데이터는:
- 55~69점(관리자 QA 큐) 항목의 검토 우선순위를 정하는 데 쓰이고
- 나중에 이 규칙 기반 스코어링을 실제 분류 모델로 교체할 때 학습
  데이터로 직결된다.

### 9.5 관리자 QA 화면 (신뢰 구축을 위한 필수 선행 단계)
사용자에게 전면 노출하기 전에, 관리자 화면에서 "후보 리스트 +
스코어 브레이크다운 + 원클릭 확정/거절" UI를 먼저 만들어 최소
2~4주간 내부 검증 기간을 갖는 것을 권장한다. 여기서 얻은 CONFIRMED/
REJECTED 라벨이 알고리즘 튜닝의 첫 데이터셋이 된다.

### 9.6 "재경매/재매각" 안전장치
동일 물건이 유찰 후 재경매되어 여러 낙찰 이력을 가질 수 있다. 매칭은
항상 **최종 성공 낙찰(caseState=매각완료) 행 각각을 독립적으로** 다루면
되므로 로직 자체는 이미 안전하지만, 관리자 QA 화면에 "같은 물건주소의
과거 유찰 이력"을 함께 보여주면 혼동 방지에 도움된다.

### 9.7 부정 증거(negative evidence) 활용 — 2단계 이후
동일 동·층·면적의 네이버 매물이 후보 실거래 시점에 **아직 살아있는
상태(미삭제)**라면, 이는 "그 세대는 안 팔렸다"는 반증 신호다. 매물
이력이 쌓이면 이런 부정 증거로 오탐 후보를 추가로 걸러낼 수 있다.

---

## 10. 단계별 구현 로드맵 (제안 — 코드 작업 전 합의용)

| 단계 | 범위 | 전제조건 |
|---|---|---|
| **0단계** | `paymentCompletedAt`(매각대금완납일) 수집 경로 확보 + 국토부 실거래 API 연동 확보 | **완료(2026-07-28)** — 완납일은 탱크옥션 `histInfo` sta=1216에서 확보 가능함을 표본 검증, 국토부 API는 `BUILDING_REGISTER_API_KEY` 재사용으로 활용신청 승인 완료·실제 호출 성공까지 확인함([data-findings 문서](./auction-resale-matching-data-findings.md) 2·8·9장) |
| **1단계** | `actual_trade` 테이블 신설 + 국토부 API 수집 배치 구현(Stage A), 2~7장의 스코어링을 동/매물이력 없이 구현. **착수 전 확인 필요**: 우리 쪽 주소 파싱이 국토부 API의 `umdNm`(읍면동)과 정확히 같은 표기(법정동 기준)를 뽑아내는지 표본 검증(법정동/행정동 명칭이 다른 지역 존재 가능 — 2장 하드필터가 지번 매칭으로 바뀌면서 새로 생긴 전제조건) | 0단계 완료 — 이제 바로 착수 가능 |
| **2단계** | 관리자 QA 화면(9.5) — 내부 검증 | 1단계 완료 |
| **3단계** | 검증 통과 후 사용자 화면 노출(70점 이상만) | 2단계에서 오탐률 확인 |
| **4단계** | `naver_listing_snapshot`(매물 이력) 추가, 완납 전 계약 특별 규칙(4.4) 완전 가동 | 3단계 안정화 후 |
| **5단계** | 매도 손익 리포트(9.1), 사용자 피드백 루프(9.4) | 4단계 이후, 우선순위는 사용자 판단 |

이 로드맵은 순서 제안일 뿐이며, 실제 착수 여부·순서는 사용자 승인
후 결정한다.

---

## 11. 1단계 구현 설계 (실행 계획, 2026-07-28)

### 11.1 어느 레포에 구현하는가 — `auction-api`(NestJS)로 확정

이 기능의 핵심은 **지속 실행 배치 스케줄러**(7장)다. `auction`
(Next.js)은 Vercel 서버리스라 상시 배치를 못 돌리고, `auction-api`
(NestJS, Railway 상시 실행)에는 이미 동일 패턴(`CrawlerService.
tickScheduler`, `KakaoNotifyScheduler`)이 있다. **전부 auction-api에
구현한다.**

국토부 API 키(`BUILDING_REGISTER_API_KEY`)는 원래 `auction`의
`.env.local`에만 있는 줄 알았으나, 확인 결과 **`auction-api/.env`에도
이미 동일 키가 등록돼 있다** — 별도 운영 조치(Railway 환경변수 추가)
없이 바로 재사용 가능.

### 11.2 새 모듈 구조 — 기존 `crawler` 모듈과 동일 패턴

```
src/resale-match/
  resale-match.module.ts
  entities/
    actual-trade.entity.ts          -- 6.2절 스키마
    auction-trade-match.entity.ts   -- 6.4절 스키마
  molit-trade-client.service.ts     -- 국토부 API 호출 래퍼
  trade-ingestion.service.ts        -- Stage A(수집)
  match-scoring.util.ts             -- Stage B 스코어링(순수 함수, 4장)
  resale-match.service.ts           -- Stage A/B 오케스트레이션 + 스케줄러
  resale-match.controller.ts        -- 관리자 조회용(최소 범위, 2단계 QA 화면의 API)
```

`crawler.module.ts`와 동일하게 `TypeOrmModule.forFeature([...])`로
엔티티 등록, `AuctionsModule`을 import해 `AuctionsService` 재사용
(완납일 조회, 매칭 결과 반영).

### 11.3 `molit-trade-client.service.ts` — 국토부 API 래퍼

이번 세션에서 실제 검증된 호출 방식을 그대로 구현으로 옮긴다:
- `GET https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade`
- 파라미터: `serviceKey`(env), `LAWD_CD`, `DEAL_YMD`
- 응답은 XML → `fast-xml-parser` 등으로 파싱(NestJS 표준 http 클라이언트는
  `@nestjs/axios` 사용, 기존 코드베이스에 이미 axios 의존성 있는지 확인
  필요 — 없으면 크롤러처럼 httpx 유사 계층 없이 Node `fetch`/`axios`로
  충분)
- 실측 확인된 필드 그대로 매핑: `aptDong`, `floor`, `excluUseAr`,
  `dealAmount`(만원→원 변환), `dealYear/Month/Day`, `rgstDate`,
  `buyerGbn`, `slerGbn`, `dealingGbn`, `cdealType`, `cdealDay`,
  `umdNm`, `jibun`
- **트래픽 관리**: 호출 큐/카운터를 두어 일일 10,000건 한도 내로
  스로틀링(7.2절 Stage A 주의사항)

### 11.4 마이그레이션 순서 (4개, 순차 적용)

1. `AddAuctionResaleMatchDates` — `auctions`에 `saleConfirmedAt`,
   `paymentCompletedAt`, `paymentCompletedAtIsEstimated` 추가(6.1절)
2. `AddActualTradeTable` — 6.2절 스키마
3. `AddAuctionTradeMatchTable` — 6.4절 스키마
4. `AddAuctionResaleMatchDenormalizedColumns` — `resaleMatchedTradeId`/
   `resaleMatchScore`/`resaleMatchTier` (1·4를 합쳐도 무방, 기존
   레포 관례상 목적별로 분리하는 편이 history 문서 추적에 유리)

### 11.5 기존(이미 매각완료된) 물건의 완납일 백필 문제

**중요 — 이번 세션에서 여러 번 겪은 패턴과 동일**: 신규 컬럼을
추가해도 크롤러가 새로 그 필드를 채우는 건 **이후 재크롤링되는
물건부터**다. 이미 DB에 있는 매각완료 물건(`caseState`가 매각
계열)은 `paymentCompletedAt`이 전부 비어 있는 채로 남는다.

→ **오피스텔 재크롤링 때 썼던 것과 동일한 방식**(nohup 백그라운드
배치, `crawler/recrawl_all.py` 패턴)으로, 이미 매각완료된 기존
물건 전체를 대상으로 `histInfo`를 재조회해 `sta=1216` 값을
`paymentCompletedAt`에 채우는 **1회성 백필 스크립트**가 1단계
작업에 포함돼야 한다. 이게 없으면 국토부 API 연동이 다 돼도
매칭 대상(완납일 있는 물건)이 "새로 매각완료되는 물건"만으로
한정돼 한동안 매칭 결과가 거의 안 나온다.

### 11.6 착수 순서 제안

1. 마이그레이션 4개 + TypeORM 엔티티 작성
2. `molit-trade-client.service.ts` 단독 구현 → 실제 API 호출
   테스트(이번 세션에 검증된 LAWD_CD/DEAL_YMD 파라미터로 스모크
   테스트)
3. 완납일 백필 배치(11.5) 실행 — 기존 매각완료 물건 전체 대상
4. `trade-ingestion.service.ts`(Stage A) 구현
5. `match-scoring.util.ts`(Stage B, 4장 알고리즘) 순수 함수로 구현
   + 유닛 테스트(스코어 계산은 로직이 복잡해 테스트 커버리지 중요)
6. 스케줄러 연결(`@nestjs/schedule` 또는 기존 `setInterval` 패턴)
7. 최소 관리자 조회 API(결과 확인용) — 전체 QA 화면(9.5, 2단계)은
   범위 밖, 우선 DB 직접 조회나 간단한 리스트 API로 결과만 확인
   가능하게

### 11.7 1단계에서 미루는 것 (명시적 범위 제외)

- 사용자 화면 노출(3단계 범위)
- 네이버 매물 이력(`naver_listing_snapshot`, 4단계 범위) — 없어도
  1단계 스코어링(동 제외 서브스코어)은 정상 동작(5.1절)
- 완납 전 계약 특별 규칙의 "보강 증거" 부분(4.4절) — 매물 이력 없이는
  페널티만 적용되는 보수적 버전으로 우선 동작(의도된 동작)
- 관리자 QA 화면 UI(2단계 범위) — 1단계는 배치·스코어링 로직까지만
