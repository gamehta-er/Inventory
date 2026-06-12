const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..", "..");
const publicDir = path.join(rootDir, "public");
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(rootDir, "data");
const uploadDir = path.join(dataDir, "uploads");
const backupDir = path.join(dataDir, "backups");
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(dataDir, "inventory-3.db");

for (const dir of [dataDir, uploadDir, backupDir, path.dirname(dbPath)]) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  rootDir,
  publicDir,
  dataDir,
  uploadDir,
  backupDir,
  dbPath,
};
