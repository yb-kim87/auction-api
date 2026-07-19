export type UpdateAuctionDto = {
  memo: string;
  link: string;
  views: number;
  auctionNo: string;
  /** 담당 법원+계(예: "수원지방법원 9계"). 사건번호가 법원마다 독립적으로
   * 채번되어 겹칠 수 있어, 물건 식별 고유 키를 만들 때 사건번호와 함께
   * 반드시 같이 쓴다(auction-no.util.ts normalizeAuctionNo 참고). */
  court?: string;
  /** 탱크옥션 baseInfo.stateNm 원문(진행/변경/취하/매각 등). */
  caseState?: string;
  address: string;
  totalUnits: number;
  usage: string;
  area: string;
  builtYear: number;
  bidDate: string;
  appraisedValue: number;
  minPrice: number;
  salePrice: number | null;
  naverPrice: number;
  naverPriceFloor: number | null;
  naverPriceFloorLabel: string | null;
  naverId: string;
  diffNaverSale: number | null;
  diffNaverMin: number;
  diffNaverAppraised: number;
  elevator: string;
  parking: string;
  landShare: string;
  buildingRegistry: string;
  education: string;
  tradingCount: string;
  bidInfo: string;
  owner: string;
  appraiser: string;
  officialLandPrice: number;
  tenantInfo: string;
  specialNote: string;
  tenantDetail: string;
  priceDetail: string;
  tradingDetail: string;
  recordTime: string;
  /** 관리자가 직접 표시하는 재개발 여부(자동 판별 불가). */
  isRedevelopment?: boolean;
  /** 아직 정식 컬럼으로 승격하지 않은 크롤러 부가 데이터(선택). */
  extraData?: Record<string, unknown> | null;
};
