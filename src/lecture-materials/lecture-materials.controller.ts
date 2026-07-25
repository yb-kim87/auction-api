import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  Headers,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { extname, join } from "path";
import { LectureMaterialsService } from "./lecture-materials.service";
import { FieldLayout, ImagePlacement } from "./lecture-slide.entity";
import { getAuthContext, requireAdmin } from "../common/auth-context";

/** 업로드된 이미지를 Next.js 프론트의 public 폴더에 직접 써서, 기존 슬라이드
 *  이미지들(/lecture-materials/*.png)과 동일한 방식으로 정적 서빙되게 한다. */
const UPLOAD_DIR = join(__dirname, "..", "..", "..", "auction", "public", "lecture-materials", "uploads");
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"];

@Controller("lecture-materials")
export class LectureMaterialsController {
  constructor(private readonly service: LectureMaterialsService) {}

  @Get("slides")
  async findByDeck(
    @Headers() headers: Record<string, string>,
    @Query("deckId") deckId: string,
  ) {
    requireAdmin(getAuthContext(headers));
    if (!deckId) {
      throw new BadRequestException("deckId 쿼리 파라미터가 필요합니다.");
    }
    return this.service.findByDeck(deckId);
  }

  @Patch("slides/:id")
  async updateSlide(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body()
    body: {
      content?: Record<string, string>;
      layout?: Record<string, FieldLayout>;
      images?: ImagePlacement[];
    },
  ) {
    requireAdmin(getAuthContext(headers));
    if (!body.content && !body.layout && !body.images) {
      throw new BadRequestException("content, layout, images 중 하나는 필요합니다.");
    }
    return this.service.updateSlide(id, body);
  }

  @Post("upload-image")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadImage(
    @Headers() headers: Record<string, string>,
    @UploadedFile() file: Express.Multer.File,
  ) {
    requireAdmin(getAuthContext(headers));
    if (!file) {
      throw new BadRequestException("이미지 파일을 선택해 주세요.");
    }
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      throw new BadRequestException("png, jpg, webp, gif 이미지만 업로드할 수 있습니다.");
    }

    if (!existsSync(UPLOAD_DIR)) {
      mkdirSync(UPLOAD_DIR, { recursive: true });
    }
    const filename = `${randomUUID()}${extname(file.originalname) || ".png"}`;
    writeFileSync(join(UPLOAD_DIR, filename), file.buffer);

    return { url: `/lecture-materials/uploads/${filename}` };
  }
}
