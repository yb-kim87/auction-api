import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { FieldLayout, ImagePlacement, LectureSlide } from "./lecture-slide.entity";

@Injectable()
export class LectureMaterialsService {
  constructor(
    @InjectRepository(LectureSlide)
    private readonly repo: Repository<LectureSlide>,
  ) {}

  async findByDeck(deckId: string): Promise<LectureSlide[]> {
    return this.repo.find({ where: { deckId }, order: { sortOrder: "ASC" } });
  }

  async updateSlide(
    id: string,
    input: {
      content?: Record<string, string>;
      layout?: Record<string, FieldLayout>;
      images?: ImagePlacement[];
    },
  ): Promise<LectureSlide> {
    const slide = await this.repo.findOne({ where: { id } });
    if (!slide) {
      throw new NotFoundException("해당 슬라이드를 찾을 수 없습니다.");
    }
    if (input.content) {
      slide.content = input.content;
    }
    if (input.layout) {
      slide.layout = input.layout;
    }
    if (input.images) {
      slide.images = input.images;
    }
    slide.updatedAt = new Date();
    return this.repo.save(slide);
  }
}
