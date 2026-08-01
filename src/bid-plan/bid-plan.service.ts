import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuctionBidPlan } from "./bid-plan.entity";
import { Auction } from "../auctions/auction.entity";

export interface SaveBidPlanInput {
  bidPrice: number;
  salePrice: number;
  finalProfit: number | null;
  requiredEquity: number | null;
  memo: string;
  inputs: Record<string, unknown>;
}

@Injectable()
export class BidPlanService {
  constructor(
    @InjectRepository(AuctionBidPlan)
    private readonly repo: Repository<AuctionBidPlan>,
    @InjectRepository(Auction)
    private readonly auctionRepo: Repository<Auction>,
  ) {}

  async save(username: string, auctionId: string, input: SaveBidPlanInput): Promise<AuctionBidPlan> {
    const existing = await this.repo.findOne({ where: { username, auctionId } });
    const plan =
      existing ??
      this.repo.create({
        username,
        auctionId,
      });
    plan.bidPrice = input.bidPrice;
    plan.salePrice = input.salePrice;
    plan.finalProfit = input.finalProfit;
    plan.requiredEquity = input.requiredEquity;
    plan.memo = input.memo.trim();
    plan.inputsJson = JSON.stringify(input.inputs ?? {});
    return this.repo.save(plan);
  }

  async findOne(username: string, auctionId: string): Promise<AuctionBidPlan | null> {
    return this.repo.findOne({ where: { username, auctionId } });
  }

  async remove(username: string, auctionId: string): Promise<{ ok: true }> {
    await this.repo.delete({ username, auctionId });
    return { ok: true };
  }

  /** 목록 화면용 — 물건 요약 정보(주소/사건번호/상태)를 함께 붙여 반환한다. */
  async findMine(username: string) {
    const plans = await this.repo.find({ where: { username }, order: { updatedAt: "DESC" } });
    if (plans.length === 0) return [];
    const auctionIds = plans.map((p) => p.auctionId);
    const auctions = await this.auctionRepo.find({
      where: auctionIds.map((id) => ({ id })),
    });
    const auctionById = new Map(auctions.map((a) => [a.id, a]));
    return plans.map((plan) => {
      const auction = auctionById.get(plan.auctionId);
      return {
        ...plan,
        auction: auction
          ? {
              id: auction.id,
              address: auction.address,
              auctionNo: auction.auctionNo,
              court: auction.court,
              status: auction.status,
              bidDate: auction.bidDate,
            }
          : null,
      };
    });
  }
}
