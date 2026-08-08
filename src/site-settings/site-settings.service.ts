import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AppSettingsRow } from "./site-settings.entity";

const STATE_ID = "singleton";

@Injectable()
export class SiteSettingsService {
  constructor(
    @InjectRepository(AppSettingsRow)
    private readonly repo: Repository<AppSettingsRow>,
  ) {}

  async get(): Promise<AppSettingsRow> {
    let row = await this.repo.findOne({ where: { id: STATE_ID } });
    if (!row) {
      row = this.repo.create({ id: STATE_ID });
      row = await this.repo.save(row);
    }
    return row;
  }

  async update(patch: Partial<Pick<AppSettingsRow, "hideRegistryTenantForStudents">>): Promise<AppSettingsRow> {
    const row = await this.get();
    Object.assign(row, patch);
    return this.repo.save(row);
  }
}
