import { Injectable, BadRequestException, ForbiddenException, NotFoundException, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, IsNull, Repository } from "typeorm";
import * as XLSX from "xlsx";
import { Auction } from "./auction.entity";
import { stripResaleMatchFields, stripStaffOnlyAuctionFields } from "./auction-staff-fields.util";
import { AuctionChangeLog } from "./auction-change.entity";
import {
  EXCEL_HEADERS,
  isValidAuctionRow,
  rowToAuction,
  type AuctionRow,
} from "./excel-columns";
import { parseAddressMeta } from "./address-parser";
import { normalizeTankLink } from "../crawler/crawler-url.util";
import type { UpdateAuctionDto } from "./update-auction.dto";
import { buildAuctionEntity, mergeAuctionFromSource, resolvePriceDiffs } from "./auction-builder";
import { isClosedCaseState, validateCrawledItem } from "./crawl-item-validation.util";
import { AuctionStatus } from "../common/constants";
import { normalizeAuctionNo } from "./auction-no.util";
import {
  applyFieldChanges,
  buildFieldChanges,
  resolveCrawlerUpdateChanges,
  snapshotAuction,
  type ChangeSource,
} from "./auction-change.util";
import { parseTradingCountFromDetail } from "./trading-count.util";
import type { AuctionFieldChange } from "./auction-change.entity";
import { parseUnitFloorFromAddress, selectFloorAwareNaverPrice } from "./naver-floor-price.util";
import { TagsService } from "../tags/tags.service";
import { nowPartsInKst } from "../common/kst-time.util";
import { buildAuctionReferenceLinks, type AuctionReferenceLink } from "./reference-links.util";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WriteMeta {
  status: AuctionStatus;
  submittedBy: string;
  changeSource?: ChangeSource;
  skipIfUnchanged?: boolean;
}

@Injectable()
export class AuctionsService implements OnModuleInit {
  constructor(
    @InjectRepository(Auction)
    private readonly auctionRepo: Repository<Auction>,
    @InjectRepository(AuctionChangeLog)
    private readonly changeLogRepo: Repository<AuctionChangeLog>,
    private readonly tagsService: TagsService,
  ) {}

  /** 물건 상세의 외부 참고링크(부동산플래닛 등, 사용자 요청 2026-08-10:
   * "탱크옥션처럼 우측에 배치해서 물건별로"). 백엔드(Railway, 해외
   * 리전)에서는 VWorld API에 직접 연결할 수 없어(SocketError, 기존
   * 부가세계산기/매도분석 지도와 동일 이슈, docs/history/2026-07-21_01
   * 참고) 여기서는 지오코딩을 시도하지 않고 캐싱된 좌표만으로 링크를
   * 만든다. 좌표가 없으면 프론트가 Vercel(서울 리전) API 라우트로
   * 지오코딩한 뒤 `updateVatBuildingInfo`로 캐싱해준다. */
  async getReferenceLinks(id: string): Promise<AuctionReferenceLink[]> {
    const item = await this.auctionRepo.findOne({ where: { id } });
    if (!item) throw new NotFoundException("물건을 찾을 수 없습니다.");
    return buildAuctionReferenceLinks({
      lat: item.latitude,
      lng: item.longitude,
      usage: item.usage ?? "",
      address: item.address ?? "",
    });
  }

  /** 물건의 factTags(내부 코드)/strategyTags(사용자 노출 문구)를 현재 활성 규칙 기준으로 재계산해 저장한다 */
  private async syncFactTags(item: Auction): Promise<Auction> {
    const { factCodes, strategyItems } = await this.tagsService.computeTagsFor(item);
    const nextFactJson = JSON.stringify(factCodes);
    const nextStrategyJson = JSON.stringify(strategyItems);
    if (item.factTags === nextFactJson && item.strategyTags === nextStrategyJson) {
      item.factTagsList = factCodes;
      item.strategyTagsList = strategyItems;
      return item;
    }
    item.factTags = nextFactJson;
    item.strategyTags = nextStrategyJson;
    const saved = await this.auctionRepo.save(item);
    saved.factTagsList = factCodes;
    saved.strategyTagsList = strategyItems;
    return saved;
  }

  async onModuleInit() {
    await this.backfillAuctionNoNorm();
    await this.logProductionDbHealth();
  }

  private async logProductionDbHealth() {
    if (!process.env.DATABASE_URL?.trim()) return;

    const total = await this.countAll();
    console.log(`[DB] 운영 auctions ${total}건`);

    if (total === 0) {
      console.warn(
        "[DB] 경고: 운영 DB가 비어 있습니다. Postgres 재생성/DATABASE_URL 변경 여부를 확인하세요.",
      );
    }
  }

  private async backfillAuctionNoNorm() {
    const missing = await this.auctionRepo.find({
      where: { auctionNoNorm: IsNull() },
    });
    if (missing.length === 0) return;

    const claimed = new Set(
      (await this.auctionRepo.find({ where: {} }))
        .map((item) => item.auctionNoNorm)
        .filter((norm): norm is string => Boolean(norm)),
    );

    const toSave: Auction[] = [];
    for (const item of missing) {
      const norm = normalizeAuctionNo(item.auctionNo);
      if (!norm || claimed.has(norm)) continue;
      item.auctionNoNorm = norm;
      claimed.add(norm);
      toSave.push(item);
    }

    if (toSave.length > 0) {
      await this.auctionRepo.save(toSave);
    }
  }

  async findApproved(isStaff: boolean, isAdmin: boolean) {
    const items = await this.auctionRepo.find({
      where: { status: AuctionStatus.APPROVED },
      order: { updatedAt: "DESC", createdAt: "DESC" },
    });
    if (isStaff) {
      return isAdmin ? items : items.map((item) => stripResaleMatchFields(item));
    }
    return items.map((item) => stripResaleMatchFields(stripStaffOnlyAuctionFields(item)));
  }

