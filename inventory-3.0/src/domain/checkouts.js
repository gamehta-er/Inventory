const { db } = require("../db");
const { now } = require("../lib/utils");
const { httpError } = require("../lib/http");

function getOpenCheckout(assetId) {
  return db.prepare(`
    SELECT c.*, tm.name AS assigned_name, l.name AS location_name
    FROM asset_checkouts c
    LEFT JOIN team_members tm ON tm.id = c.assigned_to_member_id
    JOIN locations l ON l.id = c.location_id
    WHERE c.asset_id = ? AND c.checked_in_at IS NULL
    ORDER BY c.checked_out_at DESC
    LIMIT 1
  `).get(assetId) || null;
}

function listCheckouts(assetId) {
  return db.prepare(`
    SELECT c.*, tm.name AS assigned_name, l.name AS location_name, am.name AS actor_name
    FROM asset_checkouts c
    LEFT JOIN team_members tm ON tm.id = c.assigned_to_member_id
    JOIN locations l ON l.id = c.location_id
    LEFT JOIN team_members am ON am.id = c.actor_member_id
    WHERE c.asset_id = ?
    ORDER BY c.checked_out_at DESC
  `).all(assetId);
}

function createCheckout({ assetId, assignedToMemberId, locationId, reason, nvbug, actorMemberId, statusAtCheckout }) {
  if (getOpenCheckout(assetId)) {
    throw httpError(409, "Asset already has an open checkout.", { errors: { checkout: "Asset already has an open checkout." } });
  }
  const info = db.prepare(`
    INSERT INTO asset_checkouts (
      asset_id, assigned_to_member_id, location_id, checked_out_at, reason, nvbug, actor_member_id, status_at_checkout
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(assetId, assignedToMemberId || null, locationId, now(), reason, nvbug || "", actorMemberId || null, statusAtCheckout);
  return Number(info.lastInsertRowid);
}

function closeCheckout(assetId, { reason, nvbug }) {
  const open = getOpenCheckout(assetId);
  if (!open) throw httpError(400, "No open checkout for this asset.", { errors: { checkout: "No open checkout for this asset." } });
  db.prepare(`
    UPDATE asset_checkouts SET checked_in_at = ?, reason = COALESCE(NULLIF(?, ''), reason), nvbug = COALESCE(NULLIF(?, ''), nvbug)
    WHERE id = ?
  `).run(now(), reason, nvbug, open.id);
  return open.id;
}

module.exports = {
  getOpenCheckout,
  listCheckouts,
  createCheckout,
  closeCheckout,
};
