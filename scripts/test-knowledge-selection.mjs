import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { selectKnowledgeByApplicationPolicy } = require(
  "../dist/ai/knowledge-selection.util.js",
);

const at = (day) => new Date(`2026-07-${String(day).padStart(2, "0")}T00:00:00Z`);
const rows = [
  { item: { id: "always-a", grade: 1, updatedAt: at(1) }, score: 0 },
  { item: { id: "always-b", grade: 1, updatedAt: at(2) }, score: 2 },
  { item: { id: "conditional-1", grade: 2, updatedAt: at(3) }, score: 10 },
  { item: { id: "conditional-2", grade: 2, updatedAt: at(4) }, score: 8 },
  { item: { id: "conditional-3", grade: 2, updatedAt: at(5) }, score: 6 },
  { item: { id: "conditional-over", grade: 2, updatedAt: at(6) }, score: 4 },
  { item: { id: "conditional-unmatched", grade: 2, updatedAt: at(7) }, score: 0 },
  { item: { id: "reference-1", grade: 3, updatedAt: at(8) }, score: 5 },
  { item: { id: "reference-over", grade: 3, updatedAt: at(9) }, score: 3 },
];

assert.deepEqual(
  selectKnowledgeByApplicationPolicy(rows).map((item) => item.id),
  [
    "always-b",
    "always-a",
    "conditional-1",
    "conditional-2",
    "conditional-3",
    "reference-1",
  ],
);
console.log("knowledge-selection: ok");
