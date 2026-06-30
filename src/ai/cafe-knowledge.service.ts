import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  KnowledgeDraft,
  type KnowledgeDraftStatus,
} from "./knowledge-draft.entity";
import { KnowledgeService } from "./knowledge.service";
import { OpenAiService } from "./openai.service";

export type ImportCafePostInput = {
  sourceUrl: string;
  sourceArticleId: string;
  sourceTitle?: string;
  sourceBoard?: string;
  cafeUrl?: string;
  rawContent: string;
};

export type UpdateKnowledgeDraftInput = {
  title?: string;
  category?: string;
  tags?: string;
  content?: string;
  status?: KnowledgeDraftStatus;
};

function parseArticleIdFromUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    for (const key of ["iframe_url_utf8", "iframe_url"]) {
      const nested = parsed.searchParams.get(key);
      if (nested) {
        let decoded = nested;
        for (let i = 0; i < 4; i += 1) {
          if (!decoded.includes("%")) break;
          decoded = decodeURIComponent(decoded);
        }
        const nestedId = parseArticleIdFromUrl(decoded);
        if (nestedId) return nestedId;
      }
    }
    for (const key of ["articleid", "articleId"]) {
      const value = parsed.searchParams.get(key)?.trim();
      if (value && /^\d+$/.test(value)) return value;
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1] ?? "")) {
      return parts[parts.length - 1] ?? "";
    }
  } catch {
    const match = trimmed.match(/articleid=(\d+)/i);
    if (match) return match[1];
  }
  return "";
}

function resolveCafeArticleId(sourceArticleId: string, sourceUrl: string): string {
  const fromUrl = parseArticleIdFromUrl(sourceUrl);
  const id = sourceArticleId.trim();
  if (fromUrl) return fromUrl;
  return id;
}