  /** 관심물건 페이지 등에서, 전체 목록을 내려받지 않고 필요한 물건만 콕
   * 집어 조회할 때 쓴다(성능: 관심물건이 몇 건 안 되는데도 전체 물건을
   * 다 불러오면 느려지는 문제, 2026-08-02). */
  async findByIds(ids: string[], isStaff: boolean, isAdmin: boolean) {
    // id 컬럼이 uuid 타입이라, UUID 형식이 아닌 값이 하나라도 섞여 있으면
    // Postgres가 배치 전체를 invalid input syntax 에러로 거부해 500이
    // 난다(실측 사고, 2026-08-05: 관심물건에 잘못 저장된 "categories"
    // 값 하나 때문에 그 회원의 관심물건 8건 전체가 안 보였음). 호출 측
    // 데이터가 이미 깨져 있어도 서비스가 죽지 않도록 여기서도 걸러낸다.
    const validIds = ids.filter((id) => UUID_RE.test(id));
    if (validIds.length === 0) return [];
    const items = await this.auctionRepo.find({ where: { id: In(validIds) } });
    if (isStaff) {
      return isAdmin ? items : items.map((item) => stripResaleMatchFields(item));
    }
    return items.map((item) => stripResaleMatchFields(stripStaffOnlyAuctionFields(item)));
  }

  async findAllAdmin(options: { page: number; pageSize: number; search: string }) {
    const query = this.auctionRepo
      .createQueryBuilder("auction");

    if (options.search) {
      query.andWhere(
        `(
          LOWER(COALESCE(auction.auctionNo, '')) LIKE :search OR
          LOWER(COALESCE(auction.address, '')) LIKE :search OR
          LOWER(COALESCE(auction.court, '')) LIKE :search OR
          LOWER(COALESCE(auction.submittedBy, '')) LIKE :search
        )`,
        { search: `%${options.search.toLocaleLowerCase()}%` },
      );
    }

    const [items, total] = await query
      .orderBy("COALESCE(auction.updatedAt, auction.createdAt)", "DESC")
      .addOrderBy("auction.createdAt", "DESC")
      .skip((options.page - 1) * options.pageSize)
      .take(options.pageSize)
      .getManyAndCount();

    return {
      items,
      total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.max(1, Math.ceil(total / options.pageSize)),
    };
  }

  findPending() {
    return this.auctionRepo.find({
      where: { status: AuctionStatus.PENDING },
      order: { createdAt: "DESC" },
    });
  }

  findBySubmitter(username: string) {
    return this.auctionRepo.find({
      where: { submittedBy: username },
      order: { createdAt: "DESC" },
    });
  }

  findChangeHistory(auctionId: string) {
    return this.changeLogRepo.find({
      where: { auctionId },
      order: { changedAt: "DESC" },
    });
  }

  private async recordChanges(
    auctionId: string,
    before: Auction,
    after: Auction,
    changedBy: string,
    source: ChangeSource,
    precomputed?: AuctionFieldChange[],
  ) {
    const changes =
      precomputed ??
      buildFieldChanges(snapshotAuction(before), snapshotAuction(after));
    if (changes.length === 0) return;

    const log = this.changeLogRepo.create({
      auctionId,
      changedBy,
      source,
      changes,
    });
    await this.changeLogRepo.save(log);
  }

  private applyDetectedChanges(
    item: Auction,
    next: Auction,
    changes: AuctionFieldChange[],
    meta: {
      auctionNoNorm: string | null;
      status: AuctionStatus;
      updatedBy: string;
      city: string;
      district: string;
      propType: string;
    },
  ) {
    applyFieldChanges(item, next, changes);

    if (changes.some((change) => change.field === "address")) {
      item.city = meta.city;
      item.district = meta.district;
      item.propType = meta.propType;
    }

    if (meta.auctionNoNorm) {
      item.auctionNoNorm = meta.auctionNoNorm;
    }
    item.status = meta.status;
    item.isUpdated = true;
    item.updatedAt = new Date();
    item.updatedBy = meta.updatedBy;
  }

  private cloneAuctionState(item: Auction): Auction {
    return Object.assign(new Auction(), item);
  }

  countApproved() {
    return this.auctionRepo.count({ where: { status: AuctionStatus.APPROVED } });
  }

  countAll() {
    return this.auctionRepo.count();
  }

  countPending() {
    return this.auctionRepo.count({ where: { status: AuctionStatus.PENDING } });
  }

  async removeOne(id: string) {
    const result = await this.auctionRepo.delete({ id });
    if (!result.affected) {
      throw new BadRequestException("삭제할 물건을 찾을 수 없습니다.");
    }
    return { deleted: 1, total: await this.countAll() };
  }

  async removeMany(ids: string[]) {
    if (ids.length === 0) {
      throw new BadRequestException("삭제할 항목을 선택해 주세요.");
    }
    const result = await this.auctionRepo.delete(ids);
    return { deleted: result.affected ?? 0, total: await this.countAll() };
  }

  async removeAll() {
    if (
      process.env.DATABASE_URL?.trim() &&
      process.env.ALLOW_DELETE_ALL !== "true"
    ) {
      throw new BadRequestException(
        "운영 DB에서는 전체 삭제가 비활성화되어 있습니다. Railway Variables에 ALLOW_DELETE_ALL=true 설정 후에만 가능합니다.",
      );
    }
    const result = await this.auctionRepo.delete({});
    return { deleted: result.affected ?? 0, total: 0 };
  }

  async updateOne(id: string, dto: UpdateAuctionDto, updatedBy = "") {
    const item = await this.auctionRepo.findOne({ where: { id } });
    if (!item) {
      throw new BadRequestException("수정할 물건을 찾을 수 없습니다.");
    }

    return this.applyUpdate(item, dto, updatedBy);
  }

