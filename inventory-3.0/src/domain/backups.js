const fs = require("node:fs");
const path = require("node:path");
const { db, logActivity, bumpRevision } = require("../db");
const { dbPath, backupDir } = require("../config/paths");
const { httpError } = require("../lib/http");

function listBackups() {
  return fs.readdirSync(backupDir)
    .filter((name) => /^inventory-3-backup-\d{8}-\d{6}\.db$/.test(name))
    .map((name) => {
      const fullPath = path.join(backupDir, name);
      const stat = fs.statSync(fullPath);
      return {
        id: name,
        filename: name,
        location: fullPath,
        folder: backupDir,
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function createBackup(actorName = "Admin User") {
  const compact = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const stamp = `${compact.slice(0, 8)}-${compact.slice(8, 14)}`;
  const filename = `inventory-3-backup-${stamp}.db`;
  const destination = path.join(backupDir, filename);
  db.exec("PRAGMA wal_checkpoint(FULL);");
  fs.copyFileSync(dbPath, destination);
  logActivity({
    actorName,
    action: "backup-create",
    summary: `Created backup ${filename}`,
    source: "admin",
    metadata: { filename },
  });
  bumpRevision();
  return { backup: listBackups().find((backup) => backup.id === filename), backups: listBackups() };
}

function backupPathById(id) {
  const filename = path.basename(String(id || ""));
  if (!/^inventory-3-backup-\d{8}-\d{6}\.db$/.test(filename)) throw httpError(400, "Invalid backup id.");
  const fullPath = path.join(backupDir, filename);
  if (!fs.existsSync(fullPath)) throw httpError(404, "Backup not found.");
  return { filename, fullPath };
}

module.exports = {
  listBackups,
  createBackup,
  backupPathById,
};
