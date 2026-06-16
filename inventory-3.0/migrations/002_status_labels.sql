CREATE TABLE IF NOT EXISTS status_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  deployable INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO status_labels (name, slug, deployable, archived, sort_order) VALUES
  ('Ready to Deploy', 'ready-to-deploy', 1, 0, 1),
  ('Idle', 'idle', 1, 0, 2),
  ('In Use', 'in-use', 0, 0, 3),
  ('Broken', 'broken', 0, 0, 4),
  ('EOL', 'eol', 0, 0, 5),
  ('E-waste Pending', 'e-waste-pending', 0, 0, 6),
  ('E-Wasted', 'e-wasted', 0, 1, 7),
  ('Archived', 'archived', 0, 1, 8),
  ('Borrowed', 'borrowed', 1, 0, 9),
  ('Lent', 'lent', 0, 0, 10);

ALTER TABLE assets ADD COLUMN status_id INTEGER REFERENCES status_labels(id);

UPDATE assets SET status_id = (
  SELECT id FROM status_labels WHERE status_labels.name = assets.status
) WHERE status_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_assets_status_id ON assets(status_id);