  /** 부가세계산기 자동계산이 VWorld/건축물대장 API로 조회한 물건 고유값
   * (PNU·구조명·주용도명·지상층수)을 캐싱한다. 이 값들은 물건마다 바뀌지
   * 않으므로 한 번 저장해두면 다음 자동계산부터는 API 호출을 건너뛸 수
   * 있다(사용자 요청, 2026-07-24) — 공시지가는 매년 갱신될 수 있어
   * 캐싱 대상에서 제외하고 항상 API로 새로 받는다. 전체 필드 업데이트
   * (updateOne)와 달리 승인 상태·변경이력에 영향을 주지 않는 가벼운
   * patch라 로그인한 일반 회원도 호출할 수 있다. */
  async updateVatBuildingInfo(
    id: string,
    dto: {
      vatPnu?: string | null;
      vatStructureName?: string | null;
      vatMainPurposeName?: string | null;
      vatGroundFloors?: number | null;
      housingLedgerPk?: string | null;
      housingLedgerDongNm?: string | null;
      /** 외부 참고링크(부동산플래닛 등)용 좌표 캐시. 프론트가 Vercel
       * icn1 라우트로 지오코딩한 결과를 저장해둔다(백엔드는 VWorld를
       * 직접 호출할 수 없어 스스로 채우지 못함, 2026-08-10). */
      latitude?: number | null;
      longitude?: number | null;
    },
  ) {
    const item = await this.auctionRepo.findOne({ where: { id } });
    if (!item) {
      throw new BadRequestException("물건을 찾을 수 없습니다.");
    }
    if (dto.vatPnu !== undefined) item.vatPnu = dto.vatPnu;
    if (dto.vatStructureName !== undefined) item.vatStructureName = dto.vatStructureName;
    if (dto.vatMainPurposeName !== undefined) item.vatMainPurposeName = dto.vatMainPurposeName;
    if (dto.vatGroundFloors !== undefined) item.vatGroundFloors = dto.vatGroundFloors;
    if (dto.housingLedgerPk !== undefined) item.housingLedgerPk = dto.housingLedgerPk;
    if (dto.housingLedgerDongNm !== undefined) item.housingLedgerDongNm = dto.housingLedgerDongNm;
    if (dto.latitude !== undefined) item.latitude = dto.latitude;
    if (dto.longitude !== undefined) item.longitude = dto.longitude;
    await this.auctionRepo.save(item);
    return {
      vatPnu: item.vatPnu,
      vatStructureName: item.vatStructureName,
      vatMainPurposeName: item.vatMainPurposeName,
      vatGroundFloors: item.vatGroundFloors,
      housingLedgerPk: item.housingLedgerPk,
      housingLedgerDongNm: item.housingLedgerDongNm,
      latitude: item.latitude,
      longitude: item.longitude,
    };
  }

  async updateOwnPending(id: string, username: string, dto: UpdateAuctionDto) {
    const item = await this.findOwnPending(id, username);
    return this.applyUpdate(item, dto, username, "consultant_edit");
  }

  async removeOwnPending(id: string, username: string) {
    const item = await this.findOwnPending(id, username);
    await this.auctionRepo.delete({ id: item.id });
    const items = await this.findBySubmitter(username);
    return {
      deleted: 1,
      total: items.length,
    };
  }

  private async findOwnPending(id: string, username: string) {
    const item = await this.auctionRepo.findOne({ where: { id } });
    if (!item) {
      throw new BadRequestException("물건을 찾을 수 없습니다.");
    }
    if (item.submittedBy !== username) {
      throw new ForbiddenException("본인이 등록한 물건만 수정할 수 있습니다.");
    }
    if (item.status !== AuctionStatus.PENDING) {
      throw new BadRequestException("승인 대기 중인 물건만 수정·삭제할 수 있습니다.");
    }
    return item;
  }

  /** court(법원+계)를 포함한 고유 키로 우선 조회한다. court 정보가 아직 없는
   * 크롤링 결과(v1/v2 일부 경로 등)나, court 도입 이전에 저장된 레거시
   * 물건과 이어 붙이기 위해 사건번호만으로도 재시도한다 — 단, 사건번호가
   * 같은 물건이 법원별로 여러 건(다른 court) 존재하면 어느 것이 맞는지
   * 알 수 없으므로, 후보가 정확히 1건일 때만 채택한다(잘못된 병합 방지). */
  private async findByNormalizedAuctionNo(
    norm: string,
    rawAuctionNo?: string,
    court?: string,
  ) {
    const byNorm = await this.auctionRepo.findOne({
      where: { auctionNoNorm: norm },
    });
    if (byNorm) return byNorm;

    const legacyRows = await this.auctionRepo.find({
      where: { auctionNoNorm: IsNull() },
    });
    const legacyMatch = legacyRows.find(
      (row) => normalizeAuctionNo(row.auctionNo) === norm,
    );
    if (legacyMatch) return legacyMatch;

    // court가 있는 새 크롤링 결과인데 court 포함 키로 못 찾은 경우 —
    // court 없이 저장된 기존 물건과 이어 붙일 수 있는지 사건번호만으로
    // 한 번 더 확인한다(후보가 유일할 때만).
    if (court && rawAuctionNo) {
      const bareNorm = normalizeAuctionNo(rawAuctionNo);
      if (bareNorm && bareNorm !== norm) {
        const candidates = await this.auctionRepo.find({
          where: { auctionNoNorm: bareNorm },
        });
        if (candidates.length === 1) return candidates[0];
      }
    }

    return null;
  }

