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

  async importRawPost(input: ImportCafePostInput) {
    const sourceArticleId = input.sourceArticleId.trim();
    const rawContent = input.rawContent.trim();
    if (!sourceArticleId || !rawContent) {
      return { skipped: true as const, reason: "empty" };
    }

    const existing = await this.draftRepo.findOne({
      where: { sourceArticleId },
    });
    if (existing) {
      return { skipped: true as const, reason: "duplicate", item: existing };
    }

    const item = await this.draftRepo.save(
      this.draftRepo.create({
        sourceArticleId,
        sourceUrl: input.sourceUrl.trim(),
        sourceTitle: input.sourceTitle?.trim() ?? "",
        sourceBoard: input.sourceBoard?.trim() ?? "",
        cafeUrl: input.cafeUrl?.trim() ?? "",
        rawContent: rawContent.slice(0, 20000),
        status: "raw",
      }),
    );
    return { skipped: false as const, item };
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
