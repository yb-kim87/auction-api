import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KakaoAdCreative } from "./kakao-ad-creative.entity";

@Injectable()
export class KakaoAdCreativeService {
  constructor(
    @InjectRepository(KakaoAdCreative)
    private readonly repo: Repository<KakaoAdCreative>,
  ) {}

  async findAll(): Promise<KakaoAdCreative[]> {
    return this.repo.find({ order: { createdAt: "DESC" } });
  }

  /** adName → 이미지 매핑을 한 번에 조회하기 위한 헬퍼(목록 화면에서 사용) */
  async findMapByAdNames(adNames: string[]): Promise<Record<string, KakaoAdCreative>> {
    if (adNames.length === 0) return {};
    const rows = await this.repo
      .createQueryBuilder("c")
      .where("c.adName IN (:...adNames)", { adNames })
      .getMany();
    return Object.fromEntries(rows.map((r) => [r.adName, r]));
  }

  async upsert(input: {
    adName: string;
    mediaUrl: string;
    mediaType: "image" | "video";
  }): Promise<KakaoAdCreative> {
    if (!input.adName.trim()) throw new BadRequestException("유입소재명을 입력해 주세요.");
    if (!input.mediaUrl.trim()) throw new BadRequestException("이미지/영상 URL을 입력해 주세요.");

    const existing = await this.repo.findOne({ where: { adName: input.adName } });
    if (existing) {
      existing.mediaUrl = input.mediaUrl.trim();
      existing.mediaType = input.mediaType;
      return this.repo.save(existing);
    }
    return this.repo.save(
      this.repo.create({
        adName: input.adName.trim(),
        mediaUrl: input.mediaUrl.trim(),
        mediaType: input.mediaType,
      }),
    );
  }

  async delete(id: string): Promise<{ ok: boolean }> {
    const result = await this.repo.delete({ id });
    if (!result.affected) throw new NotFoundException("등록된 소재를 찾을 수 없습니다.");
    return { ok: true };
  }
}
