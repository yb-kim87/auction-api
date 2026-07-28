import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { extractRightsAnalysisFacts } = require(
  "../dist/ai/rights-analysis-context.util.js",
);

const facts = extractRightsAnalysisFacts({
  buildingRegistry:
    "을(1) 2020-06-23 근저당권설정 은행 1,068,000,000 (말소기준등기)\n" +
    "갑(3) 2025-04-03 임의경매 채권자 청구금액 880,000,000",
  tenantDetail:
    "전입:2019-08-30 / 확정:2019-08-19 / 보:200,000,000원",
  specialNote:
    "보증금 전액을 배당받지 못하더라도 잔존 임차보증금반환채권을 포기함",
});

assert.deepEqual(facts.baselineCandidate, {
  type: "근저당권설정",
  date: "2020-06-23",
  sourceLine:
    "을(1) 2020-06-23 근저당권설정 은행 1,068,000,000 (말소기준등기)",
});
assert.deepEqual(facts.claimAmounts, [880_000_000]);
assert.equal(facts.hasCreditorWaiver, true);
assert.deepEqual(facts.preBaselineTenantDates, ["2019-08-30"]);

const separateRows = extractRightsAnalysisFacts({
  buildingRegistry:
    "갑(1) 2020-06-23 소유권보존 개인\n" +
    "을(1) 2020-06-23 근저당권설정 은행 1,068,000,000 (말소기준등기)",
  tenantDetail: "",
  specialNote: "",
});
assert.equal(separateRows.baselineCandidate?.type, "근저당권설정");

const wrappedMarker = extractRightsAnalysisFacts({
  buildingRegistry:
    "갑(3) 2025-07-02 강제경매개시결정 채권자 청구금액 50,046,000\n" +
    "(말소기준등기 2025타경12345)",
  tenantDetail: "",
  specialNote: "",
});
assert.equal(wrappedMarker.baselineCandidate?.type, "강제경매개시결정");

const missing = extractRightsAnalysisFacts({
  buildingRegistry: "값없음",
  tenantDetail: "",
  specialNote: "",
});
assert.equal(missing.baselineCandidate, null);
assert.ok(missing.warnings.some((warning) => warning.includes("등기 원문이 없어")));

console.log("rights-analysis-context: ok");
