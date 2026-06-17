const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { dbPath } = require("../config/paths");

const migrationsDir = path.join(__dirname, "..", "..", "migrations");
const {
  STATUSES,
  TEAM_MEMBERS,
  SYNTHETIC_ASSET_COUNTS,
  COMMON_FIELDS,
  CATEGORY_PROFILES,
} = require("../config/constants");
const { now, json, normalizeBug } = require("../lib/utils");

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");
db.exec("PRAGMA foreign_keys = ON;");

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      prefix TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS field_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER,
      field_key TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 0,
      options_json TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(category_id, field_key),
      FOREIGN KEY(category_id) REFERENCES categories(id)
    );
    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      username TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      building TEXT NOT NULL,
      detail TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS asset_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      manufacturer TEXT,
      model_number TEXT,
      sku TEXT,
      description TEXT,
      image_path TEXT,
      label_line TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(category_id, name),
      FOREIGN KEY(category_id) REFERENCES categories(id)
    );
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      serial TEXT,
      asset_tag TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      owner_id INTEGER,
      location_id INTEGER NOT NULL,
      usage TEXT,
      nvbug TEXT,
      borrowed_lent TEXT,
      notes TEXT,
      extra_json TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(model_id) REFERENCES asset_models(id),
      FOREIGN KEY(category_id) REFERENCES categories(id),
      FOREIGN KEY(owner_id) REFERENCES team_members(id),
      FOREIGN KEY(location_id) REFERENCES locations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category_id);
    CREATE INDEX IF NOT EXISTS idx_assets_serial ON assets(serial);
    CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
    CREATE INDEX IF NOT EXISTS idx_assets_owner ON assets(owner_id);
    CREATE TABLE IF NOT EXISTS asset_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      owner_id INTEGER,
      reason TEXT,
      nvbug TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(asset_id) REFERENCES assets(id),
      FOREIGN KEY(owner_id) REFERENCES team_members(id)
    );
    CREATE TABLE IF NOT EXISTS asset_activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER,
      asset_id INTEGER,
      model_id INTEGER,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      summary TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      reason TEXT,
      nvbug TEXT,
      source TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(parent_id) REFERENCES asset_activity_log(id),
      FOREIGN KEY(asset_id) REFERENCES assets(id),
      FOREIGN KEY(model_id) REFERENCES asset_models(id)
    );
    CREATE INDEX IF NOT EXISTS idx_activity_asset ON asset_activity_log(asset_id);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON asset_activity_log(created_at);
    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile TEXT NOT NULL,
      filename TEXT,
      status TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT,
      preview_json TEXT,
      created_at TEXT NOT NULL,
      committed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS label_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      width_in REAL NOT NULL,
      height_in REAL NOT NULL,
      layout_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function getSchemaVersion() {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get();
  return row ? Number(row.value) : 0;
}

