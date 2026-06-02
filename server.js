const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const root = __dirname;
const publicDir = path.join(root, "public");
const dataDir = path.join(root, "data");
const inventoryPath = path.join(dataDir, "inventory.csv");
const reportsPath = path.join(dataDir, "reports.csv");
const partsPath = path.join(dataDir, "parts.csv");
const membersPath = path.join(dataDir, "members.csv");
const transactionsPath = path.join(dataDir, "transactions.csv");
const evaluationPath = path.join(dataDir, "evaluation_queue.csv");
const replenishmentPath = path.join(dataDir, "replenishment.csv");
const partCodesPath = path.join(dataDir, "part_codes.csv");
const dbPath = path.join(dataDir, "inventory.db");
const backupDirDefault = "data/backups";
const referenceImagesDir = path.join(dataDir, "reference_images");
const defaultReportEmail = "gamehta@nvidia.com";
const rowLabel = "Available Quantity";
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const adminEmails = new Set(["gamehta@nvidia.com", "monicam@nvidia.com"]);
let db;

const defaultSettings = {
  supportEmail: defaultReportEmail,
  backupDirectory: backupDirDefault,
  backupLastRunAt: "",
  backupLastStatus: "Not run",
  backupLastPath: ""
};

const csvFiles = {
  parts: { path: partsPath, fileName: "parts.csv", label: "SKU Catalog", exportPath: "/exports/sku-catalog" },
  members: { path: membersPath, fileName: "members.csv", label: "Members", exportPath: "/exports/members" },
  partcodes: { path: partCodesPath, fileName: "part_codes.csv", label: "Barcode / QR Mappings", exportPath: "/exports/code-mappings" },
  transactions: { path: transactionsPath, fileName: "transactions.csv", label: "Transaction Log", exportPath: "/exports/transaction-log" },
  evaluations: { path: evaluationPath, fileName: "evaluation_queue.csv", label: "Admin Review Queue", exportPath: "/exports/admin-review-queue" },
  replenishment: { path: replenishmentPath, fileName: "replenishment.csv", label: "Replenishment Records", exportPath: "/exports/replenishment-records" }
};

const categoryOrder = [
  "Cables",
  "GPU",
  "Hard Disk",
  "M.2 Drives",
  "Network Card",
  "Riser Card",
  "Transposer",
  "PDU",
  "PSU",
  "Server",
  "Water Cool Hose"
];

const searchProfiles = [
  {
    label: "Storage",
    triggers: ["hard drive", "drive", "disk", "hdd", "ssd", "m.2", "m2", "nvme", "sata", "sas", "storage"],
    categories: ["Hard Disk", "M.2 Drives"],
    refinements: [
      { label: "Type", options: ["SATA", "SAS", "SSD", "M.2", "NVMe"] },
      { label: "Capacity", options: ["1TB", "2TB", "4TB", "10TB", "18TB", "20TB"] }
    ]
  },
  {
    label: "GPU",
    triggers: ["gpu", "graphics", "accelerator", "a100", "h100", "l40s", "pcie gpu"],
    categories: ["GPU"],
    refinements: [
      { label: "Model", options: ["A100", "H100", "L40S"] },
      { label: "Memory", options: ["48GB", "80GB"] }
    ]
  },
  {
    label: "Cables",
    triggers: ["cable", "cord", "minisas", "sff", "sata fanout", "c13", "c14", "power cable"],
    categories: ["Cables"],
    refinements: [
      { label: "Connector", options: ["MiniSAS", "SFF-8643", "SATA", "C13", "C14"] },
      { label: "Use", options: ["storage", "power", "PDU"] }
    ]
  },
  {
    label: "Power",
    triggers: ["power", "psu", "pdu", "power supply"],
    categories: ["PSU", "PDU"],
    refinements: [
      { label: "Type", options: ["PSU", "PDU", "power cable"] },
      { label: "Rating", options: ["2400W", "32A", "3PH"] }
    ]
  }
];

const partsHeaders = [
  "Image Path",
  "SKU",
  "Part Name",
  "Category",
  "Available Quantity",
  "Min Quantity",
  "Aisle",
  "Bin",
  "Distinguishers",
  "Aliases",
  "Metadata"
];

const transactionHeaders = [
  "Timestamp",
  "User Name",
  "Email",
  "Action",
  "SKU",
  "Part Name",
  "Category",
  "Quantity",
  "Before Quantity",
  "After Quantity",
  "Aisle",
  "Bin",
  "Reason",
  "User Role",
  "Guest",
  "NVBug#",
  "Lookup Method",
  "Part Code",
  "Admin Override"
];

const evaluationHeaders = [
  "Timestamp",
  "User Name",
  "Email",
  "Hint",
  "Candidate SKU",
  "Candidate Name",
  "Confidence",
  "Reason",
  "Status",
  "Code",
  "Lookup Method"
];

const partCodeHeaders = [
  "Code",
  "Code Type",
  "SKU",
  "Asset ID",
  "Status",
  "Location Override",
  "Created By",
  "Created At",
  "Last Scanned At",
  "Notes"
];

const replenishmentHeaders = [
  "Id",
  "Created At",
  "Updated At",
  "Created By",
  "Email",
  "SKU",
  "Part Name",
  "Category",
  "Aisle",
  "Bin",
  "Current Quantity",
  "Min Quantity",
  "Requested Quantity",
  "Priority",
  "Status",
  "Owner",
  "Notes"
];

const replenishmentStatuses = [
  "New Request",
  "Submitted",
  "In Progress",
  "Completed"
];

function defaultPartCodesFromParts(parts) {
  return parts.map((part) => ({
    Code: `QR-${part.SKU}`,
    "Code Type": "QR",
    SKU: part.SKU,
    "Asset ID": "",
    Status: "Active",
    "Location Override": "",
    "Created By": "System Seed",
    "Created At": "2026-05-28T00:00:00.000Z",
    "Last Scanned At": "",
    Notes: "SKU-level pilot QR code"
  }));
}

