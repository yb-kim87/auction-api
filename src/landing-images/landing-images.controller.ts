import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { extname, join } from "path";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { LandingImagesService } from "./landing-images.service";

/** 업로드된 강의실 메인 이미지를 Next.js 프론트의 public 폴더에 직접 써서
 * 정적 서빙되게 한다(lecture-materials 업로드와 동일한 방식). */
const UPLOAD_DIR = join(__dirname, "..", "..", "..", "auction", "public", "landing-images", "uploads");
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"];

@Controller("landing-images")
export class LandingImagesController {
  constructor(private readonly service: LandingImagesService) {}

  /** 조회는 비로그인 상태에서도 가능해야 한다 — /courses 소개 페이지는
   * 로그인 미들웨어를 타지만, 이 API 자체는 공개 소개용 이미지라서
   * 별도 인증을 요구하지 않는다. */
  @Get()
  async list() {
    return this.service.list();
  }

  @Post(":key")
  async update(
    @Headers() headers: Record<string, string>,
    @Param("key") key: string,
    @Body() body: { imageUrl?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    if (!body.imageUrl) {
      throw new BadRequestException("imageUrl이 필요합니다.");
    }
    return this.service.update(key, body.imageUrl);
  }

  @Delete(":key")
  async reset(@Headers() headers: Record<string, string>, @Param("key") key: string) {
    requireAdmin(getAuthContext(headers));
    return this.service.reset(key);
  }

  @Post("upload-image")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadImage(@Headers() headers: Record<string, string>, @UploadedFile() file: Express.Multer.File) {
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

    return { url: `/landing-images/uploads/${filename}` };
  }
}
