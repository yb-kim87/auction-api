import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  getAuthContext,
  requireAdmin,
  requireAuth,
  requireSearchAccess,
} from "../common/auth-context";
import { AiAnalysisService } from "./ai-analysis.service";
import { AiAssistantService } from "./ai-assistant.service";
import {
  CafeKnowledgeService,
  type UpdateKnowledgeDraftInput,
} from "./cafe-knowledge.service";
import { KnowledgeService, type UpsertKnowledgeInput } from "./knowledge.service";
import { KnowledgeCategoryService } from "./knowledge-category.service";
import { OpenAiService } from "./openai.service";
import type { KnowledgeDraftStatus } from "./knowledge-draft.entity";

@Controller("ai")
export class AiController {
  constructor(
    private readonly aiAnalysisService: AiAnalysisService,
    private readonly aiAssistantService: AiAssistantService,
    private readonly knowledgeService: KnowledgeService,
    private readonly knowledgeCategoryService: KnowledgeCategoryService,
    private readonly cafeKnowledgeService: CafeKnowledgeService,
    private readonly openAiService: OpenAiService,
  ) {}

  @Post("ask")
  async ask(
    @Headers() headers: Record<string, string>,
    @Body() body: { question?: string; auctionId?: string },
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    requireSearchAccess(ctx);
    return this.aiAssistantService.ask(ctx.username, body.question ?? "", body.auctionId);
  }

  @Post("compare")
  async compare(
    @Headers() headers: Record<string, string>,
    @Body() body: { auctionIdA?: string; auctionIdB?: string },
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    requireSearchAccess(ctx);
    return this.aiAssistantService.compare(body.auctionIdA ?? "", body.auctionIdB ?? "");
  }

  @Get("auctions/:auctionId/analysis")
  async getAnalysis(
    @Headers() headers: Record<string, string>,
    @Param("auctionId") auctionId: string,
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    requireSearchAccess(ctx);
    const result = await this.aiAnalysisService.getLatest(auctionId);
    if (!result) {
      throw new NotFoundException("저장된 분석 결과가 없습니다.");
    }
    return result;
  }

  @Post("auctions/:auctionId/analyze")
  async analyze(
    @Headers() headers: Record<string, string>,
    @Param("auctionId") auctionId: string,
    @Body() body: { refresh?: boolean },
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    requireSearchAccess(ctx);
    return this.aiAnalysisService.analyze(
      auctionId,
      ctx.username,
      ctx.role,
      Boolean(body?.refresh),
    );
  }

  @Get("knowledge")
  listKnowledge(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.knowledgeService.findAll();
  }

  @Post("knowledge")
  createKnowledge(
    @Headers() headers: Record<string, string>,
    @Body() body: UpsertKnowledgeInput,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.knowledgeService.create(body);
  }

  /** 관리자가 카테고리+원본 메모를 입력하면 AI가 제목/태그/내용으로 정리해
   *  반환한다(저장은 하지 않음 — 결과를 확인·수정한 뒤 POST /knowledge로
   *  직접 승인·저장). */
  @Post("knowledge/structure")
  structureKnowledge(
    @Headers() headers: Record<string, string>,
    @Body() body: { category?: string; rawText?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    if (!body.rawText?.trim()) {
      throw new BadRequestException("정리할 내용을 입력해 주세요.");
    }
    return this.openAiService.structureKnowledgeInput({
      category: body.category ?? "",
      rawText: body.rawText,
    });
  }

  /** 관리자가 입력한 전략 설명 초안을 AI가 사용자 노출 문구로 다듬어 반환한다
   *  (저장은 하지 않음 — 결과를 확인한 뒤 기존 "전략 추가/저장"으로 직접 승인). */
  @Post("strategy/refine-description")
  refineStrategyDescription(
    @Headers() headers: Record<string, string>,
    @Body() body: { label?: string; rawText?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    if (!body.rawText?.trim()) {
      throw new BadRequestException("정리할 설명을 입력해 주세요.");
    }
    return this.openAiService.refineStrategyDescription({
      label: body.label ?? "",
      rawText: body.rawText,
    });
  }

  @Patch("knowledge/:id")
  updateKnowledge(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: Partial<UpsertKnowledgeInput>,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.knowledgeService.update(id, body);
  }

  @Delete("knowledge/:id")
  removeKnowledge(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.knowledgeService.remove(id);
  }

  @Get("knowledge-categories")
  listKnowledgeCategories(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.knowledgeCategoryService.findAll();
  }

  @Post("knowledge-categories")
  createKnowledgeCategory(
    @Headers() headers: Record<string, string>,
    @Body() body: { name?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.knowledgeCategoryService.create(body.name ?? "");
  }

  @Delete("knowledge-categories/:id")
  removeKnowledgeCategory(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.knowledgeCategoryService.remove(id);
  }

  @Get("knowledge-drafts")
  listKnowledgeDrafts(
    @Headers() headers: Record<string, string>,
    @Query("status") status?: KnowledgeDraftStatus,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.cafeKnowledgeService.findAll(status);
  }

  @Get("knowledge-drafts/:id")
  getKnowledgeDraft(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.cafeKnowledgeService.findOne(id);
  }

  @Patch("knowledge-drafts/:id")
  updateKnowledgeDraft(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: UpdateKnowledgeDraftInput,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.cafeKnowledgeService.updateDraft(id, body);
  }

  @Post("knowledge-drafts/:id/structure")
  structureKnowledgeDraft(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.cafeKnowledgeService.structureDraft(id);
  }

  @Post("knowledge-drafts/structure-batch")
  structureKnowledgeDraftBatch(
    @Headers() headers: Record<string, string>,
    @Body() body: { limit?: number },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.cafeKnowledgeService.structureBatch(body?.limit ?? 20);
  }

  @Post("knowledge-drafts/:id/approve")
  approveKnowledgeDraft(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.cafeKnowledgeService.approveDraft(id);
  }

  @Post("knowledge-drafts/:id/reject")
  rejectKnowledgeDraft(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.cafeKnowledgeService.rejectDraft(id);
  }

  @Delete("knowledge-drafts/:id")
  removeKnowledgeDraft(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.cafeKnowledgeService.removeDraft(id);
  }
}
