import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { LandingImageRow } from "./landing-image.entity";
import { LANDING_IMAGE_SLOTS, LANDING_IMAGE_SLOT_KEYS } from "./landing-images.constants";

export interface LandingImageDto {
  key: string;
  label: string;
  recommendedSize: string;
  imageUrl: string;
  isCustom: boolean;
}

@Injectable()
export class LandingImagesService {
  constructor(
    @InjectRepository(LandingImageRow)
    private readonly repo: Repository<LandingImageRow>,
  ) {}

  /** 슬롯 정의 + DB에 저장된 커스텀 URL을 합쳐서 반환한다.
   * 관리자가 아직 안 바꾼 슬롯은 defaultUrl(barojp 원본 참고 이미지)을 그대로 보여준다. */
  async list(): Promise<LandingImageDto[]> {
    const rows = await this.repo.find();
    const byKey = new Map(rows.map((r) => [r.id, r]));
    return LANDING_IMAGE_SLOTS.map((slot) => {
      const row = byKey.get(slot.key);
      return {
        key: slot.key,
        label: slot.label,
        recommendedSize: slot.recommendedSize,
        imageUrl: row?.imageUrl || slot.defaultUrl,
        isCustom: Boolean(row?.imageUrl),
      };
    });
  }

  async update(key: string, imageUrl: string): Promise<LandingImageDto> {
    if (!LANDING_IMAGE_SLOT_KEYS.includes(key)) {
      throw new BadRequestException(`알 수 없는 이미지 슬롯입니다: ${key}`);
    }
    if (!imageUrl || !imageUrl.trim()) {
      throw new BadRequestException("이미지 URL이 필요합니다.");
    }
    let row = await this.repo.findOne({ where: { id: key } });
    if (!row) {
      row = this.repo.create({ id: key });
    }
    row.imageUrl = imageUrl.trim();
    await this.repo.save(row);

    const slot = LANDING_IMAGE_SLOTS.find((s) => s.key === key)!;
    return { key, label: slot.label, recommendedSize: slot.recommendedSize, imageUrl: row.imageUrl, isCustom: true };
  }

  /** 커스텀 이미지를 지우고 기본(barojp 참고) 이미지로 되돌린다. */
  async reset(key: string): Promise<LandingImageDto> {
    const slot = LANDING_IMAGE_SLOTS.find((s) => s.key === key);
    if (!slot) {
      throw new BadRequestException(`알 수 없는 이미지 슬롯입니다: ${key}`);
    }
    await this.repo.delete({ id: key });
    return { key, label: slot.label, recommendedSize: slot.recommendedSize, imageUrl: slot.defaultUrl, isCustom: false };
  }
}