  private async applyUpdate(
    item: Auction,
    dto: UpdateAuctionDto,
    updatedBy = "",
    changeSource: ChangeSource = "admin_edit",
  ) {
    if (!dto.auctionNo?.trim() && !dto.address?.trim()) {
      throw new BadRequestException("경매번호 또는 물건주소는 필수입니다.");
    }

    const before = this.cloneAuctionState(item);
    const merged = mergeAuctionFromSource(item, dto);
    const nextNorm = normalizeAuctionNo(merged.auctionNo);
    if (nextNorm && nextNorm !== item.auctionNoNorm) {
      const duplicate = await this.auctionRepo.findOne({
        where: { auctionNoNorm: nextNorm },
      });
      if (duplicate && duplicate.id !== item.id) {
        throw new BadRequestException("이미 등록된 경매번호입니다.");
      }
    }

    const { city, district, propType } = parseAddressMeta(merged.address, merged.usage);
    const diffs = resolvePriceDiffs(merged);

    const next = this.cloneAuctionState(item);
    Object.assign(next, {
      ...merged,
      ...diffs,
      city,
      district,
      propType,
      auctionNoNorm: nextNorm,
    });

    const changes = buildFieldChanges(
      snapshotAuction(before),
      snapshotAuction(next),
    );
    if (changes.length === 0) {
      return item;
    }

    this.applyDetectedChanges(item, next, changes, {
      auctionNoNorm: nextNorm,
      status: item.status,
      updatedBy: updatedBy || item.updatedBy,
      city,
      district,
      propType,
    });

    const saved = await this.auctionRepo.save(item);
    await this.recordChanges(
      item.id,
      before,
      saved,
      updatedBy || item.updatedBy,
      changeSource,
      changes,
    );
    return saved;
  }

  private async upsertOne(
    dto: UpdateAuctionDto | Partial<AuctionRow>,
    meta: WriteMeta,
  ): Promise<{ item: Auction; created: boolean; unchanged?: boolean }> {
    const court = "court" in dto ? (dto.court ?? "") : "";
    const norm = normalizeAuctionNo(dto.auctionNo ?? "", court);
    const existing = norm
      ? await this.findByNormalizedAuctionNo(norm, dto.auctionNo ?? "", court)
      : null;

    if (existing) {
      const before = this.cloneAuctionState(existing);
      const mergedStatus =
        existing.status === AuctionStatus.APPROVED
          ? AuctionStatus.APPROVED
          : meta.status;

      const preserveMemoIfEmpty =
        meta.changeSource === "crawler" || meta.changeSource === "excel";

      const merged = mergeAuctionFromSource(existing, dto, {
        preserveMemoIfEmpty,
        preserveExistingIfEmpty: meta.changeSource === "crawler",
      });
      const { city, district, propType } = parseAddressMeta(merged.address, merged.usage);
      const diffs = resolvePriceDiffs(merged);

      const next = this.cloneAuctionState(existing);
      Object.assign(next, {
        ...merged,
        ...diffs,
        city,
        district,
        propType,
        auctionNoNorm: norm,
        status: mergedStatus,
      });

      let changes = buildFieldChanges(
        snapshotAuction(before),
        snapshotAuction(next),
      );

      if (meta.changeSource === "crawler") {
        changes = resolveCrawlerUpdateChanges(changes);
      }

      if (meta.skipIfUnchanged && changes.length === 0) {
        return { item: existing, created: false, unchanged: true };
      }

      if (changes.length === 0) {
        return { item: existing, created: false };
      }

      this.applyDetectedChanges(existing, next, changes, {
        auctionNoNorm: norm,
        status: mergedStatus,
        updatedBy: meta.submittedBy,
        city,
        district,
        propType,
      });

      let item = await this.auctionRepo.save(existing);
      await this.recordChanges(
        item.id,
        before,
        item,
        meta.submittedBy,
        meta.changeSource ?? "excel",
        changes,
      );
      item = await this.syncFactTags(item);
      return { item, created: false };
    }

    const entity = buildAuctionEntity(dto, meta);
    let item = await this.auctionRepo.save(entity);
    item = await this.syncFactTags(item);
    return { item, created: true };
  }

  async importCrawledItem(
    dto: Partial<UpdateAuctionDto>,
    submittedBy: string,
  ) {
    const validation = validateCrawledItem(dto);
    if (!validation.valid) {
      return {
        skipped: true as const,
        unchanged: false as const,
        created: false,
        item: null,
        reason: validation.reason,
      };
    }

    const normalizedDto = { ...dto, auctionNo: validation.auctionNo };

    const { item, created, unchanged } = await this.upsertOne(normalizedDto, {
      status: AuctionStatus.APPROVED,
      submittedBy,
      changeSource: "crawler",
      skipIfUnchanged: true,
    });

    if (unchanged) {
      return {
        skipped: true as const,
        unchanged: true as const,
        created: false,
        item,
      };
    }

    return { skipped: false as const, unchanged: false as const, created, item };
  }

  /** 오늘(자정 이후) 생성되거나 갱신된 물건의 링크 목록.
   * v3(HTTPX) 네이버 호가/실거래 상세 포맷 수정 이후, 오늘 이미 수집돼
   * 옛 포맷으로 저장된 물건을 새 포맷으로 재수집(재크롤링)하기 위한
   * 1회성 백필 용도 — listMissingNaverId() 와 동일한 쿼리 패턴. */
  async listRecentlyUpdatedLinks(
    sinceHours = 24,
  ): Promise<{ auctionNo: string; link: string }[]> {
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    const rows = await this.auctionRepo
      .createQueryBuilder("a")
      .select("a.auctionNo", "auctionNo")
      .addSelect("a.link", "link")
      .where("a.link != :emptyLink", { emptyLink: "" })
      .andWhere(
        "(a.createdAt >= :since OR a.updatedAt >= :since)",
        { since },
      )
      .getRawMany<{ auctionNo: string; link: string }>();

    return rows
      .filter((row) => row.auctionNo?.trim() && row.link?.trim())
      .map((row) => ({
        auctionNo: row.auctionNo.trim(),
        link: row.link.trim(),
      }));
  }

