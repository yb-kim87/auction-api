import { Body, Controller, Delete, Get, Headers, Param, Post } from "@nestjs/common";
import { RegulatedRegionService } from "./regulated-region.service";
import { getAuthContext, requireAdmin, requireAuth } from "../common/auth-context";

@Controller("regulated-regions")
export class RegulatedRegionController {
  constructor(private readonly regionService: RegulatedRegionService) {}

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
