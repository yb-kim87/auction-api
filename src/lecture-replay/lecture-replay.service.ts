import { randomBytes, createHash } from "crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Course } from "./entities/course.entity";
import { CourseSection } from "./entities/course-section.entity";
import { CourseVideo } from "./entities/course-video.entity";
import { LectureAccessLink } from "./entities/lecture-access-link.entity";
import { LectureEnrollment, LectureEnrollmentStatus } from "./entities/lecture-enrollment.entity";
import { LectureProgress } from "./entities/lecture-progress.entity";
import { LectureQuestion } from "./entities/lecture-question.entity";
import { LectureNote } from "./entities/lecture-note.entity";
import { LectureSectionMaterial } from "./entities/lecture-section-material.entity";
import { UsersService } from "../users/users.service";
import { UserRole } from "../common/constants";

/** Bunny Stream 서명 재생 URL 유효시간. 짧게 잡아 URL 유출로 인한
 * 재사용 여지를 줄인다(재생 화면에서 필요할 때마다 새로 발급받음). */
const PLAY_URL_TTL_SECONDS = 6 * 60 * 60;

/** 관리자 "90일 권한 부여" 빠른 버튼의 기본 수강 기간. */
const DEFAULT_ENROLLMENT_DAYS = 90;

/** OT 강의는 신규 OT수강생뿐 아니라 기존 유료 수강생에게도 공통 제공한다.
 * 일반 회원(member)에게는 자동 공개하지 않고, 일반 강의는 계속 개별
 * 수강권이 있어야 시청할 수 있다. */
