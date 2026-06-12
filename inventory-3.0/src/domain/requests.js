const { db } = require("../db");
const { bugLinks } = require("../lib/utils");

function listRequests() {
  return db.prepare(`
    SELECT r.*, a.asset_tag, a.serial, c.name AS category_name, c.slug AS category_slug, m.name AS model_name, tm.name AS owner_name
    FROM asset_requests r
    JOIN assets a ON a.id = r.asset_id
    JOIN categories c ON c.id = a.category_id
    JOIN asset_models m ON m.id = a.model_id
    LEFT JOIN team_members tm ON tm.id = r.owner_id
    ORDER BY r.created_at DESC
    LIMIT 300
  `).all().map((row) => ({
    id: row.id,
    assetId: row.asset_id,
    assetTag: row.asset_tag,
    serial: row.serial || "",
    category: row.category_name,
    categorySlug: row.category_slug,
    model: row.model_name,
    type: row.type,
    priority: row.priority,
    status: row.status,
    owner: row.owner_name || "",
    reason: row.reason || "",
    nvbug: row.nvbug || "",
    nvbugLinks: bugLinks(row.nvbug),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

module.exports = {
  listRequests,
};
