import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KnowledgeCategory } from "./knowledge-category.entity";

@Injectable()
export class KnowledgeCategoryService {
  constructor(
    @InjectRepository(KnowledgeCategory)
    private readonly repo: Repository<KnowledgeCategory>,
  ) {}

  findAll(): Promise<KnowledgeCategory[]> {
    return this.repo.find({ order: { sortOrder: "ASC", createdAt: "ASC" } });
  }

  async create(name: string): Promise<KnowledgeCategory> {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException("분류명을 입력해 주세요.");
    const exists = await this.repo.findOne({ where: { name: trimmed } });
    if (exists) throw new BadRequestException("이미 존재하는 분류입니다.");
    const maxOrder = await this.repo
      .createQueryBuilder("c")
      .select("MAX(c.sortOrder)", "max")
      .getRawOne<{ max: number | null }>();
    return this.repo.save(
      this.repo.create({ name: trimmed, sortOrder: (maxOrder?.max ?? -1) + 1 }),
    );
  }

  async remove(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}