function canAccessOtContent(role: UserRole | undefined): boolean {
  return role === UserRole.OT_STUDENT ||
    role === UserRole.STUDENT ||
    role === UserRole.CONSULTING_STUDENT;
}

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
    @InjectRepository(LectureProgress)
    private readonly progressRepo: Repository<LectureProgress>,
    @InjectRepository(LectureQuestion)
    private readonly questionRepo: Repository<LectureQuestion>,
    @InjectRepository(LectureNote)
    private readonly noteRepo: Repository<LectureNote>,
    @InjectRepository(LectureSectionMaterial)
    private readonly materialRepo: Repository<LectureSectionMaterial>,
    private readonly usersService: UsersService,
  ) {}

  // ---------- 관리자: 강의자료(주차별 파일) ----------

  private readonly materialListSelect = [
    "id",
    "sectionId",
    "title",
    "url",
    "sortOrder",
    "createdAt",
    "updatedAt",
  ] as const;

  listMaterials(sectionId: string) {
    return this.materialRepo.find({
      where: { sectionId },
      order: { sortOrder: "ASC", createdAt: "ASC" },
      select: [...this.materialListSelect],
    });
  }

  async createMaterial(sectionId: string, input: { title: string; url: string }) {
    const section = await this.sectionRepo.findOne({ where: { id: sectionId } });
    if (!section) throw new NotFoundException("강의 주차(섹션)를 찾을 수 없습니다.");
    const url = input.url.trim();
    if (!url) throw new NotFoundException("링크를 입력해주세요.");
    const row = this.materialRepo.create({
      sectionId,
      title: input.title.trim() || url,
      url,
    });
    return this.materialRepo.save(row);
  }

  async deleteMaterial(id: string) {
    await this.materialRepo.delete(id);
    return { ok: true };
  }

  // ---------- 회원: 강의자료 열람 ----------

  /** courseId의 이 회원 접근 권한을 확인한 뒤(getAccessMode와 동일한
   * 검증), sectionId가 실제로 그 강의에 속하는지까지 확인한다. */
  private async assertSectionBelongsToCourse(sectionId: string, courseId: string): Promise<CourseSection> {
    const section = await this.sectionRepo.findOne({ where: { id: sectionId } });
    if (!section || section.courseId !== courseId) {
      throw new NotFoundException("강의 주차(섹션)를 찾을 수 없습니다.");
    }
    return section;
  }

  async listMyMaterials(username: string, courseId: string, sectionId: string) {
    await this.getAccessMode(username, courseId);
    await this.assertSectionBelongsToCourse(sectionId, courseId);
    return this.listMaterials(sectionId);
  }

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
      // 등록 직후엔 기본 비공개. 준비가 끝나면 목록에서 "공개로"를
      // 눌러 직접 켜야 수강생에게 보인다(사용자 요청, 2026-08-02 재변경).
      isPublished: false,
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

  /** Bunny Stream Video API로 영상의 실제 재생시간(초)을 조회한다.
   * BUNNY_STREAM_API_KEY가 없거나 API 호출이 실패하면 null을 반환하고
   * 조용히 넘어간다 — 관리자가 직접 입력한 값이 있으면 그걸 쓰고,
   * 없으면 화면에 "-"로 표시될 뿐 영상 등록 자체를 막지 않는다. */
  private async fetchBunnyVideoDurationSeconds(bunnyVideoId: string): Promise<number | null> {
    const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID?.trim();
    const apiKey = process.env.BUNNY_STREAM_API_KEY?.trim();
    if (!libraryId || !apiKey) return null;
    try {
      const res = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos/${bunnyVideoId}`, {
        headers: { AccessKey: apiKey, accept: "application/json" },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { length?: number };
      return typeof data.length === "number" && data.length > 0 ? Math.round(data.length) : null;
    } catch {
      return null;
    }
  }

  /** 챕터 목록을 검증·정규화한다 — 제목 없는 항목 제외, startSeconds
   * 오름차순 정렬(관리자가 순서 뒤섞어 입력해도 재생 목록은 항상
   * 시간순으로 보이게). 빈 배열/undefined면 null(챕터 없음)로 저장. */
  private normalizeChapters(
    chapters: Array<{ title?: string; startSeconds?: number; endSeconds?: number }> | undefined,
  ): Array<{ title: string; startSeconds: number; endSeconds?: number }> | null {
    if (!chapters) return null;
    const cleaned = chapters
      .map((c) => {
        const startSeconds = Math.max(0, Math.round(c.startSeconds ?? 0));
        const endSeconds =
          typeof c.endSeconds === "number" && c.endSeconds > startSeconds
            ? Math.round(c.endSeconds)
            : undefined;
        return { title: (c.title ?? "").trim(), startSeconds, endSeconds };
      })
      .filter((c) => c.title.length > 0)
      .sort((a, b) => a.startSeconds - b.startSeconds);
    return cleaned.length > 0 ? cleaned : null;
  }

  async createVideo(
    sectionId: string,
    body: {
      title?: string;
      description?: string;
      bunnyVideoId?: string;
      durationSeconds?: number;
      chapters?: Array<{ title?: string; startSeconds?: number; endSeconds?: number }>;
    },
  ) {
    const title = body.title?.trim();
    const bunnyVideoId = body.bunnyVideoId?.trim();
    if (!title) throw new BadRequestException("영상 제목을 입력해주세요.");
    if (!bunnyVideoId) throw new BadRequestException("Bunny video ID를 입력해주세요.");
    const section = await this.sectionRepo.findOne({ where: { id: sectionId } });
    if (!section) throw new NotFoundException("섹션을 찾을 수 없습니다.");
    const count = await this.videoRepo.count({ where: { sectionId } });
    const durationSeconds =
      body.durationSeconds ?? (await this.fetchBunnyVideoDurationSeconds(bunnyVideoId));
    const video = this.videoRepo.create({
      sectionId,
      title,
      description: body.description?.trim() || null,
      bunnyVideoId,
      durationSeconds,
      sortOrder: count,
      // 등록 직후엔 기본 비공개. 준비가 끝나면 목록에서 "공개로"를
      // 눌러 직접 켜야 수강생에게 보인다(사용자 요청, 2026-08-02 재변경).
      isPublished: false,
      chapters: this.normalizeChapters(body.chapters),
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
      isOtVideo?: boolean;
      chapters?: Array<{ title?: string; startSeconds?: number; endSeconds?: number }> | null;
    },
  ) {
    const video = await this.videoRepo.findOne({ where: { id } });
    if (!video) throw new NotFoundException("영상을 찾을 수 없습니다.");
    if (body.title !== undefined) video.title = body.title.trim();
    if (body.description !== undefined) video.description = body.description.trim() || null;
    if (body.bunnyVideoId !== undefined) video.bunnyVideoId = body.bunnyVideoId.trim();
    if (body.durationSeconds !== undefined) {
      video.durationSeconds = body.durationSeconds;
    } else if (!video.durationSeconds && video.bunnyVideoId) {
      // 재생시간이 비어있는 기존 영상을 다른 필드만 고쳐서 저장할 때도
      // 이 기회에 자동으로 채워준다(관리자가 매번 "재조회" 버튼을 누를
      // 필요 없이 그냥 저장만 하면 채워지도록).
      video.durationSeconds = await this.fetchBunnyVideoDurationSeconds(video.bunnyVideoId);
    }
    if (body.sortOrder !== undefined) video.sortOrder = body.sortOrder;
    if (body.isPublished !== undefined) video.isPublished = body.isPublished;
    if (body.isOtVideo !== undefined) video.isOtVideo = body.isOtVideo;
    if (body.chapters !== undefined) {
      video.chapters = body.chapters === null ? null : this.normalizeChapters(body.chapters);
    }
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

  /** restrictToOtVideos: true면 OT강의로 지정되지 않은 강의를 "OT영상"
   * 단위로만 여는 경우 — isOtVideo가 아닌 영상은 실제 공개 여부와
   * 무관하게 "준비 중"으로 보이게(재생 불가) 만든다. */
  private async buildSectionsWithVideos(courseId: string, restrictToOtVideos = false) {
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
            isPublished: restrictToOtVideos ? v.isPublished && v.isOtVideo : v.isPublished,
            chapters: v.chapters,
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

  async getPlayUrl(token: string, videoId: string, startSeconds?: number) {
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
    return { embedUrl: this.buildEmbedUrl(video.bunnyVideoId, startSeconds) };
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
        isAuto: false,
      };
    });

    // OT수강생과 기존 수강생은 개별 수강권 없이도 "OT강의"로 지정된 공개
    // 강의 전체를, 또는 OT영상이 하나라도 있는 공개 강의를 자동으로 볼 수
    // 있다. 관리자는 모든 강의를(비공개 포함, 관리 목적) 자동으로 볼 수
    // 있다. 이미 개별 수강권이 있는 강의는 중복 표시하지 않는다.
    const user = await this.usersService.findByUsername(username);
    let autoCourses: Course[] = [];
    if (user?.role === UserRole.ADMIN) {
      autoCourses = await this.courseRepo.find({ order: { createdAt: "DESC" } });
    } else if (canAccessOtContent(user?.role)) {
      const publishedCourses = await this.courseRepo.find({ where: { isPublished: true } });
      for (const course of publishedCourses) {
        if (course.isOtCourse || (await this.courseHasOtVideo(course.id))) {
          autoCourses.push(course);
        }
      }
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
        isAuto: true,
      });
    }

    return Promise.all(
      items.map(async (item) => ({
        ...item,
        ...(await this.getCourseProgressSummary(username, item.courseId)),
      })),
    );
  }

  private async getCourseProgressSummary(username: string, courseId: string) {
    const sections = await this.sectionRepo.find({ where: { courseId } });
    const videos = sections.length
      ? await this.videoRepo.find({ where: { sectionId: In(sections.map((section) => section.id)), isPublished: true } })
      : [];
    const totalLessons = videos.reduce((sum, video) => sum + Math.max(1, video.chapters?.length ?? 0), 0);
    const rows = await this.progressRepo.find({ where: { username, courseId }, order: { updatedAt: "DESC" } });
    const completedLessons = rows.filter((row) => row.isCompleted).length;
    const latest = rows[0];
    const latestVideo = latest ? videos.find((video) => video.id === latest.videoId) : undefined;
    const latestChapter = latestVideo?.chapters?.find(
      (chapter) => chapter.startSeconds === latest.chapterStartSeconds,
    );
    return {
      totalLessons,
      completedLessons: Math.min(completedLessons, totalLessons),
      progressPercent: totalLessons > 0 ? Math.round((Math.min(completedLessons, totalLessons) / totalLessons) * 100) : 0,
      lastWatchedAt: latest?.updatedAt ?? null,
      lastVideoId: latest?.videoId ?? null,
      lastChapterStartSeconds: latest?.chapterStartSeconds ?? null,
      lastLessonTitle: latestChapter?.title ?? latestVideo?.title ?? null,
    };
  }

  private async courseHasOtVideo(courseId: string): Promise<boolean> {
    const sections = await this.sectionRepo.find({ where: { courseId } });
    if (sections.length === 0) return false;
    const count = await this.videoRepo.count({
      where: { sectionId: In(sections.map((s) => s.id)), isOtVideo: true, isPublished: true },
    });
    return count > 0;
  }

  /** "full": 강의 전체 시청 가능(관리자 / 정상 수강권 / 강의 전체가
   * OT강의로 지정된 경우). "ot-videos-only": 개별 수강권은 없지만
   * OT수강생이고 이 강의 안에 isOtVideo로 지정된 영상이 있어 그
   * 영상만 볼 수 있는 경우 — 이 경우 나머지 영상은 buildSectionsWithVideos
   * 에서 "준비 중"으로 가려지고, getMyPlayUrl에서도 그 영상만 재생 허용. */
  private async getAccessMode(
    username: string,
    courseId: string,
  ): Promise<"full" | "ot-videos-only"> {
    const user = await this.usersService.findByUsername(username);
    if (user?.role === UserRole.ADMIN) return "full";

    // 개별 수강권(enrollment)이 ACTIVE면 OT 여부와 무관하게 항상 "full"로
    // 취급한다. 예전엔 OT 콘텐츠 접근 가능 role(학생/OT수강생 등)이면
    // 무조건 아래 courseHasOtVideo 분기로 먼저 빠져서, OT영상이 하나라도
    // 있는 강의에서 유료 수강생조차 나머지 강의가 "준비중"으로 잠겨
    // 보이는 버그가 있었다(2026-08-11, 관리자가 공개 처리한 영상이 학생
    // 화면엔 계속 잠김으로 표시된다는 신고로 발견).
    const enrollment = await this.enrollmentRepo.findOne({ where: { username, courseId } });
    if (enrollment && this.computeEffectiveStatus(enrollment) === "ACTIVE") {
      return "full";
    }

    if (canAccessOtContent(user?.role)) {
      const course = await this.courseRepo.findOne({ where: { id: courseId } });
      if (course?.isOtCourse && course.isPublished) return "full";
      if (await this.courseHasOtVideo(courseId)) return "ot-videos-only";
    }

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
    return "full";
  }

  async getMyCourseAccessInfo(username: string, courseId: string) {
    const mode = await this.getAccessMode(username, courseId);
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    const user = await this.usersService.findByUsername(username);
    if (!course || (!course.isPublished && user?.role !== UserRole.ADMIN)) {
      throw new NotFoundException("강의를 찾을 수 없습니다.");
    }
    const progress = await this.progressRepo.find({
      where: { username, courseId },
      order: { updatedAt: "DESC" },
    });
    return {
      course: { id: course.id, title: course.title, description: course.description },
      sections: await this.buildSectionsWithVideos(course.id, mode === "ot-videos-only"),
      progress: progress.map((item) => ({
        videoId: item.videoId,
        chapterStartSeconds: item.chapterStartSeconds,
        lastPositionSeconds: item.lastPositionSeconds,
        isCompleted: item.isCompleted,
        completedAt: item.completedAt,
        updatedAt: item.updatedAt,
      })),
    };
  }

  async saveMyProgress(
    username: string,
    courseId: string,
    videoId: string,
    body: { chapterStartSeconds?: number; lastPositionSeconds?: number; isCompleted?: boolean },
  ) {
    await this.getAccessMode(username, courseId);
    const video = await this.videoRepo.findOne({ where: { id: videoId } });
    if (!video) throw new NotFoundException("영상을 찾을 수 없습니다.");
    const section = await this.sectionRepo.findOne({ where: { id: video.sectionId } });
    if (!section || section.courseId !== courseId) {
      throw new NotFoundException("영상을 찾을 수 없습니다.");
    }

    const chapterStartSeconds = Math.max(0, Math.round(body.chapterStartSeconds ?? 0));
    const lastPositionSeconds = Math.max(0, Math.round(body.lastPositionSeconds ?? chapterStartSeconds));
    let progress = await this.progressRepo.findOne({
      where: { username, courseId, videoId, chapterStartSeconds },
    });
    if (!progress) {
      progress = this.progressRepo.create({
        username,
        courseId,
        videoId,
        chapterStartSeconds,
        lastPositionSeconds,
        isCompleted: Boolean(body.isCompleted),
        completedAt: body.isCompleted ? new Date() : null,
      });
    } else {
      progress.lastPositionSeconds = Math.max(progress.lastPositionSeconds, lastPositionSeconds);
      if (body.isCompleted && !progress.isCompleted) {
        progress.isCompleted = true;
        progress.completedAt = new Date();
      }
    }
    const saved = await this.progressRepo.save(progress);
    return {
      videoId: saved.videoId,
      chapterStartSeconds: saved.chapterStartSeconds,
      lastPositionSeconds: saved.lastPositionSeconds,
      isCompleted: saved.isCompleted,
      completedAt: saved.completedAt,
      updatedAt: saved.updatedAt,
    };
  }

  private async requireCourseVideo(courseId: string, videoId: string) {
    const video = await this.videoRepo.findOne({ where: { id: videoId } });
    if (!video) throw new NotFoundException("영상을 찾을 수 없습니다.");
    const section = await this.sectionRepo.findOne({ where: { id: video.sectionId } });
    if (!section || section.courseId !== courseId) throw new NotFoundException("영상을 찾을 수 없습니다.");
    return video;
  }

  async listMyQuestions(username: string, courseId: string, videoId?: string) {
    await this.getAccessMode(username, courseId);
    return this.questionRepo.find({
      where: videoId ? { courseId, videoId } : { courseId },
      order: { createdAt: "DESC" },
    });
  }

  async createMyQuestion(
    username: string,
    courseId: string,
    body: { videoId?: string; chapterStartSeconds?: number; positionSeconds?: number; question?: string },
  ) {
    await this.getAccessMode(username, courseId);
    const videoId = body.videoId?.trim();
    const question = body.question?.trim();
    if (!videoId || !question) throw new BadRequestException("질문 내용을 입력해주세요.");
    if (question.length > 3000) throw new BadRequestException("질문은 3,000자까지 입력할 수 있습니다.");
    await this.requireCourseVideo(courseId, videoId);
    return this.questionRepo.save(this.questionRepo.create({
      username, courseId, videoId, question,
      chapterStartSeconds: Math.max(0, Math.round(body.chapterStartSeconds ?? 0)),
      positionSeconds: Math.max(0, Math.round(body.positionSeconds ?? 0)),
      answer: null, answeredAt: null,
    }));
  }

  async answerQuestion(id: string, answerValue?: string) {
    const question = await this.questionRepo.findOne({ where: { id } });
    if (!question) throw new NotFoundException("질문을 찾을 수 없습니다.");
    const answer = answerValue?.trim();
    if (!answer) throw new BadRequestException("답변 내용을 입력해주세요.");
    question.answer = answer;
    question.answeredAt = new Date();
    return this.questionRepo.save(question);
  }

  async listMyNotes(username: string, courseId: string, videoId?: string) {
    await this.getAccessMode(username, courseId);
    return this.noteRepo.find({
      where: videoId ? { username, courseId, videoId } : { username, courseId },
      order: { createdAt: "DESC" },
    });
  }

  async createMyNote(
    username: string,
    courseId: string,
    body: { videoId?: string; chapterStartSeconds?: number; positionSeconds?: number; content?: string },
  ) {
    await this.getAccessMode(username, courseId);
    const videoId = body.videoId?.trim();
    const content = body.content?.trim();
    if (!videoId || !content) throw new BadRequestException("노트 내용을 입력해주세요.");
    if (content.length > 5000) throw new BadRequestException("노트는 5,000자까지 입력할 수 있습니다.");
    await this.requireCourseVideo(courseId, videoId);
    return this.noteRepo.save(this.noteRepo.create({
      username, courseId, videoId, content,
      chapterStartSeconds: Math.max(0, Math.round(body.chapterStartSeconds ?? 0)),
      positionSeconds: Math.max(0, Math.round(body.positionSeconds ?? 0)),
    }));
  }

  async deleteMyNote(username: string, courseId: string, noteId: string) {
    await this.getAccessMode(username, courseId);
    const note = await this.noteRepo.findOne({ where: { id: noteId, username, courseId } });
    if (!note) throw new NotFoundException("노트를 찾을 수 없습니다.");
    await this.noteRepo.delete(note.id);
    return { ok: true };
  }

  async getMyPlayUrl(username: string, courseId: string, videoId: string, startSeconds?: number) {
    const mode = await this.getAccessMode(username, courseId);
    const video = await this.videoRepo.findOne({ where: { id: videoId } });
    if (!video || video.sectionId == null) {
      throw new NotFoundException("영상을 찾을 수 없습니다.");
    }
    const section = await this.sectionRepo.findOne({ where: { id: video.sectionId } });
    if (!section || section.courseId !== courseId) {
      throw new NotFoundException("영상을 찾을 수 없습니다.");
    }
    if (mode === "ot-videos-only" && !video.isOtVideo) {
      throw new ForbiddenException("수강 권한이 없는 강의입니다.");
    }
    if (!video.isPublished) {
      throw new BadRequestException("아직 공개되지 않은 영상입니다.");
    }
    return { embedUrl: this.buildEmbedUrl(video.bunnyVideoId, startSeconds) };
  }

  /** Bunny Stream 임베드 URL을 만든다. BUNNY_STREAM_TOKEN_KEY가 설정돼
   * 있으면 라이브러리의 Token Authentication 규격(SHA256(security_key +
   * video_id + expires))으로 서명해 URL 탈취/직접 공유를 어렵게 하고,
   * 없으면(라이브러리가 공개 모드인 경우) 서명 없는 기본 URL을 쓴다.
   * 플레이어 강조색(재생버튼/시크바 등)은 embed URL 파라미터로는 바꿀 수
   * 없고, Bunny 대시보드 > Stream > 해당 라이브러리 > Player 설정에서
   * 라이브러리 단위로 지정해야 한다(2026-08-02 확인, docs.bunny.net에
   * color 쿼리 파라미터는 존재하지 않음 — 이전에 넣었던 `&color=` 파라미터
   * 제거). */
  /** startSeconds가 있으면 Bunny embed의 `t=`(초 단위 시작 지점) 파라미터를
   * 붙여준다 — 영상 하나를 챕터(구간)로 나눠 보여줄 때, 챕터를 클릭하면
   * 그 지점부터 바로 재생되게 하기 위함(2026-08-04). 토큰 서명은
   * security_key+video_id+expires만으로 계산되므로 `t` 파라미터를
   * 추가해도 서명이 깨지지 않는다. */
  private buildEmbedUrl(bunnyVideoId: string, startSeconds?: number): string {
    const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID?.trim();
    if (!libraryId) {
      throw new BadRequestException("BUNNY_STREAM_LIBRARY_ID 환경변수가 설정되어 있지 않습니다.");
    }
    const tokenKey = process.env.BUNNY_STREAM_TOKEN_KEY?.trim();
    const base = `https://iframe.mediadelivery.net/embed/${libraryId}/${bunnyVideoId}`;
    // startSeconds가 0이어도(챕터가 0:00부터 시작) t=0을 명시적으로 붙여야
    // 한다 — 0을 "값 없음"으로 취급해 생략하면 Bunny 플레이어가 "이어보기
    // (마지막 시청 위치)"로 재생을 시작해버린다(사용자 보고, 2026-08-04:
    // "경매기본지식이 00:00부터 시작을 안해").
    const tParam =
      typeof startSeconds === "number" && startSeconds >= 0 ? `&t=${Math.round(startSeconds)}` : "";
    if (!tokenKey) {
      return `${base}?autoplay=false${tParam}`;
    }
    const expires = Math.floor(Date.now() / 1000) + PLAY_URL_TTL_SECONDS;
    const token = createHash("sha256").update(`${tokenKey}${bunnyVideoId}${expires}`).digest("hex");
    return `${base}?token=${token}&expires=${expires}&autoplay=false${tParam}`;
  }
}
