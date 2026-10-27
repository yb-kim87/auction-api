const assert = require('node:assert/strict');
const { ZoneBlogService, extractZoneInsights } = require('../src/redevelopment-research/zone-blog.service');

async function main() {
  const sample = ['독산1구역', '사업시행자 지정 완료', '독산2구역', '조합설립인가 완료', '독산10구역 사업시행인가', '독산1·2·3·4구역 분담금 비교', '독산1구역 일반분양 866세대'];
  assert.deepEqual(extractZoneInsights(sample, '독산1'), ['사업시행자 지정 완료', '독산1구역 일반분양 866세대']);
  const notes = [];
  const repo = {
    find: async ({ where }) => notes.filter((n) => Object.entries(where).every(([key, value]) => n[key] === value)),
    create: (v) => ({ id: String(Math.random()), ...v }),
    delete: async (where) => { for (let i = notes.length - 1; i >= 0; i--) if (Object.entries(where).every(([k, v]) => notes[i][k] === v)) notes.splice(i, 1); },
    save: async (value) => { for (const n of Array.isArray(value) ? value : [value]) notes.push(n); return value; },
  };
  let run = { zoneId: 'z', blogFetchedAt: null };
  const runRepo = { findOne: async () => run, save: async (v) => (run = v), create: (v) => v };
  const service = new ZoneBlogService(repo, runRepo, {});
  service.searchPosts = async () => [{ logNo: '1', title: '독산1구역 사업' }, { logNo: '2', title: '독산1 관련' }];
  service.openPost = async (_blog, no) => { if (no === '2') throw Error('실패'); return { title: '독산1구역 사업', postedAt: '2026-10-26', lines: sample }; };
  await service.refreshZone({ id: 'z', name: '독산1' });
  const info = await service.getZoneBlogInfo('z');
  assert.equal(info.consent, null);
  assert.equal(info.articles.length, 1);
  assert.deepEqual(info.insights.map((x) => x.text), ['사업시행자 지정 완료', '독산1구역 일반분양 866세대']);
  assert.deepEqual(info.diagnostics, { searched: 2, attempted: 2, opened: 1, failed: 1, consent: 0, timeline: 0 });
  console.log('구역별 문맥, 동의율 없는 글 저장, 중복 검색, 글 읽기 실패 표시: 통과');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
