/**
 * "010-1234-5678", "010 1234 5678", "p:+82 10-1234-5678"(페이스북 리드폼
 * 원본 형식) 등 → "01012345678". 형식이 아니면 null.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  // 국제번호(+82...) 형식이면 국가코드를 0으로 치환
  if (digits.startsWith("82") && digits.length >= 11) {
    digits = "0" + digits.slice(2);
  }
  if (!/^01[0-9]\d{7,8}$/.test(digits)) return null;
  return digits;
}
