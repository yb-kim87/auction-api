import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Auction } from "../auctions/auction.entity";
import { AuctionKnowledge } from "./knowledge.entity";

export type UpsertKnowledgeInput = {
  title: string;
  category?: string;
  tags?: string;
  content: string;
  active?: boolean;
};

const TAG_CANDIDATES = [
  "대항력",
  "임차",
  "전세",
  "근저당",
  "유치권",
  "갭투자",
  "ltv",
  "명도",
  "배당",
  "법정지상권",
  "대출",
  "아파트",
  "빌라",
  "낙찰",
  "시세",
  "권리",
];

@Injectable()
export class KnowledgeService {
  constructor(
    @InjectRepository(AuctionKnowledge)
    private readonly knowledgeRepo: Repository<AuctionKnowledge>,
  ) {}

  findAll() {
    return this.knowledgeRepo.find({
      order: { updatedAt: "DESC" },
    });
  }

  async getActiveKnowledgeMaxUpdatedAt(): Promise<Date | null> {
    const row = await this.knowledgeRepo
      .createQueryBuilder("k")
      .select("MAX(k.updatedAt)", "maxUpdated")
      .where("k.active = :active", { active: true })
      .getRawOne<{ maxUpdated: string | null }>();
    if (!row?.maxUpdated) return null;
    return new Date(row.maxUpdated);
  }

  private buildSearchContext(auction: Auction) {
    const blob = [
      auction.propType,
      auction.usage,
      auction.address,
      auction.buildingRegistry,
      auction.tenantInfo,
      auction.tenantDetail,
      auction.specialNote,
      auction.priceDetail,
      auction.memo,
    ]
      .join(" ")
      .toLowerCase();

    const keywords = new Set<string>();
    if (auction.propType) keywords.add(auction.propType.toLowerCase());
    if (auction.usage) keywords.add(auction.usage.toLowerCase());

    for (const tag of TAG_CANDIDATES) {
      if (blob.includes(tag.toLowerCase())) {
        keywords.add(tag.toLowerCase());
      }
    }

    const categories = new Set<string>(["대출", "가격분석"]);
    if (
      auction.buildingRegistry?.trim() ||
      auction.tenantInfo?.trim() ||
      auction.tenantDetail?.trim() ||
      blob.includes("임차") ||
      blob.includes("대항")
    ) {
      categories.add("권리분석");
    }
    if (blob.includes("갭")) {
      categories.add("투자전략");
    }

    return { keywords: [...keywords], categories: [...categories], blob };
  }

  /** 키워드·분류 기반 RAG 검색 (embedding 전 1단계) */
  async searchForAuction(auction: Auction, limit = 5): Promise<AuctionKnowledge[]> {
    const take = Number(process.env.RAG_TOP_K ?? limit) || limit;
    const items = await this.knowledgeRepo.find({
      where: { active: true },
      order: { updatedAt: "DESC" },
    });
    if (items.length === 0) return [];

    const { keywords, categories } = this.buildSearchContext(auction);

    const scored = items
      .map((item) => {
        let score = 0;
        const cat = item.category.trim();
        const tags = item.tags.toLowerCase();
        const title = item.title.toLowerCase();
        const content = item.content.toLowerCase();

        if (cat && categories.includes(cat)) score += 4;
        for (const kw of keywords) {
          if (tags.includes(kw)) score += 3;
          if (title.includes(kw)) score += 2;
          if (content.includes(kw)) score += 1;
        }

        return { item, score };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || b.item.updatedAt.getTime() - a.item.updatedAt.getTime());

    if (scored.length > 0) {
      return scored.slice(0, take).map((row) => row.item);
    }

    // 매칭 없을 때: 분류별 대표 + 최신 순 fallback
    const fallback: AuctionKnowledge[] = [];
    for (const cat of categories) {
      const hit = items.find((i) => i.category === cat);
      if (hit && !fallback.some((f) => f.id === hit.id)) fallback.push(hit);
    }
    for (const item of items) {
      if (fallback.length >= take) break;
      if (!fallback.some((f) => f.id === item.id)) fallback.push(item);
    }
    return fallback.slice(0, take);
  }

  formatForPrompt(items: AuctionKnowledge[]): string {
    if (items.length === 0) {
      return "[내부 경매지식]\n등록된 참고 지식이 없습니다. 물건 데이터와 일반 경매 지식으로 분석하세요.";
    }

    const blocks = items.map((item, i) => {
      const header = `${i + 1}. [${item.category || "기타"}] ${item.title}`;
      const tags = item.tags ? `(태그: ${item.tags})\n` : "";
      const body = item.content.trim().slice(0, 2000);
      return `${header}\n${tags}${body}`;
    });

    return `[내부 경매지식 — 최우선 참고]
아래는 경매코치 내부 자료입니다. 분석 시 이 내용을 최우선으로 적용하세요.
물건 데이터와 충돌하면 물건 데이터를 따르고 이유를 설명하세요.

${blocks.join("\n\n---\n\n")}`;
  }

  async create(input: UpsertKnowledgeInput) {
    const title = input.title.trim();
    const content = input.content.trim();
    if (!title || !content) {
      throw new BadRequestException("제목과 내용을 입력해 주세요.");
    }
    return this.knowledgeRepo.save(
      this.knowledgeRepo.create({
        title,
        category: input.category?.trim() ?? "",
        tags: input.tags?.trim() ?? "",
        content,
        active: input.active ?? true,
      }),
    );
  }

  async update(id: string, input: Partial<UpsertKnowledgeInput>) {
    const item = await this.knowledgeRepo.findOne({ where: { id } });
    if (!item) {
      throw new NotFoundException("경매지식을 찾을 수 없습니다.");
    }

    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw new BadRequestException("제목을 입력해 주세요.");
      item.title = title;
    }
    if (input.category !== undefined) item.category = input.category.trim();
    if (input.tags !== undefined) item.tags = input.tags.trim();
    if (input.content !== undefined) {
      const content = input.content.trim();
      if (!content) throw new BadRequestException("내용을 입력해 주세요.");
      item.content = content;
    }
    if (input.active !== undefined) item.active = input.active;

    return this.knowledgeRepo.save(item);
  }

  async remove(id: string) {
    const item = await this.knowledgeRepo.findOne({ where: { id } });
    if (!item) {
      throw new NotFoundException("경매지식을 찾을 수 없습니다.");
    }
    await this.knowledgeRepo.remove(item);
    return { ok: true };
  }
}
