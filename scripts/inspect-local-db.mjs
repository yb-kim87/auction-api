import initSqlJs from "sql.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync(path.join(root, "data", "auction.db")));
const cols = db.exec("PRAGMA table_info(auctions)")[0]?.values.map((v) => v[1]) ?? [];
console.log("columns:", cols.join(", "));
const count = db.exec("SELECT COUNT(*) FROM auctions")[0].values[0][0];
console.log("total:", count);
const byStatus = db.exec("SELECT status, COUNT(*) FROM auctions GROUP BY status");
console.log("by status:", byStatus[0]?.values);