const defaultParts = [
  {
    SKU: "GPU-A100-80GB-PCIE",
    "Part Name": "NVIDIA A100 80GB PCIe",
    Category: "GPU",
    "Available Quantity": 3,
    "Min Quantity": 2,
    Aisle: "A12",
    Bin: "03-02-1",
    Distinguishers: "Full-height PCIe GPU; 80GB label; NVIDIA A100 marking; passive heatsink; 8-pin power",
    Aliases: "A100 80GB;A100 PCIe;PNY A100 80GB PCIe;GPU A100"
  },
  {
    SKU: "GPU-H100-80GB-PCIE",
    "Part Name": "NVIDIA H100 80GB PCIe",
    Category: "GPU",
    "Available Quantity": 2,
    "Min Quantity": 2,
    Aisle: "A12",
    Bin: "03-03-2",
    Distinguishers: "H100 label; PCIe edge connector; large passive thermal module; 80GB marking",
    Aliases: "H100;H100 PCIe;NVIDIA H100;GPU H100"
  },
  {
    SKU: "GPU-L40S-48GB",
    "Part Name": "NVIDIA L40S 48GB",
    Category: "GPU",
    "Available Quantity": 4,
    "Min Quantity": 2,
    Aisle: "A13",
    Bin: "01-01-1",
    Distinguishers: "L40S label; dual-slot PCIe card; 48GB marking; blower-style shroud",
    Aliases: "L40S;L40S 48GB;GPU L40S"
  },
  {
    SKU: "HDD-HGST-20TB-SATA",
    "Part Name": "HGST Ultrastar 20TB SATA",
    Category: "Hard Disk",
    "Available Quantity": 5,
    "Min Quantity": 2,
    Aisle: "B05",
    Bin: "01-04-2",
    Distinguishers: "3.5 inch HDD; HGST Ultrastar label; 20TB; SATA connector",
    Aliases: "HGST 20TB;Ultrastar 20TB;20TB SATA;Hard Disk"
  },
  {
    SKU: "HDD-SEAGATE-18TB-SAS",
    "Part Name": "Seagate Exos 18TB SAS",
    Category: "Hard Disk",
    "Available Quantity": 7,
    "Min Quantity": 2,
    Aisle: "B05",
    Bin: "01-04-3",
    Distinguishers: "3.5 inch HDD; Seagate Exos label; 18TB; SAS connector",
    Aliases: "Seagate 18TB;Exos 18TB;18TB SAS;Hard Disk"
  },
  {
    SKU: "M2-SAMSUNG-980PRO-2TB",
    "Part Name": "Samsung 980 PRO 2TB M.2",
    Category: "M.2 Drives",
    "Available Quantity": 1,
    "Min Quantity": 4,
    Aisle: "A08",
    Bin: "02-01-3",
    Distinguishers: "M.2 2280 form factor; Samsung 980 PRO label; NVMe; 2TB",
    Aliases: "Samsung 980 PRO;980 PRO 2TB;M.2 2TB;NVMe 2TB"
  },
  {
    SKU: "M2-WD-SN850X-4TB",
    "Part Name": "WD Black SN850X 4TB M.2",
    Category: "M.2 Drives",
    "Available Quantity": 6,
    "Min Quantity": 4,
    Aisle: "A08",
    Bin: "02-01-4",
    Distinguishers: "M.2 2280 form factor; WD Black SN850X label; NVMe; 4TB",
    Aliases: "SN850X;WD Black;M.2 4TB;NVMe 4TB"
  },
  {
    SKU: "NIC-MCX6-200GBE",
    "Part Name": "Mellanox ConnectX-6 200GbE",
    Category: "Network Card",
    "Available Quantity": 3,
    "Min Quantity": 2,
    Aisle: "C03",
    Bin: "01-02-1",
    Distinguishers: "PCIe network card; dual QSFP ports; ConnectX-6 label; 200GbE",
    Aliases: "ConnectX-6;Mellanox 200GbE;CX6;Network Card;NIC"
  },
  {
    SKU: "RISER-NV-4U-PCIE",
    "Part Name": "NVIDIA 4U PCIe Riser Card",
    Category: "Riser Card",
    "Available Quantity": 6,
    "Min Quantity": 2,
    Aisle: "A07",
    Bin: "04-03-1",
    Distinguishers: "Right-angle PCIe riser; 4U bracket; NVIDIA part label",
    Aliases: "PCIe riser;4U riser;Riser Card;GPU riser"
  },
  {
    SKU: "TRANS-QTM2",
    "Part Name": "NVIDIA Quantum-2 Transposer",
    Category: "Transposer",
    "Available Quantity": 2,
    "Min Quantity": 1,
    Aisle: "C11",
    Bin: "01-01-1",
    Distinguishers: "Quantum-2 label; transposer board; high-density board connectors",
    Aliases: "Quantum-2;Transposer;QTM2"
  },
  {
    SKU: "CBL-MINISAS-HD-4X-SATA",
    "Part Name": "MiniSAS HD to 4x SATA Cable",
    Category: "Cables",
    "Available Quantity": 18,
    "Min Quantity": 5,
    Aisle: "D02",
    Bin: "05-02-2",
    Distinguishers: "MiniSAS HD SFF-8643 connector; four SATA fanout ends; black cable bundle",
    Aliases: "MiniSAS HD;SFF-8643;SATA fanout;cable"
  },
  {
    SKU: "CBL-C13-C14-2M",
    "Part Name": "C13 to C14 Power Cable 2m",
    Category: "Cables",
    "Available Quantity": 26,
    "Min Quantity": 10,
    Aisle: "D02",
    Bin: "03-01-4",
    Distinguishers: "IEC C13 female; IEC C14 male; 2 meter power cord; black jacket",
    Aliases: "C13 C14;power cable;IEC cable;PDU cable"
  },
  {
    SKU: "PDU-APC-32A-3PH",
    "Part Name": "APC 32A 3PH Rack PDU",
    Category: "PDU",
    "Available Quantity": 4,
    "Min Quantity": 2,
    Aisle: "E01",
    Bin: "02-02-1",
    Distinguishers: "APC label; rack PDU; 32A; three phase; outlet bank",
    Aliases: "APC PDU;32A PDU;3 phase PDU;Rack PDU"
  },
  {
    SKU: "PSU-DELTA-12V-2400W",
    "Part Name": "Delta 12V 2.4kW Power Supply",
    Category: "PSU",
    "Available Quantity": 7,
    "Min Quantity": 2,
    Aisle: "E03",
    Bin: "01-03-1",
    Distinguishers: "Delta label; 12V output; 2400W marking; hot-swap PSU handle",
    Aliases: "Delta PSU;2400W PSU;2.4kW power supply;PSU"
  },
  {
    SKU: "SERVER-DELL-R760",
    "Part Name": "Dell PowerEdge R760 Server",
    Category: "Server",
    "Available Quantity": 3,
    "Min Quantity": 1,
    Aisle: "F01",
    Bin: "01-01-1",
    Distinguishers: "Dell PowerEdge R760 bezel; 2U server chassis; service tag label",
    Aliases: "R760;PowerEdge R760;Dell server;Server"
  },
  {
    SKU: "HOSE-WC-1.5M-QD",
    "Part Name": "Water Cool Hose 1.5m Quick Disconnect",
    Category: "Water Cool Hose",
    "Available Quantity": 14,
    "Min Quantity": 5,
    Aisle: "D04",
    Bin: "03-01-2",
    Distinguishers: "1.5m hose; quick disconnect couplers; coolant line; braided sleeve",
    Aliases: "water hose;cooling hose;quick disconnect hose;coolant hose"
  }
];

const memberHeaders = ["Member", "Email"];

const defaultMembers = [
  ["Armin Khosravi", "akhosravi@nvidia.com"],
  ["Ben Siemens", "bsiemens@nvidia.com"],
  ["Chris David", "cdavid@nvidia.com"],
  ["Denny Srun", "dsrun@nvidia.com"],
  ["Gaurav Mehta", "gamehta@nvidia.com"],
  ["Gladson Barbosa", "gbarbosa@nvidia.com"],
  ["Ilia Makeev", "imakeev@nvidia.com"],
  ["James Taylor", "jataylor@nvidia.com"],
  ["Javier Marquez", "jmarquez@nvidia.com"],
  ["Jiqing Wang", "jiqingw@nvidia.com"],
  ["Karthikeyan Somasundaram", "ksomasundara@nvidia.com"],
  ["Kevin Okubo", "kokubo@nvidia.com"],
  ["Leland Gee", "lgee@nvidia.com"],
  ["Linh Morales", "lmorales@nvidia.com"],
  ["Monica Martin", "monicam@nvidia.com"],
  ["Vince DeMaso", "vdemaso@nvidia.com"],
  ["Zachariah Zachariah", "zzachariah@nvidia.com"],
  ["Igor Margulis", "imargulis@nvidia.com"]
].map(([Member, Email]) => ({ Member, Email }));

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (quoted && char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (!quoted && char === ",") {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });

  return { headers, rows };
}

function writeCsv(headers, rows) {
  const headerLine = headers.map(csvEscape).join(",");
  const rowLines = rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","));
  return `${[headerLine, ...rowLines].join("\n")}\n`;
}

async function ensureCsvHeaders(filePath, requiredHeaders) {
  let parsed;
  try {
    parsed = parseCsv(await fs.readFile(filePath, "utf8"));
  } catch {
    await fs.writeFile(filePath, requiredHeaders.map(csvEscape).join(",") + "\n", "utf8");
    return requiredHeaders;
  }

  if (!parsed.headers.length) {
    await fs.writeFile(filePath, requiredHeaders.map(csvEscape).join(",") + "\n", "utf8");
    return requiredHeaders;
  }

  const headers = [...parsed.headers];
  requiredHeaders.forEach((header) => {
    if (!headers.includes(header)) {
      headers.push(header);
    }
  });

  if (headers.length !== parsed.headers.length) {
    await fs.writeFile(filePath, writeCsv(headers, parsed.rows), "utf8");
  }

  return headers;
}

async function appendCsvRow(filePath, requiredHeaders, row) {
  const headers = await ensureCsvHeaders(filePath, requiredHeaders);
  await fs.appendFile(filePath, writeCsv(headers, [row]).split("\n").slice(1).join("\n"), "utf8");
}

const sqliteTables = {
  parts: { table: "parts", headers: partsHeaders, seedPath: partsPath },
  members: { table: "members", headers: memberHeaders, seedPath: membersPath },
  partcodes: { table: "part_codes", headers: partCodeHeaders, seedPath: partCodesPath },
  transactions: { table: "transactions", headers: transactionHeaders, seedPath: transactionsPath },
  evaluations: { table: "evaluations", headers: evaluationHeaders, seedPath: evaluationPath },
  replenishment: { table: "replenishment", headers: replenishmentHeaders, seedPath: replenishmentPath }
};

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function activeDb() {
  if (!db) {
    throw new Error("SQLite database is not initialized.");
  }
  return db;
}

function sqliteColumns(table) {
  return activeDb()
    .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
    .all()
    .map((column) => column.name);
}

