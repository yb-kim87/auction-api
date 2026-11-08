/**
 * 타일 요청 범위를 "0.2도 × 0.2도로 딱 떨어지는 정사각형" 대신, 0.2에 가까운 직사각형(예: 세로 0.2123 × 가로 0.2344)으로 만든다(사용자 요청 2026-11-08).
 * - 세로·가로 폭은 각각 0.2에 0.0100~0.0500을 더한 값(소수점 4자리)이고 요청마다, 가로·세로마다 다르다.
 * - 타일 칸(minLat~maxLat, minLng~maxLng)을 항상 포함하도록 늘어난 만큼을 양쪽 변에 랜덤 비율로 나눠 바깥쪽으로 넓힌다(타일 안 구역이 빠지지 않음).
 * - 모든 변 값은 toFixed(4)로 소수점 4자리.
 */
const EXTRA_MIN = 0.01;
const EXTRA_MAX = 0.05;

function expand(min: number, max: number): [string, string] {
  const extra = EXTRA_MIN + Math.random() * (EXTRA_MAX - EXTRA_MIN);
  const lowSide = extra * (0.2 + Math.random() * 0.6); // 늘어난 폭을 아래/위 변에 20~80% 비율로 나눔
  return [(min - lowSide).toFixed(4), (max + (extra - lowSide)).toFixed(4)];
}

/** 타일 칸 하나를 덮는 불규칙 직사각형 범위의 쿼리 앞부분(min_lat…max_lng). */
export function tileBoxQuery(minLat: number, maxLat: number, minLng: number, maxLng: number): string {
  const [a, b] = expand(minLat, maxLat);
  const [c, d] = expand(minLng, maxLng);
  return `min_lat=${a}&max_lat=${b}&min_lng=${c}&max_lng=${d}`;
}
