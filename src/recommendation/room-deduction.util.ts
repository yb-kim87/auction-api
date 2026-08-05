/**
 * 방빼기(방공제) — 소액임차인 최우선변제금액을 대출한도 계산에서 미리
 * 차감하는 실무 관행. 실제 임차인 유무·보증금과 무관하게, 은행이 담보
 * 여력을 보수적으로 잡기 위해 해당 지역 기준 최우선변제금액 1건을
 * 무조건 차감한다(사용자 요청, 2026-08-05: "방빼기(방공제) 적용 여부를
 * 체크박스 할 수 있게 해주고, 방공제 적용은 지역별로 데이터를 적용").
 *
 * 기준: 주택임대차보호법 시행령 2023.2.21. 개정(최신판, 사용자 확인 후
 * 통일 적용하기로 함) 최우선변제금액 표. 지역 구분은 실무에서 쓰는
 * 4단계(서울/과밀억제권역/광역시 등/그 밖의 지역)를 그대로 따른다.
 */

const SEOUL_DEDUCTION_WON = 55_000_000;
const OVERCONCENTRATED_DEDUCTION_WON = 48_000_000; // 수도권 과밀억제권역(서울 제외)
const METRO_ETC_DEDUCTION_WON = 28_000_000; // 광역시(인천 제외)·세종·안산·용인·김포·광주(경기)
const OTHER_DEDUCTION_WON = 25_000_000; // 그 밖의 지역

// 수도권정비계획법상 과밀억제권역(서울 제외) 소속 시/군. 인천은 강화군·옹진군 등
// 일부 예외가 있으나 방공제 실무 적용에서는 세분화하지 않고 인천 전역을 포함한다.
const OVERCONCENTRATED_CITIES = new Set([
  "인천",
  "의정부",
  "구리",
  "남양주",
  "하남",
  "고양",
  "수원",
  "성남",
  "안양",
  "부천",
  "광명",
  "과천",
  "의왕",
  "군포",
  "시흥",
]);

// 광역시(인천 제외) + 경기 안산·용인·김포·광주는 서울/과밀억제권역 다음 3단계.
const METRO_ETC_CITIES = new Set([
  "부산",
  "대구",
  "대전",
  "광주", // 광주광역시(normalizeCityToken이 "광역시"를 떼어내 "광주"만 남음)
  "울산",
  "세종",
  "안산",
  "용인",
  "김포",
]);

function normalizeCityToken(city: string | null | undefined): string {
  return (city ?? "").trim().replace(/(특별시|광역시|특별자치시|특별자치도|도)$/g, "").trim();
}

/** 물건 소재지(city: 시/도, district: 시/군/구)를 보고 방공제 지역
 * 단계를 판정해 최우선변제금액(원)을 반환한다. */
export function getRoomDeductionWon(
  city: string | null | undefined,
  district: string | null | undefined,
): number {
  const cityToken = normalizeCityToken(city);
  const districtToken = (district ?? "").trim();

  if (cityToken === "서울") return SEOUL_DEDUCTION_WON;

  // 경기도 소속 시는 city="경기", district에 시/군명이 들어온다(예: "수원시 영통구").
  const districtCity = districtToken.replace(/시.*$/, "시").replace(/(시|군)$/, "");
  if (
    OVERCONCENTRATED_CITIES.has(cityToken) ||
    (cityToken === "경기" && OVERCONCENTRATED_CITIES.has(districtCity))
  ) {
    return OVERCONCENTRATED_DEDUCTION_WON;
  }

  if (
    METRO_ETC_CITIES.has(cityToken) ||
    (cityToken === "경기" && districtCity === "광주") // 경기 광주시
  ) {
    return METRO_ETC_DEDUCTION_WON;
  }

  return OTHER_DEDUCTION_WON;
}
