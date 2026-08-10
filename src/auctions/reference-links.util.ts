export type AuctionReferenceLink = {
  label: string;
  url: string;
};

/** 탱크옥션 물건 상세 우측 사이드 메뉴("N단지정보", "부동산플래닛" 등)를
 * 실측 분석해(2026-08-09, tank_detailview.js) 우리 시스템에도 동일한
 * 외부 참고링크를 붙인다(사용자 요청, 2026-08-10). 네이버부동산/N단지정보는
 * 이미 naverId(djNo) 기반 NaverComplexLink로 별도 구현돼 있어 여기서는
 * 중복하지 않는다. */
export function buildAuctionReferenceLinks(input: {
  lat: number | null;
  lng: number | null;
}): AuctionReferenceLink[] {
  const links: AuctionReferenceLink[] = [];
  if (input.lat != null && input.lng != null) {
    links.push({
      label: "부동산플래닛",
      url: `https://www.bdsplanet.com/map/realprice_map.ytp?s_area_lat=${input.lat}&s_area_lng=${input.lng}&s_area_zoom=19&use=true&utm_campaign=share`,
    });
  }
  return links;
}
