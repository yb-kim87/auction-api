/** PostgreSQL은 timestamptz, 로컬 sql.js는 datetime */
export function resolveTimestampType(): "timestamptz" | "datetime" {
  return process.env.DATABASE_URL?.trim() ? "timestamptz" : "datetime";
}