function setSchemaVersion(version) {
  db.prepare(`
    INSERT INTO app_meta (key, value) VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(version));
}

function runMigrations() {
  if (!fs.existsSync(migrationsDir)) {
    console.log(`schema version ${getSchemaVersion()}`);
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/i.test(name))
    .sort((a, b) => Number(a.split("_")[0]) - Number(b.split("_")[0]));

  let currentVersion = getSchemaVersion();

  for (const file of files) {
    const version = Number(file.split("_")[0]);
    if (version <= currentVersion) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.exec("BEGIN IMMEDIATE;");
    try {
      if (sql.trim()) db.exec(sql);
      setSchemaVersion(version);
      db.exec("COMMIT;");
      currentVersion = version;
      console.log(`Applied migration ${file} (schema_version=${version})`);
    } catch (error) {
      db.exec("ROLLBACK;");
      throw new Error(`Migration ${file} failed: ${error.message}`);
    }
  }

  console.log(`schema version ${getSchemaVersion()}`);
}

function getRevision() {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'revision'").get();
  return row ? Number(row.value) : 1;
}

function bumpRevision() {
  const next = getRevision() + 1;
  db.prepare(`
    INSERT INTO app_meta (key, value) VALUES ('revision', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(next));
  return next;
}

function tx(fn, bump = true) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = fn();
    const revision = bump ? bumpRevision() : getRevision();
    db.exec("COMMIT;");
    if (result && typeof result === "object" && !Array.isArray(result)) return { ...result, appRevision: revision };
    return result;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function logActivity(entry) {
  const info = db.prepare(`
    INSERT INTO asset_activity_log (
      parent_id, asset_id, model_id, actor_name, action, summary,
      before_json, after_json, reason, nvbug, source, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.parentId || null,
    entry.assetId || null,
    entry.modelId || null,
    entry.actorName || "System",
    entry.action,
    entry.summary,
    entry.before ? json(entry.before) : null,
    entry.after ? json(entry.after) : null,
    entry.reason || "",
    normalizeBug(entry.nvbug || ""),
    entry.source || "app",
    entry.metadata ? json(entry.metadata) : null,
    now(),
  );
  return Number(info.lastInsertRowid);
}

function shouldSeed() {
  if (process.env.SEED_MODE === "0") return false;
  if (process.env.SEED_MODE === "1") return true;
  if (process.env.NODE_ENV === "production") return false;
  return true;
}

function seedMasterDataIfNeeded() {
  if (process.env.SEED_MODE === "0") return;
  const memberCount = db.prepare("SELECT COUNT(*) AS count FROM team_members").get().count;
  const categoryCount = db.prepare("SELECT COUNT(*) AS count FROM categories").get().count;
  const locationCount = db.prepare("SELECT COUNT(*) AS count FROM locations").get().count;
  if (memberCount && categoryCount && locationCount) return;

  tx(() => {
    if (!db.prepare("SELECT COUNT(*) AS count FROM app_meta WHERE key = 'revision'").get().count) {
      db.prepare("INSERT INTO app_meta (key, value) VALUES ('revision', '1')").run();
    }
    if (!categoryCount) {
      const insertCategory = db.prepare("INSERT INTO categories (slug, name, description, prefix, sort_order) VALUES (?, ?, ?, ?, ?)");
      const insertField = db.prepare("INSERT INTO field_definitions (category_id, field_key, label, type, required, options_json, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)");
      CATEGORY_PROFILES.forEach((profile, index) => {
        const categoryInfo = insertCategory.run(profile.slug, profile.name, profile.description, profile.prefix, index + 1);
        const categoryId = Number(categoryInfo.lastInsertRowid);
        let sort = 1;
        COMMON_FIELDS.forEach(([key, label, type, required]) => {
          const options = key === "status" ? STATUSES : key === "borrowedLent" ? ["", "Borrowed", "Lent"] : null;
          insertField.run(categoryId, key, label, type, required, options ? json(options) : null, sort++);
        });
        profile.fields.forEach(([key, label, type, required, options]) => {
          insertField.run(categoryId, key, label, type, required, options ? json(options) : null, sort++);
        });
      });
    }
    if (!memberCount) {
      const insertMember = db.prepare("INSERT INTO team_members (name, email, username) VALUES (?, ?, ?)");
      TEAM_MEMBERS.forEach((member) => insertMember.run(...member));
    }
    if (!locationCount) {
      const insertLocation = db.prepare("INSERT INTO locations (name, building, detail) VALUES (?, ?, ?)");
      const buildings = ["Building R", "Building S", "Building E"];
      for (const building of buildings) {
        for (const detail of ["Lab 104 / Rack 01 / Cabinet 01", "Lab 209 / Rack 02 / Cabinet 02", "Lab 305 / Rack 03 / Cabinet 03", "Lab 410 / Storage 04", "Lab 512 / Rack 05 / Cabinet 05"]) {
          insertLocation.run(`Santa Clara ${building} / ${detail}`, building, detail);
        }
      }
    }
    if (!db.prepare("SELECT COUNT(*) AS count FROM label_templates").get().count) {
      db.prepare("INSERT INTO label_templates (name, width_in, height_in, layout_json) VALUES (?, ?, ?, ?)").run(
        "Small Asset Label",
        2.125,
        1,
        json({ line1: "model", line2: "assetTag", barcode: "assetTag", line3: "serial" }),
      );
    }
  }, false);
}

function seedSyntheticAssetsIfNeeded() {
  const categoryCount = db.prepare("SELECT COUNT(*) AS count FROM categories").get().count;
  const assetCount = db.prepare("SELECT COUNT(*) AS count FROM assets").get().count;
  if (!categoryCount || assetCount || !shouldSeed()) return;

  tx(() => {
    const members = db.prepare("SELECT id FROM team_members ORDER BY id").all();
    const locations = db.prepare("SELECT id FROM locations ORDER BY id").all();
    if (!members.length || !locations.length) return;

    const insertModel = db.prepare(`
      INSERT INTO asset_models (category_id, name, manufacturer, model_number, sku, description, label_line, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAsset = db.prepare(`
      INSERT INTO assets (
        model_id, category_id, serial, asset_tag, status, status_id, owner_id, location_id,
        usage, nvbug, borrowed_lent, notes, extra_json, archived, created_at, updated_at, revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const statusCycle = ["Idle", "In Use", "Ready to Deploy", "Broken", "In Use", "Idle", "E-waste Pending"];
    const usageCycle = ["Lab validation", "AI research", "Driver bring-up", "Automation", "Regression pool", "Thermal study", "Rack qualification"];
    let globalAssetNumber = 1;

    for (const profile of CATEGORY_PROFILES) {
      const category = db.prepare("SELECT id FROM categories WHERE slug = ?").get(profile.slug);
      if (!category) continue;
      const modelIds = profile.models.map((modelName, modelIndex) => {
        const sku = `${profile.prefix}-SKU-${String(modelIndex + 1).padStart(3, "0")}`;
        const info = insertModel.run(
          category.id,
          modelName,
          modelName.includes("Cable") ? "CableWorks" : modelName.includes("Switch") ? "NetFabric" : "Lab Systems",
          `${profile.prefix}-${String(modelIndex + 1).padStart(4, "0")}`,
          sku,
          `${profile.name} model prepared for Inventory 3.0 validation.`,
          `${profile.prefix} ${modelName}`,
          now(),
          now(),
        );
        return Number(info.lastInsertRowid);
      });

      const perCategory = SYNTHETIC_ASSET_COUNTS[profile.slug] ?? 8;
      for (let i = 1; i <= perCategory; i += 1) {
        const modelId = modelIds[(i - 1) % modelIds.length];
        let status = statusCycle[(i - 1) % statusCycle.length];
        if (profile.slug === "e-waste") status = i % 3 === 0 ? "E-Wasted" : "E-waste Pending";
        if (profile.slug === "broken-devices") status = i % 4 === 0 ? "E-waste Pending" : "Broken";
        const archived = status === "E-Wasted" ? 1 : 0;
        const ownerId = status === "In Use" || status === "Lent" || profile.slug === "low-price-consumables" ? members[(i + globalAssetNumber) % members.length].id : null;
        const loc = locations[(i + globalAssetNumber) % locations.length].id;
        const assetTag = `INV3-${profile.prefix}-${String(i).padStart(5, "0")}`;
        const serial = profile.slug === "low-price-consumables" ? "" : `${profile.prefix}3${String(20260000 + globalAssetNumber).padStart(8, "0")}`;
        const extra = {};
        for (const [key, label, type] of profile.fields) {
          if (type === "date") extra[key] = `2026-${String(((i - 1) % 9) + 1).padStart(2, "0")}-${String(((i - 1) % 23) + 1).padStart(2, "0")}`;
          else if (key === "quantity") extra[key] = 5 + (i % 40);
          else if (key === "requester") extra[key] = TEAM_MEMBERS[(i + 2) % TEAM_MEMBERS.length][0];
          else if (key === "problem") extra[key] = "Synthetic repair triage item. Validate before returning to service.";
          else if (key === "eWastePending") extra[key] = i % 3 === 0 ? "Yes" : "No";
          else if (key === "type") extra[key] = ["ETH", "IB", "RJ45"][i % 3];
          else if (key === "gpuClass") extra[key] = ["Data Center", "Professional", "RTX"][i % 3];
          else if (key === "nativeResolution") extra[key] = ["3840x2160", "2560x1440", "1920x1080"][i % 3];
          else if (key === "openPartNo") extra[key] = `${profile.prefix}-OPN-${String(i).padStart(4, "0")}`;
          else if (key === "ip") extra[key] = `10.30.${(i % 20) + 1}.${(globalAssetNumber % 200) + 20}`;
          else extra[key] = `${label} ${String(i).padStart(2, "0")}`;
        }
        const statusIdRow = db.prepare("SELECT id FROM status_labels WHERE name = ?").get(status);
        insertAsset.run(
          modelId,
          category.id,
          serial,
          assetTag,
          status,
          statusIdRow ? statusIdRow.id : null,
          ownerId,
          loc,
          usageCycle[i % usageCycle.length],
          String(9000000 + globalAssetNumber),
          i % 17 === 0 ? "Borrowed" : i % 19 === 0 ? "Lent" : "",
          "Synthetic Inventory 3.0 seed record.",
          json(extra),
          archived,
          now(),
          now(),
          1,
        );
        logActivity({
          assetId: Number(db.prepare("SELECT last_insert_rowid() AS id").get().id),
          modelId,
          actorName: "System",
          action: "seed",
          summary: `Seeded ${assetTag}`,
          source: "seed",
          metadata: { synthetic: true },
        });
        globalAssetNumber += 1;
      }
    }
    bumpRevision();
  }, false);
}

function seedIfNeeded() {
  const count = db.prepare("SELECT COUNT(*) AS count FROM categories").get().count;
  if (count || !shouldSeed()) {
    seedSyntheticAssetsIfNeeded();
    return;
  }
  tx(() => {
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('revision', '1')").run();

    const insertCategory = db.prepare("INSERT INTO categories (slug, name, description, prefix, sort_order) VALUES (?, ?, ?, ?, ?)");
    const insertField = db.prepare("INSERT INTO field_definitions (category_id, field_key, label, type, required, options_json, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)");
    CATEGORY_PROFILES.forEach((profile, index) => {
      const categoryInfo = insertCategory.run(profile.slug, profile.name, profile.description, profile.prefix, index + 1);
      const categoryId = Number(categoryInfo.lastInsertRowid);
      let sort = 1;
      COMMON_FIELDS.forEach(([key, label, type, required]) => {
        const options = key === "status" ? STATUSES : key === "borrowedLent" ? ["", "Borrowed", "Lent"] : null;
        insertField.run(categoryId, key, label, type, required, options ? json(options) : null, sort++);
      });
      profile.fields.forEach(([key, label, type, required, options]) => {
        insertField.run(categoryId, key, label, type, required, options ? json(options) : null, sort++);
      });
    });

    const insertMember = db.prepare("INSERT INTO team_members (name, email, username) VALUES (?, ?, ?)");
    TEAM_MEMBERS.forEach((member) => insertMember.run(...member));

    const insertLocation = db.prepare("INSERT INTO locations (name, building, detail) VALUES (?, ?, ?)");
    const buildings = ["Building R", "Building S", "Building E"];
    for (const building of buildings) {
      for (const detail of ["Lab 104 / Rack 01 / Cabinet 01", "Lab 209 / Rack 02 / Cabinet 02", "Lab 305 / Rack 03 / Cabinet 03", "Lab 410 / Storage 04", "Lab 512 / Rack 05 / Cabinet 05"]) {
        insertLocation.run(`Santa Clara ${building} / ${detail}`, building, detail);
      }
    }

    db.prepare("INSERT INTO label_templates (name, width_in, height_in, layout_json) VALUES (?, ?, ?, ?)").run(
      "Small Asset Label",
      2.125,
      1,
      json({ line1: "model", line2: "assetTag", barcode: "assetTag", line3: "serial" }),
    );

    const members = db.prepare("SELECT id FROM team_members ORDER BY id").all();
    const locations = db.prepare("SELECT id FROM locations ORDER BY id").all();
    const insertModel = db.prepare(`
      INSERT INTO asset_models (category_id, name, manufacturer, model_number, sku, description, label_line, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAsset = db.prepare(`
      INSERT INTO assets (
        model_id, category_id, serial, asset_tag, status, status_id, owner_id, location_id,
        usage, nvbug, borrowed_lent, notes, extra_json, archived, created_at, updated_at, revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const statusCycle = ["Idle", "In Use", "Ready to Deploy", "Broken", "In Use", "Idle", "E-waste Pending"];
    const usageCycle = ["Lab validation", "AI research", "Driver bring-up", "Automation", "Regression pool", "Thermal study", "Rack qualification"];
    let globalAssetNumber = 1;

    for (const profile of CATEGORY_PROFILES) {
      const category = db.prepare("SELECT id FROM categories WHERE slug = ?").get(profile.slug);
      const modelIds = profile.models.map((modelName, modelIndex) => {
        const sku = `${profile.prefix}-SKU-${String(modelIndex + 1).padStart(3, "0")}`;
        const info = insertModel.run(
          category.id,
          modelName,
          modelName.includes("Cable") ? "CableWorks" : modelName.includes("Switch") ? "NetFabric" : "Lab Systems",
          `${profile.prefix}-${String(modelIndex + 1).padStart(4, "0")}`,
          sku,
          `${profile.name} model prepared for Inventory 3.0 validation.`,
          `${profile.prefix} ${modelName}`,
          now(),
          now(),
        );
        return Number(info.lastInsertRowid);
      });

      const assetCount = SYNTHETIC_ASSET_COUNTS[profile.slug] ?? 8;
      for (let i = 1; i <= assetCount; i += 1) {
        const modelId = modelIds[(i - 1) % modelIds.length];
        let status = statusCycle[(i - 1) % statusCycle.length];
        if (profile.slug === "e-waste") status = i % 3 === 0 ? "E-Wasted" : "E-waste Pending";
        if (profile.slug === "broken-devices") status = i % 4 === 0 ? "E-waste Pending" : "Broken";
        const archived = status === "E-Wasted" ? 1 : 0;
        const ownerId = status === "In Use" || status === "Lent" || profile.slug === "low-price-consumables" ? members[(i + globalAssetNumber) % members.length].id : null;
        const loc = locations[(i + globalAssetNumber) % locations.length].id;
        const assetTag = `INV3-${profile.prefix}-${String(i).padStart(5, "0")}`;
        const serial = profile.slug === "low-price-consumables" ? "" : `${profile.prefix}3${String(20260000 + globalAssetNumber).padStart(8, "0")}`;
        const extra = {};
        for (const [key, label, type] of profile.fields) {
          if (type === "date") extra[key] = `2026-${String(((i - 1) % 9) + 1).padStart(2, "0")}-${String(((i - 1) % 23) + 1).padStart(2, "0")}`;
          else if (key === "quantity") extra[key] = 5 + (i % 40);
          else if (key === "requester") extra[key] = TEAM_MEMBERS[(i + 2) % TEAM_MEMBERS.length][0];
          else if (key === "problem") extra[key] = "Synthetic repair triage item. Validate before returning to service.";
          else if (key === "eWastePending") extra[key] = i % 3 === 0 ? "Yes" : "No";
          else if (key === "type") extra[key] = ["ETH", "IB", "RJ45"][i % 3];
          else if (key === "gpuClass") extra[key] = ["Data Center", "Professional", "RTX"][i % 3];
          else if (key === "nativeResolution") extra[key] = ["3840x2160", "2560x1440", "1920x1080"][i % 3];
          else if (key === "openPartNo") extra[key] = `${profile.prefix}-OPN-${String(i).padStart(4, "0")}`;
          else if (key === "ip") extra[key] = `10.30.${(i % 20) + 1}.${(globalAssetNumber % 200) + 20}`;
          else extra[key] = `${label} ${String(i).padStart(2, "0")}`;
        }
        const statusIdRow = db.prepare("SELECT id FROM status_labels WHERE name = ?").get(status);
        insertAsset.run(
          modelId,
          category.id,
          serial,
          assetTag,
          status,
          statusIdRow ? statusIdRow.id : null,
          ownerId,
          loc,
          usageCycle[i % usageCycle.length],
          String(9000000 + globalAssetNumber),
          i % 17 === 0 ? "Borrowed" : i % 19 === 0 ? "Lent" : "",
          "Synthetic Inventory 3.0 seed record.",
          json(extra),
          archived,
          now(),
          now(),
          1,
        );
        logActivity({
          assetId: Number(db.prepare("SELECT last_insert_rowid() AS id").get().id),
          modelId,
          actorName: "System",
          action: "seed",
          summary: `Seeded ${assetTag}`,
          source: "seed",
          metadata: { synthetic: true },
        });
        globalAssetNumber += 1;
      }
    }
  }, false);
}

initSchema();
runMigrations();
seedMasterDataIfNeeded();
seedIfNeeded();
seedSyntheticAssetsIfNeeded();

module.exports = {
  db,
  getSchemaVersion,
  getRevision,
  bumpRevision,
  tx,
  logActivity,
};
