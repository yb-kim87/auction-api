import { randomBytes, createHash } from "crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Course } from "./entities/course.entity";
import { CourseSection } from "./entities/course-section.entity";
import { CourseVideo } from "./entities/course-video.entity";
import { LectureAccessLink } from "./entities/lecture-access-link.entity";
import { LectureEnrollment, LectureEnrollmentStatus } from "./entities/lecture-enrollment.entity";
import { UsersService } from "../users/users.service";
import { UserRole } from "../common/constants";

/** Bunny Stream 서명 재생 URL 유효시간. 짧게 잡아 URL 유출로 인한
 * 재사용 여지를 줄인다(재생 화면에서 필요할 때마다 새로 발급받음). */
const PLAY_URL_TTL_SECONDS = 6 * 60 * 60;

/** 관리자 "90일 권한 부여" 빠른 버튼의 기본 수강 기간. */
const DEFAULT_ENROLLMENT_DAYS = 90;

@Injectable()
export class LectureReplayService {
  constructor(
    @InjectRepository(Course) private readonly courseRepo: Repository<Course>,
    @InjectRepository(CourseSection) private readonly sectionRepo: Repository<CourseSection>,
    @InjectRepository(CourseVideo) private readonly videoRepo: Repository<CourseVideo>,
    @InjectRepository(LectureAccessLink)
    private readonly linkRepo: Repository<LectureAccessLink>,
    @InjectRepository(LectureEnrollment)
    private readonly enrollmentRepo: Repository<LectureEnrollment>,
    private readonly usersService: UsersService,
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
      // 등록하면 바로 보이도록 기본 공개. 준비 안 된 강의를 숨기고
      // 싶으면 목록에서 "비공개로"를 눌러 직접 끄면 된다(2026-08-02).
      isPublished: true,
    });
    return this.courseRepo.save(course);
  }

  async updateCourse(
    id: string,
    body: { title?: string; description?: string; isPublished?: boolean; isOtCourse?: boolean },
  ) {
    const course = await this.courseRepo.findOne({ where: { id } });
    if (!course) throw new NotFoundException("강의를 찾을 수 없습니다.");
    if (body.title !== undefined) course.title = body.title.trim();
    if (body.description !== undefined) course.description = body.description.trim() || null;
    if (body.isPublished !== undefined) course.isPublished = body.isPublished;
    if (body.isOtCourse !== undefined) course.isOtCourse = body.isOtCourse;
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
      // 등록하면 바로 재생 가능하도록 기본 공개(2026-08-02, 직원이 영상
      // 등록만 하면 별도로 "공개로" 누르지 않아도 되게 해달라는 요청).
      // 준비 안 된 영상은 목록에서 "비공개"로 직접 끄면 된다.
      isPublished: true,
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

  // ---------- 공개: 토큰 기반 시청 (deprecated) ----------
  // 2026-08-02부로 회원 로그인 + 수강권(enrollment) 기반 접근으로 전환했다
  // (아래 "회원 수강권 기반 시청" 섹션 참고). 이 토큰 방식은 관리자 화면의
  // 링크 발급 UI에서는 더 이상 노출하지 않지만, 이미 공유된 링크가 있을
  // 수 있어 코드/엔드포인트/테이블은 삭제하지 않고 그대로 남겨둔다
  // (사용자 요청: "바로 삭제하지 말고 안전하게 정리").

  private async resolveActiveLink(token: string): Promise<LectureAccessLink> {
    const link = await this.linkRepo.findOne({ where: { token } });
    if (!link || !link.isActive || (link.expiresAt && link.expiresAt.getTime() < Date.now())) {
      throw new NotFoundException(
        "접근할 수 없는 강의입니다. 링크가 만료되었거나 유효하지 않습니다.",
      );
    }
    return link;
  }

  private async buildSectionsWithVideos(courseId: string) {
    const sections = await this.sectionRepo.find({
      where: { courseId },
      order: { sortOrder: "ASC" },
    });
    return Promise.all(
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
  }

  async getAccessInfo(token: string) {
    const link = await this.resolveActiveLink(token);
    const course = await this.courseRepo.findOne({ where: { id: link.courseId } });
    if (!course) {
      throw new NotFoundException(
        "접근할 수 없는 강의입니다. 링크가 만료되었거나 유효하지 않습니다.",
      );
    }
    return {
      linkTitle: link.title,
      course: { id: course.id, title: course.title, description: course.description },
      sections: await this.buildSectionsWithVideos(course.id),
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

  // ---------- 관리자: 수강권(enrollment) ----------

  async listEnrollments(courseId?: string) {
    const enrollments = await this.enrollmentRepo.find({
      where: courseId ? { courseId } : {},
      order: { createdAt: "DESC" },
    });
    return Promise.all(
      enrollments.map(async (e) => {
        const user = await this.usersService.findByUsername(e.username);
        return {
          id: e.id,
          username: e.username,
          userName: user?.name ?? null,
          userPhone: user?.phone ?? null,
          courseId: e.courseId,
          startsAt: e.startsAt,
          expiresAt: e.expiresAt,
          status: e.status,
          effectiveStatus: this.computeEffectiveStatus(e),
          createdAt: e.createdAt,
        };
      }),
    );
  }

  async grantEnrollment(body: {
    username?: string;
    courseId?: string;
    startsAt?: string;
    expiresAt?: string;
  }) {
    const username = body.username?.trim();
    const courseId = body.courseId?.trim();
    if (!username) throw new BadRequestException("회원을 선택해주세요.");
    if (!courseId) throw new BadRequestException("강의를 선택해주세요.");
    const user = await this.usersService.findByUsername(username);
    if (!user) throw new NotFoundException("회원을 찾을 수 없습니다.");
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    if (!course) throw new NotFoundException("강의를 찾을 수 없습니다.");

    const startsAt = body.startsAt ? new Date(body.startsAt) : new Date();
    const expiresAt = body.expiresAt
      ? new Date(body.expiresAt)
      : new Date(startsAt.getTime() + DEFAULT_ENROLLMENT_DAYS * 24 * 60 * 60 * 1000);

    // username+courseId unique 제약이 있으므로, 이미 있으면 갱신(중복 생성 방지).
    const existing = await this.enrollmentRepo.findOne({ where: { username, courseId } });
    if (existing) {
      existing.startsAt = startsAt;
      existing.expiresAt = expiresAt;
      existing.status = LectureEnrollmentStatus.ACTIVE;
      return this.enrollmentRepo.save(existing);
    }
    const enrollment = this.enrollmentRepo.create({
      username,
      courseId,
      startsAt,
      expiresAt,
      status: LectureEnrollmentStatus.ACTIVE,
    });
    return this.enrollmentRepo.save(enrollment);
  }

  /** 관리자 화면의 "90일 권한 부여" 빠른 버튼. */
  grantEnrollmentQuick90(body: { username?: string; courseId?: string }) {
    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + DEFAULT_ENROLLMENT_DAYS * 24 * 60 * 60 * 1000);
    return this.grantEnrollment({
      username: body.username,
      courseId: body.courseId,
      startsAt: startsAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  }

  async updateEnrollment(
    id: string,
    body: { startsAt?: string; expiresAt?: string; status?: LectureEnrollmentStatus },
  ) {
    const enrollment = await this.enrollmentRepo.findOne({ where: { id } });
    if (!enrollment) throw new NotFoundException("수강권을 찾을 수 없습니다.");
    if (body.startsAt !== undefined) enrollment.startsAt = new Date(body.startsAt);
    if (body.expiresAt !== undefined) enrollment.expiresAt = new Date(body.expiresAt);
    if (body.status !== undefined) enrollment.status = body.status;
    return this.enrollmentRepo.save(enrollment);
  }

  async revokeEnrollment(id: string) {
    const enrollment = await this.enrollmentRepo.findOne({ where: { id } });
    if (!enrollment) throw new NotFoundException("수강권을 찾을 수 없습니다.");
    enrollment.status = LectureEnrollmentStatus.REVOKED;
    return this.enrollmentRepo.save(enrollment);
  }

  /** 저장된 status가 REVOKED가 아니어도, 배치 없이 조회 시점의 날짜로
   * ACTIVE/시작전/만료를 매번 다시 계산한다(스펙: starts_at/expires_at
   * 기준 실시간 판정). REVOKED는 날짜와 무관하게 항상 우선한다. */
  private computeEffectiveStatus(
    e: LectureEnrollment,
  ): "ACTIVE" | "NOT_STARTED" | "EXPIRED" | "REVOKED" {
    if (e.status === LectureEnrollmentStatus.REVOKED) return "REVOKED";
    const now = Date.now();
    if (now < e.startsAt.getTime()) return "NOT_STARTED";
    if (now > e.expiresAt.getTime()) return "EXPIRED";
    return "ACTIVE";
  }

  // ---------- 회원: 수강권 기반 시청 ----------

  async listMyCourses(username: string) {
    const enrollments = await this.enrollmentRepo.find({
      where: { username },
      order: { createdAt: "DESC" },
    });
    const courseIds = enrollments.map((e) => e.courseId);
    const courses = courseIds.length > 0 ? await this.courseRepo.find({ where: { id: In(courseIds) } }) : [];

    const items = enrollments.map((e) => {
      const course = courses.find((c) => c.id === e.courseId);
      const now = Date.now();
      const remainingDays = Math.max(
        0,
        Math.ceil((e.expiresAt.getTime() - now) / (24 * 60 * 60 * 1000)),
      );
      return {
        enrollmentId: e.id,
        courseId: e.courseId,
        courseTitle: course?.title ?? "(삭제된 강의)",
        courseDescription: course?.description ?? null,
        startsAt: e.startsAt,
        expiresAt: e.expiresAt,
        remainingDays,
        effectiveStatus: this.computeEffectiveStatus(e),
      };
    });

    // OT수강생은 개별 수강권 없이도 "OT강의"로 지정된 공개 강의를, 관리자는
    // 모든 강의를(비공개 포함, 관리 목적) 자동으로 볼 수 있다(2026-08-02).
    // 이미 개별 수강권이 있는 강의는 중복 표시하지 않는다.
    const user = await this.usersService.findByUsername(username);
    let autoCourses: Course[] = [];
    if (user?.role === UserRole.ADMIN) {
      autoCourses = await this.courseRepo.find({ order: { createdAt: "DESC" } });
    } else if (user?.role === UserRole.OT_STUDENT) {
      autoCourses = await this.courseRepo.find({ where: { isOtCourse: true, isPublished: true } });
    }
    for (const course of autoCourses) {
      if (items.some((i) => i.courseId === course.id)) continue;
      items.unshift({
        enrollmentId: `auto-${course.id}`,
        courseId: course.id,
        courseTitle: course.title,
        courseDescription: course.description,
        startsAt: new Date(0),
        expiresAt: new Date("2999-12-31"),
        remainingDays: Number.MAX_SAFE_INTEGER,
        effectiveStatus: "ACTIVE",
      });
    }

    return items;
  }

  /** 관리자는 모든 강의(비공개 포함)를, OT수강생은 "OT강의"로 지정된
   * 공개 강의를 개별 enrollment 없이도 자동으로 볼 수 있다. */
  private async hasAutoAccess(username: string, courseId: string): Promise<boolean> {
    const user = await this.usersService.findByUsername(username);
    if (user?.role === UserRole.ADMIN) return true;
    if (user?.role !== UserRole.OT_STUDENT) return false;
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    return Boolean(course?.isOtCourse && course.isPublished);
  }

  private async requireActiveEnrollment(username: string, courseId: string) {
    if (await this.hasAutoAccess(username, courseId)) return null;

    const enrollment = await this.enrollmentRepo.findOne({ where: { username, courseId } });
    if (!enrollment) {
      throw new ForbiddenException("수강 권한이 없는 강의입니다.");
    }
    const status = this.computeEffectiveStatus(enrollment);
    if (status === "REVOKED") {
      throw new ForbiddenException("강의 접근 권한이 종료되었습니다.");
    }
    if (status === "NOT_STARTED") {
      throw new ForbiddenException("아직 수강 기간이 시작되지 않았습니다.");
    }
    if (status === "EXPIRED") {
      throw new ForbiddenException("수강 기간이 종료되었습니다.");
    }
    return enrollment;
  }

  async getMyCourseAccessInfo(username: string, courseId: string) {
    await this.requireActiveEnrollment(username, courseId);
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    const user = await this.usersService.findByUsername(username);
    if (!course || (!course.isPublished && user?.role !== UserRole.ADMIN)) {
      throw new NotFoundException("강의를 찾을 수 없습니다.");
    }
    return {
      course: { id: course.id, title: course.title, description: course.description },
      sections: await this.buildSectionsWithVideos(course.id),
    };
  }

  async getMyPlayUrl(username: string, courseId: string, videoId: string) {
    await this.requireActiveEnrollment(username, courseId);
    const video = await this.videoRepo.findOne({ where: { id: videoId } });
    if (!video || video.sectionId == null) {
      throw new NotFoundException("영상을 찾을 수 없습니다.");
    }
    const section = await this.sectionRepo.findOne({ where: { id: video.sectionId } });
    if (!section || section.courseId !== courseId) {
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
