const { db } = require("../db");
const { safeJsonParse, bugLinks } = require("../lib/utils");

function formatActivity(row) {
  return {
    id: row.id,
    parentId: row.parent_id,
    assetId: row.asset_id,
    modelId: row.model_id,
    actorName: row.actor_name,
    action: row.action,
    summary: row.summary,
    before: safeJsonParse(row.before_json, null),
    after: safeJsonParse(row.after_json, null),
    reason: row.reason || "",
    nvbug: row.nvbug || "",
    nvbugLinks: bugLinks(row.nvbug),
    source: row.source || "",
    metadata: safeJsonParse(row.metadata_json, null),
    createdAt: row.created_at,
  };
}

function listAssetActivity(assetId, limit = 200) {
  return db.prepare("SELECT * FROM asset_activity_log WHERE asset_id = ? ORDER BY created_at DESC LIMIT ?").all(assetId, limit).map(formatActivity);
}

function listActivity(limit = 500) {
  return db.prepare(`
    SELECT * FROM asset_activity_log
    WHERE parent_id IS NULL
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit).map(formatActivity);
}

module.exports = {
  formatActivity,
  listAssetActivity,
  listActivity,
};
