const { db } = require("../db");
const { httpError } = require("../lib/http");
const { findStatusByName, resolveStatusId } = require("./statusLabels");
const { fieldRows } = require("./catalog");

function requireRevision(current, patch) {
  if (patch.revision === undefined || patch.revision === null || String(patch.revision).trim() === "") {
    throw httpError(400, "Revision is required.", {
      errors: { revision: "Revision is required." },
      currentRevision: current.revision,
    });
  }
  if (Number(patch.revision) !== Number(current.revision)) {
    throw httpError(409, "This asset was changed in another session. Refresh and try again.", {
      currentRevision: current.revision,
    });
  }
}

function validateAssetPatch(asset, patch, { requireReason = true } = {}) {
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
  if (!findStatusByName(next.status)) errors.status = "Status is not valid.";
  if (next.status === "In Use" && !next.ownerId) errors.ownerId = "Owner / Assignee is required when status is In Use.";
  if (!next.locationId) errors.locationId = "Location is required.";
  return errors;
}

function validateCreateAsset(payload, category) {
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
  if (!findStatusByName(base.status)) errors.status = "Status is required.";
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
  return errors;
}

function validateCheckout(payload, asset) {
  const errors = {};
  if (!String(payload.reason || "").trim()) errors.reason = "Reason is required.";
  if (!payload.status) errors.status = "Status is required.";
  if (!payload.locationId) errors.locationId = "Location is required.";
  if (!payload.ownerId) errors.ownerId = "Owner / Assignee is required.";
  if (asset.archived) errors.status = "Archived assets cannot be checked out.";
  return errors;
}

function validateCheckin(payload) {
  const errors = {};
  if (!String(payload.reason || "").trim()) errors.reason = "Reason is required.";
  if (!payload.status) errors.status = "Status is required.";
  if (!payload.locationId) errors.locationId = "Location is required.";
  return errors;
}

function validateImportRow(values, profile, category) {
  const issues = [];
  for (const required of profile.required || []) {
    if (!values[required]) issues.push({ field: required, severity: "error", message: `${required} is required.` });
  }
  if (!profile.referenceType && !category) {
    issues.push({ field: "category", severity: "error", message: "Category is missing or not supported by this profile." });
  }
  const status = values.status || "Ready to Deploy";
  if (!profile.referenceType && !findStatusByName(status)) {
    issues.push({ field: "status", severity: "error", message: `Status '${status}' is not valid.` });
  }
  if (values.assetTag && db.prepare("SELECT id FROM assets WHERE asset_tag = ?").get(values.assetTag)) {
    issues.push({ field: "assetTag", severity: "error", message: `Asset tag '${values.assetTag}' already exists.` });
  }
  if (values.serial && db.prepare("SELECT id FROM assets WHERE serial = ? AND serial != ''").get(values.serial)) {
    issues.push({ field: "serial", severity: "error", message: `Serial '${values.serial}' already exists.` });
  }
  return issues;
}

function statusIdForName(name) {
  return resolveStatusId(name);
}

module.exports = {
  requireRevision,
  validateAssetPatch,
  validateCreateAsset,
  validateCheckout,
  validateCheckin,
  validateImportRow,
  statusIdForName,
};
