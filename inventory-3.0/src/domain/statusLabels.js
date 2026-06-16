const { db } = require("../db");
const { httpError } = require("../lib/http");

function statusLabelRows() {
  return db.prepare("SELECT * FROM status_labels ORDER BY sort_order, name").all().map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    deployable: Boolean(row.deployable),
    archived: Boolean(row.archived),
    sortOrder: row.sort_order,
  }));
}

function statusNames() {
  return statusLabelRows().map((row) => row.name);
}

function findStatusByName(name) {
  if (!name) return null;
  return db.prepare("SELECT * FROM status_labels WHERE name = ?").get(String(name).trim())
    || db.prepare("SELECT * FROM status_labels WHERE slug = ?").get(String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"));
}

function findStatusById(id) {
  return db.prepare("SELECT * FROM status_labels WHERE id = ?").get(id) || null;
}

function resolveStatusId(nameOrId) {
  if (nameOrId === undefined || nameOrId === null || nameOrId === "") return null;
  if (Number.isFinite(Number(nameOrId))) {
    const byId = findStatusById(Number(nameOrId));
    if (byId) return byId.id;
  }
  const byName = findStatusByName(nameOrId);
  return byName ? byName.id : null;
}

function assertDeployable(statusName) {
  const label = findStatusByName(statusName);
  if (!label) throw httpError(400, "Invalid status.", { errors: { status: "Invalid status." } });
  if (!label.deployable) throw httpError(400, "Asset status is not deployable.", { errors: { status: "Cannot check out a non-deployable status." } });
  if (label.archived) throw httpError(400, "Archived assets cannot be checked out.", { errors: { status: "Archived assets cannot be checked out." } });
  return label;
}

function assertAvailableForCheckout(asset) {
  const label = findStatusByName(asset.status);
  if (!label) throw httpError(400, "Invalid status.", { errors: { status: "Invalid status." } });
  if (asset.archived || label.archived) {
    throw httpError(400, "Archived assets cannot be checked out.", { errors: { status: "Archived assets cannot be checked out." } });
  }
  if (!label.deployable) {
    throw httpError(400, "Asset is not available for checkout.", { errors: { status: "Only deployable assets can be checked out." } });
  }
  return label;
}

module.exports = {
  statusLabelRows,
  statusNames,
  findStatusByName,
  findStatusById,
  resolveStatusId,
  assertDeployable,
  assertAvailableForCheckout,
};
