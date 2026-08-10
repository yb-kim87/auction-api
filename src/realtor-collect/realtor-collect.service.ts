import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as XLSX from "xlsx";
import { RealtorOffice } from "./entities/realtor-office.entity";

/** 한방(카한방, karhanbang.com) 중개업소 검색/수집. 기존 데스크톱
 * PySide6 프로그램(hanbang.py)을 관리자 페이지 기능으로 이식했다
 * (사용자 요청, 2026-08-10). 원본은 Python(httpx+BeautifulSoup)으로
 * 스크래핑했지만, 실측해보니 이 사이트는 브라우저(Selenium) 없이도
 * User-Agent 헤더만으로 목록/상세 페이지가 정상 응답되고(WAF는
 * ajax_combo_search.asp에만 Referer/X-Requested-With를 요구), HTML
 * 구조도 정규식으로 안정적으로 파싱 가능해(실측 확인) 별도 Python
 * 워커 없이 이 서비스 안에서 순수 Node fetch + 정규식으로 직접
 * 구현했다 — 이 사이트 하나만을 위해 탱크옥션 수준의 워커/콜백
 * 인프라를 새로 만들 필요가 없었다.
 *
 * **배포 후 실측 추가 발견(2026-08-10)**: Railway(sfo, 해외 리전)에서
 * karhanbang.com으로 직접 fetch하면 매번 `ConnectTimeoutError`/
 * `fetch failed`로 실패한다 — VWorld API에서 이미 겪은 것과 동일한
 * "Railway 해외 리전이 국내 사이트 연결을 못 하는" 인프라 이슈
 * (docs/history/2026-07-21_01 참고). 그래서 모든 karhanbang.com
 * 요청은 이 서비스가 직접 fetch하지 않고, Vercel(서울 리전 icn1)의
 * `/api/realtor-collect/proxy` 라우트를 거쳐가도록 바꿨다
 * (`proxyFetch()`). 로컬 개발 환경(Railway가 아닌 국내 PC)에서는
 * 이 우회가 필요 없을 수 있지만, 다른 환경 분기를 늘리는 대신 항상
 * 프록시를 거치도록 통일했다 — 운영 배포와 항상 동일한 경로로
 * 검증할 수 있고, 로컬에서도 이미 배포된 Vercel 프록시를 그대로
 * 재사용할 수 있다. */
const LIST_URL_TEMPLATE =
  "https://www.karhanbang.com/office/office_list.asp?topM=09&flag=G&page={page}&search=&sel_sido={sido}&sel_gugun={gugun}&sel_dong={dong}";
const DETAIL_URL_TEMPLATE = "https://www.karhanbang.com/office/office_detail.asp?topM=09&mem_no={memNo}&{params}";
const AJAX_COMBO_URL = "https://www.karhanbang.com/office/ajax_combo_search.asp";

/** 사이트 자체 시/도 옵션값(12번 결번은 원본 그대로). */
const SIDO_LIST: Array<{ code: string; name: string }> = [
  { code: "1", name: "서울특별시" },
  { code: "2", name: "경기도" },
  { code: "3", name: "인천광역시" },
  { code: "4", name: "부산광역시" },
  { code: "5", name: "대구광역시" },
  { code: "6", name: "광주광역시" },
  { code: "7", name: "대전광역시" },
  { code: "8", name: "울산광역시" },
  { code: "9", name: "강원특별자치도" },
  { code: "10", name: "경상남도" },
  { code: "11", name: "경상북도" },
  { code: "13", name: "전북특별자치도" },
  { code: "14", name: "충청남도" },
  { code: "15", name: "충청북도" },
  { code: "16", name: "세종특별자치시" },
  { code: "17", name: "제주특별자치도" },
];

/** 배포 후 실측(2026-08-10~11): LIST_CONCURRENCY=5/DETAIL_CONCURRENCY=15는
 * 물론이고 3/5로 낮춰도 배치의 2/3 가까이가 계속 실패했다 — 실패
 * 로그 간격(배치당 약 30초)이 재시도 횟수(3회)×약 10초와 맞아떨어져,
 * WAF 차단이라기보다 **동시 요청이 몇 개만 겹쳐도 응답이 느려져
 * 타임아웃되는 것**으로 추정된다. 목록 페이지는 아예 동시성 없이
 * 순차 요청(1개씩)으로 낮췄다 — 느리지만 실측상 훨씬 안정적. 상세
 * 페이지는 목록보다 가벼워 소폭의 동시성(3)까지는 허용. */
const LIST_CONCURRENCY = 1;
const DETAIL_CONCURRENCY = 3;
const BATCH_DELAY_MS = 500;
const MAX_LOG_LINES = 500;

