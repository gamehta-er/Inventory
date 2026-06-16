const fs = require("node:fs");
const path = require("node:path");
const { db, logActivity, bumpRevision } = require("../db");
const { dbPath, backupDir } = require("../config/paths");
const { httpError } = require("../lib/http");
const logger = require("../lib/logger");

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

function restoreBackup(payload, actorName = "Admin User") {
  const backupId = String(payload.backupId || "");
  const confirm = String(payload.confirm || "");
  const { filename, fullPath } = backupPathById(backupId);
  if (confirm !== `RESTORE ${filename}`) {
    throw httpError(400, "Confirmation text does not match.", { errors: { confirm: `Type RESTORE ${filename}` } });
  }
  const preRestoreName = `inventory-3-backup-prerestore-${Date.now()}.db`;
  const preRestorePath = path.join(backupDir, preRestoreName);
  db.exec("PRAGMA wal_checkpoint(FULL);");
  fs.copyFileSync(dbPath, preRestorePath);
  fs.copyFileSync(fullPath, dbPath);
  logActivity({
    actorName,
    action: "backup-restore",
    summary: `Restored backup ${filename}`,
    source: "admin",
    metadata: { filename, preRestoreName },
  });
  bumpRevision();
  logger.warn("database restored", { filename, preRestoreName, actorName });
  return { restored: filename, preRestoreBackup: preRestoreName, backups: listBackups() };
}

module.exports = {
  listBackups,
  createBackup,
  backupPathById,
  restoreBackup,
};
