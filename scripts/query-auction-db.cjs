const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

(async () => {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(path.join(__dirname, "..", "data", "auction.db"));
  const db = new SQL.Database(buf);
  for (const q of ["71432", "56916"]) {
    const r = db.exec(
      `SELECT auctionNo, bidDate, minPrice, naverPrice, status, createdAt, updatedAt FROM auctions WHERE auctionNo LIKE '%${q}%' LIMIT 5`,
    );
    console.log("---", q, r[0]?.values ?? "NOT FOUND");
  }
  const total = db.exec("SELECT COUNT(*) FROM auctions");
  console.log("total", total[0]?.values);
  db.close();
})();
