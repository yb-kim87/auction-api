import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AiAnalysisService } = require("../dist/ai/ai-analysis.service.js");
const {
  extractRightsAnalysisFacts,
  buildDeterministicRightsDecision,
} = require("../dist/ai/rights-analysis-context.util.js");

const service = Object.create(AiAnalysisService.prototype);
const baselineRegistry =
  "을(1) 2020-06-23 근저당권설정 국민은행 (말소기준등기)";

function wrongAiResult() {
  return {
    summary: "AI가 잘못 만든 결론",
    priceAnalysis: "",
    rightsAnalysis: "임차보증금 2억원을 낙찰자가 인수할 수 있습니다.",
    loanAnalysis: "",
    investmentFit: "",
    checklist: [],
    recommendation: "검토",
    risks: ["대항력 있는 임차인", "임차보증금 인수 위험"],
    structuredRights: {
      reviewStatus: "possible",
      baselineRight: { type: "", date: "", reason: "" },
      tenant: {
        priorityStatus: "possible",
        opposability: "possible",
        depositAmount: 200_000_000,
      },
      assumption: {
        status: "possible",
        estimatedAmount: 200_000_000,
        reason: "임차보증금이 존재합니다.",
      },
      missingEvidence: ["임차인 전입 확인", "배당 결과"],
      evidence: [],
      knowledgeEvidence: [],
    },
  };
}

function run(input) {
  const facts = extractRightsAnalysisFacts(input);
  const result = service.validateStructuredRights(
    wrongAiResult(),
    facts,
    new Set(),
  );
  return { decision: buildDeterministicRightsDecision(facts), result };
}

const owner = run({
  buildingRegistry: baselineRegistry,
  tenantInfo: "소유자 점유",
  tenantDetail: "소유자가 전부 거주하고 있음",
});
assert.equal(owner.decision.code, "owner_occupied");
assert.equal(owner.result.structuredRights.tenant.opposability, "none");
assert.equal(owner.result.structuredRights.assumption.estimatedAmount, 0);
assert.ok(owner.result.summary.includes("소유자"));

const noTenant = run({
  buildingRegistry: baselineRegistry,
  tenantDetail: "조사된 임차내역 없음",
});
assert.equal(noTenant.decision.code, "no_tenant");
assert.equal(noTenant.result.structuredRights.assumption.status, "none");
assert.equal(noTenant.result.structuredRights.assumption.estimatedAmount, 0);

const senior = run({
  buildingRegistry: baselineRegistry,
  tenantInfo: "임차인 홍길동",
  tenantDetail:
    "임차인: 홍길동 / 전입: 2019-08-30 / 확정: 2019-08-19 / 보증금: 200,000,000원",
});
assert.equal(senior.decision.code, "senior_tenant_review");
assert.equal(senior.result.structuredRights.tenant.opposability, "possible");
assert.equal(senior.result.structuredRights.assumption.status, "unknown");
assert.equal(senior.result.structuredRights.assumption.estimatedAmount, null);
assert.ok(senior.result.structuredRights.missingEvidence.includes("미배당 보증금 잔액"));

const hug = run({
  buildingRegistry: baselineRegistry,
  tenantInfo: "주택도시보증공사(HUG) 임차보증금반환채권 승계",
  tenantDetail:
    "임차인: 홍길동 / 전입: 2019-08-30 / 확정: 2019-08-19 / 보증금: 200,000,000원",
  specialNote:
    "주택도시보증공사는 보증금 전액을 배당받지 못하더라도 잔존 임차보증금반환채권을 포기한다.",
});
assert.equal(hug.decision.code, "senior_tenant_waiver");
assert.equal(hug.result.structuredRights.tenant.opposability, "possible");
assert.equal(hug.result.structuredRights.assumption.status, "none");
assert.equal(hug.result.structuredRights.assumption.estimatedAmount, 0);
assert.ok(hug.result.summary.includes("포기"));

const noTenantWithLien = run({
  buildingRegistry: baselineRegistry,
  tenantDetail: "조사된 임차내역 없음",
  specialNote: "유치권 신고가 있으나 성립 여부는 불명확함",
});
assert.equal(noTenantWithLien.decision.code, "no_tenant");
assert.equal(noTenantWithLien.result.structuredRights.tenant.opposability, "none");
assert.equal(noTenantWithLien.result.structuredRights.assumption.status, "unknown");
assert.equal(noTenantWithLien.result.structuredRights.assumption.estimatedAmount, null);
assert.equal(noTenantWithLien.decision.requiresRag, true);

console.log("rights-analysis-pipeline: 4 requested scenarios + 1 exception guard ok");
