export type LatLng = { lat: number; lng: number };

const M_PER_DEG_LAT = 111_320;

export function pointInRing(lat: number, lng: number, ring: LatLng[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const { lat: yi, lng: xi } = ring[i];
    const { lat: yj, lng: xj } = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 점에서 다각형 변까지의 최단거리(m). 점 주변을 평면(미터)으로 근사한다. */
export function distanceToRingMeters(lat: number, lng: number, ring: LatLng[]): number {
  const kx = Math.cos((lat * Math.PI) / 180) * M_PER_DEG_LAT;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j].lng - lng) * kx;
    const ay = (ring[j].lat - lat) * M_PER_DEG_LAT;
    const bx = (ring[i].lng - lng) * kx;
    const by = (ring[i].lat - lat) * M_PER_DEG_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best;
}

/** 구역 경계까지의 거리(m) — 구역 안이면 0, 밖이면 가장 가까운 변까지의 거리(올림). */
export function distanceToZoneM(lat: number, lng: number, polygon: LatLng[]): number {
  if (pointInRing(lat, lng, polygon)) return 0;
  return Math.ceil(distanceToRingMeters(lat, lng, polygon));
}

export function centroid(polygon: LatLng[]): LatLng {
  const n = polygon.length || 1;
  return {
    lat: polygon.reduce((a, p) => a + p.lat, 0) / n,
    lng: polygon.reduce((a, p) => a + p.lng, 0) / n,
  };
}
