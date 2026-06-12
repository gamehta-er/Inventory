const { db, tx, logActivity, bumpRevision } = require("../db");
const {
  STATUSES,
  TEAM_MEMBERS,
  COMMON_FIELDS,
  CATEGORY_PROFILES,
  IMPORT_PROFILES,
} = require("../config/constants");
const { now, json, safeJsonParse, normalizeBug, canonicalField } = require("../lib/utils");
const { httpError } = require("../lib/http");
const {
  fieldRows,
  findCategoryByName,
  getOrCreateLocation,
  getOrCreateMember,
  getOrCreateModel,
} = require("./catalog");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

function validateImport(profileId, filename, csvText) {
  const profile = IMPORT_PROFILES.find((p) => p.id === profileId) || IMPORT_PROFILES[0];
  const rows = parseCsv(csvText);
  if (!rows.length) throw httpError(400, "CSV is empty.");
  const headers = rows[0].map((header) => String(header || "").trim());
  const mapped = headers.map((header) => ({ source: header, field: canonicalField(header) }));
  const dataRows = rows.slice(1).map((row, index) => {
    const values = {};
    mapped.forEach(({ field }, col) => {
      values[field] = String(row[col] || "").trim();
    });
    return { rowNumber: index + 2, values };
  });

  const issues = [];
  for (const dataRow of dataRows) {
    for (const required of profile.required || []) {
      if (!dataRow.values[required]) issues.push({ row: dataRow.rowNumber, field: required, severity: "error", message: `${required} is required.` });
    }
    const categoryName = dataRow.values.category || (profile.categorySlug ? (CATEGORY_PROFILES.find((p) => p.slug === profile.categorySlug) || {}).name : "");
    const category = categoryName ? findCategoryByName(categoryName) : null;
    if (!profile.referenceType && !category) issues.push({ row: dataRow.rowNumber, field: "category", severity: "error", message: "Category is missing or not supported by this profile." });
    const status = dataRow.values.status || "Ready to Deploy";
    if (!profile.referenceType && !STATUSES.includes(status)) issues.push({ row: dataRow.rowNumber, field: "status", severity: "error", message: `Status '${status}' is not valid.` });
  }

  const preview = {
    id: null,
    profile: profile.id,
    profileLabel: profile.label,
    filename,
    rowCount: dataRows.length,
    mappedColumns: mapped,
    issues,
    sampleRows: dataRows.slice(0, 8),
    canCommit: !issues.some((issue) => issue.severity === "error"),
    rows: dataRows,
  };
  const info = db.prepare(`
    INSERT INTO import_batches (profile, filename, status, row_count, errors_json, preview_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(profile.id, filename, preview.canCommit ? "Previewed" : "Blocked", dataRows.length, json(issues), json(preview), now());
  preview.id = Number(info.lastInsertRowid);
  db.prepare("UPDATE import_batches SET preview_json = ? WHERE id = ?").run(json(preview), preview.id);
  logActivity({
    actorName: "Import User",
    action: "import-preview",
    summary: `Previewed ${filename || "CSV import"}`,
    source: "import",
    metadata: { profile: profile.id, rows: dataRows.length, issues: issues.length },
  });
  bumpRevision();
  return preview;
}

function commitImport(batchId, actorName = "Import User") {
  const batch = db.prepare("SELECT * FROM import_batches WHERE id = ?").get(batchId);
  if (!batch) throw httpError(404, "Import batch not found.");
  const preview = safeJsonParse(batch.preview_json, null);
  if (!preview) throw httpError(400, "Import preview is invalid.");
  if (!preview.canCommit) throw httpError(400, "Import has validation errors.");
  if (batch.status === "Committed") throw httpError(400, "Import was already committed.");
  return tx(() => {
    const profile = IMPORT_PROFILES.find((p) => p.id === preview.profile);
    let created = 0;
    for (const row of preview.rows) {
      const values = row.values;
      if (profile.referenceType === "locations") {
        getOrCreateLocation(values.location || values.name);
        created += 1;
        continue;
      }
      if (profile.referenceType === "owners") {
        getOrCreateMember(values.name, values.email);
        created += 1;
        continue;
      }
      if (profile.referenceType) {
        created += 1;
        continue;
      }
      const categoryName = values.category || (CATEGORY_PROFILES.find((p) => p.slug === profile.categorySlug) || {}).name;
      const category = findCategoryByName(categoryName);
      const modelId = getOrCreateModel(category.id, values.model, values);
      const locationId = getOrCreateLocation(values.location);
      const ownerId = values.name || values.owner || values.requester ? getOrCreateMember(values.name || values.owner || values.requester, values.email) : null;
      const profileFields = fieldRows(category.id).filter((field) => !COMMON_FIELDS.some(([key]) => key === field.key));
      const extra = {};
      for (const field of profileFields) if (values[field.key]) extra[field.key] = values[field.key];
      const assetTag = values.assetTag || `INV3-IMP-${String(batchId).padStart(3, "0")}-${String(row.rowNumber).padStart(4, "0")}`;
      const existing = db.prepare("SELECT id FROM assets WHERE asset_tag = ?").get(assetTag);
      if (existing) continue;
      const info = db.prepare(`
        INSERT INTO assets (model_id, category_id, serial, asset_tag, status, owner_id, location_id, usage, nvbug, borrowed_lent, notes, extra_json, archived, created_at, updated_at, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1)
      `).run(
        modelId,
        category.id,
        values.serial || "",
        assetTag,
        values.status || "Ready to Deploy",
        ownerId,
        locationId,
        values.usage || "",
        normalizeBug(values.nvbug || ""),
        values.borrowedLent || "",
        values.notes || "",
        json(extra),
        now(),
        now(),
      );
      const assetId = Number(info.lastInsertRowid);
      logActivity({
        assetId,
        modelId,
        actorName,
        action: "import-commit",
        summary: `Imported ${assetTag}`,
        source: "import",
        metadata: { batchId },
      });
      created += 1;
    }
    db.prepare("UPDATE import_batches SET status = 'Committed', committed_at = ? WHERE id = ?").run(now(), batchId);
    logActivity({
      actorName,
      action: "import-commit",
      summary: `Committed import batch ${batchId}`,
      source: "import",
      metadata: { batchId, created },
    });
    return { created, batchId };
  });
}

module.exports = {
  parseCsv,
  validateImport,
  commitImport,
};
