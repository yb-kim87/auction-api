import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildIpStats, detectCandidates } = require("../dist/security-log/security-log-detector.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function entries({ count, path = "/users/me", status = 200, ip = "1.2.3.4", gap = 300, username = "" }) {
  const start = Date.parse("2026-09-02T00:00:00.000Z");
  return Array.from({ length: count }, (_, index) => ({
    ts: new Date(start + index * gap).toISOString(), ip,
    method: path === "/auth/login" ? "POST" : "GET", path, username, status,
    durationMs: 10, userAgent: "node",
  }));
}

assert(detectCandidates(entries({ count: 1, path: "/auth/login", status: 401 })).length === 0,
  "단발 로그인 실패는 후보가 아니어야 합니다.");
assert(detectCandidates(entries({ count: 2, status: 404 })).length === 0,
  "node UA 소량 요청만으로 후보가 되면 안 됩니다.");

const bruteForce = detectCandidates(entries({ count: 5, path: "/auth/login", status: 401 }));
assert(bruteForce.some((item) => item.ruleCode === "brute_force" && !item.requiresAi),
  "로그인 실패 5회는 확정 규칙으로 탐지해야 합니다.");

// 실측(2026-09-03): 이미 로그인된 사용자가 다른 곳에서 재로그인을 시도하면
// 409(계정당 동시 로그인 1개 제한, ConflictException)가 나는데 이건
// 비밀번호가 틀린 게 아니다 — brute_force로 오탐되면 안 된다.
assert(detectCandidates(entries({ count: 20, path: "/auth/login", status: 409 })).length === 0,
  "동시 로그인 제한(409) 반복은 브루트포스로 탐지되면 안 됩니다.");

const scanEntries = Array.from({ length: 10 }, (_, index) => ({
  ...entries({ count: 1, path: `/unknown-${index}`, status: 404 })[0],
  ts: new Date(Date.parse("2026-09-02T00:00:00.000Z") + index * 200).toISOString(),
}));
assert(detectCandidates(scanEntries).some((item) => item.ruleCode === "endpoint_scan"),
  "다중 경로 404 스캔을 탐지해야 합니다.");

assert(detectCandidates(entries({ count: 120, username: "admin", gap: 100 })).some(
  (item) => item.ruleCode === "high_rate",
), "관리자 계정도 고속 대량 요청은 탐지해야 합니다.");

const distributed = Array.from({ length: 20 }, (_, index) => ({
  ...entries({ count: 1, path: "/auth/login", status: 401, ip: `10.0.0.${index % 10}` })[0],
  ts: new Date(Date.parse("2026-09-02T00:00:00.000Z") + index * 1000).toISOString(),
}));
assert(detectCandidates(distributed).some((item) => item.ruleCode === "distributed_login_attack"),
  "여러 IP에 분산된 로그인 실패를 탐지해야 합니다.");

assert(buildIpStats(entries({ count: 1 }))[0].minIntervalMs === null,
  "단일 요청 간격은 null이어야 합니다.");
console.log("security-log-detector: ok");
