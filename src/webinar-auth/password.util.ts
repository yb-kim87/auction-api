import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/** 외부 의존성(bcrypt 등) 추가 없이 Node 내장 crypto의 scrypt로 비밀번호를
 * 해싱한다. 형식: "salt:hash" (둘 다 hex). */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(plain, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
