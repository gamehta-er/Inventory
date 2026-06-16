CREATE TABLE IF NOT EXISTS asset_checkouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  assigned_to_member_id INTEGER,
  location_id INTEGER NOT NULL,
  checked_out_at TEXT NOT NULL,
  expected_return_at TEXT,
  checked_in_at TEXT,
  reason TEXT,
  nvbug TEXT,
  actor_member_id INTEGER,
  status_at_checkout TEXT NOT NULL,
  FOREIGN KEY(asset_id) REFERENCES assets(id),
  FOREIGN KEY(assigned_to_member_id) REFERENCES team_members(id),
  FOREIGN KEY(location_id) REFERENCES locations(id),
  FOREIGN KEY(actor_member_id) REFERENCES team_members(id)
);

CREATE INDEX IF NOT EXISTS idx_checkouts_asset_open ON asset_checkouts(asset_id, checked_in_at);
