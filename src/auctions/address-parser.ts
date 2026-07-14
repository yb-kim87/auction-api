import { formatTenantStatusText } from "./tenant-status.util";

const SIDO_NAMES = [
  "서울특별시",
  "부산광역시",
  "인천광역시",
  "대구광역시",
  "대전광역시",
  "광주광역시",
  "울산광역시",
  "세종특별자치시",
  "경기도",
  "강원특별자치도",
  "강원도",
  "충청북도",
  "충청남도",
  "전북특별자치도",
  "전라북도",
  "전라남도",
  "경상북도",
  "경상남도",
  "제주특별자치도",
];

const SIDO_ALIASES: Record<string, string> = {
  강원도: "강원특별자치도",
  전라북도: "전북특별자치도",
};

export function cleanAddress(address: string): string {
  return address
    .replace(/\u00a0/g, " ")
    .replace(/\s*주소복사\s*/g, " ")
    .replace(/ +/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

export function cleanEducation(education: string): string {
  return education
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^\+?\s*더보기\s*$/.test(line))
    .map((line) => line.replace(/^\+?\s*더보기\s*/, "").trim())
    .filter(Boolean)
    .join("\n");
}

export function cleanBuildingRegistry(buildingRegistry: string): string {
  if (!buildingRegistry || buildingRegistry === "없음" || buildingRegistry === "값없음") {
    return buildingRegistry;
  }
  const isHeader = (text: string) => {
    const normalized = text.replace(/\u00a0/g, " ").trim();
    if (!normalized) return true;
    if (normalized === "순서 접수일") return true;
    if (normalized.includes("접수번호") && normalized.includes("권리종류")) return true;
    return false;
  };
  const text = buildingRegistry.replace(/\u00a0/g, " ");
  if (text.includes(", ")) {
    const parts = text
      .split(", ")
      .map((part) => part.trim())
      .filter((part) => part && !isHeader(part));
    return parts.length ? parts.join(", ") : buildingRegistry;
  }
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !isHeader(line));
  return lines.length ? lines.join("\n") : buildingRegistry;
}

export function cleanTenantDetail(tenantDetail: string): string {
  const formatted = formatTenantStatusText(tenantDetail);
  if (formatted) return formatted;
  if (!tenantDetail || tenantDetail === "없음" || tenantDetail === "값없음") {
    return tenantDetail;
  }
  const isHeader = (text: string) => {
    const normalized = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized) return true;
    if (normalized === "점유") return true;
    if (normalized.includes("점유부분/기간") && normalized.includes("전입/확정/배당")) {
      return true;
    }
    if (/^목록\??/.test(normalized) && normalized.includes("임차인") && normalized.includes("대항력")) {
      return true;
    }
    return false;
  };
  const text = tenantDetail.replace(/\u00a0/g, " ");
  if (text.includes(", ")) {
    const parts = text
      .split(", ")
      .map((part) => part.trim())
      .filter((part) => part && !isHeader(part));
    return parts.length ? parts.join(", ") : tenantDetail;
  }
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !isHeader(line));
  return lines.length ? lines.join("\n") : tenantDetail;
}

export function cleanElevator(elevator: string): string {
  if (!elevator || elevator === "없음") return elevator;
  const match = elevator.replace(/\u00a0/g, " ").match(/(\d+대\s*\/\s*\d+대)/);
  return match ? match[1] : elevator;
}

export function cleanParking(parking: string): string {
  if (!parking || parking === "없음") return parking;
  const text = parking.replace(/\u00a0/g, " ");
  const totalMatch = text.match(/총\s*주차수\s*([\d,]+)\s*대/);
  if (totalMatch) return `${totalMatch[1]}대`;
  const plainMatch = text.match(/^([\d,]+)\s*대$/);
  if (plainMatch) return `${plainMatch[1]}대`;
  if (text.includes("주차")) {
    const looseMatch = text.match(/([\d,]+)\s*대/);
    if (looseMatch) return `${looseMatch[1]}대`;
  }
  return parking;
}

export function cleanElevatorAndParking(elevator: string, parking: string) {
  let nextParking = parking;
  if (!nextParking || nextParking === "없음") {
    const fromElevator = cleanParking(elevator);
    if (fromElevator && fromElevator !== elevator && fromElevator !== "없음") {
      nextParking = fromElevator;
    }
  }
  return {
    elevator: cleanElevator(elevator),
    parking: cleanParking(nextParking),
  };
}

export function parseAddressMeta(address: string) {
  const trimmed = cleanAddress(address);
  let city = "";
  let district = "";

  for (const sido of SIDO_NAMES) {
    if (!trimmed.startsWith(sido)) continue;

    city = SIDO_ALIASES[sido] ?? sido;
    const rest = trimmed.slice(sido.length).trim();
    // "용인시 기흥구"처럼 일반시+구가 함께 오는 경우까지 district에 포함시킨다.
    const match = rest.match(/^(\S+?시)\s+(\S+?구)(?=\s|$)|^(\S+?(?:시|군|구))/);
    if (match) district = match[1] && match[2] ? `${match[1]} ${match[2]}` : match[3];
    break;
  }

  let propType = "아파트";
  if (/빌라|연립|다세대|다가구/.test(trimmed)) {
    propType = "빌라";
  }

  return { city, district, propType };
}
