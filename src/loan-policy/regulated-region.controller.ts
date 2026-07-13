import { Body, Controller, Delete, Get, Headers, Param, Post } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { RegulatedRegionService } from "./regulated-region.service";
import { getAuthContext, requireAdmin, requireAuth } from "../common/auth-context";

@Controller("regulated-regions")
export class RegulatedRegionController {
  constructor(
    private readonly regionService: RegulatedRegionService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** TEMP: 마이그레이션 실행 여부 진단용. 확인 후 제거 예정. */
  @Get("migration-debug")
  async migrationDebug(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    const migrations = await this.dataSource.query(
      `SELECT name, timestamp FROM migrations ORDER BY timestamp DESC LIMIT 10`,
    );
    const tableExists = await this.dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'regulated_regions') AS exists`,
    );
    return { migrations, regulatedRegionsTableExists: tableExists[0]?.exists };
  }

  @Get()
  async findAll(@Headers() headers: Record<string, string>) {
    requireAuth(getAuthContext(headers));
    return this.regionService.findAll();
  }

  @Post()
  async add(
    @Headers() headers: Record<string, string>,
    @Body() body: { name?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.regionService.add(body.name ?? "");
  }

  @Delete(":id")
  async remove(@Headers() headers: Record<string, string>, @Param("id") id: string) {
    requireAdmin(getAuthContext(headers));
    return this.regionService.remove(id);
  }
}