const ROW_RE =
  /<a href="javascript:moveDetail\('(\d+)','([^']*)'\);">([\s\S]*?)<\/a>[\s\S]*?<td class="coln01">([^<]*)<\/td>\s*<td class="coln03[^"]*">(?:<a href="tel:([^"]*)">[^<]*<\/a>)?<\/td>/g;

interface ListRow {
  memNo: string;
  params: string;
  name: string;
  dong: string;
  address: string;
  manager: string;
  landline: string;
}

export interface JobState {
  running: boolean;
  logs: string[];
  total: number;
  done: number;
  saved: number;
  sidoName: string;
  gugunName: string;
  dongName: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

function emptyState(): JobState {
  return {
    running: false,
    logs: [],
    total: 0,
    done: 0,
    saved: 0,
    sidoName: "",
    gugunName: "",
    dongName: "",
    startedAt: null,
    finishedAt: null,
    error: null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class RealtorCollectService {
  private readonly logger = new Logger(RealtorCollectService.name);
  private state: JobState = emptyState();

  constructor(
    @InjectRepository(RealtorOffice)
    private readonly repo: Repository<RealtorOffice>,
  ) {}

  listSido() {
    return SIDO_LIST;
  }

  /** karhanbang.com 요청은 전부 Vercel(서울 리전) 프록시를 거친다 —
   * Railway에서 직접 fetch하면 연결 자체가 안 된다(위 클래스 주석
   * 참고). `ajax=true`면 프록시가 WAF가 요구하는 Referer/
   * X-Requested-With 헤더를 함께 붙여 호출한다. */
  private async proxyFetch(targetUrl: string, options: { ajax?: boolean } = {}): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
    const secret = process.env.REALTOR_PROXY_SECRET;
    if (!secret) throw new ServiceUnavailableException("REALTOR_PROXY_SECRET 환경변수가 설정되지 않았습니다.");
    const proxyBase = (process.env.FRONTEND_URL?.split(",")[0]?.trim() || "https://auction-seven-tan.vercel.app").replace(/\/$/, "");
    const proxyUrl = new URL(`${proxyBase}/api/realtor-collect/proxy`);
    proxyUrl.searchParams.set("url", targetUrl);
    if (options.ajax) proxyUrl.searchParams.set("ajax", "1");

    try {
      const res = await fetch(proxyUrl.toString(), { headers: { "x-realtor-proxy-secret": secret } });
      return res;
    } catch (err) {
      const cause = err instanceof Error ? ((err as { cause?: unknown }).cause ?? err.message) : err;
      this.logger.error(`한방 프록시 호출 실패(${targetUrl}): ${JSON.stringify(cause)}`);
      throw new ServiceUnavailableException("한방 사이트에 연결하지 못했습니다.");
    }
  }

  /** flag="S": 시/군/구 목록, flag="G": 읍/면/동 목록(hanbang.py의
   * fetch_sub_options와 동일). 이 엔드포인트는 WAF(dotDefender)가
   * Referer/X-Requested-With를 요구함(실측 확인, 2026-08-10). */
  async fetchSubOptions(flag: "S" | "G", sidoCode: string, gugunCode = "") {
    const url = new URL(AJAX_COMBO_URL);
    url.searchParams.set("flag", flag);
    url.searchParams.set("sel_sido", sidoCode);
    url.searchParams.set("sel_gugun", gugunCode);

    const res = await this.proxyFetch(url.toString(), { ajax: true });
    if (!res.ok) throw new ServiceUnavailableException("한방 지역 목록 조회 요청 실패");
    const data = JSON.parse(await res.text()) as { datMM?: { code?: Array<string | number>; name?: string[] } };
    const codes = data.datMM?.code ?? [];
    const names = data.datMM?.name ?? [];
    return codes.map((code, i) => ({ code: String(code), name: names[i] ?? "" }));
  }

  getStatus(): JobState {
    return this.state;
  }

  private log(message: string) {
    const time = new Date().toLocaleTimeString("ko-KR", { hour12: false });
    this.state.logs.push(`[${time}] ${message}`);
    if (this.state.logs.length > MAX_LOG_LINES) {
      this.state.logs.splice(0, this.state.logs.length - MAX_LOG_LINES);
    }
  }

  start(input: {
    sidoCode: string;
    gugunCode: string;
    dongCode: string;
    sidoName: string;
    gugunName: string;
    dongName: string;
  }) {
    if (this.state.running) {
      throw new BadRequestException("이미 수집이 진행 중입니다. 완료 후 다시 시도해 주세요.");
    }
    this.state = {
      ...emptyState(),
      running: true,
      sidoName: input.sidoName,
      gugunName: input.gugunName,
      dongName: input.dongName,
      startedAt: new Date().toISOString(),
    };
    void this.run(input)
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.state.error = message;
        this.log(`오류 발생: ${message}`);
        this.logger.error(`한방 수집 실패: ${message}`);
      })
      .finally(() => {
        this.state.running = false;
        this.state.finishedAt = new Date().toISOString();
      });
    return { ok: true };
  }

  private async run(input: {
    sidoCode: string;
    gugunCode: string;
    dongCode: string;
    sidoName: string;
    gugunName: string;
    dongName: string;
  }) {
    const { sidoCode, gugunCode, dongCode, sidoName, gugunName, dongName } = input;
    this.log(`수집 시작: ${sidoName} ${gugunName || ""} ${dongName || ""}`.trim());

    const rows = await this.collectListRows(sidoCode, gugunCode, dongCode);
    this.state.total = rows.length;
    this.log(`총 ${rows.length}개 매물 상세 수집 시작...`);

    for (let i = 0; i < rows.length; i += DETAIL_CONCURRENCY) {
      const chunk = rows.slice(i, i + DETAIL_CONCURRENCY);
      await Promise.all(
        chunk.map(async (row) => {
          const detailUrl = DETAIL_URL_TEMPLATE.replace("{memNo}", row.memNo).replace("{params}", row.params);
          try {
            const mobiles = await this.fetchMobileNumbers(detailUrl);
            await this.upsert({
              memNo: row.memNo,
              sidoCode,
              sidoName,
              gugunCode,
              gugunName,
              dongCode,
              dongName,
              name: row.name,
              managerName: row.manager,
              address: row.address,
              landline: row.landline,
              mobilePrimary: mobiles[0] ?? "",
              mobileAll: mobiles.join(", "),
              detailUrl,
            });
            this.state.saved += 1;
          } catch (err) {
            this.log(`상세 수집 실패: ${row.name} (${err instanceof Error ? err.message : String(err)})`);
          }
          this.state.done += 1;
          if (this.state.done % 20 === 0 || this.state.done === rows.length) {
            this.log(`상세 수집 진행: ${this.state.done}/${rows.length}`);
          }
        }),
      );
      if (i + DETAIL_CONCURRENCY < rows.length) await sleep(BATCH_DELAY_MS);
    }
    this.log(`완료! ${this.state.saved}건 저장됨.`);
  }

  private async collectListRows(sidoCode: string, gugunCode: string, dongCode: string): Promise<ListRow[]> {
    const urlTemplate = LIST_URL_TEMPLATE.replace("{sido}", sidoCode)
      .replace("{gugun}", gugunCode)
      .replace("{dong}", dongCode);

    const all: ListRow[] = [];
    let page = 1;
    for (;;) {
      const batch = Array.from({ length: LIST_CONCURRENCY }, (_, i) => page + i);
      const results = await Promise.all(
        batch.map(async (p) => ({ page: p, ...(await this.fetchListPageWithRetry(urlTemplate, p)) })),
      );
      let stop = false;
      for (const { page: p, items, failed } of results) {
        // 요청 자체가 실패한 페이지(WAF 일시 차단 등)는 "목록이 비었다"는
        // 신호로 오인해 페이지네이션을 조기 종료하면 안 된다(실측 버그,
        // 2026-08-11: 재시도까지 다 실패한 두 번째 페이지를 빈 페이지로
        // 착각해 세종 1084건 중 10건만 수집하고 멈췄었음) — 실패는 로그만
        // 남기고 건너뛴다(그 페이지만 누락, 전체 수집은 계속 진행).
        if (failed) {
          this.log(`페이지 ${p} 조회 실패(건너뜀)`);
          continue;
        }
        if (items.length === 0) {
          stop = true;
          break;
        }
        all.push(...items);
        this.log(`페이지 ${p} / 목록 ${items.length}개`);
      }
      if (stop) break;
      page += LIST_CONCURRENCY;
      await sleep(BATCH_DELAY_MS);
    }
    return all;
  }

  private async fetchListPageWithRetry(
    urlTemplate: string,
    page: number,
    attempts = 3,
  ): Promise<{ items: ListRow[]; failed: boolean }> {
    for (let i = 1; i <= attempts; i += 1) {
      try {
        const items = await this.fetchListPage(urlTemplate, page);
        return { items, failed: false };
      } catch {
        if (i < attempts) await sleep(BATCH_DELAY_MS * i);
      }
    }
    return { items: [], failed: true };
  }

  /** 요청 자체가 실패하면(WAF 일시 차단 등) 예외를 던진다 — 빈 배열은
   * "정말로 이 페이지에 매물이 없다"는 뜻으로만 써야 한다(위 호출부
   * 주석 참고). */
  private async fetchListPage(urlTemplate: string, page: number): Promise<ListRow[]> {
    const url = urlTemplate.replace("{page}", String(page));
    const res = await this.proxyFetch(url);
    if (!res.ok) throw new Error(`목록 페이지 요청 실패(status ${res.status})`);
    const html = await res.text();
    return this.parseListRows(html);
  }

  private parseListRows(html: string): ListRow[] {
    const rows: ListRow[] = [];
    for (const m of html.matchAll(ROW_RE)) {
      const [, memNo, params, inner, manager, landline] = m;
      const lines = inner
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const name = (lines[0] ?? "").trim();
      if (!name) continue;
      const dongMatch = inner.match(/<span class="viewnum">([^<]*)<\/span>/);
      const addressMatch = inner.match(/<span class="date">([^<]*)<\/span>/);
      rows.push({
        memNo,
        params,
        name,
        dong: dongMatch?.[1]?.trim() ?? "",
        address: addressMatch?.[1]?.trim() ?? "",
        manager: manager?.trim() ?? "",
        landline: landline ?? "",
      });
    }
    return rows;
  }

  private async fetchMobileNumbers(detailUrl: string): Promise<string[]> {
    const res = await this.proxyFetch(detailUrl);
    if (!res.ok) return [];
    const html = await res.text();
    const nums = new Set<string>();
    for (const m of html.matchAll(/href="tel:([^"]+)"/g)) {
      if (m[1].startsWith("010")) nums.add(m[1]);
    }
    if (nums.size === 0) {
      for (const m of html.matchAll(/010[-\s]?\d{3,4}[-\s]?\d{4}/g)) {
        nums.add(m[0].replace(/\s+/g, ""));
      }
    }
    return [...nums].sort();
  }

  private async upsert(data: {
    memNo: string;
    sidoCode: string;
    sidoName: string;
    gugunCode: string;
    gugunName: string;
    dongCode: string;
    dongName: string;
    name: string;
    managerName: string;
    address: string;
    landline: string;
    mobilePrimary: string;
    mobileAll: string;
    detailUrl: string;
  }) {
    const existing = await this.repo.findOne({ where: { memNo: data.memNo } });
    if (existing) {
      await this.repo.update(existing.id, data);
      return;
    }
    const row = this.repo.create(data);
    await this.repo.save(row);
  }

  async list(filters: {
    sidoCode?: string;
    gugunCode?: string;
    dongCode?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
    const qb = this.repo.createQueryBuilder("o").orderBy("o.updatedAt", "DESC");
    if (filters.sidoCode) qb.andWhere("o.sidoCode = :sidoCode", { sidoCode: filters.sidoCode });
    if (filters.gugunCode) qb.andWhere("o.gugunCode = :gugunCode", { gugunCode: filters.gugunCode });
    if (filters.dongCode) qb.andWhere("o.dongCode = :dongCode", { dongCode: filters.dongCode });
    if (filters.search?.trim()) {
      qb.andWhere("(o.name ILIKE :q OR o.managerName ILIKE :q OR o.mobileAll ILIKE :q OR o.address ILIKE :q)", {
        q: `%${filters.search.trim()}%`,
      });
    }
    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items, total, page, pageSize };
  }

  async exportExcel(filters: { sidoCode?: string; gugunCode?: string; dongCode?: string; search?: string }): Promise<Buffer> {
    const qb = this.repo.createQueryBuilder("o").orderBy("o.updatedAt", "DESC");
    if (filters.sidoCode) qb.andWhere("o.sidoCode = :sidoCode", { sidoCode: filters.sidoCode });
    if (filters.gugunCode) qb.andWhere("o.gugunCode = :gugunCode", { gugunCode: filters.gugunCode });
    if (filters.dongCode) qb.andWhere("o.dongCode = :dongCode", { dongCode: filters.dongCode });
    if (filters.search?.trim()) {
      qb.andWhere("(o.name ILIKE :q OR o.managerName ILIKE :q OR o.mobileAll ILIKE :q OR o.address ILIKE :q)", {
        q: `%${filters.search.trim()}%`,
      });
    }
    const rows = await qb.getMany();
    const sheetRows = rows.map((r) => ({
      시도: r.sidoName,
      시군구: r.gugunName,
      읍면동: r.dongName,
      상호: r.name,
      담당자: r.managerName,
      "모바일(대표)": r.mobilePrimary,
      "모바일(전체)": r.mobileAll,
      전화: r.landline,
      주소: r.address,
      상세URL: r.detailUrl,
      수집일: r.updatedAt.toISOString().slice(0, 10),
    }));
    const sheet = XLSX.utils.json_to_sheet(sheetRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "부동산수집");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }
}
