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
 * `NaverComplexLink`로 별도 구현돼 있어 여기서는 중복하지 않는다.
 *
 * 네이버지도/다음(카카오)지도는 주소 텍스트 검색이라 좌표(VWorld
 * 지오코딩) 없이 항상 즉시 만들 수 있다(사용자 요청, 2026-08-10:
 * "모든 용도에 해당하는 네이버지도 다음지도도 넣어줘") — 용도 구분
 * 없이 전 물건에 노출. 부동산플래닛/네이버부동산은 좌표가 캐싱돼
 * 있어야만 추가된다. */
export function buildAuctionReferenceLinks(input: {
  lat: number | null;
  lng: number | null;
  usage: string;
  address: string;
}): AuctionReferenceLink[] {
  const links: AuctionReferenceLink[] = [];
  const address = input.address.trim();
  if (address) {
    const q = encodeURIComponent(address);
    links.push({ label: "네이버지도", url: `https://map.naver.com/p/search/${q}` });
    links.push({ label: "다음지도", url: `https://map.kakao.com/link/search/${q}` });
  }
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
