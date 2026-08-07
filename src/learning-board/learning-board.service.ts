import { ForbiddenException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuctionAssignment, ServiceReport } from "./learning-board.entity";

@Injectable()
export class LearningBoardService {
  constructor(@InjectRepository(AuctionAssignment) private readonly assignments: Repository<AuctionAssignment>, @InjectRepository(ServiceReport) private readonly reports: Repository<ServiceReport>) {}
  listAssignments(username: string) { return this.assignments.find({ where: { username }, order: { updatedAt: "DESC" } }); }
  createAssignment(username: string, body: Partial<AuctionAssignment>) { return this.assignments.save(this.assignments.create({ username, ...body, status: "draft" })); }
  async updateAssignment(username: string, id: string, body: Partial<AuctionAssignment>) { const row = await this.assignments.findOneBy({ id, username }); if (!row) throw new ForbiddenException("과제를 찾을 수 없습니다."); Object.assign(row, body); return this.assignments.save(row); }
  listReports(username: string) { return this.reports.find({ where: { username }, order: { createdAt: "DESC" } }); }
  createReport(username: string, body: Partial<ServiceReport>) { return this.reports.save(this.reports.create({ username, ...body, status: "received" })); }
}