  /** 프런트 lib/progress-status-filter.ts의 parseBidDate와 동일 규칙. */
  private parseBidDate(value: string): Date | null {
    if (!value?.trim()) return null;
    const normalized = value.trim().replace(/\./g, "-").replace(/\//g, "-");
    const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) {
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /** 입찰기일이 오늘인 승인 물건의 링크 목록 — "당일물건 조회" 예약 작업이
   * 이 링크들을 재크롤링해서 낙찰 여부/변경사항을 갱신하는 데 쓴다.
   * 탱크옥션은 낙찰 결과를 입찰 당일 오후 5시 이후에나 반영하므로, 그
   * 전에는 오늘 날짜 물건을 목록에서 제외한다(재조회해도 아직 변경 전
   * 상태라 의미가 없음). 이미 취하·매각 확정된 사건도 더 이상 입찰기일이
   * 갱신되지 않으므로 함께 제외한다. */
  async listTodayBidDateLinks(): Promise<{ auctionNo: string; link: string }[]> {
    const rows = await this.auctionRepo
      .createQueryBuilder("a")
      .select("a.auctionNo", "auctionNo")
      .addSelect("a.link", "link")
      .addSelect("a.bidDate", "bidDate")
      .addSelect("a.caseState", "caseState")
      .where("a.status = :status", { status: AuctionStatus.APPROVED })
      .andWhere("a.link != :emptyLink", { emptyLink: "" })
      .andWhere("a.bidDate != :emptyBidDate", { emptyBidDate: "" })
      .getRawMany<{ auctionNo: string; link: string; bidDate: string; caseState: string }>();

    // 서버(Railway)는 UTC로 동작해 new Date()의 시/분/날짜가 KST와 어긋난다
    // (예: KST 7/20 00:34 = UTC 7/19 15:34) — 반드시 KST 기준으로 계산해야
    // "오늘" 판정이 실제 한국 날짜와 맞는다.
    const kst = nowPartsInKst();
    const today = new Date(kst.year, kst.month - 1, kst.date);
    const resultAnnounced = kst.hour >= 17;

    // court 필드 도입 전 레거시 레코드(court="")와 court 포함 정규화 이후
    // 새로 만들어진 레코드가 같은 link를 가진 채 둘 다 남아있는 경우가
    // 있다(실측: 2025타경33665 / 2025타경33665(9)가 court만 다르고
    // link·물건은 완전히 동일, 2026-07-20). 레거시 쪽은 caseState가 채워
    // 지지 않아 종결 판정을 피해가므로, 링크 단위로 먼저 묶어 그룹 중
    // 하나라도 종결·미래 상태면 그룹 전체를 제외한다.
    const byLink = new Map<string, typeof rows>();
    for (const row of rows) {
      if (!row.auctionNo?.trim() || !row.link?.trim()) continue;
      const key = row.link.trim();
      const group = byLink.get(key);
      if (group) group.push(row);
      else byLink.set(key, [row]);
    }

    const isEligibleRow = (row: (typeof rows)[number]) => {
      if (isClosedCaseState(row.caseState)) return false;
      const parsed = this.parseBidDate(row.bidDate);
      if (!parsed) return false;
      const bidDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
      if (bidDay.getTime() === today.getTime()) return resultAnnounced;
      return bidDay.getTime() < today.getTime();
    };

    const result: { auctionNo: string; link: string }[] = [];
    for (const [link, group] of byLink) {
      // 그룹 안에 종결(caseState 종결) 레코드가 하나라도 있으면, 이 링크의
      // 물건은 이미 결론이 났다는 뜻이므로 다른 레코드가 caseState 미기재
      // 상태라도 전체를 제외한다.
      if (group.some((row) => isClosedCaseState(row.caseState))) continue;
      // caseState가 채워진 레코드를 우선 대표로 쓰고, 그 값이 재조회 대상
      // 조건(오늘/과거 입찰기일)을 만족하는 것이 하나라도 있으면 포함한다.
      const representative =
        group.find((row) => row.caseState?.trim()) ?? group[0];
      if (!isEligibleRow(representative)) continue;
      result.push({
        auctionNo: representative.auctionNo.trim(),
        link,
      });
    }
    return result;
  }

  async listMissingNaverId(): Promise<{ auctionNo: string; link: string }[]> {
    const rows = await this.auctionRepo
      .createQueryBuilder("a")
      .select("a.auctionNo", "auctionNo")
      .addSelect("a.link", "link")
      .where("(a.naverId IS NULL OR a.naverId = :emptyId)", { emptyId: "" })
      .andWhere("a.link != :emptyLink", { emptyLink: "" })
      .getRawMany<{ auctionNo: string; link: string }>();

    return rows
      .filter((row) => row.auctionNo?.trim() && row.link?.trim())
      .map((row) => ({
        auctionNo: row.auctionNo.trim(),
        link: row.link.trim(),
      }));
  }

  /** 부가세계산기 자동조회 대상(85㎡ 초과 아파트) 중 sharedArea(공용면적)가
   * 비어있는 물건만 골라 link를 반환한다. area는 text 컬럼이라 85 초과
   * 비교는 SQL이 아닌 애플리케이션 레벨에서 한다(실측, 2026-07-21). */
  async listMissingSharedArea(): Promise<{ link: string; area: string }[]> {
    const rows = await this.auctionRepo
      .createQueryBuilder("a")
      .select("a.link", "link")
      .addSelect("a.area", "area")
      .where("a.usage LIKE :usage", { usage: "아파트%" })
      .andWhere("(a.sharedArea IS NULL OR a.sharedArea = :empty)", { empty: "" })
      .andWhere("a.link != :emptyLink", { emptyLink: "" })
      .getRawMany<{ link: string; area: string }>();

    return rows
      .filter((row) => {
        const area = Number(String(row.area ?? "").replace(/,/g, ""));
        return row.link?.trim() && Number.isFinite(area) && area > 85;
      })
      .map((row) => ({ link: row.link.trim(), area: row.area }));
  }

  /** 공시가격(officialLandPrice)이 비어있는 진행중 물건의 link를 반환한다.
   * 이 필드는 페이지 렌더 시점에 탱크옥션 쪽 공시가격 데이터가 아직 안
   * 채워져 있으면 크롤링 당시 0으로 남는 경우가 있어(실측, 2026-07-22)
   * 재조회로 보정한다. */
  async listMissingOfficialLandPrice(): Promise<{ link: string }[]> {
    const rows = await this.auctionRepo
      .createQueryBuilder("a")
      .select("a.link", "link")
      .where("(a.officialLandPrice IS NULL OR a.officialLandPrice = 0)")
      .andWhere("a.link != :emptyLink", { emptyLink: "" })
      .andWhere("a.caseState NOT IN (:...closed)", {
        closed: [
          "취하",
          "매각",
          "허가",
          "기각",
          "각하",
          "취소",
          "매각결정기일",
          "지급기한",
          "배당기일",
          "배당종결",
        ],
      })
      .getRawMany<{ link: string }>();

    return rows.filter((row) => row.link?.trim()).map((row) => ({ link: row.link.trim() }));
  }

  /** link 기준으로 officialLandPrice/specialNote 두 필드만 patch한다
   * (전체 재크롤 없는 가벼운 보정용). */
  async patchLandPriceAndNoteOnly(
    link: string,
    officialLandPrice: number,
    specialNote: string,
    updatedBy: string,
  ) {
    const trimmedLink = link.trim();
    if (!trimmedLink) {
      return { updated: false as const, skipped: true as const, reason: "invalid_link" };
    }
    const item = await this.auctionRepo.findOne({ where: { link: trimmedLink } });
    if (!item) {
      return { updated: false as const, skipped: true as const, reason: "not_found" };
    }

    const before = this.cloneAuctionState(item);
    if (officialLandPrice > 0) item.officialLandPrice = officialLandPrice;
    if (specialNote.trim()) item.specialNote = specialNote.trim();
    item.isUpdated = true;
    item.updatedAt = new Date();
    item.updatedBy = updatedBy;

    const changes = buildFieldChanges(
      snapshotAuction(before),
      snapshotAuction(item),
    );
    if (changes.length === 0) {
      return { updated: false as const, skipped: true as const, item };
    }

    const saved = await this.auctionRepo.save(item);
    await this.recordChanges(
      item.id,
      before,
      saved,
      updatedBy,
      "crawler",
      changes,
    );
    return { updated: true as const, skipped: false as const, item: saved };
  }

  async patchNaverIdOnly(
    auctionNo: string,
    naverId: string,
    updatedBy: string,
  ) {
    const norm = normalizeAuctionNo(auctionNo);
    const item = norm ? await this.findByNormalizedAuctionNo(norm) : null;
    if (!item) {
      return { updated: false as const, skipped: true as const, reason: "not_found" };
    }

    const nextId = naverId.trim();
    if (!nextId || !/^\d+$/.test(nextId)) {
      return { updated: false as const, skipped: true as const, reason: "invalid_id" };
    }
    if (item.naverId === nextId) {
      return {
        updated: false as const,
        skipped: true as const,
        reason: "unchanged",
        item,
      };
    }

    const before = this.cloneAuctionState(item);
    item.naverId = nextId;
    item.isUpdated = true;
    item.updatedAt = new Date();
    item.updatedBy = updatedBy;

    const changes = buildFieldChanges(
      snapshotAuction(before),
      snapshotAuction(item),
    );
    if (changes.length === 0) {
      return { updated: false as const, skipped: true as const, item };
    }

    const saved = await this.auctionRepo.save(item);
    await this.recordChanges(
      item.id,
      before,
      saved,
      updatedBy,
      "crawler",
      changes,
    );
    return { updated: true as const, skipped: false as const, item: saved };
  }

  /** 탱크옥션 getEnvBldg.php에서만 얻을 수 있는 공용면적(sharedArea)을
   * link(tid 포함 URL) 기준으로 단일 필드만 채운다. auctionNo는 법원이
   * 다르면 중복될 수 있어 link로 찾는다(실측, 2026-07-19). */
  async patchSharedAreaOnly(link: string, sharedArea: string, updatedBy: string) {
    const trimmedLink = link.trim();
    if (!trimmedLink) {
      return { updated: false as const, skipped: true as const, reason: "invalid_link" };
    }
    const item = await this.auctionRepo.findOne({ where: { link: trimmedLink } });
    if (!item) {
      return { updated: false as const, skipped: true as const, reason: "not_found" };
    }

    const nextValue = sharedArea.trim();
    if (!nextValue) {
      return { updated: false as const, skipped: true as const, reason: "invalid_value" };
    }
    if (item.sharedArea === nextValue) {
      return {
        updated: false as const,
        skipped: true as const,
        reason: "unchanged",
        item,
      };
    }

    const before = this.cloneAuctionState(item);
    item.sharedArea = nextValue;
    item.isUpdated = true;
    item.updatedAt = new Date();
    item.updatedBy = updatedBy;

    const changes = buildFieldChanges(
      snapshotAuction(before),
      snapshotAuction(item),
    );
    if (changes.length === 0) {
      return { updated: false as const, skipped: true as const, item };
    }

    const saved = await this.auctionRepo.save(item);
    await this.recordChanges(
      item.id,
      before,
      saved,
      updatedBy,
      "crawler",
      changes,
    );
    return { updated: true as const, skipped: false as const, item: saved };
  }

  async backfillTradingCountFromDetail(updatedBy: string) {
    const rows = await this.auctionRepo
      .createQueryBuilder("a")
      .select("a.id", "id")
      .addSelect("a.tradingCount", "tradingCount")
      .addSelect("a.tradingDetail", "tradingDetail")
      .where("trim(a.tradingDetail) != :empty", { empty: "" })
      .getRawMany<{ id: string; tradingCount: string; tradingDetail: string }>();

    let updated = 0;
    let unchanged = 0;

    for (const row of rows) {
      const next = parseTradingCountFromDetail(row.tradingDetail ?? "");
      const prev = (row.tradingCount ?? "").trim();
      if (next === prev) {
        unchanged += 1;
        continue;
      }

      const item = await this.auctionRepo.findOne({ where: { id: row.id } });
      if (!item) continue;

      const before = this.cloneAuctionState(item);
      item.tradingCount = next;
      const changes = buildFieldChanges(
        snapshotAuction(before),
        snapshotAuction(item),
      );
      if (changes.length === 0) {
        unchanged += 1;
        continue;
      }

      await this.auctionRepo.save(item);
      await this.recordChanges(
        item.id,
        before,
        item,
        updatedBy,
        "admin_edit",
        changes,
      );
      updated += 1;
    }

    return { total: rows.length, updated, unchanged };
  }

  /**
   * 주소 파싱 로직(district에 "시+구" 포함) 변경 반영용: 기존 물건의
   * city/district를 address 기준으로 다시 계산해 저장한다.
   */
  async backfillCityDistrict() {
    const rows = await this.auctionRepo.find();

    let updated = 0;
    let unchanged = 0;

    for (const item of rows) {
      const { city, district } = parseAddressMeta(item.address ?? "");
      if (item.city === city && item.district === district) {
        unchanged += 1;
        continue;
      }
      item.city = city;
      item.district = district;
      await this.auctionRepo.save(item);
      updated += 1;
    }

    return { total: rows.length, updated, unchanged };
  }

  /**
   * 용도가 "아파트"이고 priceDetail(호가 상세)이 있는 기존 물건에 대해,
   * 재크롤링 없이 저장된 priceDetail을 다시 파싱해 층수 기준 네이버 호가로 갱신한다.
   * 물건 자신이 1·2층이면 1·2층 매물 중 최저가, 그 외에는 3층 이상 매물 중 최저가를 적용한다.
   */
  async backfillNaverFloorPrice(updatedBy: string) {
    const rows = await this.auctionRepo.find({
      where: { usage: "아파트" },
    });

    let updated = 0;
    let unchanged = 0;
    let skipped = 0;

    for (const item of rows) {
      if (!item.priceDetail?.trim()) {
        skipped += 1;
        continue;
      }

      const targetFloor = parseUnitFloorFromAddress(item.address);
      const floorAware = selectFloorAwareNaverPrice(item.priceDetail, targetFloor);
      if (floorAware.naverPrice == null) {
        skipped += 1;
        continue;
      }

      if (
        floorAware.naverPrice === item.naverPrice &&
        floorAware.naverPriceFloor === item.naverPriceFloor &&
        floorAware.naverPriceFloorLabel === item.naverPriceFloorLabel
      ) {
        unchanged += 1;
        continue;
      }

      const before = this.cloneAuctionState(item);
      item.naverPrice = floorAware.naverPrice;
      item.naverPriceFloor = floorAware.naverPriceFloor;
      item.naverPriceFloorLabel = floorAware.naverPriceFloorLabel;
      const diffs = resolvePriceDiffs({
        naverPrice: item.naverPrice,
        minPrice: item.minPrice,
        appraisedValue: item.appraisedValue,
        salePrice: item.salePrice,
      });
      item.diffNaverSale = diffs.diffNaverSale;
      item.diffNaverMin = diffs.diffNaverMin;
      item.diffNaverAppraised = diffs.diffNaverAppraised;

      const changes = buildFieldChanges(
        snapshotAuction(before),
        snapshotAuction(item),
      );
      if (changes.length === 0) {
        unchanged += 1;
        continue;
      }

      await this.auctionRepo.save(item);
      await this.recordChanges(
        item.id,
        before,
        item,
        updatedBy,
        "admin_edit",
        changes,
      );
      updated += 1;
    }

    return { total: rows.length, updated, unchanged, skipped };
  }

  async createOne(dto: UpdateAuctionDto, meta: WriteMeta) {
    if (!dto.auctionNo?.trim() && !dto.address?.trim()) {
      throw new BadRequestException("경매번호 또는 물건주소는 필수입니다.");
    }

    const { item } = await this.upsertOne(dto, {
      ...meta,
      changeSource: meta.changeSource ?? "manual_create",
    });
    return item;
  }

  async importFromExcel(
    buffer: Buffer,
    meta: WriteMeta,
  ) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      throw new BadRequestException("엑셀 시트를 찾을 수 없습니다.");
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    });