function ensureSqliteTable(table, headers) {
  const columnSql = headers.map((header) => `${quoteIdentifier(header)} TEXT`).join(", ");
  activeDb().exec(`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table)} (${columnSql})`);
  const existing = new Set(sqliteColumns(table));
  headers.forEach((header) => {
    if (!existing.has(header)) {
      activeDb().exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(header)} TEXT`);
    }
  });
}

function insertSqliteRows(table, headers, rows) {
  if (!rows.length) return;
  ensureSqliteTable(table, headers);
  const placeholders = headers.map(() => "?").join(", ");
  const columns = headers.map(quoteIdentifier).join(", ");
  const statement = activeDb().prepare(`INSERT INTO ${quoteIdentifier(table)} (${columns}) VALUES (${placeholders})`);
  activeDb().exec("BEGIN");
  try {
    rows.forEach((row) => {
      statement.run(...headers.map((header) => row[header] ?? ""));
    });
    activeDb().exec("COMMIT");
  } catch (error) {
    activeDb().exec("ROLLBACK");
    throw error;
  }
}

function replaceSqliteTable(table, headers, rows) {
  ensureSqliteTable(table, headers);
  activeDb().exec(`DELETE FROM ${quoteIdentifier(table)}`);
  insertSqliteRows(table, headers, rows);
}

function appendSqliteRow(table, headers, row) {
  insertSqliteRows(table, headers, [row]);
}

function readSqliteRows(table, preferredHeaders = []) {
  ensureSqliteTable(table, preferredHeaders);
  return activeDb().prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all();
}

function sqliteRowCount(table) {
  return activeDb().prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count;
}

function ensureSettingsTable() {
  activeDb().exec('CREATE TABLE IF NOT EXISTS settings ("Key" TEXT PRIMARY KEY, "Value" TEXT)');
  const insert = activeDb().prepare('INSERT OR IGNORE INTO settings ("Key", "Value") VALUES (?, ?)');
  Object.entries(defaultSettings).forEach(([key, value]) => insert.run(key, value));
}

function setSetting(key, value) {
  ensureSettingsTable();
  activeDb()
    .prepare('INSERT INTO settings ("Key", "Value") VALUES (?, ?) ON CONFLICT("Key") DO UPDATE SET "Value" = excluded."Value"')
    .run(key, String(value ?? ""));
}

function settingsValues() {
  ensureSettingsTable();
  const rows = activeDb().prepare('SELECT "Key" AS key, "Value" AS value FROM settings').all();
  return {
    ...defaultSettings,
    ...Object.fromEntries(rows.map((row) => [row.key, row.value]))
  };
}

function displayPath(filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function resolveConfiguredPath(value) {
  const configured = String(value || "").trim() || backupDirDefault;
  return path.isAbsolute(configured) ? path.normalize(configured) : path.resolve(root, configured);
}

function operationalSettings() {
  const values = settingsValues();
  const backupPath = resolveConfiguredPath(values.backupDirectory);
  return {
    supportEmail: values.supportEmail || defaultReportEmail,
    backupDirectory: values.backupDirectory || backupDirDefault,
    backupResolvedPath: backupPath,
    backupLastRunAt: values.backupLastRunAt || "",
    backupLastStatus: values.backupLastStatus || "Not run",
    backupLastPath: values.backupLastPath || "",
    databasePath: dbPath,
    databaseDisplayPath: displayPath(dbPath),
    databaseResolvedPath: dbPath
  };
}

function sqliteCsvContent(key) {
  const config = sqliteTables[key];
  if (!config) {
    throw new Error("Choose a valid data area.");
  }
  const headers = sqliteColumns(config.table);
  const rows = readSqliteRows(config.table, config.headers);
  return writeCsv(headers, rows);
}

function importCsvToSqlite(key, content) {
  const config = sqliteTables[key];
  if (!config) {
    throw new Error("Choose a valid data area.");
  }
  const parsed = parseCsv(content);
  const headers = [...parsed.headers];
  config.headers.forEach((header) => {
    if (!headers.includes(header)) {
      headers.push(header);
    }
  });
  replaceSqliteTable(config.table, headers, parsed.rows);
}

const sqliteMigrations = [
  {
    id: "20260529_replenishment_progress_requests",
    sql: `
      UPDATE replenishment
      SET
        Id = CASE
          WHEN Id LIKE 'KBN-%' THEN 'REQ-' || substr(Id, 5)
          ELSE Id
        END,
        Status = CASE Status
          WHEN 'Bin Threshold Reached' THEN 'New Request'
          WHEN 'Signal Sent' THEN 'Submitted'
          WHEN 'Reorder in Progress' THEN 'In Progress'
          WHEN 'Bin Refilled' THEN 'Completed'
          ELSE Status
        END
      WHERE Id LIKE 'KBN-%'
         OR Status IN ('Bin Threshold Reached', 'Signal Sent', 'Reorder in Progress', 'Bin Refilled');
    `
  }
];

function runSqliteMigrations() {
  activeDb().exec('CREATE TABLE IF NOT EXISTS schema_migrations ("Id" TEXT PRIMARY KEY, "Applied At" TEXT NOT NULL)');
  const applied = new Set(activeDb().prepare('SELECT "Id" AS id FROM schema_migrations').all().map((row) => row.id));
  sqliteMigrations.forEach((migration) => {
    if (applied.has(migration.id)) return;
    activeDb().exec("BEGIN");
    try {
      activeDb().exec(migration.sql);
      activeDb()
        .prepare('INSERT INTO schema_migrations ("Id", "Applied At") VALUES (?, ?)')
        .run(migration.id, new Date().toISOString());
      activeDb().exec("COMMIT");
    } catch (error) {
      activeDb().exec("ROLLBACK");
      throw error;
    }
  });
}

async function initializeSqlite() {
  db = new DatabaseSync(dbPath);
  activeDb().exec("PRAGMA journal_mode = WAL");
  activeDb().exec("PRAGMA foreign_keys = ON");

  Object.values(sqliteTables).forEach((config) => ensureSqliteTable(config.table, config.headers));
  activeDb().exec(
    'CREATE TABLE IF NOT EXISTS reports ("Timestamp" TEXT, "Comments" TEXT, "Inventory Snapshot" TEXT)'
  );
  ensureSettingsTable();

  for (const [key, config] of Object.entries(sqliteTables)) {
    if (sqliteRowCount(config.table) === 0) {
      const csv = await fs.readFile(config.seedPath, "utf8");
      importCsvToSqlite(key, csv);
    }
  }

  runSqliteMigrations();
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizePart(row) {
  return {
    imagePath: row["Image Path"] || row["Reference Photo"] || row.Picture || row.Photo || "",
    sku: row.SKU,
    name: row["Part Name"],
    category: row.Category,
    quantity: toNumber(row["Available Quantity"]),
    minQuantity: toNumber(row["Min Quantity"]),
    aisle: row.Aisle,
    bin: row.Bin,
    distinguishers: row.Distinguishers,
    aliases: row.Aliases,
    metadata: row.Metadata || row["Search Metadata"] || "",
    location: `${row.Aisle}-${row.Bin}`,
    status: partStatus(toNumber(row["Available Quantity"]), toNumber(row["Min Quantity"]))
  };
}

function denormalizePart(part, headers = partsHeaders) {
  const row = {
    ...(part.raw || {}),
    "Image Path": part.imagePath,
    SKU: part.sku,
    "Part Name": part.name,
    Category: part.category,
    "Available Quantity": part.quantity,
    "Min Quantity": part.minQuantity,
    Aisle: part.aisle,
    Bin: part.bin,
    Distinguishers: part.distinguishers,
    Aliases: part.aliases,
    Metadata: part.metadata
  };
  return Object.fromEntries(headers.map((header) => [header, row[header] ?? ""]));
}

function partStatus(quantity, minQuantity) {
  if (quantity <= 0) {
    return "Critical";
  }
  if (quantity <= minQuantity) {
    return "Low";
  }
  return "In Stock";
}

function aggregateByCategory(parts) {
  const totals = new Map(categoryOrder.map((category) => [category, 0]));
  parts.forEach((part) => {
    totals.set(part.category, (totals.get(part.category) || 0) + part.quantity);
  });
  return Object.fromEntries([...totals.entries()].filter(([, value]) => value > 0));
}

function quantitiesToCsv(quantities) {
  const columns = Object.keys(quantities);
  const header = ["Metric", ...columns].map(csvEscape).join(",");
  const row = [rowLabel, ...columns.map((column) => quantities[column] ?? 0)].map(csvEscape).join(",");
  return `${header}\n${row}\n`;
}

async function readParts() {
  return readSqliteRows("parts", partsHeaders).map((row) => ({
    ...normalizePart(row),
    raw: row
  }));
}

async function writeParts(parts) {
  const headers = sqliteColumns("parts");
  partsHeaders.forEach((header) => {
    if (!headers.includes(header)) {
      headers.push(header);
    }
  });
  replaceSqliteTable("parts", headers, parts.map((part) => denormalizePart(part, headers)));
}

async function readInventory() {
  const quantities = aggregateByCategory(await readParts());
  const columns = Object.keys(quantities);
  const settings = operationalSettings();

  return {
    columns,
    rowLabel,
    quantities,
    source: "data/inventory.db",
    reportEmail: settings.supportEmail
  };
}

async function readMembers() {
  return readSqliteRows("members", memberHeaders)
    .map((row) => ({
      name: String(row.Member || "").trim(),
      email: String(row.Email || "").trim()
    }))
    .filter((member) => member.name && member.email);
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizePartCode(row) {
  return {
    code: String(row.Code || "").trim(),
    normalizedCode: normalizeCode(row.Code),
    codeType: row["Code Type"] || "QR",
    sku: String(row.SKU || "").trim(),
    assetId: row["Asset ID"] || "",
    status: row.Status || "Active",
    locationOverride: row["Location Override"] || "",
    createdBy: row["Created By"] || "",
    createdAt: row["Created At"] || "",
    lastScannedAt: row["Last Scanned At"] || "",
    notes: row.Notes || "",
    raw: row
  };
}

function denormalizePartCode(code, headers = partCodeHeaders) {
  const row = {
    ...(code.raw || {}),
    Code: code.code,
    "Code Type": code.codeType,
    SKU: code.sku,
    "Asset ID": code.assetId,
    Status: code.status,
    "Location Override": code.locationOverride,
    "Created By": code.createdBy,
    "Created At": code.createdAt,
    "Last Scanned At": code.lastScannedAt,
    Notes: code.notes
  };
  return Object.fromEntries(headers.map((header) => [header, row[header] ?? ""]));
}

async function readPartCodes() {
  return readSqliteRows("part_codes", partCodeHeaders).map(normalizePartCode).filter((row) => row.code);
}

async function writePartCodes(codes) {
  const headers = sqliteColumns("part_codes");
  partCodeHeaders.forEach((header) => {
    if (!headers.includes(header)) {
      headers.push(header);
    }
  });
  replaceSqliteTable("part_codes", headers, codes.map((code) => denormalizePartCode(code, headers)));
}

function normalizeReplenishmentCard(row) {
  return {
    id: row.Id || "",
    createdAt: row["Created At"] || "",
    updatedAt: row["Updated At"] || "",
    createdBy: row["Created By"] || "",
    email: row.Email || "",
    sku: row.SKU || "",
    partName: row["Part Name"] || "",
    category: row.Category || "",
    aisle: row.Aisle || "",
    bin: row.Bin || "",
    currentQuantity: row["Current Quantity"] || "",
    minQuantity: row["Min Quantity"] || "",
    requestedQuantity: row["Requested Quantity"] || "",
    priority: row.Priority || "Normal",
    status: replenishmentStatuses.includes(row.Status) ? row.Status : "New Request",
    owner: row.Owner || "",
    notes: row.Notes || ""
  };
}

function denormalizeReplenishmentCard(card) {
  return {
    Id: card.id,
    "Created At": card.createdAt,
    "Updated At": card.updatedAt,
    "Created By": card.createdBy,
    Email: card.email,
    SKU: card.sku,
    "Part Name": card.partName,
    Category: card.category,
    Aisle: card.aisle,
    Bin: card.bin,
    "Current Quantity": card.currentQuantity,
    "Min Quantity": card.minQuantity,
    "Requested Quantity": card.requestedQuantity,
    Priority: card.priority,
    Status: card.status,
    Owner: card.owner,
    Notes: card.notes
  };
}

async function readReplenishmentCards() {
  return readSqliteRows("replenishment", replenishmentHeaders).map(normalizeReplenishmentCard).filter((card) => card.id);
}

async function writeReplenishmentCards(cards) {
  replaceSqliteTable("replenishment", replenishmentHeaders, cards.map(denormalizeReplenishmentCard));
}

function nextReplenishmentId(cards) {
  const maxId = cards.reduce((max, card) => {
    const value = Number(String(card.id || "").replace(/\D/g, ""));
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 1000);
  return `REQ-${maxId + 1}`;
}

function summarizeReplenishment(cards) {
  const openRequests = cards.filter((card) => card.status !== "Completed").length;
  return {
    openRequests,
    critical: cards.filter((card) => card.priority === "Critical" && card.status !== "Completed").length,
    inProgress: cards.filter((card) => card.status === "In Progress").length,
    refilled: cards.filter((card) => card.status === "Completed").length
  };
}

async function replenishmentBoard() {
  const cards = await readReplenishmentCards();
  return {
    ok: true,
    statuses: replenishmentStatuses,
    summary: summarizeReplenishment(cards),
    cards
  };
}

function normalizeReplenishmentPriority(value) {
  const priority = String(value || "Normal").trim();
  return ["Normal", "High", "Critical"].includes(priority) ? priority : "Normal";
}

async function createReplenishmentRequest(payload) {
  const user = normalizeUser(payload.user);
  const sku = String(payload.sku || "").trim();
  const item = String(payload.item || payload.partName || "").trim();
  const requestedQuantity = Math.floor(Number(payload.requestedQuantity || payload.quantity || 1));
  const priority = normalizeReplenishmentPriority(payload.priority);
  const notes = String(payload.notes || "").trim();

  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    throw new Error("Requested quantity must be a positive whole number.");
  }

  const parts = await readParts();
  const part = sku ? parts.find((candidate) => candidate.sku === sku) : null;
  if (sku && !part) {
    throw new Error("Selected SKU was not found in the catalog.");
  }

  if (!part && !item) {
    throw new Error("Choose a catalog part or describe the item that needs replenishment.");
  }

  const cards = await readReplenishmentCards();
  const timestamp = new Date().toISOString();
  const card = {
    id: nextReplenishmentId(cards),
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: user.name,
    email: user.email,
    sku: part?.sku || sku,
    partName: part?.name || item,
    category: part?.category || "",
    aisle: part?.aisle || "",
    bin: part?.bin || "",
    currentQuantity: part ? String(part.quantity) : "",
    minQuantity: part ? String(part.minQuantity) : "",
    requestedQuantity: String(requestedQuantity),
    priority,
    status: "New Request",
    owner: "",
    notes
  };

  await writeReplenishmentCards([...cards, card]);
  return {
    ok: true,
    message: `${card.id} replenishment request created.`,
    card,
    board: await replenishmentBoard()
  };
}

async function updateReplenishmentStatus(payload) {
  const user = normalizeUser(payload.user);
  const id = String(payload.id || "").trim();
  const status = String(payload.status || "").trim();

  if (!id) {
    throw new Error("Choose a replenishment card to update.");
  }

  if (!replenishmentStatuses.includes(status)) {
    throw new Error("Choose a valid replenishment status.");
  }

  const cards = await readReplenishmentCards();
  const cardIndex = cards.findIndex((card) => card.id === id);
  if (cardIndex === -1) {
    throw new Error("Replenishment card was not found.");
  }

  const updatedCard = {
    ...cards[cardIndex],
    status,
    updatedAt: new Date().toISOString(),
    owner: cards[cardIndex].owner || user.name
  };
  cards[cardIndex] = updatedCard;

  await writeReplenishmentCards(cards);
  return {
    ok: true,
    message: `${updatedCard.id} status updated.`,
    card: updatedCard,
    board: await replenishmentBoard()
  };
}

function assertAdminRequest(request) {
  const email = String(request.headers["x-admin-email"] || "").trim().toLowerCase();
  if (!adminEmails.has(email)) {
    throw new Error("Administrator access requires Gaurav or Monica signed in as admin.");
  }
}

function resolveCsvFile(key) {
  const file = csvFiles[String(key || "").trim()];
  if (!file) {
    throw new Error("Choose a valid data area.");
  }
  return file;
}

function validateCsvForSave(key, content) {
  const dataArea = resolveCsvFile(key).label;
  const parsed = parseCsv(content);
  if (!parsed.headers.length) {
    throw new Error("Imported content must include a header row.");
  }

  if (key === "parts") {
    ["SKU", "Part Name", "Category", "Available Quantity", "Metadata"].forEach((header) => {
      if (!parsed.headers.includes(header)) {
        throw new Error(`${dataArea} must keep the ${header} field.`);
      }
    });
  }

  if (key === "members") {
    ["Member", "Email"].forEach((header) => {
      if (!parsed.headers.includes(header)) {
        throw new Error(`${dataArea} must keep the ${header} field.`);
      }
    });
  }

  if (key === "partcodes") {
    ["Code", "Code Type", "SKU", "Status"].forEach((header) => {
      if (!parsed.headers.includes(header)) {
        throw new Error(`${dataArea} must keep the ${header} field.`);
      }
    });

    const activeCodes = new Map();
    parsed.rows.forEach((row, index) => {
      const normalized = normalizeCode(row.Code);
      const status = String(row.Status || "Active").trim().toLowerCase();
      if (!normalized || status !== "active") {
        return;
      }
      if (activeCodes.has(normalized)) {
        throw new Error(`${dataArea} has duplicate active code "${row.Code}" on records ${activeCodes.get(normalized)} and ${index + 2}.`);
      }
      activeCodes.set(normalized, index + 2);
    });
  }

  if (key === "replenishment") {
    ["Id", "Part Name", "Requested Quantity", "Status"].forEach((header) => {
      if (!parsed.headers.includes(header)) {
        throw new Error(`${dataArea} must keep the ${header} field.`);
      }
    });
  }
}

function validateAdminApprovals(payload) {
  const approvals = Array.isArray(payload.approvals) ? payload.approvals : [];
  const uniqueApprovals = [
    ...new Set(
      approvals
        .map((approval) => String(approval?.email || approval || "").trim().toLowerCase())
        .filter(Boolean)
    )
  ];

  if (uniqueApprovals.length < 2) {
    throw new Error("Two different administrators must approve database changes before saving.");
  }

  uniqueApprovals.forEach((email) => {
    if (!adminEmails.has(email)) {
      throw new Error("Reviewer must be an authorized administrator.");
    }
  });

  return uniqueApprovals;
}

async function readAdminCsv(key) {
  const file = resolveCsvFile(key);
  return {
    key,
    label: file.label,
    fileName: file.fileName,
    exportPath: file.exportPath,
    content: sqliteCsvContent(key)
  };
}

async function saveAdminCsv(payload) {
  const key = String(payload.file || "").trim();
  const file = resolveCsvFile(key);
  const content = String(payload.content || "");
  const approvals = validateAdminApprovals(payload);
  validateCsvForSave(key, content);
  importCsvToSqlite(key, content.endsWith("\n") ? content : `${content}\n`);

  return {
    ok: true,
    message: `${file.label} saved to the database after ${approvals.length} administrator approvals.`,
    label: file.label,
    fileName: file.fileName
  };
}

async function readCatalog() {
  const [parts, partCodes, evaluations] = await Promise.all([
    readParts(),
    readPartCodes(),
    Promise.resolve(readSqliteRows("evaluations", evaluationHeaders))
  ]);
  const settings = operationalSettings();
  const activePartCodeCount = partCodes.filter((code) => String(code.status || "Active").trim().toLowerCase() === "active").length;
  const pendingEvaluationCount = evaluations.filter((row) => {
    const status = String(row.Status || "Pending").trim().toLowerCase();
    return !["closed", "complete", "completed", "resolved"].includes(status);
  }).length;

  return {
    parts,
    categories: categoryOrder,
    reportEmail: settings.supportEmail,
    partCodeCount: activePartCodeCount,
    pendingEvaluationCount
  };
}

function readAdminSettings() {
  const settings = operationalSettings();
  return {
    ok: true,
    settings
  };
}

function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

async function saveAdminSettings(payload) {
  const supportEmail = String(payload.supportEmail || "").trim();
  const backupDirectory = String(payload.backupDirectory || "").trim();

  if (!validateEmail(supportEmail)) {
    throw new Error("Enter a valid report email address.");
  }
  if (!backupDirectory) {
    throw new Error("Enter a backup folder.");
  }

  setSetting("supportEmail", supportEmail);
  setSetting("backupDirectory", backupDirectory);

  return {
    ok: true,
    message: "Control Center settings saved.",
    settings: operationalSettings()
  };
}

async function runDatabaseBackup() {
  const settings = operationalSettings();
  const backupDirectory = resolveConfiguredPath(settings.backupDirectory);
  const timestamp = new Date().toISOString();
  const fileStamp = timestamp.replace(/[:.]/g, "-");
  const targetPath = path.join(backupDirectory, `inventory-backup-${fileStamp}.db`);

  try {
    await fs.mkdir(backupDirectory, { recursive: true });
    activeDb().exec(`VACUUM INTO '${escapeSqlString(targetPath)}'`);
    setSetting("backupLastRunAt", timestamp);
    setSetting("backupLastStatus", "Completed");
    setSetting("backupLastPath", targetPath);
    return {
      ok: true,
      message: "Database backup completed.",
      settings: operationalSettings()
    };
  } catch (error) {
    setSetting("backupLastRunAt", timestamp);
    setSetting("backupLastStatus", `Failed: ${error.message}`);
    setSetting("backupLastPath", targetPath);
    throw new Error(`Backup failed: ${error.message}`);
  }
}

function normalizeUser(user) {
  const name = String(user?.name || "").trim();
  const email = String(user?.email || user?.id || "").trim();
  if (!name || !email) {
    throw new Error("Please sign in with your name and email before changing inventory.");
  }
  return {
    name,
    email,
    type: String(user?.type || "member").trim() || "member",
    role: String(user?.role || "user").trim() || "user"
  };
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9.+-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function includesNormalized(haystack, needle) {
  return String(haystack || "").toLowerCase().includes(String(needle || "").toLowerCase());
}

function inferSearchProfiles(hintText) {
  const normalizedHint = String(hintText || "").toLowerCase();
  return searchProfiles.filter((profile) =>
    profile.triggers.some((trigger) => includesNormalized(normalizedHint, trigger))
  );
}

const broadSearchTerms = new Set([
  "adapter",
  "cable",
  "card",
  "disk",
  "drive",
  "gpu",
  "hard disk",
  "hdd",
  "network card",
  "nic",
  "pdu",
  "power",
  "psu",
  "server",
  "storage"
]);

function partSearchText(part) {
  return [
    part.sku,
    part.name,
    part.category,
    part.distinguishers,
    part.aliases,
    part.metadata,
    part.location,
    part.raw ? Object.values(part.raw).join(" ") : ""
  ].join(" ");
}

function scorePart(part, hintText, profiles = []) {
  const normalizedHint = String(hintText || "").toLowerCase();
  const aliases = String(part.aliases || "")
    .split(";")
    .map((alias) => alias.trim())
    .filter(Boolean);
  const metadataTerms = String(part.metadata || "")
    .split(/[,;]/)
    .map((term) => term.trim())
    .filter(Boolean);
  const searchable = partSearchText(part);
  const tokens = tokenize(hintText);
  let score = 0;
  const reasons = [];

  profiles.forEach((profile) => {
    if (profile.categories.includes(part.category)) {
      score += 38;
      reasons.push(`${profile.label} category match`);
    }
  });

  if (includesNormalized(normalizedHint, part.sku)) {
    score += 100;
    reasons.push("SKU matched");
  }

  [...aliases, ...metadataTerms].forEach((term) => {
    if (term.length >= 4 && includesNormalized(normalizedHint, term)) {
      const isAlias = aliases.includes(term);
      const broadTerm = broadSearchTerms.has(term.toLowerCase());
      score += broadTerm ? (isAlias ? 12 : 8) : isAlias ? 65 : 32;
      if (!broadTerm) {
        reasons.push(`${isAlias ? "Alias" : "Metadata"} matched: ${term}`);
      }
    }
  });

  if (includesNormalized(normalizedHint, part.name)) {
    score += 70;
    reasons.push("Part name matched");
  }

  if (includesNormalized(normalizedHint, part.category)) {
    score += 14;
    reasons.push(`Category matched: ${part.category}`);
  }

  tokens.forEach((token) => {
    if (includesNormalized(searchable, token)) {
      score += token.length >= 5 ? 8 : 4;
    }
  });

  return { score, reasons: [...new Set(reasons)].slice(0, 4) };
}

function uniqueRefinements(profiles, candidates, hintText = "") {
  const topScore = candidates[0]?.score || 0;
  const scopedCandidates = candidates
    .filter((candidate) => topScore === 0 || candidate.score >= topScore - 20)
    .slice(0, 4);
  const scopedText = scopedCandidates.map((candidate) => partSearchText(candidate.part)).join(" ");
  const normalizedHint = String(hintText || "").toLowerCase();
  const profileRefinements = profiles.flatMap((profile) =>
    (profile.refinements || [])
      .map((group) => ({
        label: group.label,
        options: (group.options || []).filter(
          (option) => includesNormalized(scopedText, option) && !includesNormalized(normalizedHint, option)
        )
      }))
      .filter((group) => group.options.length)
  );
  const catalogOptions = new Map();

  scopedCandidates.forEach((candidate) => {
    const text = partSearchText(candidate.part);
    ["SATA", "SAS", "SSD", "M.2", "NVMe", "1TB", "2TB", "4TB", "10TB", "18TB", "20TB", "48GB", "80GB"].forEach((option) => {
      if (includesNormalized(text, option) && !includesNormalized(normalizedHint, option)) {
        const label = /tb|gb/i.test(option) ? "Capacity / memory" : "Type";
        catalogOptions.set(`${label}:${option}`, { label, option });
      }
    });
  });

  const merged = new Map();
  [...profileRefinements, ...[...catalogOptions.values()].map(({ label, option }) => ({ label, options: [option] }))].forEach(
    (group) => {
      const key = group.label;
      const existing = merged.get(key) || new Set();
      (group.options || []).forEach((option) => existing.add(option));
      merged.set(key, existing);
    }
  );

  return [...merged.entries()]
    .map(([label, options]) => ({
      label,
      options: [...options].slice(0, 8)
    }))
    .filter((group) => group.options.length);
}

function groupCandidates(candidates) {
  const groups = new Map();
  candidates.forEach((candidate) => {
    const label = candidate.part.category || "Other";
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label).push(candidate);
  });

  return [...groups.entries()].map(([label, items]) => ({
    label,
    candidates: items
  }));
}

function confidenceFromScore(score) {
  if (score >= 100) return 0.97;
  if (score >= 70) return 0.92;
  if (score >= 42) return 0.82;
  if (score >= 22) return 0.66;
  if (score >= 10) return 0.48;
  return 0.18;
}

async function analyzePart(payload) {
  const parts = await readParts();
  const hintText = [
    payload.hints,
    payload.categoryHint
  ]
    .filter(Boolean)
    .join(" ");

  if (!hintText.trim()) {
    return {
      ok: true,
      match: null,
      candidates: [],
      needsAdminEvaluation: true,
      message: "Enter a SKU, name, connector, label, part number, or category hint to search the catalog."
    };
  }

  const profiles = inferSearchProfiles(hintText);
  const candidates = parts
    .map((part) => {
      const result = scorePart(part, hintText, profiles);
      return {
        part,
        confidence: confidenceFromScore(result.score),
        score: result.score,
        reasons: result.reasons.length ? result.reasons : ["Reference metadata similarity"]
      };
    })
    .sort((left, right) => right.score - left.score)
    .filter((candidate) => candidate.score >= (profiles.length ? 10 : 1))
    .slice(0, 12);

  const match = candidates[0] || null;
  const groups = groupCandidates(candidates);
  const summary = candidates.length
    ? profiles.length
      ? `${profiles.map((profile) => profile.label).join(" / ")} search found ${candidates.length} matching option${candidates.length === 1 ? "" : "s"}.`
      : `Found ${candidates.length} matching option${candidates.length === 1 ? "" : "s"}.`
    : "";
  return {
    ok: true,
    match,
    candidates,
    groups,
    refinements: uniqueRefinements(profiles, candidates, hintText),
    summary,
    needsAdminEvaluation: !match || match.confidence < 0.7,
    message: match
      ? match.confidence >= 0.85
        ? "Recommended match is ready. Confirm the SKU or send it to admin review."
        : "Matching results are ready. Select the closest part or add one more detail to narrow results."
      : "No strong catalog match found. Send this search to admin evaluation."
  };
}

async function recordEvaluation(payload) {
  const user = normalizeUser(payload.user);
  const candidate = payload.candidate?.part || payload.candidate || {};
  const timestamp = new Date().toISOString();
  const row = {
    Timestamp: timestamp,
    "User Name": user.name,
    Email: user.email,
    Hint: String(payload.hints || "").trim(),
    "Candidate SKU": candidate.sku || candidate.SKU || "",
    "Candidate Name": candidate.name || candidate["Part Name"] || "",
    Confidence: payload.candidate?.confidence ?? payload.confidence ?? "",
    Reason: String(payload.reason || "User rejected catalog match").trim(),
    Status: "Pending",
    Code: String(payload.code || "").trim(),
    "Lookup Method": String(payload.lookupMethod || "").trim()
  };

  appendSqliteRow("evaluations", evaluationHeaders, row);
  return { ok: true, message: "Search result was sent to administrator evaluation.", row };
}

async function lookupPartCode(payload) {
  const user = normalizeUser(payload.user);
  const code = String(payload.code || "").trim();
  const normalizedCode = normalizeCode(code);
  const lookupMethod = String(payload.lookupMethod || "Barcode/QR").trim();

  if (!normalizedCode) {
    throw new Error("Enter or scan a barcode / QR code first.");
  }

  const [parts, codes] = await Promise.all([readParts(), readPartCodes()]);
  const activeMatches = codes.filter((item) => item.normalizedCode === normalizedCode && String(item.status || "Active").toLowerCase() === "active");

  if (activeMatches.length > 1) {
    await recordEvaluation({
      user,
      code,
      lookupMethod,
      hints: `Duplicate active barcode / QR code: ${code}`,
      reason: "Duplicate active code mapping requires administrator review."
    });
    return {
      ok: true,
      found: false,
      needsAdminEvaluation: true,
      code,
      message: "This code has more than one active mapping. It was sent to administrator review."
    };
  }

  const disabledMatch = codes.find((item) => item.normalizedCode === normalizedCode);
  const directSkuPart = parts.find((part) => normalizeCode(part.sku) === normalizedCode);
  const codeRecord = activeMatches[0] || (directSkuPart
    ? {
        code,
        normalizedCode,
        codeType: "SKU Direct Entry",
        sku: directSkuPart.sku,
        assetId: "",
        status: "Active",
        locationOverride: "",
        createdBy: "",
        createdAt: "",
        lastScannedAt: "",
        notes: "Direct SKU fallback"
      }
    : null);

  if (disabledMatch && disabledMatch.status && String(disabledMatch.status).toLowerCase() !== "active" && !activeMatches.length) {
    await recordEvaluation({
      user,
      code,
      lookupMethod,
      candidate: { SKU: disabledMatch.sku },
      hints: `Inactive barcode / QR code: ${code}`,
      reason: `Code status is ${disabledMatch.status}. Administrator review required.`
    });
    return {
      ok: true,
      found: false,
      needsAdminEvaluation: true,
      code,
      message: `This code is ${disabledMatch.status}. It was sent to administrator review.`
    };
  }

  if (!codeRecord) {
    await recordEvaluation({
      user,
      code,
      lookupMethod,
      hints: `Unknown barcode / QR code: ${code}`,
      reason: "Unknown code submitted for administrator mapping."
    });
    return {
      ok: true,
      found: false,
      needsAdminEvaluation: true,
      code,
      message: "Code was not found. It was sent to administrator review."
    };
  }

  const part = parts.find((candidate) => candidate.sku === codeRecord.sku);
  if (!part) {
    await recordEvaluation({
      user,
      code,
      lookupMethod,
      candidate: { SKU: codeRecord.sku },
      hints: `Barcode / QR code mapped to missing SKU: ${code}`,
      reason: "Code mapped to a SKU that does not exist in the catalog."
    });
    return {
      ok: true,
      found: false,
      needsAdminEvaluation: true,
      code,
      message: "The code exists, but its SKU is missing from the catalog. It was sent to administrator review."
    };
  }

  if (activeMatches[0]) {
    const timestamp = new Date().toISOString();
    const nextCodes = codes.map((item) =>
      item.normalizedCode === normalizedCode && String(item.status || "Active").toLowerCase() === "active"
        ? { ...item, lastScannedAt: timestamp }
        : item
    );
    await writePartCodes(nextCodes);
    codeRecord.lastScannedAt = timestamp;
  }

  const match = {
    part,
    confidence: 1,
    score: 100,
    reasons: [`${codeRecord.codeType || "Code"} matched ${codeRecord.code}`]
  };

  return {
    ok: true,
    found: true,
    needsAdminEvaluation: false,
    code,
    codeRecord,
    match,
    candidates: [match],
    groups: groupCandidates([match]),
    refinements: [],
    summary: `${codeRecord.codeType || "Code"} matched one catalog part.`,
    message: "Code matched a catalog part. Confirm the SKU before updating inventory."
  };
}

async function applyTransaction(payload) {
  const user = normalizeUser(payload.user);
  const sku = String(payload.sku || "").trim();
  const action = String(payload.action || "").trim();
  const quantity = Math.floor(Number(payload.quantity));
  const reason = String(payload.reason || "").trim();
  const nvbug = String(payload.nvbug || payload["NVBug#"] || "").trim();
  const lookupMethod = String(payload.lookupMethod || "").trim();
  const partCode = String(payload.partCode || payload.code || "").trim();
  const adminOverride = payload.adminOverride ? "Yes" : "";

  if (!["take", "add"].includes(action)) {
    throw new Error("Choose whether the user is taking the part or adding inventory.");
  }

  if (!sku) {
    throw new Error("Choose a confirmed part before updating inventory.");
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive whole number.");
  }

  const parts = await readParts();
  const partIndex = parts.findIndex((part) => part.sku === sku);
  if (partIndex === -1) {
    throw new Error("SKU was not found in the catalog.");
  }

  const part = parts[partIndex];
  const beforeQuantity = part.quantity;
  const afterQuantity = action === "add" ? beforeQuantity + quantity : beforeQuantity - quantity;

  if (afterQuantity < 0) {
    throw new Error(`Only ${beforeQuantity} available. Reduce the quantity or send to admin review.`);
  }

  parts[partIndex] = { ...part, quantity: afterQuantity, status: partStatus(afterQuantity, part.minQuantity) };
  await writeParts(parts);

  const transaction = {
    Timestamp: new Date().toISOString(),
    "User Name": user.name,
    Email: user.email,
    Action: action,
    SKU: part.sku,
    "Part Name": part.name,
    Category: part.category,
    Quantity: quantity,
    "Before Quantity": beforeQuantity,
    "After Quantity": afterQuantity,
    Aisle: part.aisle,
    Bin: part.bin,
    Reason: reason,
    "User Role": user.role,
    Guest: user.type === "guest" ? "Yes" : "",
    "NVBug#": nvbug,
    "Lookup Method": lookupMethod,
    "Part Code": partCode,
    "Admin Override": adminOverride
  };

  appendSqliteRow("transactions", transactionHeaders, transaction);

  return {
    ok: true,
    message: "Inventory updated and transaction logged.",
    part: parts[partIndex],
    location: { aisle: part.aisle, bin: part.bin },
    beforeQuantity,
    afterQuantity,
    transaction
  };
}

function periodStart(period, now = new Date()) {
  const start = new Date(now);
  if (period === "day") {
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (period === "week") {
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (period === "month") {
    return new Date(start.getFullYear(), start.getMonth(), 1);
  }
  if (period === "year") {
    return new Date(start.getFullYear(), 0, 1);
  }
  return null;
}

function formatReportTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp || "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

async function readTransactions() {
  return readSqliteRows("transactions", transactionHeaders);
}

async function managementReport(params) {
  assertValidPeriod(params.period);
  const period = params.period || "week";
  const action = String(params.action || "all").trim().toLowerCase();
  const dateFrom = String(params.dateFrom || "").trim();
  const dateTo = String(params.dateTo || "").trim();
  const start = dateFrom ? new Date(`${dateFrom}T00:00:00`) : periodStart(period);
  const end = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null;
  const filters = {
    user: String(params.user || "all").trim().toLowerCase(),
    category: String(params.category || "all").trim(),
    sku: String(params.sku || "all").trim(),
    location: String(params.location || "all").trim().toLowerCase(),
    role: String(params.role || "all").trim().toLowerCase(),
    guest: String(params.guest || "all").trim().toLowerCase(),
    nvbug: String(params.nvbug || "all").trim().toLowerCase(),
    lookupMethod: String(params.lookupMethod || "all").trim().toLowerCase(),
    search: String(params.search || "").trim().toLowerCase()
  };
  const [allTransactions, parts, replenishmentCards, evaluations] = await Promise.all([
    readTransactions(),
    readParts(),
    readReplenishmentCards(),
    Promise.resolve(readSqliteRows("evaluations", evaluationHeaders))
  ]);
  const partMap = new Map(parts.map((part) => [part.sku, part]));
  const transactions = allTransactions.filter((row) => {
    const timestamp = new Date(row.Timestamp || "");
    const actionMatches = action === "all" || String(row.Action || "").toLowerCase() === action;
    const dateMatches =
      (!start || (!Number.isNaN(timestamp.getTime()) && timestamp >= start)) &&
      (!end || (!Number.isNaN(timestamp.getTime()) && timestamp <= end));
    const userText = `${row["User Name"] || ""} ${row.Email || ""}`.toLowerCase();
    const locationText = `${row.Aisle || ""} ${row.Bin || ""} ${row.Aisle || ""}/${row.Bin || ""}`.toLowerCase();
    const nvbug = String(row["NVBug#"] || "").trim();
    const hasUsableNvbug = Boolean(nvbug) && !/^no nvbug/i.test(nvbug);
    const searchable = Object.values(row).join(" ").toLowerCase();
    return (
      actionMatches &&
      dateMatches &&
      (filters.user === "all" || userText.includes(filters.user)) &&
      (filters.category === "all" || row.Category === filters.category) &&
      (filters.sku === "all" || row.SKU === filters.sku) &&
      (filters.location === "all" || locationText.includes(filters.location)) &&
      (filters.role === "all" || String(row["User Role"] || "").toLowerCase() === filters.role) &&
      (filters.guest === "all" ||
        (filters.guest === "yes" ? String(row.Guest || "").toLowerCase() === "yes" : String(row.Guest || "").toLowerCase() !== "yes")) &&
      (filters.nvbug === "all" || (filters.nvbug === "with" ? hasUsableNvbug : !hasUsableNvbug)) &&
      (filters.lookupMethod === "all" || String(row["Lookup Method"] || "").toLowerCase() === filters.lookupMethod) &&
      (!filters.search || searchable.includes(filters.search))
    );
  });

  const byUserMap = new Map();
  const byCategoryMap = new Map();
  const bySkuMap = new Map();
  const byLocationMap = new Map();
  const skuSet = new Set();
  let quantityMoved = 0;
  let takenQuantity = 0;
  let restockedQuantity = 0;
  let guestMovements = 0;
  let missingNvbug = 0;
  let adminOverrides = 0;

  transactions.forEach((row) => {
    const email = String(row.Email || "").trim().toLowerCase();
    const key = email || row["User Name"] || "Unknown";
    const quantity = toNumber(row.Quantity);
    const lowerAction = String(row.Action || "").toLowerCase();
    const category = row.Category || "Uncategorized";
    const sku = row.SKU || "Unknown SKU";
    const locationKey = `${row.Aisle || "Unknown"} / ${row.Bin || "Unknown"}`;
    const nvbug = String(row["NVBug#"] || "").trim();
    const hasUsableNvbug = Boolean(nvbug) && !/^no nvbug/i.test(nvbug);
    quantityMoved += quantity;
    if (lowerAction === "take") takenQuantity += quantity;
    if (lowerAction === "add") restockedQuantity += quantity;
    if (String(row.Guest || "").toLowerCase() === "yes") guestMovements += 1;
    if (!hasUsableNvbug) missingNvbug += 1;
    if (String(row["Admin Override"] || "").toLowerCase() === "yes") adminOverrides += 1;
    if (row.SKU) skuSet.add(row.SKU);
    if (!byUserMap.has(key)) {
      byUserMap.set(key, {
        name: row["User Name"] || "Unknown",
        email: row.Email || "",
        transactions: 0,
        taken: 0,
        restocked: 0,
        guestMovements: 0,
        missingNvbug: 0,
        lastMovement: "",
        skuCounts: new Map()
      });
    }
    const user = byUserMap.get(key);
    user.transactions += 1;
    if (lowerAction === "take") {
      user.taken += quantity;
    }
    if (lowerAction === "add") {
      user.restocked += quantity;
    }
    if (String(row.Guest || "").toLowerCase() === "yes") user.guestMovements += 1;
    if (!hasUsableNvbug) user.missingNvbug += 1;
    if (!user.lastMovement || new Date(row.Timestamp || 0) > new Date(user.lastMovement || 0)) {
      user.lastMovement = row.Timestamp || "";
    }
    if (row.SKU) {
      user.skuCounts.set(row.SKU, (user.skuCounts.get(row.SKU) || 0) + quantity);
    }

    if (!byCategoryMap.has(category)) {
      byCategoryMap.set(category, { category, movements: 0, quantityMoved: 0, taken: 0, restocked: 0, skus: new Set() });
    }
    const categoryRow = byCategoryMap.get(category);
    categoryRow.movements += 1;
    categoryRow.quantityMoved += quantity;
    if (lowerAction === "take") categoryRow.taken += quantity;
    if (lowerAction === "add") categoryRow.restocked += quantity;
    if (row.SKU) categoryRow.skus.add(row.SKU);

    if (!bySkuMap.has(sku)) {
      const part = partMap.get(sku) || {};
      bySkuMap.set(sku, {
        sku,
        partName: row["Part Name"] || part.name || "",
        category,
        movements: 0,
        quantityMoved: 0,
        taken: 0,
        restocked: 0,
        currentQuantity: part.quantity ?? "",
        location: part.location || `${row.Aisle || ""}-${row.Bin || ""}`
      });
    }
    const skuRow = bySkuMap.get(sku);
    skuRow.movements += 1;
    skuRow.quantityMoved += quantity;
    if (lowerAction === "take") skuRow.taken += quantity;
    if (lowerAction === "add") skuRow.restocked += quantity;

    if (!byLocationMap.has(locationKey)) {
      byLocationMap.set(locationKey, { location: locationKey, movements: 0, quantityMoved: 0, skus: new Map() });
    }
    const locationRow = byLocationMap.get(locationKey);
    locationRow.movements += 1;
    locationRow.quantityMoved += quantity;
    if (row.SKU) locationRow.skus.set(row.SKU, (locationRow.skus.get(row.SKU) || 0) + quantity);
  });

  const byUser = [...byUserMap.values()]
    .map((user) => ({
      name: user.name,
      email: user.email,
      transactions: user.transactions,
      taken: user.taken,
      restocked: user.restocked,
      guestMovements: user.guestMovements,
      missingNvbug: user.missingNvbug,
      lastMovement: formatReportTime(user.lastMovement),
      topSku:
        [...user.skuCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || ""
    }))
    .sort((left, right) => right.transactions - left.transactions);

  const byCategory = [...byCategoryMap.values()]
    .map((row) => ({ ...row, uniqueSkus: row.skus.size, skus: undefined }))
    .sort((left, right) => right.quantityMoved - left.quantityMoved);

  const bySku = [...bySkuMap.values()].sort((left, right) => right.quantityMoved - left.quantityMoved);

  const byLocation = [...byLocationMap.values()]
    .map((row) => ({
      location: row.location,
      movements: row.movements,
      quantityMoved: row.quantityMoved,
      uniqueSkus: row.skus.size,
      topSku: [...row.skus.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || ""
    }))
    .sort((left, right) => right.quantityMoved - left.quantityMoved);

  const details = transactions
    .slice()
    .sort((left, right) => new Date(right.Timestamp || 0) - new Date(left.Timestamp || 0))
    .slice(0, 500)
    .map((row) => ({
      when: formatReportTime(row.Timestamp),
      timestamp: row.Timestamp || "",
      userName: row["User Name"] || "",
      email: row.Email || "",
      action: row.Action || "",
      actionLabel: String(row.Action || "").toLowerCase() === "add" ? "Restocked" : "Checked out",
      sku: row.SKU || "",
      partName: row["Part Name"] || "",
      category: row.Category || "",
      quantity: toNumber(row.Quantity),
      beforeQuantity: row["Before Quantity"] || "",
      afterQuantity: row["After Quantity"] || "",
      aisle: row.Aisle || "",
      bin: row.Bin || "",
      reason: row.Reason || "",
      userRole: row["User Role"] || "",
      guest: row.Guest || "",
      nvbug: row["NVBug#"] || "",
      lookupMethod: row["Lookup Method"] || "",
      partCode: row["Part Code"] || "",
      adminOverride: row["Admin Override"] || ""
    }));

  const pendingEvaluationCount = evaluations.filter((row) => {
    const status = String(row.Status || "Pending").trim().toLowerCase();
    return !["closed", "complete", "completed", "resolved"].includes(status);
  }).length;
  const totalOnHand = parts.reduce((total, part) => total + Number(part.quantity || 0), 0);
  const lowSkuCount = parts.filter((part) => Number(part.quantity) <= Number(part.minQuantity || 0)).length;
  const missingSkuCount = parts.filter((part) => Number(part.quantity) <= 0).length;
  const openRestockRequests = replenishmentCards.filter((card) => card.status !== "Completed").length;

  return {
    ok: true,
    period,
    action,
    filters,
    summary: {
      transactionCount: transactions.length,
      quantityMoved,
      takenQuantity,
      restockedQuantity,
      netQuantityChange: restockedQuantity - takenQuantity,
      uniqueUsers: byUser.length,
      uniqueSkus: skuSet.size,
      guestMovements,
      missingNvbug,
      adminOverrides,
      totalOnHand,
      totalSkus: parts.length,
      lowSkus: lowSkuCount,
      missingSkus: missingSkuCount,
      openRestockRequests,
      pendingAdminReviews: pendingEvaluationCount
    },
    byUser,
    byCategory,
    bySku,
    byLocation,
    details,
    message: `${transactions.length} movement${transactions.length === 1 ? "" : "s"} found after filters.`
  };
}

function assertValidPeriod(period) {
  if (!["day", "week", "month", "year", "all", undefined, null, ""].includes(period)) {
    throw new Error("Choose a valid report period.");
  }
}

async function appendReport(payload) {
  const comment = String(payload.comments || "").trim();
  if (!comment) {
    throw new Error("Please enter comments before submitting the report.");
  }

  const inventory = await readInventory();
  const timestamp = new Date().toISOString();
  const reportRow = [
    timestamp,
    comment,
    ...inventory.columns.map((column) => inventory.quantities[column])
  ]
    .map(csvEscape)
    .join(",");

  activeDb()
    .prepare('INSERT INTO reports ("Timestamp", "Comments", "Inventory Snapshot") VALUES (?, ?, ?)')
    .run(timestamp, comment, JSON.stringify(inventory.quantities));
  await fs.appendFile(reportsPath, `${reportRow}\n`, "utf8");

  const bodyLines = [
    "Missing/Low Inventory Report",
    "",
    `Comments: ${comment}`,
    "",
    "Current Available Quantity:",
    ...inventory.columns.map((column) => `- ${column}: ${inventory.quantities[column]}`)
  ];
  const settings = operationalSettings();

  const mailto =
    `mailto:${settings.supportEmail}` +
    `?subject=${encodeURIComponent("Missing/Low Inventory Report")}` +
    `&body=${encodeURIComponent(bodyLines.join("\n"))}`;

  return {
    ok: true,
    message: "Report saved. Opening a pre-filled email draft.",
    mailto,
    reportEmail: settings.supportEmail
  };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function sendCsv(response, filePath, fileName) {
  response.writeHead(200, {
    "Content-Type": mimeTypes[".csv"],
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "no-store"
  });
  response.end(await fs.readFile(filePath, "utf8"));
}

function sendSqliteCsv(response, key) {
  const file = resolveCsvFile(key);
  response.writeHead(200, {
    "Content-Type": mimeTypes[".csv"],
    "Content-Disposition": `attachment; filename="${file.fileName}"`,
    "Cache-Control": "no-store"
  });
  response.end(sqliteCsvContent(key));
}

function sendCsvContent(response, content, fileName) {
  response.writeHead(200, {
    "Content-Type": mimeTypes[".csv"],
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "no-store"
  });
  response.end(content);
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (requestUrl.pathname.startsWith("/reference-images/")) {
    const imageName = decodeURIComponent(requestUrl.pathname.replace("/reference-images/", ""));
    const imagePath = path.normalize(path.join(referenceImagesDir, imageName));
    if (!isInside(referenceImagesDir, imagePath)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    try {
      const ext = path.extname(imagePath).toLowerCase();
      response.writeHead(200, {
        "Content-Type": mimeTypes[ext] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      response.end(await fs.readFile(imagePath));
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
    return;
  }

  if (requestUrl.pathname === "/exports/category-inventory") {
    sendCsvContent(response, quantitiesToCsv(aggregateByCategory(await readParts())), "inventory.csv");
    return;
  }

  const exportRoute = Object.entries(csvFiles).find(([, file]) => file.exportPath === requestUrl.pathname);
  if (exportRoute) {
    sendSqliteCsv(response, exportRoute[0]);
    return;
  }

  if (requestUrl.pathname === "/inventory.csv") {
    sendCsvContent(response, quantitiesToCsv(aggregateByCategory(await readParts())), "inventory.csv");
    return;
  }

  if (requestUrl.pathname === "/parts.csv") {
    sendSqliteCsv(response, "parts");
    return;
  }

  if (requestUrl.pathname === "/members.csv") {
    sendSqliteCsv(response, "members");
    return;
  }

  if (requestUrl.pathname === "/part_codes.csv") {
    sendSqliteCsv(response, "partcodes");
    return;
  }

  if (requestUrl.pathname === "/transactions.csv") {
    sendSqliteCsv(response, "transactions");
    return;
  }

  if (requestUrl.pathname === "/evaluation_queue.csv") {
    sendSqliteCsv(response, "evaluations");
    return;
  }

  if (requestUrl.pathname === "/replenishment.csv") {
    sendSqliteCsv(response, "replenishment");
    return;
  }

  const safePath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.normalize(path.join(publicDir, decodeURIComponent(safePath)));

  if (filePath !== path.join(publicDir, "index.html") && !isInside(publicDir, filePath)) {
    response.writeHead(403);
    response.end("Forbidden");
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
  } catch (error) {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function handleRequest(request, response) {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && requestUrl.pathname === "/api/inventory") {
      sendJson(response, 200, await readInventory());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/catalog") {
      sendJson(response, 200, await readCatalog());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/members") {
      sendJson(response, 200, {
        members: await readMembers(),
        source: "data/inventory.db"
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/replenishment") {
      sendJson(response, 200, await replenishmentBoard());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/admin/csv") {
      assertAdminRequest(request);
      sendJson(response, 200, await readAdminCsv(requestUrl.searchParams.get("file")));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/admin/management-report") {
      assertAdminRequest(request);
      sendJson(
        response,
        200,
        await managementReport({
          period: requestUrl.searchParams.get("period"),
          dateFrom: requestUrl.searchParams.get("dateFrom"),
          dateTo: requestUrl.searchParams.get("dateTo"),
          action: requestUrl.searchParams.get("action"),
          user: requestUrl.searchParams.get("user"),
          category: requestUrl.searchParams.get("category"),
          sku: requestUrl.searchParams.get("sku"),
          location: requestUrl.searchParams.get("location"),
          role: requestUrl.searchParams.get("role"),
          guest: requestUrl.searchParams.get("guest"),
          nvbug: requestUrl.searchParams.get("nvbug"),
          lookupMethod: requestUrl.searchParams.get("lookupMethod"),
          search: requestUrl.searchParams.get("search")
        })
      );
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/admin/settings") {
      assertAdminRequest(request);
      sendJson(response, 200, readAdminSettings());
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/admin/csv") {
      assertAdminRequest(request);
      sendJson(response, 200, await saveAdminCsv(await readJsonBody(request)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/admin/settings") {
      assertAdminRequest(request);
      sendJson(response, 200, await saveAdminSettings(await readJsonBody(request)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/admin/backup") {
      assertAdminRequest(request);
      sendJson(response, 200, await runDatabaseBackup());
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/analyze-part") {
      sendJson(response, 200, await analyzePart(await readJsonBody(request)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/part-code-lookup") {
      sendJson(response, 200, await lookupPartCode(await readJsonBody(request)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/evaluation") {
      sendJson(response, 200, await recordEvaluation(await readJsonBody(request)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/replenishment") {
      sendJson(response, 200, await createReplenishmentRequest(await readJsonBody(request)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/replenishment/status") {
      sendJson(response, 200, await updateReplenishmentStatus(await readJsonBody(request)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/transaction") {
      sendJson(response, 200, await applyTransaction(await readJsonBody(request)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/report") {
      sendJson(response, 200, await appendReport(await readJsonBody(request)));
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(request, response);
      return;
    }

    response.writeHead(405);
    response.end("Method not allowed");
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: error.message || "Something went wrong."
    });
  }
}

async function ensureDataFiles() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(partsPath);
  } catch {
    await fs.writeFile(partsPath, writeCsv(partsHeaders, defaultParts), "utf8");
  }

  try {
    await fs.access(membersPath);
  } catch {
    await fs.writeFile(membersPath, writeCsv(memberHeaders, defaultMembers), "utf8");
  }

  try {
    await fs.access(partCodesPath);
  } catch {
    const seededParts = parseCsv(await fs.readFile(partsPath, "utf8")).rows;
    await fs.writeFile(partCodesPath, writeCsv(partCodeHeaders, defaultPartCodesFromParts(seededParts)), "utf8");
  }

  try {
    await fs.access(reportsPath);
  } catch {
    const seededParts = parseCsv(await fs.readFile(partsPath, "utf8")).rows.map(normalizePart);
    const reportHeaders = ["Timestamp", "Comments", ...Object.keys(aggregateByCategory(seededParts))];
    await fs.writeFile(reportsPath, reportHeaders.map(csvEscape).join(",") + "\n", "utf8");
  }

  try {
    await fs.access(transactionsPath);
  } catch {
    await fs.writeFile(transactionsPath, transactionHeaders.map(csvEscape).join(",") + "\n", "utf8");
  }
  await ensureCsvHeaders(transactionsPath, transactionHeaders);

  try {
    await fs.access(evaluationPath);
  } catch {
    await fs.writeFile(evaluationPath, evaluationHeaders.map(csvEscape).join(",") + "\n", "utf8");
  }
  await ensureCsvHeaders(evaluationPath, evaluationHeaders);

  try {
    await fs.access(replenishmentPath);
  } catch {
    await fs.writeFile(replenishmentPath, replenishmentHeaders.map(csvEscape).join(",") + "\n", "utf8");
  }

  await ensureCsvHeaders(partsPath, partsHeaders);
  await ensureCsvHeaders(membersPath, memberHeaders);
  await ensureCsvHeaders(partCodesPath, partCodeHeaders);
  await ensureCsvHeaders(replenishmentPath, replenishmentHeaders);

  await initializeSqlite();
}

ensureDataFiles()
  .then(() => {
    http.createServer(handleRequest).listen(port, host, () => {
      console.log(`Inventory app running at http://${host}:${port}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
