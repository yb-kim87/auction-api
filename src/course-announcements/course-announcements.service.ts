import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CourseAnnouncementRow } from "./course-announcement.entity";

@Injectable()
export class CourseAnnouncementsService {
  constructor(
    @InjectRepository(CourseAnnouncementRow)
    private readonly repo: Repository<CourseAnnouncementRow>,
  ) {}

  async list(): Promise<CourseAnnouncementRow[]> {
    return this.repo.find({ order: { createdAt: "DESC" } });
  }

  async create(title: string, body: string): Promise<CourseAnnouncementRow> {
    if (!title.trim() || !body.trim()) {
      throw new BadRequestException("제목과 내용을 모두 입력해 주세요.");
    }
    return this.repo.save(this.repo.create({ title: title.trim(), body: body.trim() }));
  }

  async update(id: string, title: string, body: string): Promise<CourseAnnouncementRow> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException("공지사항을 찾을 수 없습니다.");
    if (!title.trim() || !body.trim()) {
      throw new BadRequestException("제목과 내용을 모두 입력해 주세요.");
    }
    row.title = title.trim();
    row.body = body.trim();
    return this.repo.save(row);
  }

  async remove(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}