function normalizeSourceUrl(url: string): string {
  const trimmed = url.trim().split("#")[0].replace(/\/$/, "");
  try {
    const parsed = new URL(trimmed);
    const articleId = parseArticleIdFromUrl(trimmed);
    if (articleId) {
      return `${parsed.hostname.toLowerCase()}/article/${articleId}`;
    }
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.toLowerCase().replace(/\/$/, "")}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

@Injectable()
export class CafeKnowledgeService {
  constructor(
    @InjectRepository(KnowledgeDraft)
    private readonly draftRepo: Repository<KnowledgeDraft>,
    private readonly knowledgeService: KnowledgeService,
    private readonly openAiService: OpenAiService,
  ) {}

  findAll(status?: KnowledgeDraftStatus) {
    const where = status ? { status } : {};
    return this.draftRepo.find({
      where,
      order: { updatedAt: "DESC" },
    });
  }

  async findOne(id: string) {
    const item = await this.draftRepo.findOne({ where: { id } });
    if (!item) {
      throw new NotFoundException("카페 지식 초안을 찾을 수 없습니다.");
    }
    return item;
  }

  async getKnownCafeSources(cafeUrl?: string) {
    const items = await this.draftRepo.find({
      select: ["sourceUrl", "sourceArticleId", "cafeUrl", "status"],
    });
    const base = cafeUrl?.trim().replace(/\/$/, "") ?? "";
    const filtered = base
      ? items.filter((item) => {
          const itemCafe = item.cafeUrl.trim().replace(/\/$/, "");
          return !itemCafe || itemCafe === base || itemCafe.startsWith(base);
        })
      : items;

    const urls = [
      ...new Set(
        filtered.map((item) => item.sourceUrl.trim()).filter(Boolean),
      ),
    ];
    const articleIds = [
      ...new Set(
        filtered.map((item) => item.sourceArticleId.trim()).filter(Boolean),
      ),
    ];
    return { urls, articleIds };
  }

  async importRawPost(input: ImportCafePostInput) {
    const sourceUrl = input.sourceUrl.trim();
    const sourceArticleId = resolveCafeArticleId(
      input.sourceArticleId,
      sourceUrl,
    );
    const rawContent = input.rawContent.trim();
    if ((!sourceArticleId && !sourceUrl) || !rawContent) {
      return { skipped: true as const, reason: "empty" };
    }

    if (sourceArticleId) {
      const byId = await this.draftRepo.findOne({
        where: { sourceArticleId },
      });
      if (byId) {
        return { skipped: true as const, reason: "duplicate", item: byId };
      }
    }

    if (sourceUrl) {
      const normalized = normalizeSourceUrl(sourceUrl);
      const candidates = await this.draftRepo.find({
        select: ["id", "sourceUrl", "sourceArticleId"],
      });
      const byUrl = candidates.find(
        (row) => normalizeSourceUrl(row.sourceUrl) === normalized,
      );
      if (byUrl) {
        return {
          skipped: true as const,
          reason: "duplicate_url",
          item: byUrl,
        };
      }
    }

    const item = await this.draftRepo.save(
      this.draftRepo.create({
        sourceArticleId: sourceArticleId || normalizeSourceUrl(sourceUrl),
        sourceUrl,
        sourceTitle: input.sourceTitle?.trim() ?? "",
        sourceBoard: input.sourceBoard?.trim() ?? "",
        cafeUrl: input.cafeUrl?.trim() ?? "",
        rawContent: rawContent.slice(0, 20000),
        status: "raw",
      }),
    );
    return { skipped: false as const, item };
  }

  async importSkippedMarker(input: ImportCafePostInput & { skipReason?: string }) {
    const sourceUrl = input.sourceUrl.trim();
    const sourceArticleId = resolveCafeArticleId(
      input.sourceArticleId,
      sourceUrl,
    );
    if (!sourceArticleId && !sourceUrl) {
      return { skipped: true as const, reason: "empty" };
    }

    if (sourceArticleId) {
      const existing = await this.draftRepo.findOne({
        where: { sourceArticleId },
      });
      if (existing) {
        return { skipped: true as const, reason: "duplicate", item: existing };
      }
    }

    const item = await this.draftRepo.save(
      this.draftRepo.create({
        sourceArticleId: sourceArticleId || normalizeSourceUrl(sourceUrl),
        sourceUrl,
        sourceTitle: input.sourceTitle?.trim() ?? "",
        sourceBoard: input.sourceBoard?.trim() ?? "",
        cafeUrl: input.cafeUrl?.trim() ?? "",
        rawContent: (input.rawContent || "[prefilter-skipped]").slice(0, 500),
        status: "skipped",
        aiNote: input.skipReason?.trim() || "경매 지식과 무관한 글",
      }),
    );
    return { skipped: false as const, item, marked: true as const };
  }

  async upsertDraftFromSync(input: {
    id?: string;
    sourceArticleId: string;
    sourceUrl: string;
    sourceTitle?: string;
    sourceBoard?: string;
    cafeUrl?: string;
    rawContent?: string;
    title?: string;
    category?: string;
    tags?: string;
    content?: string;
    aiNote?: string;
    status?: KnowledgeDraftStatus;
    errorMessage?: string | null;
  }) {
    const sourceArticleId = resolveCafeArticleId(
      input.sourceArticleId,
      input.sourceUrl,
    );
    if (!sourceArticleId) {
      return { ok: false as const, reason: "empty_id" };
    }

    let item = await this.draftRepo.findOne({ where: { sourceArticleId } });
    const created = !item;
    const payload = {
      sourceArticleId,
      sourceUrl: input.sourceUrl.trim(),
      sourceTitle: input.sourceTitle?.trim() ?? "",
      sourceBoard: input.sourceBoard?.trim() ?? "",
      cafeUrl: input.cafeUrl?.trim() ?? "",
      rawContent: (input.rawContent ?? "").slice(0, 20000),
      title: input.title?.trim() ?? "",
      category: input.category?.trim() ?? "",
      tags: input.tags?.trim() ?? "",
      content: input.content?.trim() ?? "",
      aiNote: input.aiNote?.trim() ?? "",
      status: input.status ?? "structured",
      errorMessage: input.errorMessage ?? null,
    };

    if (item) {
      Object.assign(item, payload);
    } else {
      item = this.draftRepo.create(payload);
    }
    const saved = await this.draftRepo.save(item);
    return { ok: true as const, created, item: saved };
  }

  async updateDraft(id: string, input: UpdateKnowledgeDraftInput) {
    const item = await this.findOne(id);
    if (input.title !== undefined) item.title = input.title.trim();
    if (input.category !== undefined) item.category = input.category.trim();
    if (input.tags !== undefined) item.tags = input.tags.trim();
    if (input.content !== undefined) item.content = input.content.trim();
    if (input.status !== undefined) item.status = input.status;
    return this.draftRepo.save(item);
  }

  async structureDraft(id: string) {
    const item = await this.findOne(id);
    if (item.status === "approved") {
      throw new BadRequestException("이미 승인된 초안입니다.");
    }

    try {
      const result = await this.openAiService.structureCafePost({
        sourceTitle: item.sourceTitle,
        sourceBoard: item.sourceBoard,
        rawContent: item.rawContent,
      });

      if (result.skip) {
        item.status = "skipped";
        item.aiNote = result.skipReason ?? "경매지식으로 적합하지 않음";
        item.errorMessage = null;
        return this.draftRepo.save(item);
      }

      item.title = result.title;
      item.category = result.category;
      item.tags = result.tags;
      item.content = result.content;
      item.aiNote = result.note;
      item.status = "structured";
      item.errorMessage = null;
      return this.draftRepo.save(item);
    } catch (error) {
      item.errorMessage =
        error instanceof Error ? error.message : "AI 정리 실패";
      return this.draftRepo.save(item);
    }
  }

  async structureBatch(limit = 20) {
    const items = await this.draftRepo.find({
      where: { status: "raw" },
      order: { createdAt: "ASC" },
      take: Math.min(Math.max(limit, 1), 50),
    });

    let structured = 0;
    let skipped = 0;
    let failed = 0;

    for (const item of items) {
      const before = item.status;
      const saved = await this.structureDraft(item.id);
      if (saved.status === "structured") structured += 1;
      else if (saved.status === "skipped") skipped += 1;
      else if (saved.status === before && saved.errorMessage) failed += 1;
    }

    return { total: items.length, structured, skipped, failed };
  }

  async approveDraft(id: string) {
    const item = await this.findOne(id);
    if (item.status === "approved") {
      throw new BadRequestException("이미 승인된 초안입니다.");
    }

    const title = item.title.trim() || item.sourceTitle.trim();
    const content = item.content.trim() || item.rawContent.trim();
    if (!title || !content) {
      throw new BadRequestException(
        "제목과 내용이 비어 있습니다. AI 정리 또는 수동 편집 후 승인해 주세요.",
      );
    }

    const tags = [
      item.tags.trim(),
      item.sourceBoard.trim(),
      "네이버카페",
    ]
      .filter(Boolean)
      .join(",");

    const knowledge = await this.knowledgeService.create({
      title,
      category: item.category.trim() || "기타",
      tags,
      content,
      active: true,
    });

    item.status = "approved";
    item.errorMessage = null;
    await this.draftRepo.save(item);
    return { draft: item, knowledge };
  }

  async rejectDraft(id: string) {
    const item = await this.findOne(id);
    item.status = "rejected";
    return this.draftRepo.save(item);
  }

  async removeDraft(id: string) {
    const item = await this.findOne(id);
    await this.draftRepo.remove(item);
    return { ok: true };
  }
}
