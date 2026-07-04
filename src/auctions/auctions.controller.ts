import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Headers,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Res,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { AuctionsService } from "./auctions.service";
import type { UpdateAuctionDto } from "./update-auction.dto";
import {
  getAuthContext,
  requireAdmin,
  requireConsultant,
} from "../common/auth-context";
import { AuctionStatus, UserRole } from "../common/constants";

@Controller("auctions")
export class AuctionsController {
  constructor(private readonly auctionsService: AuctionsService) {}

  @Get()
  findApproved() {
    return this.auctionsService.findApproved();
  }

  @Get("manage")
  findAllAdmin(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.auctionsService.findAllAdmin();
  }

  @Get("pending")
  findPending(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.auctionsService.findPending();
  }

  @Get("my")
  findMine(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireConsultant(ctx);
    return this.auctionsService.findBySubmitter(ctx.username);
  }

  @Get("count")
  async count(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    if (ctx.role === UserRole.ADMIN) {
      const total = await this.auctionsService.countAll();
      const pending = await this.auctionsService.countPending();
      return { total, pending };
    }
    if (ctx.role === UserRole.CONSULTANT) {
      const items = await this.auctionsService.findBySubmitter(ctx.username);
      return { total: items.length, pending: items.filter((i) => i.status === AuctionStatus.PENDING).length };
    }
    const total = await this.auctionsService.countApproved();
    return { total, pending: 0 };
  }

  @Get("template")
  downloadTemplate(@Res() res: Response) {
    const buffer = this.auctionsService.createTemplateBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="auction-template.xlsx"',
    );
    res.send(buffer);
  }

  @Post()
  createOne(
    @Headers() headers: Record<string, string>,
    @Body() body: UpdateAuctionDto,
  ) {
    const ctx = getAuthContext(headers);
    if (ctx.role === UserRole.ADMIN) {
      return this.auctionsService.createOne(body, {
        status: AuctionStatus.APPROVED,
        submittedBy: ctx.username,
      });
    }
    if (ctx.role === UserRole.CONSULTANT) {
      return this.auctionsService.createOne(body, {
        status: AuctionStatus.PENDING,
        submittedBy: ctx.username,
      });
    }
    throw new BadRequestException("등록 권한이 없습니다.");
  }

  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async upload(
    @Headers() headers: Record<string, string>,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const ctx = getAuthContext(headers);
    if (!file) {
      throw new BadRequestException("엑셀 파일을 선택해 주세요.");
    }

    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];

    if (
      !allowed.includes(file.mimetype) &&
      !file.originalname.match(/\.xlsx?$/i)
    ) {
      throw new BadRequestException("xlsx 또는 xls 파일만 업로드할 수 있습니다.");
    }

    if (ctx.role === UserRole.ADMIN) {
      return this.auctionsService.importFromExcel(file.buffer, {
        status: AuctionStatus.APPROVED,
        submittedBy: ctx.username,
      });
    }

    if (ctx.role === UserRole.CONSULTANT) {
      return this.auctionsService.importFromExcel(file.buffer, {
        status: AuctionStatus.PENDING,
        submittedBy: ctx.username,
      });
    }

    throw new BadRequestException("업로드 권한이 없습니다.");
  }

  @Post("approve-many")
  approveMany(
    @Headers() headers: Record<string, string>,
    @Body() body: { ids?: string[] },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.auctionsService.approveMany(body.ids ?? []);
  }

  @Post("reject-many")
  rejectMany(
    @Headers() headers: Record<string, string>,
    @Body() body: { ids?: string[] },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.auctionsService.rejectMany(body.ids ?? []);
  }

  @Post("delete-many")
  removeMany(
    @Headers() headers: Record<string, string>,
    @Body() body: { ids?: string[] },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.auctionsService.removeMany(body.ids ?? []);
  }

  @Patch(":id/approve")
  approveOne(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.auctionsService.approveOne(id);
  }

  @Patch(":id/reject")
  rejectOne(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.auctionsService.rejectOne(id);
  }

  @Patch("my/:id")
  updateMine(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: UpdateAuctionDto,
  ) {
    const ctx = getAuthContext(headers);
    requireConsultant(ctx);
    return this.auctionsService.updateOwnPending(id, ctx.username, body);
  }

  @Delete("my/:id")
  removeMine(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    const ctx = getAuthContext(headers);
    requireConsultant(ctx);
    return this.auctionsService.removeOwnPending(id, ctx.username);
  }

  @Get(":id/changes")
  findChanges(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.auctionsService.findChangeHistory(id);
  }

  @Patch(":id")
  updateOne(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: UpdateAuctionDto,
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.auctionsService.updateOne(id, body, ctx.username);
  }

  @Delete("all")
  removeAll(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.auctionsService.removeAll();
  }

  @Post("backfill-trading-count")
  backfillTradingCount(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.auctionsService.backfillTradingCountFromDetail(ctx.username);
  }

  @Post("backfill-naver-floor-price")
  backfillNaverFloorPrice(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.auctionsService.backfillNaverFloorPrice(ctx.username);
  }

  @Delete(":id")
  removeOne(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.auctionsService.removeOne(id);
  }
}
