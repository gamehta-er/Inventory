const { db, tx, logActivity, getRevision } = require("../db");
const {
  STATUSES,
  ACTIVE_STATUSES,
  AVAILABLE_STATUSES,
  EXCEPTION_STATUSES,
} = require("../config/constants");
const { now, safeJsonParse, json, normalizeBug, bugLinks } = require("../lib/utils");
const { httpError } = require("../lib/http");
const {
  fieldRows,
  findCategoryByName,
  getOrCreateModel,
} = require("./catalog");
const { formatActivity } = require("./activity");

function hydrateAsset(row) {
  if (!row) return null;
  const extra = safeJsonParse(row.extra_json, {});
  return {
    id: row.id,
    modelId: row.model_id,
    categoryId: row.category_id,
    category: row.category_name,
    categorySlug: row.category_slug,
    categoryPrefix: row.category_prefix,
    model: row.model_name,
    manufacturer: row.manufacturer || "",
    modelNumber: row.model_number || "",
    sku: row.sku || "",
    modelImagePath: row.image_path || "",
    serial: row.serial || "",
    assetTag: row.asset_tag,
    status: row.status,
    ownerId: row.owner_id || "",
    owner: row.owner_name || "",
    ownerEmail: row.owner_email || "",
    locationId: row.location_id,
    location: row.location_name,
    building: row.building,
    usage: row.usage || "",
    nvbug: row.nvbug || "",
    nvbugLinks: bugLinks(row.nvbug),
    borrowedLent: row.borrowed_lent || "",
    notes: row.notes || "",
    extra,
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
  };
}

function assetSelectSql() {
  return `
    SELECT
      a.*, c.name AS category_name, c.slug AS category_slug, c.prefix AS category_prefix,
      m.name AS model_name, m.manufacturer, m.model_number, m.sku, m.image_path,
      tm.name AS owner_name, tm.email AS owner_email,
      l.name AS location_name, l.building
    FROM assets a
    JOIN categories c ON c.id = a.category_id
    JOIN asset_models m ON m.id = a.model_id
    LEFT JOIN team_members tm ON tm.id = a.owner_id
    JOIN locations l ON l.id = a.location_id
  `;
}

function getAllAssets(includeArchived = false) {
  const rows = db.prepare(`${assetSelectSql()} ${includeArchived ? "" : "WHERE a.archived = 0"} ORDER BY c.sort_order, a.asset_tag`).all();
  return rows.map(hydrateAsset);
}

function getAsset(id, includeArchived = true) {
  const row = db.prepare(`${assetSelectSql()} WHERE a.id = ? ${includeArchived ? "" : "AND a.archived = 0"}`).get(id);
  return hydrateAsset(row);
}

function getAssetByIdentifier(identifier) {
  const row = db.prepare(`${assetSelectSql()} WHERE LOWER(a.serial) = LOWER(?) OR LOWER(a.asset_tag) = LOWER(?) LIMIT 1`).get(identifier, identifier);
  return hydrateAsset(row);
}

