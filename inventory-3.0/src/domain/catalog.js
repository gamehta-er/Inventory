const { db, tx, logActivity } = require("../db");
const { STATUSES, COMMON_FIELDS } = require("../config/constants");
const { now, slugify, safeJsonParse, json } = require("../lib/utils");
const { httpError } = require("../lib/http");

function categoryRows() {
  return db.prepare("SELECT * FROM categories WHERE active = 1 ORDER BY sort_order, name").all();
}

function memberRows() {
  return db.prepare("SELECT * FROM team_members WHERE active = 1 ORDER BY name").all();
}

function locationRows() {
  return db.prepare("SELECT * FROM locations WHERE active = 1 ORDER BY building, detail").all();
}

function fieldRows(categoryId) {
  return db.prepare("SELECT * FROM field_definitions WHERE category_id = ? ORDER BY sort_order").all(categoryId).map((field) => ({
    id: field.id,
    categoryId: field.category_id,
    key: field.field_key,
    label: field.label,
    type: field.type,
    required: Boolean(field.required),
    options: safeJsonParse(field.options_json, null),
  }));
}

function findMemberByName(name) {
  if (!name) return null;
  return db.prepare("SELECT * FROM team_members WHERE LOWER(name) = LOWER(?) OR LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)").get(name, name, name) || null;
}

function findLocationByName(name) {
  if (!name) return null;
  return db.prepare("SELECT * FROM locations WHERE LOWER(name) = LOWER(?)").get(name) || null;
}

function findCategoryByName(name) {
  if (!name) return null;
  const slug = slugify(name);
  return db.prepare("SELECT * FROM categories WHERE LOWER(name) = LOWER(?) OR slug = ?").get(name, slug) || null;
}

function getOrCreateLocation(name) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const existing = findLocationByName(clean);
  if (existing) return existing.id;
  const building = clean.includes("Building S") ? "Building S" : clean.includes("Building E") ? "Building E" : "Building R";
  const info = db.prepare("INSERT INTO locations (name, building, detail) VALUES (?, ?, ?)").run(clean, building, clean.replace(`Santa Clara ${building} / `, ""));
  return Number(info.lastInsertRowid);
}

function getOrCreateMember(name, email = "") {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const existing = findMemberByName(clean);
  if (existing) return existing.id;
  const username = clean.toLowerCase().replace(/[^a-z0-9]+/g, ".");
  const info = db.prepare("INSERT INTO team_members (name, email, username) VALUES (?, ?, ?)").run(clean, email || `${username}@nvidia.com`, username);
  return Number(info.lastInsertRowid);
}

function getOrCreateModel(categoryId, modelName, values = {}) {
  const clean = String(modelName || "Unspecified Model").trim();
  const existing = db.prepare("SELECT * FROM asset_models WHERE category_id = ? AND LOWER(name) = LOWER(?)").get(categoryId, clean);
  if (existing) return existing.id;
  const prefix = db.prepare("SELECT prefix FROM categories WHERE id = ?").get(categoryId).prefix;
  const info = db.prepare(`
    INSERT INTO asset_models (category_id, name, manufacturer, model_number, sku, description, label_line, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(categoryId, clean, values.manufacturer || "", values.modelNumber || "", values.sku || `${prefix}-IMPORT`, "Imported model.", `${prefix} ${clean}`, now(), now());
  return Number(info.lastInsertRowid);
}

function updateCategoryFields(categoryId, payload) {
  const category = db.prepare("SELECT * FROM categories WHERE id = ?").get(categoryId);
  if (!category) throw httpError(404, "Category not found.");
  const updates = Array.isArray(payload.fields) ? payload.fields : [];
  return tx(() => {
    const before = fieldRows(categoryId);
    const update = db.prepare("UPDATE field_definitions SET required = ? WHERE category_id = ? AND field_key = ?");
    for (const field of updates) update.run(field.required ? 1 : 0, categoryId, field.key);
    const after = fieldRows(categoryId);
    logActivity({
      actorName: payload.actorName || "Admin User",
      action: "field-settings-update",
      summary: `Updated required fields for ${category.name}`,
      before,
      after,
      reason: payload.reason || "Updated field settings",
      source: "admin",
      metadata: { categoryId },
    });
    return { category: { ...category, fields: after } };
  });
}

module.exports = {
  STATUSES,
  COMMON_FIELDS,
  categoryRows,
  memberRows,
  locationRows,
  fieldRows,
  findMemberByName,
  findLocationByName,
  findCategoryByName,
  getOrCreateLocation,
  getOrCreateMember,
  getOrCreateModel,
  updateCategoryFields,
};
