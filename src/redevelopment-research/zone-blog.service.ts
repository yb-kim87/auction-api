import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { RedevelopmentZone } from "../redevelopment/entities/redevelopment-zone.entity";
import { BlogNoteKind, RedevelopmentZoneBlogNote } from "./entities/redevelopment-zone-blog-note.entity";
import { RedevelopmentResearchRun } from "./entities/redevelopment-research-run.entity";
import { NaverLandService } from "./naver-land.service";

/** 구역 조사 때 함께 조사하는 재개발 블로그(사용자 지정, 2026-10-25). 블로그 안 검색 → 상위 글 몇 개만 열어 동의율·공문 타임라인을 뽑는다.
 * 호출은 네이버 부동산 조사와 같은 직렬 큐·랜덤 간격을 거치고, 한 번에 검색 1회 + 글 최대 MAX_POSTS개만 연다. */
const BLOGS = [{ blogId: "hoonihooon_", label: "재개발 전문가 후니동산" }];
const MAX_POSTS = 5;
const MAX_TIMELINE_PER_POST = 20;

export type ZoneBlogNote = {
  id: string;
  blogId: string;
  logNo: string;
  postTitle: string;
  postedAt: string;
  url: string;
  kind: BlogNoteKind;
  text: string;
  yesPct: number | null;
  noPct: number | null;
  qualifier: string | null;
  docDate: string | null;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** 블로그 글 HTML(se-main-container)을 줄 단위 텍스트로. */
export function blogHtmlToLines(html: string): string[] {
  const i = html.indexOf("se-main-container");
  const body = i >= 0 ? html.slice(i) : html;
  const text = decodeEntities(
    body
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<\/(p|div|tr|td|th|li|h\d)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
  return text
    .split(/\n+/)
    .map((l) => l.replace(/[​ ]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** 구역 이름 → 글에서 찾을 키(예: "(가)대림동 680" → 동 "대림동", 번지 "680"). 번지가 없으면 이름 자체. */
export function zoneBlogKeys(name: string): { dong: string | null; bun: string | null; plain: string } {
  const plain = name.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  const m = /([가-힣]+동)\s*(\d+(?:-\d+)?)/.exec(name.replace(/\([^)]*\)/g, " "));
  return { dong: m ? m[1] : null, bun: m ? m[2] : null, plain };
}

function lineMentionsZone(line: string, keys: ReturnType<typeof zoneBlogKeys>): boolean {
  const compact = line.replace(/\s+/g, "");
  if (keys.dong && keys.bun) {
    if (compact.includes(`${keys.dong}${keys.bun}`)) return true;
    // "대림동 868일대, 680일대"처럼 번지만 따로 적힌 경우 — 같은 줄에 동 이름이 있어야 인정.
    const re = new RegExp(`(?<![\\d-])${keys.bun.replace(/-/g, "\\-")}(?:번지|일대|[,)\\s]|$)`);
    return compact.includes(keys.dong) && re.test(line.replace(/\s+/g, ""));
  }
  return keys.plain.length >= 3 && compact.includes(keys.plain.replace(/\s+/g, ""));
}

function parseConsent(line: string): { yes: number | null; no: number | null; qualifier: string | null } | null {
  const yes = /(?:찬성률?|동의율?)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%\s*(이상|이하|추정|내외)?/.exec(line);
  const no = /반대(?:율|동의)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%\s*(이상|이하|추정|내외)?/.exec(line);
  if (!yes && !no) return null;
  return {
    yes: yes ? Number(yes[1]) : null,
    no: no ? Number(no[1]) : null,
    qualifier: (yes?.[2] ?? no?.[2]) || null,
  };
}

function normalizeDocDate(md: string, postedAt: string): string | null {
  const m = /^(\d{1,2})월\s*(\d{1,2})일$/.exec(md.trim());
  if (!m) return null;
  const [py, pm] = postedAt.split("-").map(Number);
  const month = Number(m[1]);
  const year = month > pm ? py - 1 : py;
  return `${year}-${String(month).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
}

@Injectable()
export class ZoneBlogService {
  private readonly logger = new Logger(ZoneBlogService.name);

  constructor(
    @InjectRepository(RedevelopmentZoneBlogNote) private readonly noteRepo: Repository<RedevelopmentZoneBlogNote>,
    @InjectRepository(RedevelopmentResearchRun) private readonly runRepo: Repository<RedevelopmentResearchRun>,
    private readonly naver: NaverLandService,
  ) {}

  /** 블로그 검색 결과의 (글번호, 제목) — 관련도순. */
  private async searchPosts(blogId: string, query: string): Promise<Array<{ logNo: string; title: string }>> {
    const url = `https://m.blog.naver.com/PostSearchList.naver?blogId=${blogId}&orderBy=sim&searchText=${encodeURIComponent(query)}`;
    const html = await this.naver.getText(url, `https://m.blog.naver.com/${blogId}`);
    const out: Array<{ logNo: string; title: string }> = [];
    const seen = new Set<string>();
    const re = /<a href="https:\/\/m\.blog\.naver\.com\/PostView\.naver\?blogId=[^&"]+&amp;logNo=(\d+)[^"]*" class="title__[^"]*"[^>]*><span class="ell\d"><span>([\s\S]*?)<\/span><\/span><\/a>/g;
    for (const m of html.matchAll(re)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ logNo: m[1], title: decodeEntities(m[2].replace(/<[^>]+>/g, "")).trim() });
    }
    return out;
  }

  /** 글 한 개 열기 → 제목·작성일·본문 줄. */
  private async openPost(blogId: string, logNo: string): Promise<{ title: string; postedAt: string; lines: string[] } | null> {
    const html = await this.naver.getText(`https://m.blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}`, `https://m.blog.naver.com/${blogId}`);
    const title = decodeEntities(/<meta property="og:title" content="([^"]*)"/.exec(html)?.[1] ?? "").trim();
    const d = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*\d{1,2}:\d{2}/.exec(html);
    if (!d) return null;
    const postedAt = `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`;
    return { title, postedAt, lines: blogHtmlToLines(html) };
  }

  /** 구역에 대해 블로그를 조사해 저장한다. 실패해도 구역 조사 전체를 막지 않도록 호출한 쪽이 try/catch 한다. */
  async refreshZone(zone: Pick<RedevelopmentZone, "id" | "name">): Promise<{ posts: number; consent: number; timeline: number }> {
    const keys = zoneBlogKeys(zone.name);
    const query = keys.dong && keys.bun ? `${keys.dong} ${keys.bun}` : keys.plain;
    let posts = 0;
    let consent = 0;
    let timeline = 0;
    for (const blog of BLOGS) {
      const found = (await this.searchPosts(blog.blogId, query)).slice(0, MAX_POSTS);
      for (const p of found) {
        const post = await this.openPost(blog.blogId, p.logNo);
        if (!post) continue;
        const rows: Array<Partial<RedevelopmentZoneBlogNote>> = [];
        const { lines } = post;
        const url = `https://blog.naver.com/${blog.blogId}/${p.logNo}`;
        for (let i = 0; i < lines.length; i++) {
          if (!lineMentionsZone(lines[i], keys)) continue;
          // 동의율: 같은 줄, 없으면 바로 다음 줄까지 본다(표가 줄로 쪼개진 경우).
          const c = parseConsent(lines[i]) ?? (i + 1 < lines.length && !lineMentionsZone(lines[i + 1], keys) ? parseConsent(lines[i + 1]) : null);
          if (c) {
            rows.push({ kind: "consent", text: lines[i].slice(0, 300), yesPct: c.yes, noPct: c.no, qualifier: c.qualifier });
            continue;
          }
          // 자치구 공문 타임라인: 공문 제목 줄 바로 다음 줄이 "07월 27일" 형태.
          const next = lines[i + 1] ?? "";
          const docDate = normalizeDocDate(next, post.postedAt);
          if (docDate && lines[i].length <= 200) {
            rows.push({ kind: "timeline", text: lines[i], docDate, yesPct: null, noPct: null, qualifier: null });
          }
        }
        // 글 하나에서 공문 타임라인이 너무 길면 최신 일자부터 일부만 남긴다.
        const tl = rows.filter((r) => r.kind === "timeline").sort((a, b) => (b.docDate ?? "").localeCompare(a.docDate ?? ""));
        const keep = [...rows.filter((r) => r.kind === "consent"), ...tl.slice(0, MAX_TIMELINE_PER_POST)];
        await this.noteRepo.delete({ zoneId: zone.id, blogId: blog.blogId, logNo: p.logNo });
        posts += 1;
        if (!keep.length) continue;
        const now = new Date();
        await this.noteRepo.save(
          keep.map((r) =>
            this.noteRepo.create({
              zoneId: zone.id,
              blogId: blog.blogId,
              logNo: p.logNo,
              postTitle: post.title || p.title,
              postedAt: post.postedAt,
              url,
              kind: r.kind as BlogNoteKind,
              text: r.text as string,
              yesPct: r.yesPct ?? null,
              noPct: r.noPct ?? null,
              qualifier: r.qualifier ?? null,
              docDate: r.docDate ?? null,
              fetchedAt: now,
            }),
          ),
        );
        consent += keep.filter((r) => r.kind === "consent").length;
        timeline += keep.filter((r) => r.kind === "timeline").length;
      }
    }
    const run = await this.runRepo.findOne({ where: { zoneId: zone.id } });
    if (run) {
      run.blogFetchedAt = new Date();
      await this.runRepo.save(run);
    } else {
      await this.runRepo.save(
        this.runRepo.create({ zoneId: zone.id, status: "idle", phase: "", error: null, naverFetched: 0, naverSaved: 0, naverDetailDone: 0, naverDetailRemaining: 0, tradesFetched: 0, tradesSaved: 0, startedAt: null, finishedAt: null, blogFetchedAt: new Date(), updatedAt: new Date() }),
      );
    }
    this.logger.log(`블로그 조사(${zone.name}): 글 ${posts}개, 동의율 ${consent}건, 공문 ${timeline}건`);
    return { posts, consent, timeline };
  }

  /** 목록용 동의율을 한 번에 읽는다. 구역 팝업과 같이 글 작성일 최신순이다. */
  async listConsentSummaries() {
    const rows = await this.noteRepo.find({ where: { kind: "consent" } });
    rows.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
    const latest = new Map<string, { zoneId: string; yesPct: number | null; noPct: number | null; qualifier: string | null; postedAt: string }>();
    for (const row of rows) {
      if (!latest.has(row.zoneId)) latest.set(row.zoneId, { zoneId: row.zoneId, yesPct: row.yesPct, noPct: row.noPct, qualifier: row.qualifier, postedAt: row.postedAt });
    }
    return [...latest.values()];
  }

  /** 구역의 블로그 정보 — 동의율은 글 작성일이 최신인 것을 대표로, 나머지는 이력으로. 공문은 최신 일자순. */
  async getZoneBlogInfo(zoneId: string): Promise<{
    fetchedAt: string | null;
    consent: ZoneBlogNote | null;
    consentHistory: ZoneBlogNote[];
    timeline: ZoneBlogNote[];
  }> {
    const rows = await this.noteRepo.find({ where: { zoneId } });
    const run = await this.runRepo.findOne({ where: { zoneId } });
    const toNote = (r: RedevelopmentZoneBlogNote): ZoneBlogNote => ({
      id: r.id, blogId: r.blogId, logNo: r.logNo, postTitle: r.postTitle, postedAt: r.postedAt, url: r.url, kind: r.kind,
      text: r.text, yesPct: r.yesPct, noPct: r.noPct, qualifier: r.qualifier, docDate: r.docDate,
    });
    const consents = rows.filter((r) => r.kind === "consent").sort((a, b) => b.postedAt.localeCompare(a.postedAt)).map(toNote);
    // 같은 공문(제목·일자)은 최신 글 것만.
    const seen = new Set<string>();
    const timeline = rows
      .filter((r) => r.kind === "timeline")
      .sort((a, b) => (b.docDate ?? "").localeCompare(a.docDate ?? "") || b.postedAt.localeCompare(a.postedAt))
      .filter((r) => {
        const k = `${r.docDate}|${r.text.replace(/\s+/g, "")}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map(toNote);
    return {
      fetchedAt: run?.blogFetchedAt ? run.blogFetchedAt.toISOString() : null,
      consent: consents[0] ?? null,
      consentHistory: consents.slice(1),
      timeline,
    };
  }
}
