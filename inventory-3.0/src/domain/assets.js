const { db, tx, logActivity, getRevision } = require("../db");
const {
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
const { assertAvailableForCheckout, findStatusByName } = require("./statusLabels");
const {
  requireRevision,
  validateAssetPatch,
  validateCreateAsset,
  validateCheckout,
  validateCheckin,
  statusIdForName,
} = require("./validators");
const { createCheckout, closeCheckout, listCheckouts } = require("./checkouts");

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
    ownerId: row.owner_id ?? "",
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
      l.name AS location_name, l.building,
      COALESCE(sl.name, a.status) AS status,
      sl.deployable AS status_deployable,
      sl.archived AS status_archived
    FROM assets a
    JOIN categories c ON c.id = a.category_id
    JOIN asset_models m ON m.id = a.model_id
    LEFT JOIN team_members tm ON tm.id = a.owner_id
    JOIN locations l ON l.id = a.location_id
    LEFT JOIN status_labels sl ON sl.id = a.status_id
  `;
}

function getAllAssets(includeArchived = false) {
  const clause = includeArchived ? "" : "WHERE a.archived = 0 AND (sl.archived IS NULL OR sl.archived = 0)";
  const rows = db.prepare(`${assetSelectSql()} ${clause} ORDER BY c.sort_order, a.asset_tag`).all();
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
  const checkouts = listCheckouts(id).map((row) => ({
    id: row.id,
    assignedTo: row.assigned_name || "",
    location: row.location_name,
    checkedOutAt: row.checked_out_at,
    checkedInAt: row.checked_in_at,
    statusAtCheckout: row.status_at_checkout,
    reason: row.reason || "",
    nvbug: row.nvbug || "",
    actorName: row.actor_name || "",
  }));
  return { asset, fields: fieldRows(asset.categoryId), requests, activity, checkouts };
}

function resolveOwnerId(patchValue, currentValue) {
  if (patchValue !== undefined) {
    return patchValue === "" || patchValue === null ? null : patchValue;
  }
  return currentValue || null;
}

function asOwnerId(value) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function updateAsset(id, patch, actorName = "Admin User") {
  const current = getAsset(id, true);
  if (!current) throw httpError(404, "Asset not found.");
  requireRevision(current, patch);
  const errors = validateAssetPatch(current, patch, true);
  if (Object.keys(errors).length) throw httpError(400, "Missing required fields.", { errors });

  return tx(() => {
    const categoryId = patch.categoryId || current.categoryId;
    const modelId = patch.model ? getOrCreateModel(categoryId, patch.model, patch) : current.modelId;
    const extra = { ...current.extra, ...(patch.extra || {}) };
    const before = current;
    const nextOwner = resolveOwnerId(patch.ownerId, current.ownerId);
    const nextLocation = patch.locationId ?? current.locationId;
    const nextStatus = patch.status ?? current.status;
    const nextStatusId = statusIdForName(nextStatus);
    db.prepare(`
      UPDATE assets SET
        model_id = ?, category_id = ?, serial = ?, asset_tag = ?, status = ?, status_id = ?, owner_id = ?,
        location_id = ?, usage = ?, nvbug = ?, borrowed_lent = ?, notes = ?, extra_json = ?,
        archived = CASE WHEN ? IN ('Archived', 'E-Wasted') THEN 1 ELSE archived END,
        updated_at = ?, revision = revision + 1
      WHERE id = ?
    `).run(
      modelId,
      categoryId,
      patch.serial ?? current.serial,
      patch.assetTag ?? current.assetTag,
      nextStatus,
      nextStatusId,
      nextOwner,
      nextLocation,
      patch.usage ?? current.usage,
      normalizeBug(patch.nvbug ?? current.nvbug),
      patch.borrowedLent ?? current.borrowedLent,
      patch.notes ?? current.notes,
      json(extra),
      nextStatus,
      now(),
      id,
    );
    const after = getAsset(id, true);
    logActivity({
      assetId: id,
      modelId,
      actorName,
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

function createAsset(payload, actorName = "Admin User") {
  const category = payload.categoryId
    ? db.prepare("SELECT * FROM categories WHERE id = ?").get(payload.categoryId)
    : findCategoryByName(payload.category || "");
  if (!category) throw httpError(400, "Category is required.");
  const errors = validateCreateAsset(payload, category);
  if (Object.keys(errors).length) throw httpError(400, "Missing required fields.", { errors });
  const base = {
    model: String(payload.model || "").trim(),
    serial: String(payload.serial || "").trim(),
    assetTag: String(payload.assetTag || "").trim(),
    status: payload.status || "Ready to Deploy",
    ownerId: asOwnerId(payload.ownerId),
    locationId: payload.locationId || "",
  };
  const extra = payload.extra || {};
  const statusId = statusIdForName(base.status);

  return tx(() => {
    const modelId = getOrCreateModel(category.id, base.model, payload);
    const info = db.prepare(`
      INSERT INTO assets (
        model_id, category_id, serial, asset_tag, status, status_id, owner_id, location_id,
        usage, nvbug, borrowed_lent, notes, extra_json, archived, created_at, updated_at, revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1)
    `).run(
      modelId,
      category.id,
      base.serial,
      base.assetTag,
      base.status,
      statusId,
      base.ownerId,
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
      actorName,
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

function applyAction(id, action, payload = {}, parentId = null, actorName = "Inventory User", actorMemberId = null, skipActivity = false) {
  const current = getAsset(id, true);
  if (!current) throw httpError(404, "Asset not found.");
  if (action !== "print-label" && action !== "request") requireRevision(current, payload);
  const reason = String(payload.reason || "").trim();
  const nvbug = normalizeBug(payload.nvbug || "");

  if (action === "request") {
    if (!reason) throw httpError(400, "Reason is required.", { errors: { reason: "Reason is required." } });
    return tx(() => {
      const info = db.prepare(`
        INSERT INTO asset_requests (asset_id, type, priority, status, owner_id, reason, nvbug, created_at, updated_at)
        VALUES (?, ?, ?, 'Open', ?, ?, ?, ?, ?)
      `).run(id, payload.requestType || "Support", payload.priority || "Normal", asOwnerId(payload.ownerId), reason, nvbug, now(), now());
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
      if (!skipActivity) {
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
      }
      return { detail: assetDetail(id) };
    });
  }

  if (action === "check-out") {
    const errors = validateCheckout(payload, current);
    if (Object.keys(errors).length) throw httpError(400, "Missing required fields.", { errors });
    assertAvailableForCheckout(current);
    if (!findStatusByName(payload.status)) {
      throw httpError(400, "Invalid status.", { errors: { status: "Invalid status." } });
    }
    return tx(() => {
      const before = current;
      const ownerId = asOwnerId(payload.ownerId) ?? asOwnerId(current.ownerId);
      const statusId = statusIdForName(payload.status);
      db.prepare(`
        UPDATE assets SET status = ?, status_id = ?, owner_id = ?, location_id = ?, usage = ?, nvbug = ?, borrowed_lent = ?,
          archived = 0, updated_at = ?, revision = revision + 1
        WHERE id = ?
      `).run(payload.status, statusId, ownerId, payload.locationId, payload.usage ?? current.usage, nvbug || current.nvbug, payload.borrowedLent ?? current.borrowedLent, now(), id);
      createCheckout({
        assetId: id,
        assignedToMemberId: ownerId,
        locationId: payload.locationId,
        reason,
        nvbug,
        actorMemberId,
        statusAtCheckout: payload.status,
      });
      const after = getAsset(id, true);
      if (!skipActivity) {
        logActivity({
          parentId,
          assetId: id,
          modelId: current.modelId,
          actorName,
          action: "check-out",
          summary: `Checked out ${current.assetTag}`,
          before,
          after,
          reason,
          nvbug,
        });
      }
      return { detail: assetDetail(id) };
    });
  }

  if (action === "check-in") {
    const errors = validateCheckin(payload, current);
    if (Object.keys(errors).length) throw httpError(400, "Missing required fields.", { errors });
    return tx(() => {
      const before = current;
      const ownerId = asOwnerId(payload.ownerId);
      const statusId = statusIdForName(payload.status);
      closeCheckout(id, { reason, nvbug });
      db.prepare(`
        UPDATE assets SET status = ?, status_id = ?, owner_id = ?, location_id = ?, usage = ?, nvbug = ?, borrowed_lent = ?,
          archived = CASE WHEN ? IN ('Archived', 'E-Wasted') THEN 1 ELSE 0 END,
          updated_at = ?, revision = revision + 1
        WHERE id = ?
      `).run(payload.status, statusId, ownerId, payload.locationId, payload.usage ?? current.usage, nvbug || current.nvbug, payload.borrowedLent ?? current.borrowedLent, payload.status, now(), id);
      const after = getAsset(id, true);
      if (!skipActivity) {
        logActivity({
          parentId,
          assetId: id,
          modelId: current.modelId,
          actorName,
          action: "check-in",
          summary: `Checked in ${current.assetTag}`,
          before,
          after,
          reason,
          nvbug,
        });
      }
      return { detail: assetDetail(id) };
    });
  }

  if (!reason) throw httpError(400, "Reason is required.", { errors: { reason: "Reason is required." } });
  if (!payload.status) throw httpError(400, "Status is required.", { errors: { status: "Status is required." } });
  if (!payload.locationId) throw httpError(400, "Location is required.", { errors: { locationId: "Location is required." } });

  return tx(() => {
    const before = current;
    const ownerId = resolveOwnerId(payload.ownerId, current.ownerId);
    const statusId = statusIdForName(payload.status);
    db.prepare(`
      UPDATE assets SET status = ?, status_id = ?, owner_id = ?, location_id = ?, usage = ?, nvbug = ?, borrowed_lent = ?,
        archived = CASE WHEN ? IN ('Archived', 'E-Wasted') THEN 1 ELSE 0 END,
        updated_at = ?, revision = revision + 1
      WHERE id = ?
    `).run(payload.status, statusId, ownerId, payload.locationId, payload.usage ?? current.usage, nvbug || current.nvbug, payload.borrowedLent ?? current.borrowedLent, payload.status, now(), id);
    const after = getAsset(id, true);
    if (!skipActivity) {
      logActivity({
        parentId,
        assetId: id,
        modelId: current.modelId,
        actorName,
        action,
        summary: `${humanActionName(action)} ${current.assetTag}`,
        before,
        after,
        reason,
        nvbug,
      });
    }
    return { detail: assetDetail(id) };
  });
}

function humanActionName(action) {
  const map = {
    "check-out": "Checked out",
    "check-in": "Checked in",
    "status-change": "Status changed for",
  };
  return map[action] || action;
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
    if (payload.action !== "print-label") {
      if (!expected[id] || Number(expected[id]) !== Number(asset.revision)) {
        conflicts.push({ id, assetTag: asset.assetTag, reason: "Revision required or stale.", currentRevision: asset.revision });
        continue;
      }
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

function commitBulk(payload, actorName = "Inventory User", actorMemberId = null) {
  const preview = previewBulk(payload);
  if (preview.conflicts.length) throw httpError(409, "Bulk action has conflicts.", { preview });
  if (!preview.eligible.length) throw httpError(400, "No eligible assets selected.", { preview });
  const tags = preview.eligible.map((row) => row.assetTag).join(", ");
  const actionLabel = {
    "check-out": "Checked out",
    "check-in": "Checked in",
    "status-change": "Status changed for",
    "print-label": "Printed labels for",
  }[payload.action] || `Bulk ${payload.action} for`;
  const parentId = logActivity({
    actorName,
    action: "bulk-action",
    summary: `${actionLabel}: ${tags}`,
    reason: payload.reason || "",
    nvbug: payload.nvbug || "",
    source: "bulk",
    metadata: {
      action: payload.action,
      count: preview.eligible.length,
      skipped: preview.ineligible.length,
      assetIds: preview.eligible.map((row) => row.id),
      assetTags: preview.eligible.map((row) => row.assetTag),
    },
  });
  const results = [];
  for (const row of preview.eligible) {
    const current = getAsset(row.id, true);
    if (payload.action === "print-label") {
      applyAction(row.id, "print-label", {
        reason: payload.reason || "Bulk label print",
        nvbug: payload.nvbug || "",
      }, parentId, actorName, actorMemberId, true);
    } else {
      applyAction(row.id, payload.action, {
        revision: current.revision,
        status: payload.status || current.status,
        ownerId: resolveOwnerId(payload.ownerId, current.ownerId),
        locationId: payload.locationId || current.locationId,
        usage: payload.usage,
        nvbug: payload.nvbug,
        borrowedLent: payload.borrowedLent,
        reason: payload.reason,
      }, parentId, actorName, actorMemberId, true);
    }
    results.push({ id: row.id, assetTag: row.assetTag, ok: true });
  }
  return { preview, results, parentId };
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