function applySearch(query) {
  const q = String(query.q || "").trim();
  const filters = {
    category: query.category || "",
    model: query.model || "",
    serial: query.serial || "",
    assetTag: query.assetTag || "",
    status: query.status || "",
    owner: query.owner || "",
    location: query.location || "",
    usage: query.usage || "",
    nvbug: query.nvbug || "",
    borrowedLent: query.borrowedLent || "",
  };
  const all = getAllAssets(false);

  const exact = q ? getAssetByIdentifier(q) : null;
  if (exact && !exact.archived) {
    return { mode: "exact", assets: [exact], appliedCategory: exact.categorySlug };
  }

  let appliedCategory = filters.category;
  let categoryOnlyQuery = false;
  if (q && !appliedCategory) {
    const category = findCategoryByName(q);
    if (category) {
      appliedCategory = category.slug;
      categoryOnlyQuery = true;
    }
  }

  const nonEmptyFilter = Object.values(filters).some(Boolean);
  const extraFilters = Object.entries(query).filter(([key, value]) => key.startsWith("extra.") && String(value || "").trim());
  if (!q && !nonEmptyFilter && !extraFilters.length) return { mode: "empty", assets: [], appliedCategory: "" };

  const textNeedle = q && !categoryOnlyQuery ? q.toLowerCase() : "";
  let assets = all.filter((asset) => {
    if (appliedCategory && asset.categorySlug !== appliedCategory) return false;
    if (filters.model && asset.model !== filters.model) return false;
    if (filters.serial && !asset.serial.toLowerCase().includes(filters.serial.toLowerCase())) return false;
    if (filters.assetTag && !asset.assetTag.toLowerCase().includes(filters.assetTag.toLowerCase())) return false;
    if (filters.status && asset.status !== filters.status) return false;
    if (filters.owner && asset.owner !== filters.owner) return false;
    if (filters.location && asset.location !== filters.location) return false;
    if (filters.usage && asset.usage !== filters.usage) return false;
    if (filters.nvbug && !asset.nvbug.toLowerCase().includes(filters.nvbug.toLowerCase())) return false;
    if (filters.borrowedLent && asset.borrowedLent !== filters.borrowedLent) return false;
    if (textNeedle) {
      const haystack = [
        asset.category,
        asset.model,
        asset.serial,
        asset.assetTag,
        asset.status,
        asset.owner,
        asset.location,
        asset.usage,
        asset.nvbug,
        asset.notes,
        ...Object.values(asset.extra || {}),
      ].join(" ").toLowerCase();
      if (!haystack.includes(textNeedle)) return false;
    }
    return true;
  });

  if (extraFilters.length) {
    assets = assets.filter((asset) => extraFilters.every(([key, value]) => {
      const fieldKey = key.slice("extra.".length);
      return String(asset.extra[fieldKey] || "").toLowerCase().includes(String(value || "").toLowerCase());
    }));
  }

  return { mode: appliedCategory ? "category" : "query", assets, appliedCategory };
}

function summarizeAssets(assets) {
  const active = assets.filter((asset) => ACTIVE_STATUSES.has(asset.status) && !asset.archived);
  return {
    active: active.length,
    available: active.filter((asset) => AVAILABLE_STATUSES.has(asset.status)).length,
    unavailable: active.filter((asset) => !AVAILABLE_STATUSES.has(asset.status)).length,
    exceptions: active.filter((asset) => EXCEPTION_STATUSES.has(asset.status)).length,
    borrowed: active.filter((asset) => asset.borrowedLent === "Borrowed" || asset.status === "Borrowed").length,
    lent: active.filter((asset) => asset.borrowedLent === "Lent" || asset.status === "Lent").length,
    archived: assets.filter((asset) => asset.archived || asset.status === "Archived" || asset.status === "E-Wasted").length,
  };
}

