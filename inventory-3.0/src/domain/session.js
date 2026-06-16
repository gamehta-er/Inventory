const { db, getRevision } = require("../db");
const { IMPORT_PROFILES } = require("../config/constants");
const { now } = require("../lib/utils");
const { categoryRows, memberRows, locationRows, fieldRows } = require("./catalog");
const { getAllAssets, summarizeAssets } = require("./assets");
const { statusLabelRows } = require("./statusLabels");

function loginBootstrap() {
  return {
    app: { name: "Inventory 3.0", team: "#imargulis-staff" },
    members: memberRows(),
  };
}

function sessionSnapshot(session) {
  const categories = categoryRows().map((category) => ({
    id: category.id,
    slug: category.slug,
    name: category.name,
    description: category.description,
    prefix: category.prefix,
    fields: fieldRows(category.id),
    count: db.prepare("SELECT COUNT(*) AS count FROM assets WHERE category_id = ? AND archived = 0").get(category.id).count,
  }));
  const allAssets = getAllAssets(true);
  return {
    app: { name: "Inventory 3.0", team: "#imargulis-staff", revision: getRevision(), updatedAt: now() },
    user: session ? {
      id: session.memberId,
      name: session.memberName,
      email: session.email,
      role: session.role,
    } : null,
    statuses: statusLabelRows(),
    statusNames: statusLabelRows().map((row) => row.name),
    importProfiles: IMPORT_PROFILES,
    categories,
    members: memberRows(),
    locations: locationRows(),
    summary: summarizeAssets(allAssets),
  };
}

module.exports = {
  loginBootstrap,
  sessionSnapshot,
};
