export type AuctionReferenceLink = {
  label: string;
  url: string;
};

/** 탱크옥션의 `resolveNaverLandGroup`/`resolveNaverLandFilterGroup`
 * (tank_detailview.js 실측, 2026-08-09)과 동일한 3분류 — 탱크옥션은
 * 내부 cat3 코드로 분류하지만 우리는 그 코드가 없어 usage 텍스트
 * 키워드로 근사한다(address-parser.ts의 빌라 판정 키워드와 동일). */
function resolveNaverLandGroup(usage: string): { path: string; filter: string } {
  if (/빌라|연립|다세대|다가구|도시형생활주택/.test(usage)) {
    return { path: "houses", filter: "VL:JWJT:DDDGG:SGJT:HOJT" };
  }
  if (/아파트|오피스텔/.test(usage)) {
    return { path: "complexes", filter: "APT:OPST" };
  }
  return { path: "offices", filter: "SG:SMS:GJCG:GM:TJ:APTHGJ" };
}

/** 탱크옥션 물건 상세 우측 사이드 메뉴("N단지정보", "부동산플래닛",
 * "네이버부동산" 등)를 실측 분석해(2026-08-09, tank_detailview.js)
 * 우리 시스템에도 동일한 외부 참고링크를 붙인다(사용자 요청,
 * 2026-08-10). N단지정보(단지 상세페이지, naverId/djNo 기반)는 이미
 * `NaverComplexLink`로 별도 구현돼 있어 여기서는 중복하지 않고,
 * 좌표 기반 지도 검색 링크(네이버부동산/부동산플래닛)만 다룬다. */
export function buildAuctionReferenceLinks(input: {
  lat: number | null;
  lng: number | null;
  usage: string;
}): AuctionReferenceLink[] {
  const links: AuctionReferenceLink[] = [];
  if (input.lat != null && input.lng != null) {
    links.push({
      label: "부동산플래닛",
      url: `https://www.bdsplanet.com/map/realprice_map.ytp?s_area_lat=${input.lat}&s_area_lng=${input.lng}&s_area_zoom=19&use=true&utm_campaign=share`,
    });
    const { path, filter } = resolveNaverLandGroup(input.usage);
    links.push({
      label: "네이버부동산",
      url: `https://new.land.naver.com/${path}?ms=${input.lat},${input.lng},16&a=${filter}&e=RETAIL`,
    });
  }
  return links;
}
