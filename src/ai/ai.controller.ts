import {
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
import type { KnowledgeDraftStatus } from "./knowledge-draft.entity";

@Controller("ai")
export class AiController {
  constructor(
    private readonly aiAnalysisService: AiAnalysisService,
    private readonly aiAssistantService: AiAssistantService,
    private readonly knowledgeService: KnowledgeService,
    private readonly cafeKnowledgeService: CafeKnowledgeService,
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