    if (rows.length === 0) {
      throw new BadRequestException("업로드할 데이터가 없습니다.");
    }

    const parsedRows: Partial<AuctionRow>[] = [];

    for (const row of rows) {
      const parsed = rowToAuction(row);
      if (!isValidAuctionRow(parsed)) continue;
      parsedRows.push(parsed);
    }

    if (parsedRows.length === 0) {
      throw new BadRequestException(
        "유효한 물건 데이터가 없습니다. 엑셀 헤더와 내용을 확인해 주세요.",
      );
    }

    const byAuctionNo = new Map<string, Partial<AuctionRow>>();
    const withoutAuctionNo: Partial<AuctionRow>[] = [];

    for (const parsed of parsedRows) {
      const norm = normalizeAuctionNo(parsed.auctionNo ?? "");
      if (norm) {
        byAuctionNo.set(norm, parsed);
      } else {
        withoutAuctionNo.push(parsed);
      }
    }

    let created = 0;
    let updated = 0;

    for (const parsed of [...byAuctionNo.values(), ...withoutAuctionNo]) {
      const result = await this.upsertOne(parsed, {
        ...meta,
        changeSource: "excel",
      });
      if (result.created) created += 1;
      else updated += 1;
    }

    return {
      imported: created + updated,
      created,
      updated,
      total: meta.status === AuctionStatus.APPROVED
        ? await this.countApproved()
        : await this.countAll(),
      status: meta.status,
    };
  }

  async approveOne(id: string) {
    const item = await this.auctionRepo.findOne({ where: { id } });
    if (!item) {
      throw new BadRequestException("승인할 물건을 찾을 수 없습니다.");
    }
    item.status = AuctionStatus.APPROVED;
    return this.auctionRepo.save(item);
  }

  async rejectOne(id: string) {
    const item = await this.auctionRepo.findOne({ where: { id } });
    if (!item) {
      throw new BadRequestException("반려할 물건을 찾을 수 없습니다.");
    }
    item.status = AuctionStatus.REJECTED;
    return this.auctionRepo.save(item);
  }

  async approveMany(ids: string[]) {
    if (ids.length === 0) {
      throw new BadRequestException("승인할 항목을 선택해 주세요.");
    }
    await this.auctionRepo.update(ids, { status: AuctionStatus.APPROVED });
    return { approved: ids.length, pending: await this.countPending() };
  }

  async rejectMany(ids: string[]) {
    if (ids.length === 0) {
      throw new BadRequestException("반려할 항목을 선택해 주세요.");
    }
    await this.auctionRepo.update(ids, { status: AuctionStatus.REJECTED });
    return { rejected: ids.length, pending: await this.countPending() };
  }

  createTemplateBuffer(): Buffer {
    const sample = [
      {
        메모: "입지 좋음",
        링크: "https://www.courtauction.go.kr",
        조회수: 342,
        경매번호: "2024타경12345",
        물건주소: "서울특별시 강남구 대치동 은마아파트 101동 502호",
        "총 세대수": 4424,
        용도: "주거용",
        평형: "34평",
        연식: 1979,
        입찰기일: "2025-02-18",
        감정가: 1450000000,
        최저가: 1160000000,
        낙찰가: 1280000000,
        "네이버 호가": 1550000000,
        "호가 - 낙찰가": 270000000,
        "호가 - 최저가": 390000000,
        "호가 - 감정가": 100000000,
        실거래건수: "2025 3건, 2024 2건",
        낙찰정보: "3명",
        소유자: "김○○",
        감정원: "한국감정원",
        공시지가: 890000000,
        임차정보: "전입 없음",
        특이사항: "유치권 없음",
        승강기: "비상/승용",
        주차장: "자주식 500대",
        토지지분: "35.7㎡",
        건물등기: "이상없음",
        교육환경: "대치초, 대치중",
        임차인현황: "-",
        "호가 상세": "22년 3월 1.55억 거래",
        "실거래 상세": "최근 3건",
        기록시간: "2025-01-15 09:22",
      },
    ];

    const sheet = XLSX.utils.json_to_sheet(sample, { header: EXCEL_HEADERS });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "경매물건");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  /** 사건번호로 기존 물건을 조회한다 — "주소 추가" 시 이미 DB에 있어
   * 재크롤링을 건너뛴 물건도 매도분석은 놓치지 않기 위해 사용
   * (사용자 요청, 2026-08-01). */
  async findByAuctionNos(auctionNos: string[]): Promise<Auction[]> {
    if (auctionNos.length === 0) return [];
    return this.auctionRepo.find({ where: { auctionNo: In(auctionNos) } });
  }

  /** URL(링크) 기준으로 정확히 찾는다 — 사건번호(auctionNo)는 법원이
   * 다르면 같은 번호가 중복될 수 있어(실측: 2026-08-03, 운영 DB에서
   * 238개 사건번호가 서로 다른 법원 사건과 겹침) 매도분석처럼 "이 물건,
   * 정확히 이거" 매칭이 중요한 곳에는 auctionNo 대신 link로 찾는다. */
  async findByLinks(links: string[]): Promise<Auction[]> {
    if (links.length === 0) return [];
    const keys = new Set<string>();
    for (const link of links) {
      keys.add(link.split("&")[0].trim());
      const normalized = normalizeTankLink(link);
      if (normalized) keys.add(normalized);
    }
    if (keys.size === 0) return [];
    return this.auctionRepo
      .createQueryBuilder("a")
      .where("split_part(a.link, '&', 1) IN (:...keys) OR a.link IN (:...keys)", {
        keys: Array.from(keys),
      })
      .getMany();
  }

  async getLinkCollectFilterMap(): Promise<
    Map<
      string,
      {
        bidDate: string;
        usage: string;
        area: string;
        naverPrice: number;
        priceDetail: string;
        tradingDetail: string;
        caseState: string;
      }
    >
  > {
    const rows = await this.auctionRepo
      .createQueryBuilder("a")
      .select("a.link", "link")
      .addSelect("a.bidDate", "bidDate")
      .addSelect("a.usage", "usage")
      .addSelect("a.area", "area")
      .addSelect("a.naverPrice", "naverPrice")
      .addSelect("a.priceDetail", "priceDetail")
      .addSelect("a.tradingDetail", "tradingDetail")
      .addSelect("a.caseState", "caseState")
      .where("a.status = :status", { status: AuctionStatus.APPROVED })
      .getRawMany<{
        link: string;
        bidDate: string;
        usage: string;
        area: string;
        naverPrice: number;
        priceDetail: string;
        tradingDetail: string;
        caseState: string;
      }>();
    const map = new Map<
      string,
      {
        bidDate: string;
        usage: string;
        area: string;
        naverPrice: number;
        priceDetail: string;
        tradingDetail: string;
        caseState: string;
      }
    >();
    for (const row of rows) {
      if (!row.link?.trim()) continue;
      const record = {
        bidDate: row.bidDate ?? "",
        usage: row.usage ?? "",
        area: row.area ?? "",
        naverPrice: row.naverPrice ?? 0,
        priceDetail: row.priceDetail ?? "",
        tradingDetail: row.tradingDetail ?? "",
        caseState: row.caseState ?? "",
      };
      const keys = new Set<string>();
      keys.add(row.link.split("&")[0].trim());
      const normalized = normalizeTankLink(row.link);
      if (normalized) keys.add(normalized);
      for (const key of keys) {
        map.set(key, record);
      }
    }
    return map;
  }

  extractLinksFromExcel(buffer: Buffer): string[] {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException("엑셀 시트를 찾을 수 없습니다.");
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    });

    const links: string[] = [];
    for (const row of rows) {
      const link = String(row["링크"] ?? row["link"] ?? "").trim();
      if (link) links.push(link);
    }

    if (links.length === 0) {
      throw new BadRequestException("'링크' 열을 찾을 수 없습니다.");
    }

    return links;
  }
}
