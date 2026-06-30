export function hasNaverPrice(naverPrice: number | null | undefined): boolean {
  return naverPrice != null && Number.isFinite(naverPrice) && naverPrice > 0;
}
