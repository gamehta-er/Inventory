const http = require("http");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3001);
const appRoot = __dirname;
const repoRoot = path.resolve(appRoot, "..");
const publicDir = path.join(appRoot, "public");
const dataDir = path.join(appRoot, "data");
const dbPath = path.join(dataDir, "inventory2.db");
const sourceDataDir = path.join(repoRoot, "data");
const backupDir = path.join(dataDir, "backups");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

const categoryOwners = {
  GPU: "Monica Martin",
  "Hard Disk": "Ben Siemens",
  "M.2 Drives": "Gaurav Mehta",
  Cables: "Monica Martin",
  "Network Card": "Ben Siemens",
  "Riser Card": "Gaurav Mehta",
  Transposer: "Gaurav Mehta",
  PDU: "Monica Martin",
  PSU: "Gaurav Mehta",
  Server: "Gaurav Mehta",
  "Water Cool Hose": "Monica Martin"
};

let db;

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift() || [];
  return rows
    .filter((items) => items.some((item) => String(item || "").trim()))
    .map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ""])));
}

function readSourceCsv(fileName) {
  const filePath = path.join(sourceDataDir, fileName);
  if (!fsSync.existsSync(filePath)) return [];
  return parseCsv(fsSync.readFileSync(filePath, "utf8"));
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function splitList(value) {
  return String(value || "")
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function ownerFor(category) {
  return categoryOwners[category] || "Inventory Operations";
}

function criticalityFor(quantity, minimum) {
  if (quantity <= 0) return "Critical";
  if (quantity <= minimum) return "High";
  return "Normal";
}

function stockStatus(part) {
  if (part.quantity <= 0) return { key: "missing", label: "Missing", rank: 0 };
  if (part.quantity <= part.minimum) return { key: "low", label: "Low stock", rank: 1 };
  return { key: "available", label: "Available", rank: 2 };
}

function locationLabel(part) {
  return `Aisle ${part.aisle || "-"} / Bin ${part.bin || "-"}`;
}

function isoNow() {
  return new Date().toISOString();
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

function initDatabase() {
  fsSync.mkdirSync(dataDir, { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS part_master (
      sku TEXT PRIMARY KEY,
      part_name TEXT NOT NULL,
      category TEXT NOT NULL,
      available_qty INTEGER NOT NULL DEFAULT 0,
      min_qty INTEGER NOT NULL DEFAULT 0,
      aisle TEXT,
      bin_code TEXT,
      distinguishers TEXT,
      aliases_json TEXT,
      metadata TEXT,
      image_path TEXT,
      owner TEXT,
      criticality TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS code_mappings (
      code TEXT PRIMARY KEY,
      code_type TEXT NOT NULL,
      sku TEXT NOT NULL,
      asset_id TEXT,
      status TEXT NOT NULL DEFAULT 'Active',
      location_override TEXT,
      notes TEXT,
      created_at TEXT,
      last_scanned_at TEXT,
      FOREIGN KEY (sku) REFERENCES part_master(sku)
    );

    CREATE TABLE IF NOT EXISTS stock_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      operator_name TEXT NOT NULL,
      operator_email TEXT,
      action TEXT NOT NULL,
      sku TEXT NOT NULL,
      part_name TEXT,
      category TEXT,
      quantity INTEGER NOT NULL,
      before_qty INTEGER NOT NULL,
      after_qty INTEGER NOT NULL,
      aisle TEXT,
      bin_code TEXT,
      reason TEXT,
      nvbug TEXT,
      lookup_method TEXT,
      source TEXT,
      FOREIGN KEY (sku) REFERENCES part_master(sku)
    );

    CREATE TABLE IF NOT EXISTS replenishment_requests (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      email TEXT,
      sku TEXT,
      part_name TEXT,
      category TEXT,
      aisle TEXT,
      bin_code TEXT,
      current_qty INTEGER,
      min_qty INTEGER,
      requested_qty INTEGER,
      priority TEXT,
      status TEXT,
      owner TEXT,
      notes TEXT,
      FOREIGN KEY (sku) REFERENCES part_master(sku)
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  seedSetting("runtimeSource", "SQLite");
  seedSetting("backupDirectory", path.relative(repoRoot, backupDir));
  seedSetting("lastBackupAt", "");
  seedSetting("lastBackupStatus", "Not run");
  seedSetting("lastBackupPath", "");

  const partCount = db.prepare("SELECT COUNT(*) AS count FROM part_master").get().count;
  if (!partCount) seedDatabase();
}

function seedSetting(key, value) {
  db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)").run(key, value);
}

function updateSetting(key, value) {
  db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

function readSettings() {
  return Object.fromEntries(db.prepare("SELECT key, value FROM system_settings").all().map((row) => [row.key, row.value]));
}

function seedDatabase() {
  const now = isoNow();
  const parts = readSourceCsv("parts.csv");
  const partCodes = readSourceCsv("part_codes.csv");
  const transactions = readSourceCsv("transactions.csv");
  const replenishment = readSourceCsv("replenishment.csv");

  const insertPart = db.prepare(`
    INSERT OR REPLACE INTO part_master (
      sku, part_name, category, available_qty, min_qty, aisle, bin_code, distinguishers,
      aliases_json, metadata, image_path, owner, criticality, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCode = db.prepare(`
    INSERT OR REPLACE INTO code_mappings (
      code, code_type, sku, asset_id, status, location_override, notes, created_at, last_scanned_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertLedger = db.prepare(`
    INSERT INTO stock_ledger (
      timestamp, operator_name, operator_email, action, sku, part_name, category, quantity,
      before_qty, after_qty, aisle, bin_code, reason, nvbug, lookup_method, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRequest = db.prepare(`
    INSERT OR REPLACE INTO replenishment_requests (
      id, created_at, updated_at, created_by, email, sku, part_name, category, aisle, bin_code,
      current_qty, min_qty, requested_qty, priority, status, owner, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  try {
    parts.forEach((row) => {
      const quantity = numberValue(row["Available Quantity"]);
      const minimum = numberValue(row["Min Quantity"]);
      const category = row.Category || "Uncategorized";
      insertPart.run(
        row.SKU || "",
        row["Part Name"] || "",
        category,
        quantity,
        minimum,
        row.Aisle || "",
        row.Bin || "",
        row.Distinguishers || "",
        JSON.stringify(splitList(row.Aliases)),
        row.Metadata || "",
        row["Image Path"] || "",
        ownerFor(category),
        criticalityFor(quantity, minimum),
        now,
        now
      );
    });

    partCodes.forEach((row) => {
      if (!row.Code || !row.SKU) return;
      insertCode.run(
        row.Code,
        row["Code Type"] || "Barcode",
        row.SKU,
        row["Asset ID"] || "",
        row.Status || "Active",
        row["Location Override"] || "",
        row.Notes || "",
        row["Created At"] || now,
        row["Last Scanned At"] || ""
      );
    });

    transactions.forEach((row) => {
      if (!row.SKU) return;
      insertLedger.run(
        row.Timestamp || now,
        row["User Name"] || "System Seed",
        row.Email || "",
        row.Action || "Imported",
        row.SKU,
        row["Part Name"] || "",
        row.Category || "",
        numberValue(row.Quantity),
        numberValue(row["Before Quantity"]),
        numberValue(row["After Quantity"]),
        row.Aisle || "",
        row.Bin || "",
        row.Reason || "",
        row["NVBug#"] || "",
        row["Lookup Method"] || "Imported",
        "Seed import"
      );
    });

    replenishment.forEach((row) => {
      if (!row.Id && !row.SKU) return;
      insertRequest.run(
        row.Id || `REQ-${Date.now()}`,
        row["Created At"] || now,
        row["Updated At"] || now,
        row["Created By"] || "",
        row.Email || "",
        row.SKU || "",
        row["Part Name"] || "",
        row.Category || "",
        row.Aisle || "",
        row.Bin || "",
        numberValue(row["Current Quantity"]),
        numberValue(row["Min Quantity"]),
        numberValue(row["Requested Quantity"]),
        row.Priority || "Normal",
        row.Status || "New Request",
        row.Owner || ownerFor(row.Category),
        row.Notes || ""
      );
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function safeJsonList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readParts() {
  const rows = db.prepare("SELECT * FROM part_master ORDER BY category, sku").all();
  const codeRows = db.prepare("SELECT sku, COUNT(*) AS count FROM code_mappings WHERE lower(status) = 'active' GROUP BY sku").all();
  const codeCountBySku = new Map(codeRows.map((row) => [row.sku, row.count]));
  const lastRows = db.prepare(`
    SELECT sku, MAX(timestamp) AS last_movement
    FROM stock_ledger
    GROUP BY sku
  `).all();
  const lastMovementBySku = new Map(lastRows.map((row) => [row.sku, row.last_movement]));

  return rows.map((row) => {
    const part = {
      sku: row.sku,
      partName: row.part_name,
      category: row.category,
      quantity: numberValue(row.available_qty),
      minimum: numberValue(row.min_qty),
      aisle: row.aisle || "",
      bin: row.bin_code || "",
      distinguishers: row.distinguishers || "",
      aliases: safeJsonList(row.aliases_json),
      metadata: row.metadata || "",
      imagePath: row.image_path || "",
      owner: row.owner || ownerFor(row.category),
      criticality: row.criticality || criticalityFor(row.available_qty, row.min_qty),
      lastMovement: lastMovementBySku.get(row.sku) || "",
      barcodeCount: numberValue(codeCountBySku.get(row.sku))
    };
    part.status = stockStatus(part);
    part.location = locationLabel(part);
    return part;
  });
}

function categorySummary(parts) {
  return [...parts.reduce((map, part) => {
    if (!map.has(part.category)) {
      map.set(part.category, { category: part.category, totalOnHand: 0, skuCount: 0, stockedSkus: 0, lowStock: 0, missing: 0, locations: new Set() });
    }
    const row = map.get(part.category);
    row.totalOnHand += part.quantity;
    row.skuCount += 1;
    row.stockedSkus += part.quantity > 0 ? 1 : 0;
    if (part.status.key === "low") row.lowStock += 1;
    if (part.status.key === "missing") row.missing += 1;
    row.locations.add(part.location);
    return map;
  }, new Map()).values()]
    .map((row) => ({ ...row, locations: row.locations.size }))
    .sort((left, right) => right.totalOnHand - left.totalOnHand || left.category.localeCompare(right.category));
}

function locationSummary(parts) {
  return [...parts.reduce((map, part) => {
    if (!map.has(part.location)) {
      map.set(part.location, { location: part.location, totalOnHand: 0, skuCount: 0, lowStock: 0, missing: 0, categories: new Set() });
    }
    const row = map.get(part.location);
    row.totalOnHand += part.quantity;
    row.skuCount += 1;
    if (part.status.key === "low") row.lowStock += 1;
    if (part.status.key === "missing") row.missing += 1;
    row.categories.add(part.category);
    return map;
  }, new Map()).values()]
    .map((row) => ({ ...row, categories: [...row.categories].sort().join(", ") }))
    .sort((left, right) => left.location.localeCompare(right.location));
}

function buildSnapshot() {
  const parts = readParts();
  const transactions = db.prepare("SELECT * FROM stock_ledger ORDER BY timestamp DESC, id DESC LIMIT 100").all();
  const codeMappings = db.prepare("SELECT * FROM code_mappings ORDER BY sku, code").all();
  const replenishment = db.prepare("SELECT * FROM replenishment_requests ORDER BY created_at DESC").all();
  const settings = readSettings();
  const riskQueue = parts
    .filter((part) => part.status.key !== "available")
    .sort((left, right) => left.status.rank - right.status.rank || left.category.localeCompare(right.category) || left.sku.localeCompare(right.sku));

  return {
    generatedAt: isoNow(),
    system: {
      name: "Inventory 2.0 Command Center",
      environment: "Comparison Build",
      runtime: "SQLite",
      phase: "Phase 1 - manual search and 2D barcode input",
      databaseRelativePath: path.relative(repoRoot, dbPath),
      databaseAbsolutePath: dbPath,
      seedSource: path.relative(repoRoot, sourceDataDir),
      backupDirectory: backupDir,
      lastBackupAt: settings.lastBackupAt || "",
      lastBackupStatus: settings.lastBackupStatus || "Not run",
      lastBackupPath: settings.lastBackupPath || ""
    },
    summary: {
      totalOnHand: parts.reduce((total, part) => total + part.quantity, 0),
      partMasterRecords: parts.length,
      stockedSkus: parts.filter((part) => part.quantity > 0).length,
      lowStock: parts.filter((part) => part.status.key === "low").length,
      missing: parts.filter((part) => part.status.key === "missing").length,
      locations: new Set(parts.map((part) => part.location)).size,
      openRestock: replenishment.filter((item) => !["completed", "closed", "refilled"].includes(String(item.status).toLowerCase())).length,
      codeMappings: codeMappings.filter((code) => String(code.status).toLowerCase() === "active").length
    },
    parts,
    categorySummary: categorySummary(parts),
    locationSummary: locationSummary(parts),
    riskQueue,
    transactions,
    codeMappings,
    replenishment
  };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function recordStockTransaction(payload) {
  const sku = String(payload.sku || "").trim();
  const action = String(payload.action || "").trim().toLowerCase();
  const quantity = Math.max(1, numberValue(payload.quantity));
  const reason = String(payload.reason || "").trim();
  const lookupMethod = String(payload.lookupMethod || "Manual selection").trim();
  const operatorName = String(payload.operatorName || "Gaurav Mehta").trim();
  const operatorEmail = String(payload.operatorEmail || "gamehta@nvidia.com").trim();
  const exceptionApproved = Boolean(payload.referenceException);
  let nvbug = String(payload.nvbug || "").trim();

  if (!sku) throw new Error("Select a valid SKU before recording a stock operation.");
  if (!["checkout", "restock"].includes(action)) throw new Error("Choose checkout or restock.");
  if (!reason) throw new Error("Business reason is required before updating inventory.");
  if (!nvbug && !exceptionApproved) throw new Error("Enter NVBug/reference or record an approved exception.");
  if (!nvbug && exceptionApproved) nvbug = "Exception recorded - no NVBug/reference available";

  const part = db.prepare("SELECT * FROM part_master WHERE sku = ?").get(sku);
  if (!part) throw new Error("The selected SKU was not found in Part Master.");

  const beforeQuantity = numberValue(part.available_qty);
  if (action === "checkout" && quantity > beforeQuantity) throw new Error("Checkout quantity cannot exceed available stock.");
  const afterQuantity = action === "checkout" ? beforeQuantity - quantity : beforeQuantity + quantity;
  const timestamp = isoNow();
  const actionLabel = action === "checkout" ? "Checkout" : "Restock";

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE part_master SET available_qty = ?, criticality = ?, updated_at = ? WHERE sku = ?")
      .run(afterQuantity, criticalityFor(afterQuantity, numberValue(part.min_qty)), timestamp, sku);
    db.prepare(`
      INSERT INTO stock_ledger (
        timestamp, operator_name, operator_email, action, sku, part_name, category, quantity,
        before_qty, after_qty, aisle, bin_code, reason, nvbug, lookup_method, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      timestamp,
      operatorName,
      operatorEmail,
      actionLabel,
      sku,
      part.part_name,
      part.category,
      quantity,
      beforeQuantity,
      afterQuantity,
      part.aisle || "",
      part.bin_code || "",
      reason,
      nvbug,
      lookupMethod,
      "Inventory 2.0"
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { ok: true, message: `${actionLabel} recorded for ${sku}.`, snapshot: buildSnapshot() };
}

function createReplenishmentRequest(payload) {
  const sku = String(payload.sku || "").trim();
  const part = db.prepare("SELECT * FROM part_master WHERE sku = ?").get(sku);
  if (!part) throw new Error("Select a valid SKU before creating a replenishment request.");
  const requestedQty = Math.max(1, numberValue(payload.requestedQty));
  const notes = String(payload.notes || "").trim();
  const priority = String(payload.priority || "Normal").trim();
  const now = isoNow();
  const id = `REQ2-${Date.now()}`;

  db.prepare(`
    INSERT INTO replenishment_requests (
      id, created_at, updated_at, created_by, email, sku, part_name, category, aisle, bin_code,
      current_qty, min_qty, requested_qty, priority, status, owner, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    now,
    now,
    payload.operatorName || "Gaurav Mehta",
    payload.operatorEmail || "gamehta@nvidia.com",
    sku,
    part.part_name,
    part.category,
    part.aisle || "",
    part.bin_code || "",
    numberValue(part.available_qty),
    numberValue(part.min_qty),
    requestedQty,
    priority,
    "New Request",
    part.owner || ownerFor(part.category),
    notes
  );

  return { ok: true, message: `${id} created for ${sku}.`, snapshot: buildSnapshot() };
}

function runBackup() {
  fsSync.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const targetPath = path.join(backupDir, `inventory2-${timestamp}.db`);
  db.exec(`VACUUM INTO '${escapeSqlString(targetPath)}'`);
  updateSetting("lastBackupAt", isoNow());
  updateSetting("lastBackupStatus", "Completed");
  updateSetting("lastBackupPath", targetPath);
  return { ok: true, message: "SQLite backup completed.", snapshot: buildSnapshot() };
}

function snapshotCsv(snapshot) {
  const headers = ["Category", "SKU", "Part Name", "Available", "Minimum", "Status", "Aisle", "Bin", "Owner", "Criticality", "Code Mappings", "Aliases", "Metadata"];
  const rows = snapshot.parts.map((part) => [
    part.category,
    part.sku,
    part.partName,
    part.quantity,
    part.minimum,
    part.status.label,
    part.aisle,
    part.bin,
    part.owner,
    part.criticality,
    part.barcodeCount,
    part.aliases.join("; "),
    part.metadata
  ]);
  return [headers.map(csvEscape).join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join("\n");
}

function ledgerCsv(snapshot) {
  const headers = ["Timestamp", "Operator", "Email", "Action", "SKU", "Part Name", "Category", "Quantity", "Before", "After", "Aisle", "Bin", "Reason", "NVBug/Reference", "Lookup Method"];
  const rows = snapshot.transactions.map((item) => [
    item.timestamp,
    item.operator_name,
    item.operator_email,
    item.action,
    item.sku,
    item.part_name,
    item.category,
    item.quantity,
    item.before_qty,
    item.after_qty,
    item.aisle,
    item.bin_code,
    item.reason,
    item.nvbug,
    item.lookup_method
  ]);
  return [headers.map(csvEscape).join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join("\n");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(text);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function serveStatic(requestUrl, response) {
  const safePath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.normalize(path.join(publicDir, decodeURIComponent(safePath)));
  if (filePath !== path.join(publicDir, "index.html") && !isInside(publicDir, filePath)) {
    sendText(response, 403, "Forbidden");
    return;
  }
  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(file);
  } catch {
    sendText(response, 404, "Not found");
  }
}

async function handleRequest(request, response) {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && requestUrl.pathname === "/api/v2/bootstrap") {
      sendJson(response, 200, buildSnapshot());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/v2/health") {
      sendJson(response, 200, { ok: true, runtime: "SQLite", database: dbPath });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/v2/stock/transaction") {
      sendJson(response, 200, recordStockTransaction(await readJsonBody(request)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/v2/replenishment") {
      sendJson(response, 200, createReplenishmentRequest(await readJsonBody(request)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/v2/system/backup") {
      sendJson(response, 200, runBackup());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/exports/inventory-snapshot") {
      response.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="inventory-2.0-snapshot.csv"',
        "Cache-Control": "no-store"
      });
      response.end(snapshotCsv(buildSnapshot()));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/exports/stock-ledger") {
      response.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="inventory-2.0-stock-ledger.csv"',
        "Cache-Control": "no-store"
      });
      response.end(ledgerCsv(buildSnapshot()));
      return;
    }

    await serveStatic(requestUrl, response);
  } catch (error) {
    sendJson(response, 500, { ok: false, message: error.message });
  }
}

initDatabase();
http.createServer(handleRequest).listen(port, host, () => {
  console.log(`Inventory 2.0 running at http://${host}:${port}`);
});
