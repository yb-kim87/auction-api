import { randomBytes, createHash } from "crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Course } from "./entities/course.entity";
import { CourseSection } from "./entities/course-section.entity";
import { CourseVideo } from "./entities/course-video.entity";
import { LectureAccessLink } from "./entities/lecture-access-link.entity";

/** Bunny Stream 서명 재생 URL 유효시간. 짧게 잡아 URL 유출로 인한
 * 재사용 여지를 줄인다(재생 화면에서 필요할 때마다 새로 발급받음). */
const PLAY_URL_TTL_SECONDS = 6 * 60 * 60;

@Injectable()
export class LectureReplayService {
  constructor(
    @InjectRepository(Course) private readonly courseRepo: Repository<Course>,
    @InjectRepository(CourseSection) private readonly sectionRepo: Repository<CourseSection>,
    @InjectRepository(CourseVideo) private readonly videoRepo: Repository<CourseVideo>,
    @InjectRepository(LectureAccessLink)
    private readonly linkRepo: Repository<LectureAccessLink>,
  ) {}

  // ---------- 관리자: 강의 ----------

  listCourses() {
    return this.courseRepo.find({ order: { createdAt: "DESC" } });
  }

  createCourse(body: { title?: string; description?: string }) {
    const title = body.title?.trim();
    if (!title) throw new BadRequestException("강의 제목을 입력해주세요.");
    const course = this.courseRepo.create({
      title,
      description: body.description?.trim() || null,
      isPublished: false,
    });
    return this.courseRepo.save(course);
  }

  async updateCourse(
    id: string,
    body: { title?: string; description?: string; isPublished?: boolean },
  ) {
    const course = await this.courseRepo.findOne({ where: { id } });
    if (!course) throw new NotFoundException("강의를 찾을 수 없습니다.");
    if (body.title !== undefined) course.title = body.title.trim();
    if (body.description !== undefined) course.description = body.description.trim() || null;
    if (body.isPublished !== undefined) course.isPublished = body.isPublished;
    return this.courseRepo.save(course);
  }

  async deleteCourse(id: string) {
    const sections = await this.sectionRepo.find({ where: { courseId: id } });
    for (const section of sections) {
      await this.videoRepo.delete({ sectionId: section.id });
    }
    await this.sectionRepo.delete({ courseId: id });
    await this.linkRepo.delete({ courseId: id });
    await this.courseRepo.delete(id);
    return { ok: true };
  }

  // ---------- 관리자: 섹션 ----------

  listSections(courseId: string) {
    return this.sectionRepo.find({ where: { courseId }, order: { sortOrder: "ASC" } });
  }

  async createSection(courseId: string, body: { title?: string }) {
    const title = body.title?.trim();
    if (!title) throw new BadRequestException("섹션 제목을 입력해주세요.");
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    if (!course) throw new NotFoundException("강의를 찾을 수 없습니다.");
    const count = await this.sectionRepo.count({ where: { courseId } });
    const section = this.sectionRepo.create({ courseId, title, sortOrder: count });
    return this.sectionRepo.save(section);
  }

  async updateSection(id: string, body: { title?: string; sortOrder?: number }) {
    const section = await this.sectionRepo.findOne({ where: { id } });
    if (!section) throw new NotFoundException("섹션을 찾을 수 없습니다.");
    if (body.title !== undefined) section.title = body.title.trim();
    if (body.sortOrder !== undefined) section.sortOrder = body.sortOrder;
    return this.sectionRepo.save(section);
  }

  async deleteSection(id: string) {
    await this.videoRepo.delete({ sectionId: id });
    await this.sectionRepo.delete(id);
    return { ok: true };
  }

  // ---------- 관리자: 영상 ----------

  listVideos(sectionId: string) {
    return this.videoRepo.find({ where: { sectionId }, order: { sortOrder: "ASC" } });
  }

  async createVideo(
    sectionId: string,
    body: {
      title?: string;
      description?: string;
      bunnyVideoId?: string;
      durationSeconds?: number;
    },
  ) {
    const title = body.title?.trim();
    const bunnyVideoId = body.bunnyVideoId?.trim();
    if (!title) throw new BadRequestException("영상 제목을 입력해주세요.");
    if (!bunnyVideoId) throw new BadRequestException("Bunny video ID를 입력해주세요.");
    const section = await this.sectionRepo.findOne({ where: { id: sectionId } });
    if (!section) throw new NotFoundException("섹션을 찾을 수 없습니다.");
    const count = await this.videoRepo.count({ where: { sectionId } });
    const video = this.videoRepo.create({
      sectionId,
      title,
      description: body.description?.trim() || null,
      bunnyVideoId,
      durationSeconds: body.durationSeconds ?? null,
      sortOrder: count,
      isPublished: false,
    });
    return this.videoRepo.save(video);
  }

  async updateVideo(
    id: string,
    body: {
      title?: string;
      description?: string;
      bunnyVideoId?: string;
      durationSeconds?: number | null;
      sortOrder?: number;
      isPublished?: boolean;
    },
  ) {
    const video = await this.videoRepo.findOne({ where: { id } });
    if (!video) throw new NotFoundException("영상을 찾을 수 없습니다.");
    if (body.title !== undefined) video.title = body.title.trim();
    if (body.description !== undefined) video.description = body.description.trim() || null;
    if (body.bunnyVideoId !== undefined) video.bunnyVideoId = body.bunnyVideoId.trim();
    if (body.durationSeconds !== undefined) video.durationSeconds = body.durationSeconds;
    if (body.sortOrder !== undefined) video.sortOrder = body.sortOrder;
    if (body.isPublished !== undefined) video.isPublished = body.isPublished;
    return this.videoRepo.save(video);
  }

