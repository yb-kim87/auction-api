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

// 실측(2026-09-03): 강의실을 활발히 쓰는 정상 회원(아이폰, 3분 동안
// 36건/14경로, 병렬 호출로 최소 간격 7ms)이 rapid_multi_path로
// 오탐됐다 — 임계값을 올린 뒤에는 후보가 아니어야 한다.
const normalActiveUser = [
  "/courses", "/courses/x", "/courses/x/questions", "/courses/x/notes",
  "/courses/x/videos/a/play", "/courses/x/videos/b/play", "/courses/x/videos/c/play",
  "/courses/x/videos/c/progress", "/users/me", "/settings",
  "/recommendations/strategy-labels", "/favorites", "/recommendations",
  "/courses/x/sections/s/materials",
].flatMap((path, pathIndex) =>
  Array.from({ length: pathIndex < 8 ? 3 : 1 }, (_, index) => ({
    ts: new Date(Date.parse("2026-09-02T00:00:00.000Z") + (pathIndex * 3 + index) * 7).toISOString(),
    ip: "1.2.3.4", method: "GET", path, username: "member1", status: 200,
    durationMs: 10, userAgent: "Mozilla/5.0 (iPhone)",
  })),
);
assert(!detectCandidates(normalActiveUser).some((item) => item.ruleCode === "rapid_multi_path"),
  "정상 회원이 여러 화면을 오간 것만으로 rapid_multi_path가 뜨면 안 됩니다.");

// 반대로 실제 경로 스캔(더 많은 종류의 경로를 빠르게 순회)은 여전히 잡혀야 한다.
const realScan = Array.from({ length: 60 }, (_, index) => ({
  ts: new Date(Date.parse("2026-09-02T00:00:00.000Z") + index * 7).toISOString(),
  ip: "9.9.9.9", method: "GET", path: `/scan-path-${index % 25}`, username: "", status: 200,
  durationMs: 5, userAgent: "python-requests",
}));
assert(detectCandidates(realScan).some((item) => item.ruleCode === "rapid_multi_path"),
  "폭넓은 경로 스캔은 rapid_multi_path로 계속 탐지해야 합니다.");

console.log("security-log-detector: ok");
