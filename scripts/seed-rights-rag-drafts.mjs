import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import { parse } from "dotenv";

const root = path.resolve(import.meta.dirname, "..");
const env = parse(fs.readFileSync(path.join(root, ".env")));
const base = "http://127.0.0.1:3001";
const token = jwt.sign(
  { sub: "rights-rag-draft-admin", role: "admin" },
  env.JWT_SECRET || "auction-dev-jwt-secret-change-me",
  { expiresIn: 600 },
);
const headers = {
  "Content-Type": "application/json",
  Cookie: `auc-token=${encodeURIComponent(token)}`,
};

const drafts = [
  {
    title: "[초안] 권리분석 전체 절차와 자료 우선순위",
    tags: "권리분석,등기부,매각물건명세서,현황조사서",
    content: `목적: 물건별 권리분석의 확인 순서와 근거 자료 우선순위를 정한다.

확인 순서
1. 최신 등기부에서 소유권·담보권·압류·가처분 등 등기 권리를 확인한다.
2. 매각물건명세서에서 매각으로 소멸하지 않는 권리와 임차인 정보를 확인한다.
3. 현황조사서·전입세대열람·상가건물임대차 현황서로 실제 점유자와 임차인을 대조한다.
4. 배당요구 여부와 배당 가능액을 확인한다.
5. 현장 조사 결과와 서류가 다르면 미확인으로 두고 추가 확인한다.

관리자 보완 필요: 자료별 신뢰 우선순위, 발급일 유효기간, 물건 유형별 추가 서류.`,
  },
  {
    title: "[초안] 말소기준권리 찾기",
    tags: "말소기준권리,근저당,압류,담보가등기,경매개시결정",
    content: `목적: 낙찰 후 소멸하는 권리와 인수 가능성이 있는 권리를 나누는 기준을 정한다.

확인 항목
- 등기부 권리의 종류와 접수일자·접수번호
- 근저당권, 저당권, 압류, 가압류, 담보가등기, 경매개시결정등기 후보
- 가장 앞선 말소기준권리 후보
- 말소기준권리보다 앞선 권리 존재 여부

출력 상태
- 확인 완료: 기준 권리와 일자가 서류로 확인됨
- 확인 필요: 최신 등기부 또는 권리 종류가 불명확함
- 해당 없음: 근거를 함께 기록

관리자 보완 필요: 권리별 말소기준권리 성립 조건과 예외 사례.`,
  },
  {
    title: "[초안] 임차인 대항력 판단",
    tags: "대항력,전입일,점유,확정일자,임차인",
    content: `목적: 임차인이 낙찰자에게 임대차 관계나 보증금 반환을 주장할 가능성을 판단한다.

필수 확인 자료
- 실제 점유 시작일
- 주민등록 전입일 또는 사업자등록 신청일
- 확정일자
- 소유권 및 말소기준권리 설정일
- 임대차계약서와 보증금

판단 원칙
- 점유와 전입 등 필수 요건 중 하나라도 확인되지 않으면 대항력 확정으로 표시하지 않는다.
- 날짜는 말소기준권리와 선후관계를 비교한다.
- 서류와 현장 점유가 다르면 미확인으로 표시한다.

관리자 보완 필요: 주택·상가 구분, 가족 전입, 법인 임차인 등 예외 사례.`,
  },
  {
    title: "[초안] 선순위 임차인과 보증금 인수 가능성",
    tags: "선순위임차인,보증금,인수금액,대항력,배당",
    content: `목적: 낙찰자가 임차보증금을 부담할 가능성이 있는지 선별한다.

확인 항목
- 대항력 성립 시점과 말소기준권리의 선후
- 임차보증금 총액
- 배당요구 여부와 배당 순위
- 예상 배당액과 미회수 가능액
- 매각물건명세서의 인수 문구

금액 원칙
- 보증금만으로 인수금액을 확정하지 않는다.
- 배당액이 확인되지 않으면 예상 인수금액은 미확인으로 둔다.
- 인수 예상액은 배당으로 회수되지 못하고 낙찰자에게 주장할 수 있는 금액을 기준으로 검토한다.

관리자 보완 필요: 배당 계산식, 소액임차인, 최우선변제 적용 기준.`,
  },
  {
    title: "[초안] 배당요구와 예상 배당액 확인",
    tags: "배당요구,배당종기,배당표,우선변제,보증금",
    content: `목적: 임차인과 채권자가 배당으로 회수할 금액과 낙찰자 인수 가능액을 구분한다.

확인 항목
- 배당요구 종기
- 배당요구 신청 여부와 신청일
- 채권자별 채권액과 순위
- 예상 낙찰가 기준 배당재원
- 집행비용·선순위 조세 등 우선 차감 항목

자료가 없을 때
- 배당요구 여부 미확인
- 예상 배당액 산정 불가
- 낙찰자 인수 예상액 확인 필요

관리자 보완 필요: 배당 순위표, 조세채권 처리, 배당 시뮬레이션 예시.`,
  },
  {
    title: "[초안] 낙찰자 인수 예상금액 산정 규칙",
    tags: "인수금액,보증금,배당액,준비자금,수익계산기",
    content: `목적: 관리자 확인값으로 낙찰 후 부담 가능 금액을 구조화한다.

입력값
- 확인된 임차보증금
- 확인된 예상 배당액
- 낙찰자가 인수하는 기타 권리 금액
- 산정 근거 자료와 확인일

기본 검토식
임차보증금 중 인수 가능액 = 확인된 보증금 - 확인된 예상 배당액
최종 인수 예상액 = 임차보증금 인수 가능액 + 기타 확인된 인수 권리 금액

안전 규칙
- 음수는 0원으로 본다.
- 하나라도 핵심 입력값이 미확인이면 확정금액으로 저장하지 않는다.
- AI 계산값은 초안이며 관리자 확인 전 수익계산기에 반영하지 않는다.

관리자 보완 필요: 복수 임차인 합산, 일부 배당, 조건부 인수 사례.`,
  },
  {
    title: "[초안] 특수권리 위험 신호 확인",
    tags: "유치권,법정지상권,가등기,가처분,전세권,분묘기지권",
    content: `목적: 일반적인 말소 판단만으로 결론 내리기 어려운 특수권리 위험 신호를 찾는다.

확인 대상
- 유치권 신고와 실제 점유·공사대금 근거
- 법정지상권 성립 가능성
- 소유권이전청구권 가등기와 담보가등기 구분
- 처분금지가처분·환매특약 등
- 전세권의 선후순위와 배당요구
- 토지별도등기, 대지권 미등기, 분묘기지권 가능성

출력 원칙
- 문구가 있다는 이유만으로 성립을 확정하지 않는다.
- 성립 요건, 반대 자료, 현장 확인사항을 함께 제시한다.

관리자 보완 필요: 특수권리별 성립 요건과 대표 판례·실무 확인법.`,
  },
  {
    title: "[초안] 권리분석 상태값과 확신도 기준",
    tags: "확인상태,확신도,미조사,확인불가,관리자확인",
    content: `목적: 정보 없음과 해당 없음이 혼동되지 않도록 상태를 통일한다.

상태값
- 미조사: 아직 필요한 자료를 확인하지 않음
- 조사 중: 자료 일부만 확인함
- 해당 없음: 조사 결과 해당 권리가 없음
- 확인 완료: 근거 자료로 판단과 금액을 확인함
- 확인 불가: 자료 부족·충돌로 현재 판단할 수 없음

AI 초안 상태
- possible: 위험 가능성을 발견했으나 관리자 확인 전
- unknown: 핵심 자료 부족
- none: 자료상 해당 없음. 근거 필수
- confirmed: 관리자 확인이 완료된 값에만 사용

관리자 보완 필요: 상태 변경 권한, 확인일 만료·재검토 기준.`,
  },
  {
    title: "[초안] 관리자 권리분석 최종 확인 체크리스트",
    tags: "관리자확인,체크리스트,근거자료,확인일,인수금액",
    content: `목적: AI 권리분석 초안을 관리자가 확정하기 전 빠뜨린 항목이 없는지 확인한다.

체크리스트
- 최신 등기부 발급일과 권리 순서를 확인했는가
- 말소기준권리 종류·일자·접수번호를 기록했는가
- 실제 점유자와 전입세대를 확인했는가
- 임대차계약서·보증금·확정일자를 확인했는가
- 배당요구 여부와 예상 배당액을 확인했는가
- 특수권리 신고와 성립 가능성을 검토했는가
- 인수 예상금액의 계산 근거를 첨부했는가
- 미확인 항목을 해당 없음으로 잘못 표시하지 않았는가
- 확인자와 확인일을 기록했는가

관리자 보완 필요: 내부 검수자, 필수 첨부파일, 재검토 주기.`,
  },
];

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${url}: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