  async deleteVideo(id: string) {
    await this.videoRepo.delete(id);
    return { ok: true };
  }

  // ---------- 관리자: 접근 링크 ----------

  async listLinks(courseId?: string) {
    return this.linkRepo.find({
      where: courseId ? { courseId } : {},
      order: { createdAt: "DESC" },
    });
  }

  async createLink(body: { courseId?: string; title?: string; expiresAt?: string | null }) {
    const courseId = body.courseId?.trim();
    const title = body.title?.trim();
    if (!courseId) throw new BadRequestException("강의를 선택해주세요.");
    if (!title) throw new BadRequestException("링크 제목을 입력해주세요.");
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    if (!course) throw new NotFoundException("강의를 찾을 수 없습니다.");
    const link = this.linkRepo.create({
      token: randomBytes(16).toString("hex"),
      courseId,
      title,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      isActive: true,
    });
    return this.linkRepo.save(link);
  }

  async updateLink(id: string, body: { isActive?: boolean; expiresAt?: string | null }) {
    const link = await this.linkRepo.findOne({ where: { id } });
    if (!link) throw new NotFoundException("링크를 찾을 수 없습니다.");
    if (body.isActive !== undefined) link.isActive = body.isActive;
    if (body.expiresAt !== undefined) {
      link.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    }
    return this.linkRepo.save(link);
  }

  async deleteLink(id: string) {
    await this.linkRepo.delete(id);
    return { ok: true };
  }

  // ---------- 공개: 토큰 기반 시청 ----------

  private async resolveActiveLink(token: string): Promise<LectureAccessLink> {
    const link = await this.linkRepo.findOne({ where: { token } });
    if (!link || !link.isActive || (link.expiresAt && link.expiresAt.getTime() < Date.now())) {
      throw new NotFoundException(
        "접근할 수 없는 강의입니다. 링크가 만료되었거나 유효하지 않습니다.",
      );
    }
    return link;
  }

  async getAccessInfo(token: string) {
    const link = await this.resolveActiveLink(token);
    const course = await this.courseRepo.findOne({ where: { id: link.courseId } });
    if (!course) {
      throw new NotFoundException(
        "접근할 수 없는 강의입니다. 링크가 만료되었거나 유효하지 않습니다.",
      );
    }
    const sections = await this.sectionRepo.find({
      where: { courseId: course.id },
      order: { sortOrder: "ASC" },
    });
    const sectionsWithVideos = await Promise.all(
      sections.map(async (section) => {
        const videos = await this.videoRepo.find({
          where: { sectionId: section.id },
          order: { sortOrder: "ASC" },
        });
        return {
          id: section.id,
          title: section.title,
          videos: videos.map((v) => ({
            id: v.id,
            title: v.title,
            description: v.description,
            durationSeconds: v.durationSeconds,
            isPublished: v.isPublished,
          })),
        };
      }),
    );
    return {
      linkTitle: link.title,
      course: { id: course.id, title: course.title, description: course.description },
      sections: sectionsWithVideos,
    };
  }

  async getPlayUrl(token: string, videoId: string) {
    const link = await this.resolveActiveLink(token);
    const video = await this.videoRepo.findOne({ where: { id: videoId } });
    if (!video || video.sectionId == null) {
      throw new NotFoundException("영상을 찾을 수 없습니다.");
    }
    const section = await this.sectionRepo.findOne({ where: { id: video.sectionId } });
    if (!section || section.courseId !== link.courseId) {
      throw new NotFoundException("영상을 찾을 수 없습니다.");
    }
    if (!video.isPublished) {
      throw new BadRequestException("아직 공개되지 않은 영상입니다.");
    }
    return { embedUrl: this.buildEmbedUrl(video.bunnyVideoId) };
  }

  /** Bunny Stream 임베드 URL을 만든다. BUNNY_STREAM_TOKEN_KEY가 설정돼
   * 있으면 라이브러리의 Token Authentication 규격(SHA256(security_key +
   * video_id + expires))으로 서명해 URL 탈취/직접 공유를 어렵게 하고,
   * 없으면(라이브러리가 공개 모드인 경우) 서명 없는 기본 URL을 쓴다. */
  private buildEmbedUrl(bunnyVideoId: string): string {
    const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID?.trim();
    if (!libraryId) {
      throw new BadRequestException("BUNNY_STREAM_LIBRARY_ID 환경변수가 설정되어 있지 않습니다.");
    }
    const tokenKey = process.env.BUNNY_STREAM_TOKEN_KEY?.trim();
    const base = `https://iframe.mediadelivery.net/embed/${libraryId}/${bunnyVideoId}`;
    if (!tokenKey) {
      return `${base}?autoplay=false`;
    }
    const expires = Math.floor(Date.now() / 1000) + PLAY_URL_TTL_SECONDS;
    const token = createHash("sha256").update(`${tokenKey}${bunnyVideoId}${expires}`).digest("hex");
    return `${base}?token=${token}&expires=${expires}&autoplay=false`;
  }
}