function breakdown(assets, field) {
  const counts = new Map();
  for (const asset of assets) {
    const value = asset[field] || "Unassigned";
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function assetDetail(id) {
  const asset = getAsset(id, true);
  if (!asset) return null;
  const requests = db.prepare(`
    SELECT r.*, tm.name AS owner_name
    FROM asset_requests r
    LEFT JOIN team_members tm ON tm.id = r.owner_id
    WHERE r.asset_id = ?
    ORDER BY r.created_at DESC
  `).all(id).map((row) => ({ ...row, nvbugLinks: bugLinks(row.nvbug) }));
  const activity = db.prepare("SELECT * FROM asset_activity_log WHERE asset_id = ? ORDER BY created_at DESC LIMIT 80").all(id).map(formatActivity);
  return { asset, fields: fieldRows(asset.categoryId), requests, activity };
}

function validateAssetPatch(asset, patch, requireReason = true) {
  const errors = {};
  if (requireReason && !String(patch.reason || "").trim()) errors.reason = "Reason is required.";
  const next = {
    model: patch.model ?? asset.model,
    serial: patch.serial ?? asset.serial,
    assetTag: patch.assetTag ?? asset.assetTag,
    status: patch.status ?? asset.status,
    ownerId: patch.ownerId ?? asset.ownerId,
    locationId: patch.locationId ?? asset.locationId,
  };
  if (!next.model) errors.model = "Model is required.";
  if (!next.serial && !next.assetTag) errors.serial = "Serial No. or Asset Tag is required.";
  if (!next.assetTag) errors.assetTag = "Asset Tag is required.";
  if (!next.status) errors.status = "Status is required.";
  if (next.status === "In Use" && !next.ownerId) errors.ownerId = "Owner / Assignee is required when status is In Use.";
  if (!next.locationId) errors.locationId = "Location is required.";
  return errors;
}

function updateAsset(id, patch) {
  const current = getAsset(id, true);
  if (!current) throw httpError(404, "Asset not found.");
  if (patch.revision && Number(patch.revision) !== Number(current.revision)) throw httpError(409, "This asset was changed in another session. Refresh and try again.");
  const errors = validateAssetPatch(current, patch, true);
  if (Object.keys(errors).length) throw httpError(400, "Missing required fields.", { errors });

  return tx(() => {
    const categoryId = patch.categoryId || current.categoryId;
    const modelId = patch.model ? getOrCreateModel(categoryId, patch.model, patch) : current.modelId;
    const extra = { ...current.extra, ...(patch.extra || {}) };
    const before = current;
    const nextOwner = patch.ownerId === "" ? null : (patch.ownerId ?? current.ownerId ?? null);
    const nextLocation = patch.locationId ?? current.locationId;
    db.prepare(`
      UPDATE assets SET
        model_id = ?, category_id = ?, serial = ?, asset_tag = ?, status = ?, owner_id = ?,
        location_id = ?, usage = ?, nvbug = ?, borrowed_lent = ?, notes = ?, extra_json = ?,
        updated_at = ?, revision = revision + 1
      WHERE id = ?
    `).run(
      modelId,
      categoryId,
      patch.serial ?? current.serial,
      patch.assetTag ?? current.assetTag,
      patch.status ?? current.status,
      nextOwner,
      nextLocation,
      patch.usage ?? current.usage,
      normalizeBug(patch.nvbug ?? current.nvbug),
      patch.borrowedLent ?? current.borrowedLent,
      patch.notes ?? current.notes,
      json(extra),
      now(),
      id,
    );
    const after = getAsset(id, true);
    logActivity({
      assetId: id,
      modelId,
      actorName: patch.actorName || "Admin User",
      action: "manual-edit",
      summary: `Edited ${after.assetTag}`,
      before,
      after,
      reason: patch.reason,
      nvbug: patch.nvbug,
    });
    return { detail: assetDetail(id) };
  });
}

function createAsset(payload) {
  const category = payload.categoryId
    ? db.prepare("SELECT * FROM categories WHERE id = ?").get(payload.categoryId)
    : findCategoryByName(payload.category || "");
  if (!category) throw httpError(400, "Category is required.");
  const base = {
    model: String(payload.model || "").trim(),
    serial: String(payload.serial || "").trim(),
    assetTag: String(payload.assetTag || "").trim(),
    status: payload.status || "Ready to Deploy",
    ownerId: payload.ownerId || "",
    locationId: payload.locationId || "",
  };
  const extra = payload.extra || {};
  const errors = {};
  if (!base.model) errors.model = "Model is required.";
  if (!base.serial && !base.assetTag) errors.serial = "Serial No. or Asset Tag is required.";
  if (!base.assetTag) errors.assetTag = "Asset Tag is required.";
  if (!STATUSES.includes(base.status)) errors.status = "Status is required.";
  if (base.status === "In Use" && !base.ownerId) errors.ownerId = "Owner / Assignee is required when status is In Use.";
  if (!base.locationId) errors.locationId = "Location is required.";
  if (!String(payload.reason || "").trim()) errors.reason = "Reason is required.";
  if (base.assetTag && db.prepare("SELECT id FROM assets WHERE asset_tag = ?").get(base.assetTag)) errors.assetTag = "Asset Tag already exists.";
  const commonValues = {
    category: category.name,
    model: base.model,
    serial: base.serial,
    assetTag: base.assetTag,
    status: base.status,
    owner: base.ownerId,
    location: base.locationId,
    usage: payload.usage,
    nvbug: payload.nvbug,
    borrowedLent: payload.borrowedLent,
    notes: payload.notes,
  };
  for (const field of fieldRows(category.id)) {
    if (!field.required) continue;
    const value = commonValues[field.key] ?? extra[field.key];
    if (!String(value || "").trim()) errors[field.key] = `${field.label} is required.`;
  }
  if (Object.keys(errors).length) throw httpError(400, "Missing required fields.", { errors });

  return tx(() => {
    const modelId = getOrCreateModel(category.id, base.model, payload);
    const info = db.prepare(`
      INSERT INTO assets (
        model_id, category_id, serial, asset_tag, status, owner_id, location_id,
        usage, nvbug, borrowed_lent, notes, extra_json, archived, created_at, updated_at, revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1)
    `).run(
      modelId,
      category.id,
      base.serial,
      base.assetTag,
      base.status,
      base.ownerId || null,
      base.locationId,
      payload.usage || "",
      normalizeBug(payload.nvbug || ""),
      payload.borrowedLent || "",
      payload.notes || "",
      json(extra),
      now(),
      now(),
    );
    const id = Number(info.lastInsertRowid);
    const asset = getAsset(id, true);
    logActivity({
      assetId: id,
      modelId,
      actorName: payload.actorName || "Admin User",
      action: "manual-add",
      summary: `Added ${asset.assetTag}`,
      after: asset,
      reason: payload.reason,
      nvbug: payload.nvbug,
      source: "admin",
    });
    return { detail: assetDetail(id) };
  });
}

function applyAction(id, action, payload = {}, parentId = null) {
  const current = getAsset(id, true);
  if (!current) throw httpError(404, "Asset not found.");
  if (payload.revision && Number(payload.revision) !== Number(current.revision)) throw httpError(409, `${current.assetTag} changed in another session.`);
  const actorName = payload.actorName || "Inventory User";
  const reason = String(payload.reason || "").trim();
  const nvbug = normalizeBug(payload.nvbug || "");

  if (action === "request") {
    if (!reason) throw httpError(400, "Reason is required.", { errors: { reason: "Reason is required." } });
    return tx(() => {
      const info = db.prepare(`
        INSERT INTO asset_requests (asset_id, type, priority, status, owner_id, reason, nvbug, created_at, updated_at)
        VALUES (?, ?, ?, 'Open', ?, ?, ?, ?, ?)
      `).run(id, payload.requestType || "Support", payload.priority || "Normal", payload.ownerId || null, reason, nvbug, now(), now());
      logActivity({
        parentId,
        assetId: id,
        modelId: current.modelId,
        actorName,
        action: "request-create",
        summary: `Created request for ${current.assetTag}`,
        reason,
        nvbug,
        metadata: { requestId: Number(info.lastInsertRowid), requestType: payload.requestType || "Support" },
      });
      return { detail: assetDetail(id) };
    });
  }

  if (action === "print-label") {
    return tx(() => {
      logActivity({
        parentId,
        assetId: id,
        modelId: current.modelId,
        actorName,
        action: "print-label",
        summary: `Prepared label for ${current.assetTag}`,
        reason: reason || "Label preview",
        nvbug,
      });
      return { detail: assetDetail(id) };
    });
  }

  if (!reason) throw httpError(400, "Reason is required.", { errors: { reason: "Reason is required." } });
  if (!payload.status) throw httpError(400, "Status is required.", { errors: { status: "Status is required." } });
  if (!payload.locationId) throw httpError(400, "Location is required.", { errors: { locationId: "Location is required." } });
  if (action === "check-out" && !payload.ownerId) throw httpError(400, "Owner / Assignee is required.", { errors: { ownerId: "Owner / Assignee is required." } });

  return tx(() => {
    const before = current;
    const ownerId = action === "check-in" ? payload.ownerId || null : payload.ownerId || current.ownerId || null;
    const borrowedLent = payload.borrowedLent ?? current.borrowedLent;
    db.prepare(`
      UPDATE assets SET status = ?, owner_id = ?, location_id = ?, usage = ?, nvbug = ?, borrowed_lent = ?,
        archived = CASE WHEN ? IN ('Archived', 'E-Wasted') THEN 1 ELSE 0 END,
        updated_at = ?, revision = revision + 1
      WHERE id = ?
    `).run(payload.status, ownerId, payload.locationId, payload.usage ?? current.usage, nvbug || current.nvbug, borrowedLent, payload.status, now(), id);
    const after = getAsset(id, true);
    const actionName = action === "check-out" ? "check-out" : action === "check-in" ? "check-in" : action;
    logActivity({
      parentId,
      assetId: id,
      modelId: current.modelId,
      actorName,
      action: actionName,
      summary: `${actionName} ${current.assetTag}`,
      before,
      after,
      reason,
      nvbug,
    });
    return { detail: assetDetail(id) };
  });
}

function previewBulk(payload) {
  const ids = Array.isArray(payload.assetIds) ? payload.assetIds.map(Number).filter(Boolean) : [];
  const expected = payload.expectedRevisions || {};
  const eligible = [];
  const ineligible = [];
  const conflicts = [];
  for (const id of ids) {
    const asset = getAsset(id, true);
    if (!asset) {
      ineligible.push({ id, reason: "Asset not found." });
      continue;
    }
    if (expected[id] && Number(expected[id]) !== Number(asset.revision)) {
      conflicts.push({ id, assetTag: asset.assetTag, reason: "Changed in another session.", currentRevision: asset.revision });
      continue;
    }
    if (asset.archived && !["restore", "print-label"].includes(payload.action)) {
      ineligible.push({ id, assetTag: asset.assetTag, reason: "Archived assets cannot use this action." });
      continue;
    }
    eligible.push({ id, assetTag: asset.assetTag, model: asset.model, status: asset.status, revision: asset.revision });
  }
  return {
    action: payload.action,
    total: ids.length,
    eligible,
    ineligible,
    conflicts,
    requiredFields: payload.action === "print-label" ? [] : ["status", "locationId", "reason"],
  };
}

function commitBulk(payload) {
  const preview = previewBulk(payload);
  if (preview.conflicts.length || preview.ineligible.length) throw httpError(409, "Bulk action has conflicts or ineligible assets.", { preview });
  if (!preview.eligible.length) throw httpError(400, "No eligible assets selected.");
  return tx(() => {
    const parentId = logActivity({
      actorName: payload.actorName || "Inventory User",
      action: "bulk-action",
      summary: `Bulk ${payload.action} for ${preview.eligible.length} assets`,
      reason: payload.reason || "",
      nvbug: payload.nvbug || "",
      metadata: { action: payload.action, count: preview.eligible.length },
    });
    const results = [];
    for (const row of preview.eligible) {
      const current = getAsset(row.id, true);
      if (payload.action === "print-label") {
        logActivity({
          parentId,
          assetId: row.id,
          modelId: current.modelId,
          actorName: payload.actorName || "Inventory User",
          action: "print-label",
          summary: `Prepared label for ${current.assetTag}`,
          reason: payload.reason || "Bulk label print",
          nvbug: payload.nvbug || "",
        });
      } else {
        const before = current;
        db.prepare(`
          UPDATE assets SET status = ?, owner_id = COALESCE(?, owner_id), location_id = COALESCE(?, location_id),
            usage = COALESCE(?, usage), nvbug = COALESCE(NULLIF(?, ''), nvbug), borrowed_lent = COALESCE(?, borrowed_lent),
            archived = CASE WHEN ? IN ('Archived', 'E-Wasted') THEN 1 ELSE archived END,
            updated_at = ?, revision = revision + 1
          WHERE id = ?
        `).run(payload.status, payload.ownerId || null, payload.locationId || null, payload.usage || null, normalizeBug(payload.nvbug || ""), payload.borrowedLent || null, payload.status, now(), row.id);
        const after = getAsset(row.id, true);
        logActivity({
          parentId,
          assetId: row.id,
          modelId: current.modelId,
          actorName: payload.actorName || "Inventory User",
          action: payload.action,
          summary: `Bulk ${payload.action} ${current.assetTag}`,
          before,
          after,
          reason: payload.reason,
          nvbug: payload.nvbug || "",
        });
      }
      results.push({ id: row.id, assetTag: row.assetTag, ok: true });
    }
    return { preview, results };
  });
}

module.exports = {
  getRevision,
  hydrateAsset,
  assetSelectSql,
  getAllAssets,
  getAsset,
  getAssetByIdentifier,
  applySearch,
  summarizeAssets,
  breakdown,
  assetDetail,
  updateAsset,
  createAsset,
  applyAction,
  previewBulk,
  commitBulk,
};
