const { db, tx, logActivity } = require("../db");
const { now } = require("../lib/utils");
const { httpError } = require("../lib/http");

function listLocations() {
  return db.prepare("SELECT * FROM locations ORDER BY active DESC, building, detail").all();
}

function createLocation(payload, actorName) {
  const name = String(payload.name || "").trim();
  const building = String(payload.building || "Building R").trim();
  const detail = String(payload.detail || name).trim();
  if (!name) throw httpError(400, "Location name is required.", { errors: { name: "Location name is required." } });
  if (db.prepare("SELECT id FROM locations WHERE LOWER(name) = LOWER(?)").get(name)) {
    throw httpError(400, "Location already exists.", { errors: { name: "Location already exists." } });
  }
  return tx(() => {
    const info = db.prepare("INSERT INTO locations (name, building, detail, active) VALUES (?, ?, ?, 1)").run(name, building, detail);
    const id = Number(info.lastInsertRowid);
    logActivity({ actorName, action: "location-create", summary: `Added location ${name}`, source: "admin", metadata: { locationId: id } });
    return { location: db.prepare("SELECT * FROM locations WHERE id = ?").get(id) };
  });
}

function updateLocation(id, payload, actorName) {
  const current = db.prepare("SELECT * FROM locations WHERE id = ?").get(id);
  if (!current) throw httpError(404, "Location not found.");
  const name = String(payload.name ?? current.name).trim();
  const building = String(payload.building ?? current.building).trim();
  const detail = String(payload.detail ?? current.detail).trim();
  const active = payload.active === undefined ? current.active : (payload.active ? 1 : 0);
  if (active === 0 && db.prepare("SELECT COUNT(*) AS count FROM assets WHERE location_id = ?").get(id).count) {
    throw httpError(400, "Location is referenced by assets.", { errors: { active: "Cannot deactivate a referenced location." } });
  }
  return tx(() => {
    db.prepare("UPDATE locations SET name = ?, building = ?, detail = ?, active = ? WHERE id = ?").run(name, building, detail, active, id);
    logActivity({ actorName, action: "location-update", summary: `Updated location ${name}`, source: "admin", metadata: { locationId: id } });
    return { location: db.prepare("SELECT * FROM locations WHERE id = ?").get(id) };
  });
}

function listMembers() {
  return db.prepare("SELECT * FROM team_members ORDER BY active DESC, name").all();
}

function createMember(payload, actorName) {
  const name = String(payload.name || "").trim();
  const email = String(payload.email || "").trim();
  const username = String(payload.username || name.toLowerCase().replace(/[^a-z0-9]+/g, ".")).trim();
  if (!name) throw httpError(400, "Name is required.", { errors: { name: "Name is required." } });
  if (!email) throw httpError(400, "Email is required.", { errors: { email: "Email is required." } });
  if (db.prepare("SELECT id FROM team_members WHERE LOWER(email) = LOWER(?) OR LOWER(name) = LOWER(?)").get(email, name)) {
    throw httpError(400, "Member already exists.", { errors: { email: "Member already exists." } });
  }
  return tx(() => {
    const info = db.prepare("INSERT INTO team_members (name, email, username, active) VALUES (?, ?, ?, 1)").run(name, email, username);
    const id = Number(info.lastInsertRowid);
    logActivity({ actorName, action: "member-create", summary: `Added member ${name}`, source: "admin", metadata: { memberId: id } });
    return { member: db.prepare("SELECT * FROM team_members WHERE id = ?").get(id) };
  });
}

function updateMember(id, payload, actorName) {
  const current = db.prepare("SELECT * FROM team_members WHERE id = ?").get(id);
  if (!current) throw httpError(404, "Member not found.");
  const name = String(payload.name ?? current.name).trim();
  const email = String(payload.email ?? current.email).trim();
  const username = String(payload.username ?? current.username).trim();
  const active = payload.active === undefined ? current.active : (payload.active ? 1 : 0);
  return tx(() => {
    db.prepare("UPDATE team_members SET name = ?, email = ?, username = ?, active = ? WHERE id = ?").run(name, email, username, active, id);
    logActivity({ actorName, action: "member-update", summary: `Updated member ${name}`, source: "admin", metadata: { memberId: id } });
    return { member: db.prepare("SELECT * FROM team_members WHERE id = ?").get(id) };
  });
}

function listModels(categoryId) {
  const rows = categoryId
    ? db.prepare("SELECT * FROM asset_models WHERE category_id = ? ORDER BY name").all(categoryId)
    : db.prepare("SELECT * FROM asset_models ORDER BY category_id, name").all();
  return rows;
}

function createModel(payload, actorName) {
  const categoryId = Number(payload.categoryId);
  const name = String(payload.name || "").trim();
  if (!categoryId) throw httpError(400, "Category is required.", { errors: { categoryId: "Category is required." } });
  if (!name) throw httpError(400, "Model name is required.", { errors: { name: "Model name is required." } });
  const category = db.prepare("SELECT * FROM categories WHERE id = ?").get(categoryId);
  if (!category) throw httpError(404, "Category not found.");
  if (db.prepare("SELECT id FROM asset_models WHERE category_id = ? AND LOWER(name) = LOWER(?)").get(categoryId, name)) {
    throw httpError(400, "Model already exists.", { errors: { name: "Model already exists." } });
  }
  return tx(() => {
    const info = db.prepare(`
      INSERT INTO asset_models (category_id, name, manufacturer, model_number, sku, description, label_line, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      categoryId,
      name,
      payload.manufacturer || "",
      payload.modelNumber || "",
      payload.sku || `${category.prefix}-MDL`,
      payload.description || "",
      `${category.prefix} ${name}`,
      now(),
      now(),
    );
    const id = Number(info.lastInsertRowid);
    logActivity({ actorName, action: "model-create", summary: `Added model ${name}`, source: "admin", metadata: { modelId: id, categoryId } });
    return { model: db.prepare("SELECT * FROM asset_models WHERE id = ?").get(id) };
  });
}

function deactivateModel(id, actorName) {
  const model = db.prepare("SELECT * FROM asset_models WHERE id = ?").get(id);
  if (!model) throw httpError(404, "Model not found.");
  if (db.prepare("SELECT COUNT(*) AS count FROM assets WHERE model_id = ?").get(id).count) {
    throw httpError(400, "Model is referenced by assets.", { errors: { model: "Cannot remove a model in use." } });
  }
  return tx(() => {
    db.prepare("DELETE FROM asset_models WHERE id = ?").run(id);
    logActivity({ actorName, action: "model-delete", summary: `Removed model ${model.name}`, source: "admin", metadata: { modelId: id } });
    return { ok: true };
  });
}

module.exports = {
  listLocations,
  createLocation,
  updateLocation,
  listMembers,
  createMember,
  updateMember,
  listModels,
  createModel,
  deactivateModel,
};
