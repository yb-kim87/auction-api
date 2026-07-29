# 권리분석에 탱크옥션 대항력 '인수조건변경' 참고 신호 추가

날짜: 2026-07-30
관련 레포: auction-api

## 배경
2025타경8596 백필 확인 과정에서 사용자가 지적: 이 물건은 주택도시
보증공사(HUG)가 임차권을 승계한 사건으로, 탱크옥션 자체 분석상
`대항력: 인수조건변경` / `분석: 순위배당 있음`으로 표시되는데(전날
복구한 필드), 우리 AI 권리분석은 여전히 "말소기준권리일보다 빠른
전입일이 있어 선순위 임차인 가능성 있음 — 위험 높음"으로만 표시됨.
"우리 권리분석 규칙에 이 부분에 대한 게 있지 않냐"는 질문.

## 확인 결과
`src/ai/rights-rule.service.ts`에 정확히 이 시나리오를 위한 규칙
(`creditor_residual_claim_waiver`, "보증기관 잔존채권 포기")이 이미
존재했다. 하지만 실제 감지 로직(`rights-analysis-context.util.ts`
의 `hasCreditorWaiver`)은 법원 조사자료의 **명시적 "포기" 문구**
(`잔존 임차보증금반환채권을 포기` 등)만 정규식으로 잡고 있어서,
탱크옥션 자체 분석 문구인 "인수조건변경"/"순위배당 있음"은 전혀
인식하지 못했다 — 규칙은 있지만 이번 케이스의 데이터 패턴과 감지
로직이 연결돼 있지 않았던 것.

## 결정
"대항력 인수조건변경 + 순위배당" 조합을 곧바로 잔존채권 포기와
동일하게 취급해 위험 등급을 자동으로 낮추는 방안도 검토했으나,
사용자가 "자동 위험 해제는 위험, 참고 문구만 추가"를 선택 — 순위배당이
항상 전액 배당을 뜻하지 않아 오판 위험이 있기 때문(기존 다른
규칙들도 "임의로 확정하지 않음" 원칙을 따름).

## 변경 내용
`rights-analysis-context.util.ts`에 `hasAcquisitionConditionChangeSignal`
사실(fact) 추가 — tenantDetail에 `대항력: 인수조건변경`이 있으면
감지해 (1) `warnings`에 참고 경고 문구 추가, (2) AI 프롬프트 컨텍스트
(`formatRightsAnalysisFacts`)에도 별도 줄로 노출. 위험 등급/인수금액
계산 로직 자체는 변경하지 않음 — AI가 이 신호를 참고해 설명에
반영하도록 유도하되, 최종 판단은 여전히 사용자 확인에 맡긴다.

## 검증
`npx tsc --noEmit -p .` 통과.

## 追記 (2026-07-30) — 정책 변경: 안전한 물건으로 확정 판정

사용자가 실제 화면에서 재분석 결과를 보고 정책을 재조정: "인수조건
변경이고 실제 임차인 채권을 보증공사가 가져간 거라 안전한 거니
그냥 안전한 물건으로 하고 대신 문구만 써줘 — 매각물건명세서를
통해서 임차권 포기내용을 제대로 확인하라고" — 참고 문구로만 두지
말고, 확정 판정(안전한 물건)으로 바꾸되 항상 매각물건명세서 확인
문구를 달아달라는 요청.

`buildDeterministicRightsDecision`에 `senior_tenant_acquisition_condition_change`
분기를 신설(기존 `senior_tenant_waiver`와 동일한 필드 구성:
`final: true`, `opposability: "possible"`, `assumptionStatus: "none"`,
`assumptionAmount: 0`). `decision.final === true`이면
`buildDeterministicResult()`가 LLM을 거치지 않고 `risks: []`로
확정 결과를 바로 만들기 때문에, 프론트(`rights-presentation.ts`)의
배지 판정에서 `dangerous` 조건(assumption.status==="possible" 또는
risks 배열에 위험 키워드)이 걸리지 않아 **"권리위험 높음"이 아니라
"확인 후 입찰 검토"로 표시**된다. `checklist`에 이미 "매각물건명세서
확인하기"가 포함돼 있어 사용자가 요청한 확인 문구 요건도 별도
프론트 수정 없이 충족됨.

### 검증
`npx tsc --noEmit -p .` 통과. Railway 배포 후 API 정상 확인.

## 追記 (2026-07-30) — 사용자 노출 문구에서 '탱크옥션' 표현 제거

사용자 지시: "탱크옥션이라는 말 쓰면안돼 탱크옥션도 대법원에서
가져온거라서 탱크옥션이라는 말이 들어간건 다 빼야돼" + "앞으로
규칙이야 탱크옥션에서 크롤링 해온게 티가 나면 절대 안돼" — 사용자
노출 텍스트(AI 권리분석 summary/reason/warnings, 프롬프트 컨텍스트)
에 있던 "탱크옥션 분석상"을 전부 "임차인 현황 조사자료상"으로
순화. 이 규칙은 앞으로도 적용 — 고객에게 보이는 화면·문구에
크롤링 출처(탱크옥션)가 드러나면 안 된다. 코드 주석이나 관리자
전용 크롤러 관리 화면(로그인 상태 등 운영 목적)은 내부용이라
대상이 아니다.

## 追記 (2026-07-30) — 인수조건변경 케이스는 AI 호출 자체를 생략

사용자 지적: "인수조건변경 물건은 굳이 AI 안돌려도 될꺼같아" + "그냥
자체 로직으로 대답을 주자". 확인해보니 `senior_tenant_acquisition_
condition_change` 분기가 `final: true`인데도 `requiresRag: true`로
남아 있어, 매번 OpenAI를 호출하고 있었다 — 어차피 호출 결과는
`validateStructuredRights()`가 서버 판정값으로 덮어써서 최종
응답에 거의 반영되지 않는데도 비용·시간만 쓰던 셈. `requiresRag:
false`로 변경해 `!decision.requiresRag` 경로(이미 존재하던
`buildDeterministicResult()` 직행 경로)를 타도록 수정 — AI 호출
완전히 생략, 응답 속도/비용 개선.
