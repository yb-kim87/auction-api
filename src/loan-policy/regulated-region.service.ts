import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { RegulatedRegion } from "./regulated-region.entity";

@Injectable()
export class RegulatedRegionService {
  constructor(
    @InjectRepository(RegulatedRegion)
    private readonly repo: Repository<RegulatedRegion>,
  ) {}

  findAll(): Promise<RegulatedRegion[]> {
    return this.repo.find({ order: { name: "ASC" } });
  }

  async add(name: string): Promise<RegulatedRegion> {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException("지역명을 입력해 주세요.");
    const existing = await this.repo.findOne({ where: { name: trimmed } });
    if (existing) return existing;
    return this.repo.save(this.repo.create({ name: trimmed }));
  }

  async remove(id: string): Promise<{ ok: boolean }> {
    const result = await this.repo.delete({ id });
    if (!result.affected) throw new NotFoundException("등록된 지역을 찾을 수 없습니다.");
    return { ok: true };
  }

  /** 물건 대량 순회 시 N+1 방지용: 지역명 목록만 미리 불러와 넘긴다. */
  async findAllNames(): Promise<string[]> {
    const regions = await this.findAll();
    return regions.map((r) => r.name);
  }
}

/** 물건의 city/district 중 하나라도 등록된 규제지역명을 포함하면 규제지역으로 판정 */
export function isRegulatedArea(city: string, district: string, regionNames: string[]): boolean {
  if (regionNames.length === 0) return false;
  return regionNames.some(
    (name) => (city && city.includes(name)) || (district && district.includes(name)),
  );
}