const current = await request(`${base}/ai/knowledge`);

// 이전 인라인 실행에서 한글이 물음표로 손상된, 이번 작업의 비활성 2등급
// 레코드만 제거한다. 기존 활성 지식과 다른 관리자 지식은 건드리지 않는다.
const corrupted = current.filter(
  (item) =>
    item.active === false &&
    item.grade === 2 &&
    (item.title.includes("?") || item.category.includes("?")),
);
for (const item of corrupted) {
  await request(`${base}/ai/knowledge/${item.id}`, { method: "DELETE" });
}

const afterCleanup = await request(`${base}/ai/knowledge`);
let created = 0;
let updated = 0;
for (const draft of drafts) {
  const existing = afterCleanup.find((item) => item.title === draft.title);
  const body = JSON.stringify({
    ...draft,
    category: "권리분석",
    grade: 2,
    active: false,
  });
  if (existing) {
    await request(`${base}/ai/knowledge/${existing.id}`, { method: "PATCH", body });
    updated += 1;
  } else {
    await request(`${base}/ai/knowledge`, { method: "POST", body });
    created += 1;
  }
}

const verified = await request(`${base}/ai/knowledge`);
const saved = verified.filter(
  (item) => item.title.startsWith("[초안]") && item.category === "권리분석",
);
console.log(
  JSON.stringify(
    {
      removedCorrupted: corrupted.length,
      created,
      updated,
      drafts: saved.length,
      titles: saved.map((item) => item.title),
    },
    null,
    2,
  ),
);
