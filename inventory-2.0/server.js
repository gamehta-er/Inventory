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
const backupDir = path.join(dataDir, "backups");
const uploadsDir = path.join(dataDir, "uploads");
const assetModelUploadsDir = path.join(uploadsDir, "asset-models");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

let db;

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function safeOwnerLabel() {
  return "#imargulis-staff";
}

function safeBuildingFor(category) {
  const buildings = {
    GPU: "Santa Clara Building R",
    Server: "Santa Clara Building R",
    "M.2 Drives": "Santa Clara Building E",
    "Hard Disk": "Santa Clara Building E",
    "Network Card": "Santa Clara Building S",
    Cables: "Santa Clara Building S",
    PDU: "Santa Clara Building E",
    PSU: "Santa Clara Building E",
    "Riser Card": "Santa Clara Building R",
    Transposer: "Santa Clara Building S",
    "Water Cool Hose": "Santa Clara Building S"
  };
  return buildings[category] || "Santa Clara Building R";
}

function safeZoneFor(value) {
  const text = String(value || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash + text.charCodeAt(index) * (index + 1)) % 997;
  return String((hash % 24) + 1).padStart(2, "0");
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

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function locationLabel(part) {
  if (part.aisle && part.bin) return `${part.aisle} / ${part.bin}`;
  if (part.aisle) return part.aisle;
  return `${safeBuildingFor(part.category)} / Lab ${safeZoneFor(part.sku)} / Storage ${safeZoneFor(`${part.category}-${part.sku}`)}`;
}

function isoNow() {
  return new Date().toISOString();
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

function nvbugReferences(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const refs = new Set();
  const urlMatches = text.matchAll(/nvbugspro\.nvidia\.com\/bug\/(\d{4,})/gi);
  for (const match of urlMatches) refs.add(match[1]);
  const numberMatches = text.matchAll(/\b\d{4,}\b/g);
  for (const match of numberMatches) refs.add(match[0]);
  return [...refs];
}

function normalizeNvbugReferences(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const refs = nvbugReferences(text);
  return refs.length ? refs.join(", ") : text;
}

const convergedStatusOptions = ["In Use", "Idle", "Broken", "E-waste Pending"];
const convergedApprovedModels = ["A100+BF2", "A30+BF2"];
const lifecycleStatuses = [
  "Ready to Deploy",
  "Idle",
  "In Use",
  "Broken",
  "EOL",
  "E-waste Pending",
  "E-Wasted",
  "Disposed",
  "Archived"
];
const archivedStatuses = new Set(["E-Wasted", "Disposed", "Archived"]);
const exceptionStatuses = new Set(["Broken", "EOL", "E-waste Pending"]);
const unavailableStatuses = new Set(["In Use", "Broken", "E-waste Pending", "E-Wasted", "Disposed", "Archived"]);

const convergedDomainFields = [
  { key: "category", label: "Category", instruction: "Device family assigned to this hardware domain." },
  { key: "model", label: "Model", required: true, instruction: "Model value used for search, filtering, labels, and traceability." },
  { key: "serialNo", label: "Serial No.", required: true, instruction: "Unique device serial used for identification and traceability." },
  { key: "status", label: "Status", required: true, instruction: "Select one of In Use, Idle, Broken, or E-waste Pending." },
  { key: "owner", label: "Owner", conditional: "Required when Status is In Use", instruction: "For In Use devices, assign the responsible team or person." },
  { key: "jiraTicket", label: "NVBug #", instruction: "Latest NVBug or request reference tied to purchase, transfer, repair, or ownership change." },
  { key: "stamp", label: "Stamp", instruction: "Date the related ticket closed or the latest logged edit date." },
  { key: "location", label: "Location", instruction: "Use Santa Clara Building R, Building E, or Building S with lab, rack, cabinet, drawer, cube, or storage detail." },
  { key: "usage", label: "Usage", instruction: "Project, workflow, or shared pool the device is used for." },
  { key: "setupDate", label: "Setup Date", instruction: "Suggested date format is MM/DD/YYYY. Leave blank when the setup date is unknown or not applicable." },
  { key: "borrowedLent", label: "Borrowed/Lent", instruction: "Use Borrowed for assets from outside the team and Lent for assets loaned outside the team. Add details in Notes." },
  { key: "sku", label: "SKU", instruction: "Platform SKU when available." },
  { key: "edition", label: "Edition", instruction: "Revision of the device, for example TS1 or TS2." },
  { key: "notes", label: "Notes", instruction: "Additional details that help explain ownership, exceptions, recovery work, or unusual device state." }
];

const convergedPilotRows = [
  { sourceRow: 18, category: "Converged Platform", model: "Converged Model A", status: "Idle", usage: "Lab validation", sku: "", edition: "EB1" },
  { sourceRow: 19, category: "Converged Platform", model: "Converged Model A", status: "Idle", usage: "Lab validation", sku: "", edition: "EB1" },
  { sourceRow: 20, category: "Converged Platform", model: "Converged Model A", status: "In Use", usage: "Lab validation", sku: "", edition: "TS2" },
  { sourceRow: 21, category: "Converged Platform", model: "Converged Model A", status: "In Use", usage: "Lab validation", sku: "", edition: "TS2" },
  { sourceRow: 22, category: "Converged Platform", model: "Converged Model A", status: "Idle", usage: "Lab validation", sku: "", edition: "" },
  { sourceRow: 23, category: "Converged Platform", model: "Converged Model A", status: "Idle", usage: "", sku: "", edition: "TS2" },
  { sourceRow: 24, category: "Converged Platform", model: "Converged Model A", status: "In Use", usage: "Lab validation", sku: "", edition: "TS2" },
  { sourceRow: 25, category: "Converged Platform", model: "Converged Model A", status: "In Use", usage: "Lab validation", sku: "", edition: "TS2" },
  { sourceRow: 26, category: "Converged Platform", model: "Converged Model A", status: "In Use", usage: "Lab validation", sku: "", edition: "TS2" },
  { sourceRow: 27, category: "Converged Platform", model: "Converged Model A", status: "In Use", usage: "Lab validation", sku: "", edition: "TS2" },
  { sourceRow: 28, category: "Converged Platform", model: "Converged Model A", status: "Idle", usage: "", sku: "CGD-SKU-001", edition: "" },
  { sourceRow: 29, category: "Converged Platform", model: "Converged Model A", status: "Idle", usage: "", sku: "", edition: "CR" },
  { sourceRow: 30, category: "Converged Platform", model: "Converged Model A", status: "Idle", usage: "", sku: "", edition: "CR" },
  { sourceRow: 31, category: "Converged Platform", model: "Converged Model A", status: "Idle", usage: "", sku: "", edition: "CR" },
  { sourceRow: 32, category: "Converged Platform", model: "Converged Model A", status: "Idle", usage: "", sku: "", edition: "CR" }
];

const fieldKeyOverrides = {
  CPU: "cpu",
  GPU: "gpu",
  IP: "ip",
  PSU: "psu",
  PSID: "psid",
  SKU: "sku",
  "Serial No.": "serialNo",
  "NVBug #": "nvbug",
  "Arrive Date": "arriveDate",
  "Setup Date": "setupDate",
  "Borrowed/Lent": "borrowedLent",
  "Open Part No.": "openPartNo",
  "OPN Family": "opnFamily",
  "Mother Board": "motherBoard",
  "NV Asset Number": "nvAssetNumber",
  "Login Info": "loginInfo",
  "GPU Class": "gpuClass",
  "Native Resolution": "nativeResolution",
  "Refresh Rate": "refreshRate",
  "Old Location": "oldLocation",
  "E-Waste-Pending": "eWastePending"
};

function fieldKey(label) {
  if (fieldKeyOverrides[label]) return fieldKeyOverrides[label];
  return String(label)
    .replace(/#/g, " number ")
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "")
    .replace(/^./, (char) => char.toLowerCase());
}

function makeDomainFields(labels, requiredLabels = []) {
  const required = new Set(requiredLabels);
  return labels.map((label) => ({
    key: fieldKey(label),
    label,
    required: required.has(label),
    instruction: instructionForField(label, required.has(label))
  }));
}

function instructionForField(label, required) {
  const suffix = required ? " Required for a complete record." : "";
  const instructions = {
    Category: "Device family or category used for grouping and reporting.",
    Model: "Model value used for search, filtering, labels, and traceability.",
    "Serial No.": "Unique serial identifier used to trace the physical device.",
    Status: "Lifecycle state: In Use, Idle, Broken, or E-waste Pending.",
    Owner: "Responsible team or person. Required when status is In Use.",
    "NVBug #": "Latest NVBug or request reference tied to purchase, transfer, repair, or ownership change.",
    Stamp: "Latest logged update date or related reference closure date.",
    Location: "Santa Clara building, lab, rack, cabinet, drawer, or storage detail.",
    Usage: "Project, lab workflow, or shared pool using the device.",
    "Setup Date": "Date the device was installed or prepared for use.",
    "Arrive Date": "Date the device arrived or entered inventory.",
    "Borrowed/Lent": "Borrowed or lent state when the device belongs to, or is loaned outside, the team.",
    Notes: "Additional context for ownership, exceptions, recovery work, or unusual state.",
    Quantity: "Count of quantity-tracked items.",
    Requester: "Team or person requesting the quantity-tracked item.",
    IP: "Managed lab network identifier when assigned.",
    CPU: "CPU configuration for compute devices.",
    "Mother Board": "Main board or platform board detail.",
    Memory: "Memory configuration.",
    Disk: "Storage configuration.",
    GPU: "Installed GPU value when stable for this record.",
    PSU: "Power supply configuration.",
    Maker: "Manufacturer or board vendor.",
    Chip: "Chip or silicon identifier.",
    SKU: "Platform or part SKU when available.",
    "GPU Class": "GPU product class or market family.",
    Edition: "Hardware revision, stepping, or build edition.",
    "Open Part No.": "External part number.",
    PSID: "Firmware or board PSID when applicable.",
    "OPN Family": "Device family for DPU/NIC hardware.",
    "Production Key/Development Key": "Key configuration when tracked.",
    "NV Asset Number": "Internal asset reference when assigned.",
    "Login Info": "Administrative access reference location, not passwords.",
    Type: "Network type such as ETH, IB, or RJ45.",
    Resolution: "Native display resolution.",
    "Native Resolution": "Native display resolution.",
    "Refresh Rate": "Display refresh-rate capability.",
    Connector: "Supported display or cable connector type.",
    Features: "Special capability flags.",
    "Old Location": "Prior location kept for move or audit context.",
    Problem: "Short failure description for broken-device triage.",
    "E-Waste-Pending": "Marks whether the item should move into disposal workflow."
  };
  return `${instructions[label] || "Domain-specific field used for filtering and review."}${suffix}`;
}

function domainConfig(slug, label, description, fields, required, recordCount, prefix, models) {
  return {
    slug,
    label,
    description,
    fields: makeDomainFields(fields, required),
    recordCount,
    prefix,
    models
  };
}

const deviceDomainConfigs = [
  domainConfig("gpu", "GPU", "Graphics cards and accelerator inventory.", ["Category", "Model", "Serial No.", "Status", "Owner", "NVBug #", "Stamp", "Location", "Usage", "Arrive Date", "Borrowed/Lent", "Chip", "SKU", "GPU Class", "Edition", "Maker", "Notes"], ["Category", "Model", "Serial No.", "Status"], 174, "GPU", ["GPU Model A", "GPU Model B", "GPU Model C"]),
  domainConfig("dpu", "DPU", "DPU and NIC-style networking devices.", ["Category", "Model", "Serial No.", "Status", "Owner", "NVBug #", "Stamp", "Location", "Usage", "Setup Date", "Borrowed/Lent", "Open Part No.", "PSID", "OPN Family", "Edition"], ["Category", "Model", "Serial No.", "Status", "Open Part No."], 88, "DPU", ["BF2", "BF3", "CX-7"]),
  domainConfig("converged-gpu-dpu", "Converged GPU+DPU", "Combined accelerator and DPU assets.", ["Category", "Model", "Serial No.", "Status", "Owner", "NVBug #", "Stamp", "Location", "Usage", "Setup Date", "Borrowed/Lent", "SKU", "Edition", "Notes"], ["Category", "Model", "Serial No.", "Status"], 15, "CGD", ["Converged Model A"]),
  domainConfig("server", "Server", "Lab servers and shared compute systems.", ["Category", "Model", "Serial No.", "Status", "Owner", "NVBug #", "Stamp", "Location", "Usage", "Setup Date", "Borrowed/Lent", "IP", "CPU", "Mother Board", "Memory", "Disk", "NV Asset Number", "Notes", "Login Info"], ["Category", "Model", "Serial No.", "Status"], 72, "SRV", ["Server Model A", "Server Model B"]),
  domainConfig("workstation", "Workstation", "Personal and shared lab workstations.", ["Category", "Model", "Serial No.", "Status", "Owner", "NVBug #", "Stamp", "Location", "Usage", "Setup Date", "Borrowed/Lent", "IP", "CPU", "Mother Board", "Memory", "Disk", "Notes"], ["Category", "Model", "Serial No.", "Status"], 167, "WKS", ["Workstation Model A", "Workstation Model B"]),
  domainConfig("pc", "PC", "Testing PCs and bench systems.", ["Category", "Model", "Serial No.", "Status", "Owner", "NVBug #", "Stamp", "Location", "Usage", "Arrive Date", "Borrowed/Lent", "CPU", "Mother Board", "GPU", "Memory", "Disk", "PSU", "Notes"], ["Category", "Model", "Serial No.", "Status", "CPU"], 20, "PC", ["PC Model A", "PC Model B"]),
  domainConfig("switch", "Switch", "Network switches and fabric devices.", ["Category", "Model", "Serial No.", "Status", "Owner", "NVBug #", "Stamp", "Location", "Usage", "Setup Date", "Borrowed/Lent", "IP", "Type", "Notes"], ["Category", "Model", "Serial No.", "Status"], 13, "SWT", ["Switch Model A", "Switch Model B"]),
  domainConfig("mobile", "Mobile", "Phones, tablets, notebooks, and mobile lab devices.", ["Category", "Model", "Serial No.", "Status", "Owner", "NVBug #", "Stamp", "Location", "Usage", "Setup Date", "Borrowed/Lent", "Maker", "CPU", "Memory", "GPU", "Disk", "Resolution", "Notes"], ["Category", "Model", "Serial No.", "Status"], 34, "MOB", ["Mobile Model A", "Mobile Model B"]),
  domainConfig("monitor", "Monitor", "Displays and visual test equipment.", ["Category", "Model", "Serial No.", "Status", "Owner", "NVBug #", "Stamp", "Location", "Usage", "Arrive Date", "Borrowed/Lent", "Maker", "Native Resolution", "Refresh Rate", "Connector", "Features", "Notes"], ["Category", "Model", "Serial No.", "Status", "Native Resolution"], 76, "MON", ["Monitor Model A", "Monitor Model B"]),
  domainConfig("cable", "Cable", "Tracked lab cables and interconnects.", ["Category", "Model", "Serial No.", "Status", "Owner", "NVBug #", "Stamp", "Location", "Old Location", "Usage", "Arrive Date", "Borrowed/Lent", "Notes"], ["Category", "Model", "Serial No.", "Status"], 60, "CBL", ["Cable Model A", "Cable Model B"]),
  domainConfig("misc", "MISC", "Other tracked hardware and lab parts.", ["Category", "Model", "Serial No.", "Status", "Owner", "NVBug #", "Stamp", "Location", "Usage", "Arrive Date", "Borrowed/Lent", "Notes"], ["Category", "Model", "Serial No.", "Status"], 91, "MSC", ["Misc Model A", "Misc Model B"]),
  domainConfig("low-price-consumables", "Low-price Consumables", "Quantity-based consumables and low-cost items.", ["Category", "Model", "Quantity", "Status", "Requester", "NVBug #", "Location", "Usage", "Arrive Date", "Notes"], ["Category", "Model", "Quantity"], 41, "LPC", ["Consumable Model A", "Consumable Model B"]),
  domainConfig("e-waste", "E-Waste", "Retired and disposal-tracked devices.", ["Category", "Model", "Serial No.", "Status", "Owner", "NVBug #", "Stamp", "Location", "Usage", "Arrive Date", "Borrowed/Lent", "Notes"], ["Category", "Model", "Serial No.", "Status"], 80, "EWS", ["Retired Model A", "Retired Model B"]),
  domainConfig("broken-devices", "Broken Devices", "Repair and disposition exception queue.", ["Category", "Model", "Serial No.", "Status", "Owner", "NVBug #", "Stamp", "Location", "Problem", "E-Waste-Pending"], ["Category", "Model", "Serial No.", "Status"], 11, "BRK", ["Broken Model A", "Broken Model B"])
];

function convergedLocationForSource(sourceRow) {
  const buildings = ["Santa Clara Building R", "Santa Clara Building E", "Santa Clara Building S"];
  const labs = ["Lab 104", "Lab 209", "Lab 305", "Lab 410"];
  const index = Math.max(0, Number(sourceRow) - 18);
  const rack = String((index % 12) + 1).padStart(2, "0");
  const cabinet = String((index % 6) + 1).padStart(2, "0");
  return `${buildings[index % buildings.length]} / ${labs[index % labs.length]} / Rack ${rack} / Cabinet ${cabinet}`;
}

function validateConvergedRecord(record, batchId, approvedModels = convergedApprovedModels) {
  const issues = [];
  const addIssue = (severity, field, message) => {
    issues.push({ batchId, domain: "Converged GPU+DPU", sourceRow: record.sourceRow, severity, field, message });
  };

  if (!record.model) addIssue("error", "Model", "Model is mandatory for Converged GPU+DPU records.");
  if (!record.serialNo) addIssue("error", "Serial No.", "Serial No. is mandatory for Converged GPU+DPU records.");
  if (record.status && !convergedStatusOptions.includes(record.status)) {
    addIssue("error", "Status", "Status must be In Use, Idle, Broken, or E-waste Pending.");
  }
  if (record.status === "In Use" && !record.owner) {
    addIssue("error", "Owner", "Owner is required when Status is In Use.");
  }
  if (record.model && !approvedModels.includes(record.model)) {
    addIssue(
      "warning",
      "Model",
      `Current model value '${record.model}' is outside the approved Converged model list (${approvedModels.join(", ")}).`
    );
  }

  return issues;
}

function initDatabase() {
  fsSync.mkdirSync(dataDir, { recursive: true });
  fsSync.mkdirSync(assetModelUploadsDir, { recursive: true });
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

    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      source_file TEXT,
      domain TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      validation_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS converged_gpu_dpu_devices (
      id TEXT PRIMARY KEY,
      source_row INTEGER NOT NULL,
      category TEXT,
      model TEXT NOT NULL,
      serial_no TEXT NOT NULL UNIQUE,
      status TEXT,
      owner TEXT,
      jira_ticket TEXT,
      stamp TEXT,
      location TEXT,
      usage TEXT,
      setup_date TEXT,
      borrowed_lent TEXT,
      sku TEXT,
      edition TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_converged_status ON converged_gpu_dpu_devices(status);
    CREATE INDEX IF NOT EXISTS idx_converged_model ON converged_gpu_dpu_devices(model);
    CREATE INDEX IF NOT EXISTS idx_converged_usage ON converged_gpu_dpu_devices(usage);

    CREATE TABLE IF NOT EXISTS validation_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      source_row INTEGER,
      severity TEXT NOT NULL,
      field TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES import_batches(id)
    );

    CREATE TABLE IF NOT EXISTS domain_admin_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      field TEXT NOT NULL,
      value TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      note TEXT,
      UNIQUE(domain, field, value)
    );

    CREATE TABLE IF NOT EXISTS device_domain_records (
      id TEXT PRIMARY KEY,
      domain_slug TEXT NOT NULL,
      source_row INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(domain_slug, source_row)
    );

    CREATE INDEX IF NOT EXISTS idx_device_domain_records_slug ON device_domain_records(domain_slug);

    CREATE TABLE IF NOT EXISTS asset_models (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      model_name TEXT NOT NULL,
      manufacturer TEXT,
      model_number TEXT,
      image_path TEXT,
      label_template_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(category, model_name)
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      model_id TEXT,
      source_domain_slug TEXT,
      source_row INTEGER,
      category TEXT NOT NULL,
      model_name TEXT NOT NULL,
      serial_no TEXT,
      asset_tag TEXT,
      status TEXT NOT NULL,
      owner TEXT,
      location TEXT,
      usage TEXT,
      borrowed_lent TEXT,
      nvbug TEXT,
      stamp TEXT,
      lifecycle_state TEXT,
      eol_date TEXT,
      notes TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      UNIQUE(source_domain_slug, source_row),
      FOREIGN KEY (model_id) REFERENCES asset_models(id)
    );

    CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category);
    CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
    CREATE INDEX IF NOT EXISTS idx_assets_serial ON assets(serial_no);
    CREATE INDEX IF NOT EXISTS idx_assets_asset_tag ON assets(asset_tag);
    CREATE INDEX IF NOT EXISTS idx_assets_location ON assets(location);

    CREATE TABLE IF NOT EXISTS asset_activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      actor_email TEXT,
      action TEXT NOT NULL,
      asset_id TEXT,
      category TEXT,
      model_name TEXT,
      serial_no TEXT,
      asset_tag TEXT,
      before_json TEXT,
      after_json TEXT,
      reason TEXT,
      nvbug TEXT,
      source TEXT,
      parent_action_id INTEGER,
      metadata_json TEXT,
      FOREIGN KEY (asset_id) REFERENCES assets(id)
    );

    CREATE INDEX IF NOT EXISTS idx_asset_activity_asset ON asset_activity_log(asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_activity_action ON asset_activity_log(action);
    CREATE INDEX IF NOT EXISTS idx_asset_activity_timestamp ON asset_activity_log(timestamp);

    CREATE TABLE IF NOT EXISTS asset_requests (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      asset_id TEXT,
      category TEXT,
      model_name TEXT,
      serial_no TEXT,
      asset_tag TEXT,
      request_type TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT,
      created_by TEXT,
      email TEXT,
      owner TEXT,
      notes TEXT,
      FOREIGN KEY (asset_id) REFERENCES assets(id)
    );

    CREATE INDEX IF NOT EXISTS idx_asset_requests_asset ON asset_requests(asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_requests_status ON asset_requests(status);
  `);

  ensureColumn("asset_models", "image_path", "TEXT");

  seedSetting("runtimeSource", "SQLite");
  seedSetting("backupDirectory", path.relative(repoRoot, backupDir));
  seedSetting("lastBackupAt", "");
  seedSetting("lastBackupStatus", "Not run");
  seedSetting("lastBackupPath", "");
  seedConvergedPilot();
  seedDeviceDomains();
  syncOperationalCatalogFromDeviceDomains();
  syncNormalizedAssetsFromDeviceDomains();
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

function readDomainApprovals(domain = "Converged GPU+DPU") {
  return db.prepare(`
    SELECT
      domain,
      field,
      value,
      approved_by AS approvedBy,
      approved_at AS approvedAt,
      note
    FROM domain_admin_approvals
    WHERE domain = ?
    ORDER BY approved_at DESC, field, value
  `).all(domain);
}

function readApprovedConvergedModels() {
  const approvedValues = readDomainApprovals()
    .filter((approval) => approval.field === "Model")
    .map((approval) => approval.value);
  return [...new Set([...convergedApprovedModels, ...approvedValues])];
}

function seedConvergedPilot() {
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE converged_gpu_dpu_devices SET model = ? WHERE model = ?").run("Converged Model A", "Pilot Converged Model A");
    db.prepare("UPDATE converged_gpu_dpu_devices SET sku = ? WHERE sku = ?").run("CGD-SKU-001", "PILOT-SKU-001");
    db.prepare("UPDATE converged_gpu_dpu_devices SET jira_ticket = ? || substr(jira_ticket, 7) WHERE jira_ticket LIKE ?").run("NVB-", "PILOT-%");
    db.prepare("UPDATE converged_gpu_dpu_devices SET notes = ? WHERE notes LIKE ?").run("Prepared review record for the Converged GPU+DPU domain.", "Sanitized pilot record%");
    db.prepare(`
      INSERT OR IGNORE INTO domain_admin_approvals (
        domain, field, value, approved_by, approved_at, note
      )
      SELECT domain, field, ?, approved_by, approved_at, ?
      FROM domain_admin_approvals
      WHERE domain = ? AND field = ? AND value = ?
    `).run(
      "Converged Model A",
      "Approved for the Converged GPU+DPU domain.",
      "Converged GPU+DPU",
      "Model",
      "Pilot Converged Model A"
    );
    db.prepare("DELETE FROM domain_admin_approvals WHERE domain = ? AND field = ? AND value = ?").run("Converged GPU+DPU", "Model", "Pilot Converged Model A");
    db.prepare("DELETE FROM validation_issues WHERE domain = ? AND message LIKE ?").run("Converged GPU+DPU", "%Pilot Converged Model A%");
    db.prepare("UPDATE import_batches SET status = ? WHERE domain = ? AND status = ?").run("Approved", "Converged GPU+DPU", "Approved for pilot");
    db.prepare("UPDATE import_batches SET source_file = ? WHERE domain = ? AND source_file LIKE ?").run("Device domain setup", "Converged GPU+DPU", "Copy of Device%");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const unsafePilotRows = db.prepare(`
    SELECT COUNT(*) AS count
    FROM converged_gpu_dpu_devices
    WHERE category IN ('RoyB')
       OR model IN ('Ax800')
       OR usage IN ('Aerial')
       OR sku IN ('SKU230')
  `).get().count;
  if (unsafePilotRows) {
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM validation_issues WHERE domain = ?").run("Converged GPU+DPU");
      db.prepare("DELETE FROM converged_gpu_dpu_devices").run();
      db.prepare("DELETE FROM import_batches WHERE domain = ?").run("Converged GPU+DPU");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const staleValidationRows = db.prepare(`
    SELECT COUNT(*) AS count
    FROM validation_issues
    WHERE domain = ?
      AND message LIKE 'Workbook value %'
  `).get("Converged GPU+DPU").count;
  if (staleValidationRows) {
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM validation_issues WHERE domain = ?").run("Converged GPU+DPU");
      db.prepare("DELETE FROM converged_gpu_dpu_devices").run();
      db.prepare("DELETE FROM import_batches WHERE domain = ?").run("Converged GPU+DPU");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const existing = db.prepare("SELECT COUNT(*) AS count FROM converged_gpu_dpu_devices").get().count;
  if (existing) return;

  const now = isoNow();
  const batchId = `converged-gpu-dpu-${now.replace(/[:.]/g, "-")}`;
  const insertDevice = db.prepare(`
    INSERT INTO converged_gpu_dpu_devices (
      id, source_row, category, model, serial_no, status, owner, jira_ticket, stamp,
      location, usage, setup_date, borrowed_lent, sku, edition, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertIssue = db.prepare(`
    INSERT INTO validation_issues (
      batch_id, domain, source_row, severity, field, message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const stagedRows = convergedPilotRows.map((row, index) => ({
    ...row,
    id: `CGD-${String(index + 1).padStart(3, "0")}`,
    serialNo: `CGD-DEMO-${String(index + 1).padStart(4, "0")}`,
    owner: safeOwnerLabel(),
    jiraTicket: `NVB-${String(row.sourceRow).padStart(3, "0")}`,
    stamp: "",
    location: convergedLocationForSource(row.sourceRow),
    setupDate: "",
    borrowedLent: "",
    notes: "Prepared review record for the Converged GPU+DPU domain."
  }));
  const approvedModels = readApprovedConvergedModels();
  const issues = stagedRows.flatMap((row) => validateConvergedRecord(row, batchId, approvedModels));

  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO import_batches (
        id, source_file, domain, imported_at, row_count, validation_count, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      batchId,
      "Device domain setup",
      "Converged GPU+DPU",
      now,
      stagedRows.length,
      issues.length,
      issues.some((issue) => issue.severity === "error") ? "Needs Review" : "Review Required"
    );

    stagedRows.forEach((row) => {
      insertDevice.run(
        row.id,
        row.sourceRow,
        row.category,
        row.model,
        row.serialNo,
        row.status,
        row.owner,
        row.jiraTicket,
        row.stamp,
        row.location,
        row.usage,
        row.setupDate,
        row.borrowedLent,
        row.sku,
        row.edition,
        row.notes,
        now,
        now
      );
    });

    issues.forEach((issue) => {
      insertIssue.run(issue.batchId, issue.domain, issue.sourceRow, issue.severity, issue.field, issue.message, now);
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function statusForDomain(config, index) {
  if (config.slug === "e-waste") return index % 3 === 0 ? "E-waste Pending" : "Idle";
  if (config.slug === "broken-devices") return "Broken";
  const values = ["In Use", "Idle", "Idle", "In Use", "Broken", "Idle"];
  return values[index % values.length];
}

function domainLocation(config, index) {
  const buildings = ["Santa Clara Building R", "Santa Clara Building E", "Santa Clara Building S"];
  const labs = ["Lab 104", "Lab 209", "Lab 305", "Lab 410", "Lab 512"];
  const building = buildings[index % buildings.length];
  const lab = labs[index % labs.length];
  const rack = String((index % 18) + 1).padStart(2, "0");
  const storage = String((index % 9) + 1).padStart(2, "0");
  if (config.slug === "low-price-consumables") return `${building} / Storage ${storage}`;
  return `${building} / ${lab} / Rack ${rack} / Cabinet ${storage}`;
}

function dateForIndex(index) {
  const month = String((index % 12) + 1).padStart(2, "0");
  const day = String((index % 26) + 1).padStart(2, "0");
  return `${month}/${day}/2026`;
}

function valueForDomainField(config, field, index, status) {
  const ordinal = String(index + 1).padStart(3, "0");
  const model = config.models[index % config.models.length];
  const baseValues = {
    category: config.label === "MISC" ? "Miscellaneous" : config.label,
    model,
    serialNo: `${config.prefix}-${String(index + 1).padStart(5, "0")}`,
    status,
    owner: status === "In Use" ? safeOwnerLabel() : safeOwnerLabel(),
    nvbug: `NVB-${config.prefix}-${ordinal}`,
    stamp: dateForIndex(index + 2),
    location: domainLocation(config, index),
    usage: ["Lab validation", "Automation", "Shared pool", "Bring-up", "Reliability"][index % 5],
    setupDate: dateForIndex(index + 5),
    arriveDate: dateForIndex(index + 1),
    borrowedLent: index % 23 === 0 ? "Borrowed" : index % 29 === 0 ? "Lent" : "",
    notes: "Prepared review record for this device family.",
    quantity: String((index % 18) + 2),
    requester: safeOwnerLabel(),
    ip: `SC-LAB-NET-${ordinal}`,
    cpu: `CPU Config ${String.fromCharCode(65 + (index % 3))}`,
    motherBoard: `Board Config ${String.fromCharCode(65 + (index % 3))}`,
    memory: `${16 * ((index % 4) + 1)}GB`,
    disk: `${(index % 4) + 1}TB lab storage`,
    gpu: `GPU Config ${String.fromCharCode(65 + (index % 3))}`,
    psu: `${650 + (index % 4) * 100}W`,
    maker: ["NVIDIA", "Partner", "Lab Vendor"][index % 3],
    chip: `Chip Family ${String.fromCharCode(65 + (index % 4))}`,
    sku: `${config.prefix}-SKU-${ordinal}`,
    gpuClass: ["Data Center", "RTX", "GeForce"][index % 3],
    edition: ["A0", "A1", "TS2", "CR"][index % 4],
    openPartNo: `${config.prefix}-OPN-${ordinal}`,
    psid: `${config.prefix}-PSID-${ordinal}`,
    opnFamily: `${config.label} Family`,
    productionKeyDevelopmentKey: index % 2 === 0 ? "Production Key" : "Development Key",
    nvAssetNumber: `NV-ASSET-${config.prefix}-${ordinal}`,
    type: ["ETH", "IB", "RJ45"][index % 3],
    resolution: ["1920x1080", "2560x1440", "3840x2160"][index % 3],
    nativeResolution: ["1920x1080", "2560x1440", "3840x2160"][index % 3],
    refreshRate: ["60 Hz", "120 Hz", "144 Hz"][index % 3],
    connector: ["HDMI", "DP", "HDMI+DP"][index % 3],
    features: ["HDR", "G-Sync", "Standard"][index % 3],
    oldLocation: domainLocation(config, index + 4),
    problem: ["No boot", "Intermittent link", "Mechanical damage", "Pending triage"][index % 4],
    eWastePending: index % 2 === 0 ? "N" : "Y",
    loginInfo: "Admin vault entry"
  };
  return baseValues[field.key] ?? "";
}

function buildDeviceDomainRecord(config, index) {
  const status = statusForDomain(config, index);
  return Object.fromEntries(config.fields.map((field) => [field.key, valueForDomainField(config, field, index, status)]));
}

function validateDeviceDomainRecord(config, values, sourceRow, batchId) {
  const issues = [];
  const addIssue = (severity, field, message) => {
    issues.push({ batchId, domain: config.label, sourceRow, severity, field, message });
  };
  config.fields.forEach((field) => {
    if (field.required && !String(values[field.key] || "").trim()) {
      addIssue("error", field.label, `${field.label} is required for ${config.label} records.`);
    }
  });
  if (values.status && !convergedStatusOptions.includes(values.status)) {
    addIssue("error", "Status", "Status must be In Use, Idle, Broken, or E-waste Pending.");
  }
  if (values.status === "In Use" && !values.owner && !values.requester) {
    addIssue("error", "Owner", "Owner is required when Status is In Use.");
  }
  return issues;
}

function readApprovedModelsForDomain(config) {
  return [...new Set(config.models)];
}

function seedDeviceDomains() {
  const now = isoNow();
  const staleAcronymRows = db.prepare(`
    SELECT COUNT(*) AS count
    FROM device_domain_records
    WHERE data_json LIKE '%"cPU"%'
       OR data_json LIKE '%"gPU"%'
       OR data_json LIKE '%"iP"%'
       OR data_json LIKE '%"pSU"%'
       OR data_json LIKE '%"pSID"%'
       OR data_json LIKE '%"sKU"%'
  `).get().count;
  if (staleAcronymRows) {
    db.exec("BEGIN");
    try {
      deviceDomainConfigs.forEach((config) => {
        db.prepare("DELETE FROM validation_issues WHERE domain = ?").run(config.label);
        db.prepare("DELETE FROM import_batches WHERE domain = ?").run(config.label);
      });
      db.prepare("DELETE FROM device_domain_records").run();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  db.prepare(`
    UPDATE device_domain_records
    SET data_json = replace(data_json, ?, ?)
    WHERE data_json LIKE ?
  `).run('"loginInfo":"Stored in admin vault"', '"loginInfo":"Admin vault entry"', '%"loginInfo":"Stored in admin vault"%');

  const insertRecord = db.prepare(`
    INSERT OR REPLACE INTO device_domain_records (
      id, domain_slug, source_row, data_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertIssue = db.prepare(`
    INSERT INTO validation_issues (
      batch_id, domain, source_row, severity, field, message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  deviceDomainConfigs.forEach((config) => {
    const existing = db.prepare("SELECT COUNT(*) AS count FROM device_domain_records WHERE domain_slug = ?").get(config.slug).count;
    if (existing === config.recordCount) return;
    const batchId = `device-domain-${config.slug}-${now.replace(/[:.]/g, "-")}`;
    const rows = Array.from({ length: config.recordCount }, (_, index) => ({
      index,
      sourceRow: index + 1,
      values: buildDeviceDomainRecord(config, index)
    }));
    const issues = rows.flatMap((row) => validateDeviceDomainRecord(config, row.values, row.sourceRow, batchId));

    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM validation_issues WHERE domain = ?").run(config.label);
      db.prepare("DELETE FROM device_domain_records WHERE domain_slug = ?").run(config.slug);
      db.prepare("DELETE FROM import_batches WHERE domain = ?").run(config.label);
      db.prepare(`
        INSERT INTO import_batches (
          id, source_file, domain, imported_at, row_count, validation_count, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(batchId, "Device domain setup", config.label, now, rows.length, issues.length, issues.length ? "Review Required" : "Approved");
      rows.forEach((row) => {
        insertRecord.run(
          `${config.prefix}-${String(row.index + 1).padStart(5, "0")}`,
          config.slug,
          row.sourceRow,
          JSON.stringify(row.values),
          now,
          now
        );
      });
      issues.forEach((issue) => insertIssue.run(issue.batchId, issue.domain, issue.sourceRow, issue.severity, issue.field, issue.message, now));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
}

function deviceCatalogRows() {
  const rows = [];
  deviceDomainConfigs.forEach((config) => {
    db.prepare(`
      SELECT id, source_row AS sourceRow, data_json AS dataJson, updated_at AS updatedAt
      FROM device_domain_records
      WHERE domain_slug = ?
      ORDER BY source_row
    `).all(config.slug).forEach((row) => {
      const values = JSON.parse(row.dataJson || "{}");
      const catalogId = String(values.serialNo || row.id).trim();
      if (!catalogId) return;
      const status = String(values.status || "").trim();
      const rawQuantity = numberValue(values.quantity);
      const baselineQuantity = config.slug === "low-price-consumables"
        ? Math.max(0, rawQuantity)
        : ["Broken", "E-waste Pending"].includes(status)
          ? 0
          : 1;
      const minimum = ["Broken", "E-waste Pending"].includes(status) ? 1 : 0;
      const labelByKey = new Map(config.fields.map((field) => [field.key, field.label]));
      const metadata = config.fields
        .map((field) => {
          const value = String(values[field.key] || "").trim();
          return value ? `${labelByKey.get(field.key)}: ${value}` : "";
        })
        .filter(Boolean)
        .join("; ");
      const aliases = [
        values.model,
        values.category,
        values.owner,
        values.requester,
        values.sku,
        values.maker,
        values.chip,
        values.openPartNo,
        values.psid,
        config.label
      ].map((value) => String(value || "").trim()).filter(Boolean);
      rows.push({
        sku: catalogId,
        partName: String(values.model || values.category || config.label).trim(),
        category: config.label,
        availableQty: baselineQuantity,
        minQty: minimum,
        aisle: String(values.location || domainLocation(config, row.sourceRow)).trim(),
        binCode: String(values.usage || values.problem || "Catalog record").trim(),
        distinguishers: [status, values.usage, values.problem, values.notes].map((value) => String(value || "").trim()).filter(Boolean).join(" | "),
        aliasesJson: JSON.stringify([...new Set(aliases)]),
        metadata,
        imagePath: "",
        owner: String(values.owner || values.requester || safeOwnerLabel()).trim(),
        criticality: criticalityFor(baselineQuantity, minimum),
        updatedAt: row.updatedAt || isoNow()
      });
    });
  });
  return rows;
}

function syncOperationalCatalogFromDeviceDomains() {
  const now = isoNow();
  const rows = deviceCatalogRows();
  const existingRows = db.prepare("SELECT sku, available_qty AS availableQty FROM part_master").all();
  const existingBySku = new Map(existingRows.map((row) => [row.sku, row]));
  db.exec("CREATE TEMP TABLE IF NOT EXISTS current_catalog_skus (sku TEXT PRIMARY KEY)");
  const insertCurrentSku = db.prepare("INSERT INTO current_catalog_skus (sku) VALUES (?)");
  const upsertPart = db.prepare(`
    INSERT INTO part_master (
      sku, part_name, category, available_qty, min_qty, aisle, bin_code, distinguishers,
      aliases_json, metadata, image_path, owner, criticality, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sku) DO UPDATE SET
      part_name = excluded.part_name,
      category = excluded.category,
      min_qty = excluded.min_qty,
      aisle = excluded.aisle,
      bin_code = excluded.bin_code,
      distinguishers = excluded.distinguishers,
      aliases_json = excluded.aliases_json,
      metadata = excluded.metadata,
      image_path = excluded.image_path,
      owner = excluded.owner,
      criticality = excluded.criticality,
      updated_at = excluded.updated_at
  `);
  const insertCode = db.prepare(`
    INSERT OR REPLACE INTO code_mappings (
      code, code_type, sku, asset_id, status, location_override, notes, created_at, last_scanned_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM current_catalog_skus").run();
    rows.forEach((row) => insertCurrentSku.run(row.sku));
    db.prepare("DELETE FROM stock_ledger WHERE sku NOT IN (SELECT sku FROM current_catalog_skus)").run();
    db.prepare("DELETE FROM replenishment_requests WHERE sku NOT IN (SELECT sku FROM current_catalog_skus)").run();
    db.prepare("DELETE FROM code_mappings").run();
    db.prepare("DELETE FROM part_master WHERE sku NOT IN (SELECT sku FROM current_catalog_skus)").run();
    rows.forEach((row) => {
      const existing = existingBySku.get(row.sku);
      const availableQty = existing ? numberValue(existing.availableQty) : row.availableQty;
      upsertPart.run(
        row.sku,
        row.partName,
        row.category,
        availableQty,
        row.minQty,
        row.aisle,
        row.binCode,
        row.distinguishers,
        row.aliasesJson,
        row.metadata,
        row.imagePath,
        row.owner,
        criticalityFor(availableQty, row.minQty),
        now,
        now
      );
      insertCode.run(
        `QR-${row.sku}`,
        "QR",
        row.sku,
        row.sku,
        "Active",
        row.aisle,
        `${row.category} catalog label`,
        now,
        ""
      );
    });
    db.prepare("DELETE FROM current_catalog_skus").run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function normalizeLifecycleStatus(status, configSlug = "") {
  const text = String(status || "").trim();
  if (!text) return configSlug === "e-waste" ? "E-waste Pending" : "Ready to Deploy";
  const matched = lifecycleStatuses.find((item) => item.toLowerCase() === text.toLowerCase());
  return matched || text;
}

function lifecycleAvailability(asset) {
  const status = normalizeLifecycleStatus(asset.status);
  const borrowedLent = String(asset.borrowedLent || asset.borrowed_lent || "").trim();
  const archived = Boolean(asset.archivedAt || asset.archived_at) || archivedStatuses.has(status);
  const borrowed = borrowedLent.toLowerCase() === "borrowed";
  const lent = borrowedLent.toLowerCase() === "lent";
  const available = !archived && !lent && ["Ready to Deploy", "Idle"].includes(status);
  const unavailable = !archived && !available;
  const exception = !archived && exceptionStatuses.has(status);
  return {
    status,
    borrowedLent,
    active: !archived,
    available,
    unavailable,
    exception,
    borrowed,
    lent,
    label: status,
    key: status.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown"
  };
}

function assetModelId(category, modelName) {
  return `${String(category || "asset").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(modelName || "model").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.replace(/^-|-$/g, "");
}

function metadataForAsset(config, values) {
  const labels = new Map(config.fields.map((field) => [field.key, field.label]));
  return Object.fromEntries(
    config.fields
      .map((field) => [field.key, labels.get(field.key), values[field.key]])
      .filter((entry) => String(entry[2] || "").trim())
      .map(([key, label, value]) => [key, { label, value: String(value || "").trim() }])
  );
}

function syncNormalizedAssetsFromDeviceDomains() {
  const now = isoNow();
  const upsertModel = db.prepare(`
    INSERT INTO asset_models (
      id, category, model_name, manufacturer, model_number, label_template_json, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(category, model_name) DO UPDATE SET
      manufacturer = excluded.manufacturer,
      model_number = excluded.model_number,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);
  const upsertAsset = db.prepare(`
    INSERT INTO assets (
      id, model_id, source_domain_slug, source_row, category, model_name, serial_no, asset_tag,
      status, owner, location, usage, borrowed_lent, nvbug, stamp, lifecycle_state, eol_date,
      notes, metadata_json, created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_domain_slug, source_row) DO UPDATE SET
      model_id = excluded.model_id,
      category = excluded.category,
      model_name = excluded.model_name,
      serial_no = excluded.serial_no,
      asset_tag = excluded.asset_tag,
      status = CASE
        WHEN assets.status IN ('In Use', 'Ready to Deploy', 'Idle', 'Broken', 'EOL', 'E-waste Pending', 'E-Wasted', 'Disposed', 'Archived')
          THEN assets.status
        ELSE excluded.status
      END,
      owner = CASE WHEN assets.owner IS NULL OR assets.owner = '' THEN excluded.owner ELSE assets.owner END,
      location = CASE WHEN assets.location IS NULL OR assets.location = '' THEN excluded.location ELSE assets.location END,
      usage = excluded.usage,
      borrowed_lent = CASE WHEN assets.borrowed_lent IS NULL OR assets.borrowed_lent = '' THEN excluded.borrowed_lent ELSE assets.borrowed_lent END,
      nvbug = CASE WHEN assets.nvbug IS NULL OR assets.nvbug = '' THEN excluded.nvbug ELSE assets.nvbug END,
      stamp = excluded.stamp,
      lifecycle_state = excluded.lifecycle_state,
      eol_date = excluded.eol_date,
      notes = excluded.notes,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at,
      archived_at = CASE WHEN assets.status IN ('E-Wasted', 'Disposed', 'Archived') THEN COALESCE(assets.archived_at, excluded.archived_at) ELSE assets.archived_at END
  `);

  db.exec("BEGIN");
  try {
    deviceDomainConfigs.forEach((config) => {
      db.prepare(`
        SELECT id, source_row AS sourceRow, data_json AS dataJson, created_at AS createdAt, updated_at AS updatedAt
        FROM device_domain_records
        WHERE domain_slug = ?
        ORDER BY source_row
      `).all(config.slug).forEach((row) => {
        const values = JSON.parse(row.dataJson || "{}");
        const category = config.label;
        const modelName = String(values.model || values.category || config.label).trim();
        const modelId = assetModelId(category, modelName);
        const status = normalizeLifecycleStatus(values.status, config.slug);
        const lifecycle = lifecycleAvailability({ status, borrowedLent: values.borrowedLent });
        const metadata = metadataForAsset(config, values);
        const serialNo = String(values.serialNo || "").trim() || row.id;
        const assetTag = String(values.sku || values.nvAssetNumber || row.id).trim();
        const location = String(values.location || domainLocation(config, row.sourceRow)).trim();
        const owner = String(values.owner || values.requester || (status === "In Use" ? safeOwnerLabel() : "")).trim();
        const archivedAt = archivedStatuses.has(status) ? row.updatedAt || now : "";

        upsertModel.run(
          modelId,
          category,
          modelName,
          String(values.maker || values.manufacturer || "").trim(),
          String(values.modelNumber || values.openPartNo || values.sku || "").trim(),
          JSON.stringify({ template: "dymo-30336", primary: "asset_tag", barcode: "serial_no" }),
          JSON.stringify({ sourceDomain: config.slug }),
          row.createdAt || now,
          now
        );

        upsertAsset.run(
          row.id,
          modelId,
          config.slug,
          row.sourceRow,
          category,
          modelName,
          serialNo,
          assetTag,
          status,
          owner,
          location,
          String(values.usage || values.problem || "").trim(),
          String(values.borrowedLent || "").trim(),
          normalizeNvbugReferences(values.nvbug || values.jiraTicket),
          String(values.stamp || "").trim(),
          lifecycle.exception ? "Exception" : lifecycle.available ? "Available" : lifecycle.active ? "Unavailable" : "Archived",
          String(values.eolDate || "").trim(),
          String(values.notes || values.problem || "").trim(),
          JSON.stringify(metadata),
          row.createdAt || now,
          now,
          archivedAt
        );
      });
    });

    const existingLogCount = db.prepare("SELECT COUNT(*) AS count FROM asset_activity_log").get().count;
    if (!existingLogCount) {
      db.prepare(`
        INSERT INTO asset_activity_log (
          timestamp, actor_name, actor_email, action, asset_id, category, model_name, serial_no,
          asset_tag, before_json, after_json, reason, nvbug, source, parent_action_id, metadata_json
        )
        SELECT
          created_at,
          ?,
          ?,
          'Import Commit',
          id,
          category,
          model_name,
          serial_no,
          asset_tag,
          '{}',
          json_object('status', status, 'location', location, 'owner', owner),
          'Initial normalized import from workbook-style device records.',
          nvbug,
          'Inventory 2.0',
          NULL,
          json_object('sourceDomain', source_domain_slug, 'sourceRow', source_row)
        FROM assets
      `).run(safeOwnerLabel(), "imargulis-staff@nvidia.com");
    }
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
      aisle: row.aisle || safeBuildingFor(row.category),
      bin: row.bin_code || `Storage ${safeZoneFor(`${row.category}-${row.sku}`)}`,
      distinguishers: row.distinguishers || "",
      aliases: safeJsonList(row.aliases_json),
      metadata: row.metadata || "",
      imagePath: row.image_path || "",
      owner: row.owner || safeOwnerLabel(),
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
  const assets = readAssets();
  const activityLog = readActivityLog(new URLSearchParams());
  const assetRequests = readAssetRequests();
  const partBySku = new Map(parts.map((part) => [part.sku, part]));
  const transactions = db.prepare("SELECT * FROM stock_ledger ORDER BY timestamp DESC, id DESC LIMIT 100").all().map((item) => {
    const part = partBySku.get(item.sku);
    return {
      ...item,
      operator_name: safeOwnerLabel(),
      operator_email: "imargulis-staff@nvidia.com",
      aisle: part?.aisle || safeBuildingFor(item.category),
      bin_code: part?.bin || `Storage ${safeZoneFor(`${item.category}-${item.sku}`)}`
    };
  });
  const codeMappings = db.prepare("SELECT * FROM code_mappings ORDER BY sku, code").all();
  const replenishment = db.prepare("SELECT * FROM replenishment_requests ORDER BY created_at DESC").all().map((item) => {
    const part = partBySku.get(item.sku);
    return {
      ...item,
      created_by: safeOwnerLabel(),
      email: "imargulis-staff@nvidia.com",
      owner: safeOwnerLabel(),
      aisle: part?.aisle || safeBuildingFor(item.category),
      bin_code: part?.bin || `Storage ${safeZoneFor(`${item.category}-${item.sku}`)}`
    };
  });
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
      seedSource: "Parts Catalog",
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
      codeMappings: codeMappings.filter((code) => String(code.status).toLowerCase() === "active").length,
      assetsTotalActive: assets.filter((asset) => asset.lifecycle.active).length,
      assetsAvailable: assets.filter((asset) => asset.lifecycle.available).length,
      assetsUnavailable: assets.filter((asset) => asset.lifecycle.unavailable).length,
      assetsExceptions: assets.filter((asset) => asset.lifecycle.exception).length,
      assetsBorrowed: assets.filter((asset) => asset.lifecycle.borrowed).length,
      assetsLent: assets.filter((asset) => asset.lifecycle.lent).length
    },
    assets,
    activityLog,
    assetRequests,
    parts,
    categorySummary: categorySummary(parts),
    locationSummary: locationSummary(parts),
    riskQueue,
    transactions,
    codeMappings,
    replenishment
  };
}

function assetReadinessStatus(part, codes, requests, ledger) {
  const openRequests = requests.filter((request) => !["completed", "closed", "refilled"].includes(String(request.status || "").toLowerCase()));
  const checks = [
    {
      key: "identity",
      label: "Identity",
      status: part.sku && part.partName && part.category ? "Ready" : "Review",
      detail: "Catalog ID, model, and family are present."
    },
    {
      key: "location",
      label: "Location",
      status: part.aisle || part.bin ? "Ready" : "Review",
      detail: part.location || "Location needs administrator review."
    },
    {
      key: "label",
      label: "Label",
      status: codes.length ? "Ready" : "Review",
      detail: codes.length ? `${codes.length} active code mapping${codes.length === 1 ? "" : "s"}.` : "No active QR/barcode mapping."
    },
    {
      key: "activity",
      label: "History",
      status: ledger.length || part.lastMovement ? "Ready" : "Review",
      detail: ledger.length ? `${ledger.length} recent ledger event${ledger.length === 1 ? "" : "s"}.` : "No movement history recorded."
    },
    {
      key: "requests",
      label: "Requests",
      status: openRequests.length ? "Open" : "Clear",
      detail: openRequests.length ? `${openRequests.length} open request${openRequests.length === 1 ? "" : "s"}.` : "No open request against this catalog record."
    }
  ];

  return {
    checks,
    labelReady: codes.length > 0,
    openRequests: openRequests.length,
    historyEvents: ledger.length,
    needsReview: checks.filter((check) => check.status === "Review" || check.status === "Open").length
  };
}

function parseMetadataJson(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function assetFromRow(row) {
  const asset = {
    id: row.id,
    modelId: row.model_id || row.modelId || "",
    sourceDomainSlug: row.source_domain_slug || row.sourceDomainSlug || "",
    sourceRow: numberValue(row.source_row || row.sourceRow),
    category: row.category || "",
    modelName: row.model_name || row.modelName || "",
    serialNo: row.serial_no || row.serialNo || "",
    assetTag: row.asset_tag || row.assetTag || "",
    status: row.status || "Ready to Deploy",
    owner: row.owner || "",
    location: row.location || "",
    usage: row.usage || "",
    borrowedLent: row.borrowed_lent || row.borrowedLent || "",
    nvbug: row.nvbug || "",
    stamp: row.stamp || "",
    lifecycleState: row.lifecycle_state || row.lifecycleState || "",
    eolDate: row.eol_date || row.eolDate || "",
    notes: row.notes || "",
    metadata: parseMetadataJson(row.metadata_json || row.metadataJson),
    imagePath: row.model_image_path || row.image_path || row.imagePath || "",
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || "",
    archivedAt: row.archived_at || row.archivedAt || ""
  };
  asset.lifecycle = lifecycleAvailability(asset);
  asset.statusLabel = asset.lifecycle.label;
  asset.statusKey = asset.lifecycle.key;
  return asset;
}

function readAssets() {
  return db.prepare(`
    SELECT
      assets.id,
      assets.model_id,
      assets.source_domain_slug,
      assets.source_row,
      assets.category,
      assets.model_name,
      assets.serial_no,
      assets.asset_tag,
      assets.status,
      assets.owner,
      assets.location,
      assets.usage,
      assets.borrowed_lent,
      assets.nvbug,
      assets.stamp,
      assets.lifecycle_state,
      assets.eol_date,
      assets.notes,
      assets.metadata_json,
      asset_models.image_path AS model_image_path,
      assets.created_at,
      assets.updated_at,
      assets.archived_at
    FROM assets
    LEFT JOIN asset_models ON asset_models.id = assets.model_id
    ORDER BY assets.category, assets.source_row, assets.id
  `).all().map(assetFromRow);
}

function readAssetById(assetId) {
  const normalized = String(assetId || "").trim().toLowerCase();
  const row = db.prepare(`
    SELECT assets.*, asset_models.image_path AS model_image_path
    FROM assets
    LEFT JOIN asset_models ON asset_models.id = assets.model_id
    WHERE lower(assets.id) = ?
       OR lower(assets.serial_no) = ?
       OR lower(assets.asset_tag) = ?
    LIMIT 1
  `).get(normalized, normalized, normalized);
  if (!row) {
    const error = new Error(`Asset '${assetId}' was not found.`);
    error.statusCode = 404;
    throw error;
  }
  return assetFromRow(row);
}

function assetSearchHaystack(asset) {
  return [
    asset.id,
    asset.assetTag,
    asset.serialNo,
    asset.category,
    asset.modelName,
    asset.status,
    asset.owner,
    asset.location,
    asset.usage,
    asset.borrowedLent,
    asset.nvbug,
    asset.notes,
    ...Object.entries(asset.metadata || {}).map(([key, entry]) => {
      if (entry && typeof entry === "object") return `${entry.label || key} ${entry.value || ""}`;
      return `${key} ${entry || ""}`;
    })
  ].filter(Boolean).join(" ");
}

function assetSearchResultRow(asset) {
  return {
    id: asset.id,
    assetId: asset.id,
    assetTag: asset.assetTag,
    serialNo: asset.serialNo,
    category: asset.category,
    modelName: asset.modelName,
    status: {
      key: asset.statusKey,
      label: asset.statusLabel,
      lifecycle: asset.lifecycle
    },
    owner: asset.owner || safeOwnerLabel(),
    location: asset.location,
    usage: asset.usage,
    borrowedLent: asset.borrowedLent,
    nvbug: asset.nvbug,
    nvbugReferences: nvbugReferences(asset.nvbug),
    imagePath: asset.imagePath,
    fieldValues: assetFilterValues(asset),
    updatedAt: asset.updatedAt,
    available: asset.lifecycle.available,
    exception: asset.lifecycle.exception,
    detailUrl: `/api/v2/assets/${encodeURIComponent(asset.id)}`
  };
}

const commonAssetFilterFields = [
  { key: "category", label: "Category", type: "select" },
  { key: "modelName", label: "Model", type: "select" },
  { key: "serialNo", label: "Serial No.", type: "text" },
  { key: "assetTag", label: "Asset Tag", type: "text" },
  { key: "status", label: "Status", type: "select" },
  { key: "owner", label: "Owner", type: "select" },
  { key: "location", label: "Location", type: "select" },
  { key: "usage", label: "Usage", type: "select" },
  { key: "nvbug", label: "NVBug #", type: "text" },
  { key: "borrowedLent", label: "Borrowed/Lent", type: "select" }
];

const commonAssetFilterKeys = new Set(commonAssetFilterFields.map((field) => field.key));

function categoryConfigByLabel(label) {
  const normalized = normalizeSearchValue(label);
  return deviceDomainConfigs.find((config) => {
    const configLabel = normalizeSearchValue(config.label);
    return configLabel === normalized ||
      (configLabel === "misc" && normalized === "miscellaneous") ||
      (configLabel === "e-waste" && normalized === "e-wasted") ||
      (configLabel === "workstation" && normalized === "workstation");
  }) || null;
}

function domainFieldType(field) {
  if (["status", "category", "model", "owner", "requester", "location", "usage", "borrowedLent", "sku", "edition", "maker", "type", "gpuClass", "nativeResolution", "refreshRate", "connector", "features", "eWastePending"].includes(field.key)) return "select";
  return "text";
}

function categorySpecificFilterFields(category) {
  const config = categoryConfigByLabel(category);
  if (!config) return [];
  return config.fields
    .filter((field) => !commonAssetFilterKeys.has(field.key) && !["notes", "stamp"].includes(field.key))
    .map((field) => ({ key: field.key, label: field.label, type: domainFieldType(field), instruction: field.instruction }));
}

function assetFilterValue(asset, key) {
  if (key === "status") return asset.status;
  if (key === "model") return asset.modelName;
  if (key === "requester") return asset.owner;
  if (Object.prototype.hasOwnProperty.call(asset, key)) return asset[key];
  const metadata = asset.metadata || {};
  if (metadata[key]) return metadata[key] && typeof metadata[key] === "object" ? metadata[key].value || "" : metadata[key] || "";
  const match = Object.values(metadata).find((entry) => entry && typeof entry === "object" && fieldKey(entry.label || "") === key);
  return match?.value || "";
}

function assetFilterValues(asset) {
  const fields = [
    ...commonAssetFilterFields,
    ...categorySpecificFilterFields(asset.category)
  ];
  return Object.fromEntries(fields.map((field) => [field.key, String(assetFilterValue(asset, field.key) || "")]));
}

function assetFacetRows(assets, key) {
  const counts = new Map();
  assets.forEach((asset) => {
    const value = assetFilterValue(asset, key);
    const text = String(value || "").trim();
    if (!text) return;
    const current = counts.get(text) || { value: text, label: text, count: 0 };
    current.count += 1;
    counts.set(text, current);
  });
  return [...counts.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function filterFieldsForCategory(category) {
  return {
    common: commonAssetFilterFields,
    distinctive: categorySpecificFilterFields(category),
    activeCategory: category || ""
  };
}

function collectAssetSearchFilters(searchParams) {
  const selectedCategory = searchParams.get("category") || "";
  const fields = [
    ...commonAssetFilterFields,
    ...categorySpecificFilterFields(selectedCategory),
    ...deviceDomainConfigs.flatMap((config) => config.fields.map((field) => ({ key: field.key })))
  ];
  const allowedKeys = new Set(fields.map((field) => field.key));
  const filters = {};
  for (const key of allowedKeys) {
    const value = searchParams.get(key) || searchParams.get(`f.${key}`) || "";
    if (String(value || "").trim()) filters[key] = String(value).trim();
  }
  return filters;
}

function applyAssetSearchFilters(assets, filters) {
  return assets.filter((asset) => Object.entries(filters).every(([key, rawValue]) => {
    const value = normalizeSearchValue(rawValue);
    if (!value) return true;
    const actual = normalizeSearchValue(assetFilterValue(asset, key));
    if (["category", "status", "location", "owner", "borrowedLent", "modelName", "model", "usage"].includes(key)) return actual === value;
    return actual.includes(value);
  }));
}

function normalizeSearchValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function compactSearchValue(value) {
  return normalizeSearchValue(value).replace(/[^a-z0-9]+/g, "");
}

function categorySearchKeys(category) {
  const normalized = normalizeSearchValue(category);
  const compact = compactSearchValue(category);
  const keys = new Set([normalized, compact]);
  if (normalized === "misc") keys.add("miscellaneous");
  if (normalized === "e-waste") keys.add("ewaste");
  if (normalized === "low-price consumables") keys.add("consumables");
  if (normalized === "converged gpu+dpu") {
    keys.add("converged gpu + dpu");
    keys.add("convergedgpudpu");
  }
  return [...keys].filter(Boolean);
}

function partSearchHaystack(part) {
  return [
    part.sku,
    part.partName,
    part.category,
    part.location,
    part.owner,
    part.criticality,
    part.status?.label,
    part.distinguishers,
    Array.isArray(part.aliases) ? part.aliases.join(" ") : part.aliases,
    part.metadata
  ]
    .filter(Boolean)
    .join(" ");
}

function searchResultRow(part) {
  return {
    sku: part.sku,
    partName: part.partName,
    category: part.category,
    status: part.status,
    quantity: part.quantity,
    minimum: part.minimum,
    location: part.location,
    owner: part.owner,
    lastMovement: part.lastMovement,
    labelReady: part.barcodeCount > 0,
    detailUrl: `/api/v2/assets/${encodeURIComponent(part.sku)}`
  };
}

function facetRows(parts, key, labeler = (value) => value) {
  const counts = new Map();
  parts.forEach((part) => {
    const rawValue = key === "status" ? part.status?.key : part[key];
    const value = String(rawValue || "").trim();
    if (!value) return;
    const label = key === "status" ? part.status?.label : labeler(value);
    const current = counts.get(value) || { value, label, count: 0 };
    current.count += 1;
    counts.set(value, current);
  });
  return [...counts.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function applyInventorySearchFilters(parts, filters) {
  return parts.filter((part) => {
    return (
      (!filters.category || part.category === filters.category) &&
      (!filters.status || part.status?.key === filters.status) &&
      (!filters.location || part.location === filters.location)
    );
  });
}

function searchInventory(searchParams) {
  const query = normalizeSearchValue(searchParams.get("q") || searchParams.get("query") || "");
  const queryCompact = compactSearchValue(query);
  const filters = collectAssetSearchFilters(searchParams);
  const assets = readAssets();
  const exactIdentifierAsset = query
    ? assets.find((asset) => [asset.id, asset.serialNo, asset.assetTag].some((value) => normalizeSearchValue(value) === query))
    : null;

  let mode = "all";
  let candidates = assets.filter((asset) => asset.lifecycle.active);

  if (exactIdentifierAsset) {
    mode = "exact-asset";
    candidates = [exactIdentifierAsset];
  } else if (query) {
    const exactCategory = [...new Set(assets.map((asset) => asset.category))]
      .find((category) => categorySearchKeys(category).includes(query) || categorySearchKeys(category).includes(queryCompact));

    if (exactCategory) {
      mode = "category";
      candidates = assets.filter((asset) => asset.lifecycle.active && asset.category === exactCategory);
    } else {
      mode = "text";
      candidates = assets.filter((asset) => asset.lifecycle.active && normalizeSearchValue(assetSearchHaystack(asset)).includes(query));
    }
  }

  const filtered = exactIdentifierAsset ? candidates : applyAssetSearchFilters(candidates, filters);
  const activeCategory = filters.category || (mode === "category" ? candidates[0]?.category || "" : "");
  const filterSchema = filterFieldsForCategory(activeCategory);
  const facetFields = [...filterSchema.common, ...filterSchema.distinctive].filter((field) => field.type === "select");
  return {
    ok: true,
    query,
    mode,
    total: filtered.length,
    filters,
    filterSchema,
    facets: Object.fromEntries(facetFields.map((field) => [field.key, assetFacetRows(candidates, field.key)])),
    results: filtered.map(assetSearchResultRow)
  };
}

function countBreakdown(rows, key, fallback = "Not listed") {
  return [...rows.reduce((map, row) => {
    const raw = key === "status" ? row.status?.label : row[key];
    const label = String(raw || fallback).trim() || fallback;
    map.set(label, (map.get(label) || 0) + 1);
    return map;
  }, new Map()).entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function readAssetReport(searchParams = new URLSearchParams()) {
  const search = searchInventory(searchParams);
  const rows = search.results;
  return {
    ok: true,
    generatedAt: isoNow(),
    query: search.query,
    total: rows.length,
    filters: search.filters,
    filterSchema: search.filterSchema,
    facets: search.facets,
    summary: {
      active: rows.length,
      available: rows.filter((row) => row.available).length,
      unavailable: rows.filter((row) => !row.available && !row.exception).length,
      exceptions: rows.filter((row) => row.exception).length,
      borrowed: rows.filter((row) => row.borrowedLent === "Borrowed").length,
      lent: rows.filter((row) => row.borrowedLent === "Lent").length,
      categories: new Set(rows.map((row) => row.category).filter(Boolean)).size,
      locations: new Set(rows.map((row) => row.location).filter(Boolean)).size
    },
    breakdowns: {
      category: countBreakdown(rows, "category"),
      status: countBreakdown(rows, "status"),
      location: countBreakdown(rows, "location"),
      owner: countBreakdown(rows, "owner"),
      borrowedLent: countBreakdown(rows, "borrowedLent", "In Stock")
    },
    results: rows
  };
}

function buildAssetDetail(assetId) {
  const asset = readAssetById(assetId);
  const activity = readActivityLog(new URLSearchParams([["asset", asset.id]]));
  const requests = readAssetRequests(asset.id);
  const model = db.prepare(`
    SELECT
      id,
      category,
      model_name AS modelName,
      manufacturer,
      model_number AS modelNumber,
      image_path AS imagePath,
      label_template_json AS labelTemplateJson
    FROM asset_models
    WHERE id = ?
  `).get(asset.modelId) || null;

  const historyEvents = activity.results.map((item) => ({
    at: item.timestamp,
    type: item.action,
    summary: item.reason || item.action,
    reference: item.nvbug || item.id,
    actor: item.actorName
  }));

  return {
    ok: true,
    asset,
    model,
    requests,
    activity: activity.results,
    events: historyEvents,
    readiness: {
      checks: [
        {
          key: "identity",
          label: "Identity",
          status: asset.serialNo || asset.assetTag ? "Ready" : "Needs Data",
          detail: asset.serialNo ? `Serial ${asset.serialNo}` : "Serial or asset tag is needed."
        },
        {
          key: "location",
          label: "Location",
          status: asset.location ? "Ready" : "Needs Data",
          detail: asset.location || "Location is required for reliable search."
        },
        {
          key: "lifecycle",
          label: "Lifecycle",
          status: asset.lifecycle.exception ? "Exception" : asset.lifecycle.available ? "Available" : asset.lifecycle.active ? "Unavailable" : "Archived",
          detail: `${asset.statusLabel}${asset.borrowedLent ? ` / ${asset.borrowedLent}` : ""}`
        },
        {
          key: "history",
          label: "History",
          status: historyEvents.length ? "Ready" : "Needs Activity",
          detail: `${historyEvents.length} traceability event${historyEvents.length === 1 ? "" : "s"}.`
        }
      ],
      labelReady: Boolean(asset.serialNo || asset.assetTag),
      openRequests: requests.filter((item) => !["Closed", "Completed", "Cancelled"].includes(item.status)).length,
      historyEvents: historyEvents.length,
      needsReview: 0
    }
  };
}

function readActivityLog(searchParams = new URLSearchParams()) {
  const asset = String(searchParams.get("asset") || "").trim();
  const action = String(searchParams.get("action") || "").trim();
  const status = String(searchParams.get("status") || "").trim();
  const actor = String(searchParams.get("actor") || "").trim().toLowerCase();
  const date = String(searchParams.get("date") || "").trim();
  const nvbug = normalizeNvbugReferences(searchParams.get("nvbug") || "");
  const clauses = [];
  const params = [];
  if (asset) {
    clauses.push("(lower(asset_id) = lower(?) OR lower(serial_no) = lower(?) OR lower(asset_tag) = lower(?))");
    params.push(asset, asset, asset);
  }
  if (action) {
    clauses.push("action = ?");
    params.push(action);
  }
  if (actor) {
    clauses.push("(lower(actor_name) LIKE ? OR lower(actor_email) LIKE ?)");
    params.push(`%${actor}%`, `%${actor}%`);
  }
  if (date) {
    clauses.push("timestamp LIKE ?");
    params.push(`${date}%`);
  }
  if (nvbug) {
    clauses.push("nvbug LIKE ?");
    params.push(`%${nvbug}%`);
  }
  if (status) {
    clauses.push("after_json LIKE ?");
    params.push(`%"status":"${status.replace(/"/g, '\\"')}"%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT
      id,
      timestamp,
      actor_name AS actorName,
      actor_email AS actorEmail,
      action,
      asset_id AS assetId,
      category,
      model_name AS modelName,
      serial_no AS serialNo,
      asset_tag AS assetTag,
      before_json AS beforeJson,
      after_json AS afterJson,
      reason,
      nvbug,
      source,
      parent_action_id AS parentActionId,
      metadata_json AS metadataJson
    FROM asset_activity_log
    ${where}
    ORDER BY timestamp DESC, id DESC
    LIMIT 500
  `).all(...params).map((row) => ({
    ...row,
    before: parseMetadataJson(row.beforeJson),
    after: parseMetadataJson(row.afterJson),
    metadata: parseMetadataJson(row.metadataJson)
  }));
  return { ok: true, total: rows.length, results: rows };
}

function readAssetRequests(assetId = "") {
  const params = [];
  const where = assetId ? "WHERE asset_id = ?" : "";
  if (assetId) params.push(assetId);
  return db.prepare(`
    SELECT
      id,
      created_at AS createdAt,
      updated_at AS updatedAt,
      asset_id AS assetId,
      category,
      model_name AS modelName,
      serial_no AS serialNo,
      asset_tag AS assetTag,
      request_type AS requestType,
      status,
      priority,
      created_by AS createdBy,
      email,
      owner,
      notes
    FROM asset_requests
    ${where}
    ORDER BY created_at DESC
    LIMIT 250
  `).all(...params);
}

function insertAssetActivity(payload) {
  const result = db.prepare(`
    INSERT INTO asset_activity_log (
      timestamp, actor_name, actor_email, action, asset_id, category, model_name, serial_no,
      asset_tag, before_json, after_json, reason, nvbug, source, parent_action_id, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.timestamp || isoNow(),
    payload.actorName || safeOwnerLabel(),
    payload.actorEmail || "imargulis-staff@nvidia.com",
    payload.action,
    payload.assetId || null,
    payload.category || "",
    payload.modelName || "",
    payload.serialNo || "",
    payload.assetTag || "",
    JSON.stringify(payload.before || {}),
    JSON.stringify(payload.after || {}),
    payload.reason || "",
    normalizeNvbugReferences(payload.nvbug),
    payload.source || "Inventory 2.0",
    payload.parentActionId || null,
    JSON.stringify(payload.metadata || {})
  );
  return result.lastInsertRowid;
}

function assetPublicFields(asset) {
  return {
    id: asset.id,
    category: asset.category,
    modelName: asset.modelName,
    serialNo: asset.serialNo,
    assetTag: asset.assetTag,
    status: asset.status,
    owner: asset.owner,
    location: asset.location,
    usage: asset.usage,
    borrowedLent: asset.borrowedLent,
    nvbug: asset.nvbug,
    stamp: asset.stamp,
    eolDate: asset.eolDate,
    notes: asset.notes,
    metadata: asset.metadata,
    archivedAt: asset.archivedAt
  };
}

function validateAssetPatch(next) {
  if (!String(next.category || "").trim()) throw new Error("Category is required.");
  if (!String(next.modelName || "").trim()) throw new Error("Model is required.");
  const status = normalizeLifecycleStatus(next.status);
  if (!lifecycleStatuses.includes(status)) throw new Error(`Status must be one of: ${lifecycleStatuses.join(", ")}.`);
  if (status === "In Use" && !String(next.owner || "").trim()) throw new Error("Owner is required when status is In Use.");
  if (!String(next.location || "").trim()) throw new Error("Location is required.");
  const borrowedLent = String(next.borrowedLent || "").trim();
  if (borrowedLent && !["Borrowed", "Lent", "In Stock"].includes(borrowedLent)) {
    throw new Error("Borrowed/Lent must be Borrowed, Lent, In Stock, or blank.");
  }
  if (next.eolDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(next.eolDate))) {
    throw new Error("EOL date must use YYYY-MM-DD format.");
  }
}

function updateAsset(assetId, payload) {
  const reason = String(payload.reason || "").trim();
  if (!reason) throw new Error("Reason is required before saving asset changes.");
  const before = readAssetById(assetId);
  const allowed = ["category", "modelName", "serialNo", "assetTag", "status", "owner", "location", "usage", "borrowedLent", "nvbug", "stamp", "eolDate", "notes"];
  const next = assetPublicFields(before);
  allowed.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(payload, key)) next[key] = String(payload[key] ?? "").trim();
  });
  next.metadata = parseMetadataJson(JSON.stringify(before.metadata || {}));
  Object.entries(payload).forEach(([key, value]) => {
    if (!key.startsWith("metadata.")) return;
    const metadataKey = key.slice("metadata.".length);
    if (!metadataKey) return;
    const current = next.metadata[metadataKey];
    const existing = current && typeof current === "object" ? current : { label: metadataKey, value: current || "" };
    next.metadata[metadataKey] = {
      ...existing,
      value: String(value ?? "").trim()
    };
  });
  next.nvbug = normalizeNvbugReferences(next.nvbug);
  next.status = normalizeLifecycleStatus(next.status);
  validateAssetPatch(next);
  if (next.serialNo) {
    const duplicate = db.prepare("SELECT id FROM assets WHERE lower(serial_no) = lower(?) AND id <> ? LIMIT 1").get(next.serialNo, before.id);
    if (duplicate) throw new Error(`Serial number is already assigned to ${duplicate.id}.`);
  }
  const lifecycle = lifecycleAvailability(next);
  const archivedAt = archivedStatuses.has(next.status) ? before.archivedAt || isoNow() : "";
  const now = isoNow();
  const modelId = assetModelId(next.category, next.modelName);

  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO asset_models (
        id, category, model_name, manufacturer, model_number, label_template_json, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(category, model_name) DO UPDATE SET
        updated_at = excluded.updated_at
    `).run(
      modelId,
      next.category,
      next.modelName,
      "",
      "",
      JSON.stringify({ template: "dymo-30336", primary: "asset_tag", barcode: "serial_no" }),
      "{}",
      now,
      now
    );
    db.prepare(`
      UPDATE assets SET
        model_id = ?,
        category = ?,
        model_name = ?,
        serial_no = ?,
        asset_tag = ?,
        status = ?,
        owner = ?,
        location = ?,
        usage = ?,
        borrowed_lent = ?,
        nvbug = ?,
        stamp = ?,
        lifecycle_state = ?,
        eol_date = ?,
        notes = ?,
        metadata_json = ?,
        updated_at = ?,
        archived_at = ?
      WHERE id = ?
    `).run(
      modelId,
      next.category,
      next.modelName,
      next.serialNo,
      next.assetTag,
      next.status,
      next.owner,
      next.location,
      next.usage,
      next.borrowedLent,
      next.nvbug,
      next.stamp,
      lifecycle.exception ? "Exception" : lifecycle.available ? "Available" : lifecycle.active ? "Unavailable" : "Archived",
      next.eolDate,
      next.notes,
      JSON.stringify(next.metadata),
      now,
      archivedAt,
      before.id
    );
    const after = readAssetById(before.id);
    insertAssetActivity({
      action: before.status !== after.status ? "Status Change" : "Manual Edit",
      assetId: after.id,
      category: after.category,
      modelName: after.modelName,
      serialNo: after.serialNo,
      assetTag: after.assetTag,
      before: assetPublicFields(before),
      after: assetPublicFields(after),
      reason,
      nvbug: next.nvbug,
      actorName: payload.actorName || safeOwnerLabel(),
      actorEmail: payload.actorEmail || "imargulis-staff@nvidia.com"
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ok: true, message: `${before.id} updated.`, detail: buildAssetDetail(before.id), snapshot: buildSnapshot() };
}

function applyAssetAction(assetId, payload, parentActionId = null) {
  const before = readAssetById(assetId);
  const action = String(payload.action || "").trim().toLowerCase();
  const reason = String(payload.reason || "").trim();
  if (!action) throw new Error("Action is required.");
  if (!reason && !["print-label"].includes(action)) throw new Error("Reason is required for this action.");
  const next = assetPublicFields(before);
  let actionLabel = "";

  if (action === "check-out" || action === "checkout") {
    actionLabel = "Check Out";
    next.status = "In Use";
    next.owner = String(payload.owner || before.owner || safeOwnerLabel()).trim();
    if (!next.owner) throw new Error("Owner is required for checkout.");
  } else if (action === "check-in" || action === "checkin") {
    actionLabel = "Check In";
    next.status = "Ready to Deploy";
    next.owner = String(payload.owner || "").trim();
    next.location = String(payload.location || before.location || "").trim();
  } else if (action === "transfer") {
    actionLabel = "Transfer";
    next.owner = String(payload.owner ?? before.owner ?? "").trim();
    next.location = String(payload.location ?? before.location ?? "").trim();
  } else if (action === "status-change") {
    actionLabel = "Status Change";
    next.status = normalizeLifecycleStatus(payload.status || before.status);
    next.borrowedLent = String(payload.borrowedLent ?? before.borrowedLent ?? "").trim();
    next.eolDate = String(payload.eolDate ?? before.eolDate ?? "").trim();
  } else if (action === "archive" || action === "dispose") {
    actionLabel = action === "archive" ? "Archive" : "Dispose";
    next.status = action === "archive" ? "Archived" : "Disposed";
  } else if (action === "restore") {
    actionLabel = "Restore";
    next.status = "Ready to Deploy";
  } else if (action === "print-label") {
    actionLabel = "Print Label";
  } else if (action === "request") {
    actionLabel = "Create Request";
  } else {
    throw new Error("Unsupported asset action.");
  }

  if (actionLabel === "Print Label") {
    insertAssetActivity({
      action: actionLabel,
      assetId: before.id,
      category: before.category,
      modelName: before.modelName,
      serialNo: before.serialNo,
      assetTag: before.assetTag,
      before: assetPublicFields(before),
      after: assetPublicFields(before),
      reason: reason || "Label preview/print requested.",
      nvbug: normalizeNvbugReferences(payload.nvbug || before.nvbug),
      actorName: payload.actorName || safeOwnerLabel(),
      actorEmail: payload.actorEmail || "imargulis-staff@nvidia.com",
      parentActionId
    });
    return buildAssetDetail(before.id);
  }

  if (actionLabel === "Create Request") {
    const now = isoNow();
    const requestId = `REQ2-${Date.now()}-${String(before.id).replace(/[^a-zA-Z0-9]+/g, "").slice(-6)}`;
    db.prepare(`
      INSERT INTO asset_requests (
        id, created_at, updated_at, asset_id, category, model_name, serial_no, asset_tag,
        request_type, status, priority, created_by, email, owner, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      requestId,
      now,
      now,
      before.id,
      before.category,
      before.modelName,
      before.serialNo,
      before.assetTag,
      String(payload.requestType || "Support").trim(),
      "Open",
      String(payload.priority || "Normal").trim(),
      payload.actorName || safeOwnerLabel(),
      payload.actorEmail || "imargulis-staff@nvidia.com",
      before.owner || safeOwnerLabel(),
      reason
    );
    insertAssetActivity({
      action: actionLabel,
      assetId: before.id,
      category: before.category,
      modelName: before.modelName,
      serialNo: before.serialNo,
      assetTag: before.assetTag,
      before: assetPublicFields(before),
      after: { requestId, status: "Open", requestType: payload.requestType || "Support" },
      reason,
      nvbug: normalizeNvbugReferences(payload.nvbug || before.nvbug),
      actorName: payload.actorName || safeOwnerLabel(),
      actorEmail: payload.actorEmail || "imargulis-staff@nvidia.com",
      parentActionId
    });
    return buildAssetDetail(before.id);
  }

  validateAssetPatch(next);
  const lifecycle = lifecycleAvailability(next);
  const archivedAt = archivedStatuses.has(next.status) ? before.archivedAt || isoNow() : "";
  const now = isoNow();
  db.prepare(`
    UPDATE assets SET
      status = ?,
      owner = ?,
      location = ?,
      usage = ?,
      borrowed_lent = ?,
      nvbug = ?,
      lifecycle_state = ?,
      eol_date = ?,
      updated_at = ?,
      archived_at = ?
    WHERE id = ?
  `).run(
    next.status,
    next.owner,
    next.location,
    next.usage,
    next.borrowedLent,
    normalizeNvbugReferences(payload.nvbug || before.nvbug),
    lifecycle.exception ? "Exception" : lifecycle.available ? "Available" : lifecycle.active ? "Unavailable" : "Archived",
    next.eolDate,
    now,
    archivedAt,
    before.id
  );
  const after = readAssetById(before.id);
  insertAssetActivity({
    action: actionLabel,
    assetId: after.id,
    category: after.category,
    modelName: after.modelName,
    serialNo: after.serialNo,
    assetTag: after.assetTag,
    before: assetPublicFields(before),
    after: assetPublicFields(after),
    reason,
    nvbug: normalizeNvbugReferences(payload.nvbug || after.nvbug),
    actorName: payload.actorName || safeOwnerLabel(),
    actorEmail: payload.actorEmail || "imargulis-staff@nvidia.com",
    parentActionId
  });
  return buildAssetDetail(before.id);
}

function recordAssetAction(assetId, payload) {
  db.exec("BEGIN");
  try {
    const detail = applyAssetAction(assetId, payload);
    db.exec("COMMIT");
    return { ok: true, message: `${detail.asset.id} ${payload.action} recorded.`, detail, snapshot: buildSnapshot() };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function recordBulkAssetAction(payload) {
  const assetIds = Array.isArray(payload.assetIds) ? payload.assetIds.map((item) => String(item || "").trim()).filter(Boolean) : [];
  if (!assetIds.length) throw new Error("Select at least one asset for a bulk action.");
  const reason = String(payload.reason || "").trim();
  if (!reason && String(payload.action || "").toLowerCase() !== "print-label") throw new Error("Reason is required for bulk actions.");
  db.exec("BEGIN");
  try {
    const parentActionId = insertAssetActivity({
      action: "Bulk Action",
      before: { assetCount: assetIds.length },
      after: { action: payload.action, assetIds },
      reason: reason || "Bulk label print requested.",
      nvbug: normalizeNvbugReferences(payload.nvbug),
      actorName: payload.actorName || safeOwnerLabel(),
      actorEmail: payload.actorEmail || "imargulis-staff@nvidia.com",
      metadata: { action: payload.action, assetIds }
    });
    assetIds.forEach((assetId) => applyAssetAction(assetId, payload, parentActionId));
    db.exec("COMMIT");
    return { ok: true, message: `Bulk ${payload.action} recorded for ${assetIds.length} assets.`, snapshot: buildSnapshot(), activity: readActivityLog(new URLSearchParams()) };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCsvText(csvText) {
  const lines = String(csvText || "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, column) => [header, cells[column] || ""]));
  }).map((row, index) => ({ rowNumber: index + 2, values: row }));
  return { headers, rows };
}

function validateParsedImport(parsed) {
  const required = ["Full Name", "Email", "Username", "item Name", "Category", "Model name", "Serial number", "Asset Tag", "Location", "Status"];
  const missingHeaders = required.filter((header) => !parsed.headers.includes(header));
  const issues = [];
  if (missingHeaders.length) {
    issues.push({ severity: "error", row: 1, field: "Header", message: `Missing required columns: ${missingHeaders.join(", ")}.` });
  }
  parsed.rows.forEach((row) => {
    const values = row.values;
    if (!String(values.Category || "").trim()) issues.push({ severity: "error", row: row.rowNumber, field: "Category", message: "Category is required." });
    if (!String(values["Model name"] || values["item Name"] || "").trim()) issues.push({ severity: "error", row: row.rowNumber, field: "Model name", message: "Model name or item Name is required." });
    if (!String(values["Serial number"] || values["Asset Tag"] || "").trim()) issues.push({ severity: "error", row: row.rowNumber, field: "Serial number", message: "Serial number or Asset Tag is required." });
    const status = normalizeLifecycleStatus(values.Status || "Ready to Deploy");
    if (!lifecycleStatuses.includes(status)) issues.push({ severity: "error", row: row.rowNumber, field: "Status", message: `Unsupported status '${values.Status}'.` });
  });
  return issues;
}

function previewImport(payload) {
  const csvText = String(payload.csvText || "").trim();
  if (!csvText) throw new Error("CSV text is required for import preview.");
  const parsed = parseCsvText(csvText);
  const issues = validateParsedImport(parsed);
  const now = isoNow();
  const batchId = `csv-preview-${Date.now()}`;
  db.prepare(`
    INSERT INTO import_batches (id, source_file, domain, imported_at, row_count, validation_count, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(batchId, String(payload.fileName || "CSV import"), "Assets", now, parsed.rows.length, issues.length, issues.some((issue) => issue.severity === "error") ? "Errors" : "Preview Ready");
  insertAssetActivity({
    action: "Import Preview",
    before: {},
    after: { batchId, rows: parsed.rows.length, issues: issues.length },
    reason: "CSV import preview generated.",
    source: "Inventory 2.0 Import",
    metadata: { headers: parsed.headers }
  });
  return { ok: true, batchId, headers: parsed.headers, rows: parsed.rows.slice(0, 25), rowCount: parsed.rows.length, issues };
}

function commitImport(batchId, payload) {
  const csvText = String(payload.csvText || "").trim();
  if (!csvText) throw new Error("CSV text is required to commit import.");
  const parsed = parseCsvText(csvText);
  const issues = validateParsedImport(parsed);
  if (issues.some((issue) => issue.severity === "error")) throw new Error("Resolve import errors before committing.");
  const now = isoNow();
  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO import_batches (id, source_file, domain, imported_at, row_count, validation_count, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_file = excluded.source_file,
        imported_at = excluded.imported_at,
        row_count = excluded.row_count,
        validation_count = excluded.validation_count,
        status = excluded.status
    `).run(batchId, String(payload.fileName || "CSV commit"), "Assets", now, parsed.rows.length, 0, "Committed");
    parsed.rows.forEach((row) => {
      const values = row.values;
      const category = String(values.Category || "MISC").trim();
      const modelName = String(values["Model name"] || values["item Name"] || category).trim();
      const modelId = assetModelId(category, modelName);
      const assetId = String(values["Asset Tag"] || values["Serial number"] || `${category}-${row.rowNumber}`).trim();
      const status = normalizeLifecycleStatus(values.Status || "Ready to Deploy");
      const asset = {
        status,
        borrowedLent: "",
        archivedAt: archivedStatuses.has(status) ? now : ""
      };
      const lifecycle = lifecycleAvailability(asset);
      db.prepare(`
        INSERT INTO asset_models (
          id, category, model_name, manufacturer, model_number, label_template_json, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(category, model_name) DO UPDATE SET
          manufacturer = excluded.manufacturer,
          model_number = excluded.model_number,
          updated_at = excluded.updated_at
      `).run(
        modelId,
        category,
        modelName,
        String(values.Manufacturer || "").trim(),
        String(values["Model Number"] || "").trim(),
        JSON.stringify({ template: "dymo-30336", primary: "asset_tag", barcode: "serial_no" }),
        JSON.stringify({ company: values.Company || "", supplier: values.Supplier || "" }),
        now,
        now
      );
      db.prepare(`
        INSERT INTO assets (
          id, model_id, source_domain_slug, source_row, category, model_name, serial_no, asset_tag,
          status, owner, location, usage, borrowed_lent, nvbug, stamp, lifecycle_state, eol_date,
          notes, metadata_json, created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          model_id = excluded.model_id,
          category = excluded.category,
          model_name = excluded.model_name,
          serial_no = excluded.serial_no,
          asset_tag = excluded.asset_tag,
          status = excluded.status,
          owner = excluded.owner,
          location = excluded.location,
          nvbug = excluded.nvbug,
          notes = excluded.notes,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at,
          archived_at = excluded.archived_at
      `).run(
        assetId,
        modelId,
        "csv-import",
        row.rowNumber,
        category,
        modelName,
        String(values["Serial number"] || "").trim(),
        assetId,
        status,
        String(values["Full Name"] || safeOwnerLabel()).trim(),
        String(values.Location || "").trim() || "Santa Clara Building R",
        "",
        "",
        normalizeNvbugReferences(values["NVBug #"]),
        String(values["Purchase Date"] || "").trim(),
        lifecycle.exception ? "Exception" : lifecycle.available ? "Available" : lifecycle.active ? "Unavailable" : "Archived",
        "",
        String(values.Notes || "").trim(),
        JSON.stringify(values),
        now,
        now,
        asset.archivedAt
      );
      const inserted = readAssetById(assetId);
      insertAssetActivity({
        action: "Import Commit",
        assetId: inserted.id,
        category: inserted.category,
        modelName: inserted.modelName,
        serialNo: inserted.serialNo,
        assetTag: inserted.assetTag,
        before: {},
        after: assetPublicFields(inserted),
        reason: `CSV import commit ${batchId}.`,
        source: "Inventory 2.0 Import",
        metadata: { batchId, rowNumber: row.rowNumber }
      });
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ok: true, message: `${parsed.rows.length} rows committed.`, snapshot: buildSnapshot() };
}

function readConvergedDomain() {
  const records = db.prepare(`
    SELECT
      id,
      source_row AS sourceRow,
      category,
      model,
      serial_no AS serialNo,
      status,
      owner,
      jira_ticket AS jiraTicket,
      stamp,
      location,
      usage,
      setup_date AS setupDate,
      borrowed_lent AS borrowedLent,
      sku,
      edition,
      notes,
      updated_at AS updatedAt
    FROM converged_gpu_dpu_devices
    ORDER BY source_row
  `).all();
  const approvals = readDomainApprovals();
  const approvedModels = readApprovedConvergedModels();
  const latestBatch = db.prepare(`
    SELECT
      id,
      source_file AS sourceFile,
      domain,
      imported_at AS importedAt,
      row_count AS rowCount,
      validation_count AS validationCount,
      status
    FROM import_batches
    WHERE domain = ?
    ORDER BY imported_at DESC
    LIMIT 1
  `).get("Converged GPU+DPU") || null;
  const validationIssues = latestBatch
    ? db.prepare(`
        SELECT
          source_row AS sourceRow,
          severity,
          field,
          message
        FROM validation_issues
        WHERE domain = ? AND batch_id = ?
        ORDER BY CASE severity WHEN 'error' THEN 0 ELSE 1 END, source_row, field
      `).all("Converged GPU+DPU", latestBatch.id)
    : [];
  const filterOptions = Object.fromEntries(convergedDomainFields.map((field) => {
    const values = [...new Set(records.map((record) => String(record[field.key] || "").trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    return [field.key, values];
  }));
  const countByStatus = records.reduce((map, record) => {
    map[record.status || "Blank"] = (map[record.status || "Blank"] || 0) + 1;
    return map;
  }, {});
  const issueCounts = validationIssues.reduce((map, issue) => {
    map[issue.severity] = (map[issue.severity] || 0) + 1;
    return map;
  }, {});

  return {
    ok: true,
    domain: {
      slug: "converged-gpu-dpu",
      label: "Converged GPU+DPU",
      headerRow: 17,
      firstRecordRow: 18,
      team: safeOwnerLabel(),
      fields: convergedDomainFields,
      filterKeys: convergedDomainFields.map((field) => field.key),
      statusOptions: convergedStatusOptions,
      approvedModels,
      baselineApprovedModels: convergedApprovedModels
    },
    summary: {
      records: records.length,
      sourceRows: records.length ? `${records[0].sourceRow}-${records[records.length - 1].sourceRow}` : "",
      inUse: countByStatus["In Use"] || 0,
      idle: countByStatus.Idle || 0,
      warnings: issueCounts.warning || 0,
      errors: issueCounts.error || 0,
      approvedReviews: approvals.length
    },
    latestBatch,
    approvals,
    filterOptions,
    validationIssues,
    records
  };
}

function readDeviceDomain(config) {
  const records = db.prepare(`
    SELECT
      id,
      source_row AS sourceRow,
      data_json AS dataJson,
      updated_at AS updatedAt
    FROM device_domain_records
    WHERE domain_slug = ?
    ORDER BY source_row
  `).all(config.slug).map((row) => ({
    id: row.id,
    sourceRow: row.sourceRow,
    values: JSON.parse(row.dataJson || "{}"),
    updatedAt: row.updatedAt
  }));
  const latestBatch = db.prepare(`
    SELECT
      id,
      source_file AS sourceFile,
      domain,
      imported_at AS importedAt,
      row_count AS rowCount,
      validation_count AS validationCount,
      status
    FROM import_batches
    WHERE domain = ?
    ORDER BY imported_at DESC
    LIMIT 1
  `).get(config.label) || null;
  const validationIssues = latestBatch
    ? db.prepare(`
        SELECT
          source_row AS sourceRow,
          severity,
          field,
          message
        FROM validation_issues
        WHERE domain = ? AND batch_id = ?
        ORDER BY CASE severity WHEN 'error' THEN 0 ELSE 1 END, source_row, field
      `).all(config.label, latestBatch.id)
    : [];
  const approvals = readDomainApprovals(config.label);
  const filterOptions = Object.fromEntries(config.fields.map((field) => {
    const values = [...new Set(records.map((record) => String(record.values[field.key] || "").trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    return [field.key, values];
  }));
  const countByStatus = records.reduce((map, record) => {
    const status = record.values.status || "Blank";
    map[status] = (map[status] || 0) + 1;
    return map;
  }, {});
  const issueCounts = validationIssues.reduce((map, issue) => {
    map[issue.severity] = (map[issue.severity] || 0) + 1;
    return map;
  }, {});

  return {
    slug: config.slug,
    label: config.label,
    description: config.description,
    fields: config.fields,
    statusOptions: convergedStatusOptions,
    approvedModels: readApprovedModelsForDomain(config),
    baselineApprovedModels: config.models,
    summary: {
      records: records.length,
      inUse: countByStatus["In Use"] || 0,
      idle: countByStatus.Idle || 0,
      broken: countByStatus.Broken || 0,
      eWastePending: countByStatus["E-waste Pending"] || 0,
      warnings: issueCounts.warning || 0,
      errors: issueCounts.error || 0,
      approvedReviews: approvals.length
    },
    latestBatch,
    approvals,
    filterOptions,
    validationIssues,
    records
  };
}

function readDeviceDomains() {
  return {
    ok: true,
    generatedAt: isoNow(),
    domains: deviceDomainConfigs.map(readDeviceDomain)
  };
}

function refreshDeviceDomainBatchStatus(domainLabel) {
  const latestBatch = db.prepare(`
    SELECT id
    FROM import_batches
    WHERE domain = ?
    ORDER BY imported_at DESC
    LIMIT 1
  `).get(domainLabel);
  if (!latestBatch) return;
  const remainingIssues = db.prepare(`
    SELECT severity, COUNT(*) AS count
    FROM validation_issues
    WHERE domain = ? AND batch_id = ?
    GROUP BY severity
  `).all(domainLabel, latestBatch.id);
  const counts = Object.fromEntries(remainingIssues.map((row) => [row.severity, row.count]));
  const issueCount = remainingIssues.reduce((total, row) => total + numberValue(row.count), 0);
  const status = counts.error ? "Needs Review" : issueCount ? "Review Required" : "Approved";
  db.prepare("UPDATE import_batches SET validation_count = ?, status = ? WHERE id = ?").run(issueCount, status, latestBatch.id);
}

function approveDeviceDomainModel(slug, payload) {
  const config = deviceDomainConfigs.find((item) => item.slug === slug);
  if (!config) throw new Error("Unknown device domain.");
  const model = String(payload.model || "").trim();
  const approvedBy = String(payload.approvedBy || safeOwnerLabel()).trim() || safeOwnerLabel();
  if (!model) throw new Error("Select a model value before approving.");
  const exists = db.prepare(`
    SELECT COUNT(*) AS count
    FROM device_domain_records
    WHERE domain_slug = ? AND data_json LIKE ?
  `).get(config.slug, `%"model":"${model.replace(/"/g, '\\"')}"%`).count;
  if (!exists) throw new Error("This model value is not present in the selected device family.");

  const now = isoNow();
  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO domain_admin_approvals (
        domain, field, value, approved_by, approved_at, note
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(domain, field, value) DO UPDATE SET
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        note = excluded.note
    `).run(config.label, "Model", model, approvedBy, now, `Approved for ${config.label}.`);
    db.prepare(`
      DELETE FROM validation_issues
      WHERE domain = ?
        AND field = ?
        AND message LIKE ?
    `).run(config.label, "Model", `%${model}%`);
    refreshDeviceDomainBatchStatus(config.label);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { ok: true, domain: readDeviceDomain(config), message: `${model} approved for ${config.label}.` };
}

function refreshConvergedBatchStatus() {
  const latestBatch = db.prepare(`
    SELECT id
    FROM import_batches
    WHERE domain = ?
    ORDER BY imported_at DESC
    LIMIT 1
  `).get("Converged GPU+DPU");
  if (!latestBatch) return;

  const remainingIssues = db.prepare(`
    SELECT severity, COUNT(*) AS count
    FROM validation_issues
    WHERE domain = ? AND batch_id = ?
    GROUP BY severity
  `).all("Converged GPU+DPU", latestBatch.id);
  const counts = Object.fromEntries(remainingIssues.map((row) => [row.severity, row.count]));
  const issueCount = remainingIssues.reduce((total, row) => total + numberValue(row.count), 0);
  const status = counts.error
    ? "Needs Review"
    : issueCount
      ? "Review Required"
      : "Approved";
  db.prepare("UPDATE import_batches SET validation_count = ?, status = ? WHERE id = ?").run(issueCount, status, latestBatch.id);
}

function approveConvergedModel(payload) {
  const model = String(payload.model || "").trim();
  const approvedBy = String(payload.approvedBy || safeOwnerLabel()).trim() || safeOwnerLabel();
  if (!model) throw new Error("Select a model value before approving.");

  const currentModel = db.prepare("SELECT COUNT(*) AS count FROM converged_gpu_dpu_devices WHERE model = ?").get(model).count;
  if (!currentModel) throw new Error("This model value is not present in the Converged GPU+DPU records.");

  const now = isoNow();
  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO domain_admin_approvals (
        domain, field, value, approved_by, approved_at, note
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(domain, field, value) DO UPDATE SET
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        note = excluded.note
    `).run(
      "Converged GPU+DPU",
      "Model",
      model,
      approvedBy,
      now,
      "Approved for the Converged GPU+DPU domain."
    );
    db.prepare(`
      DELETE FROM validation_issues
      WHERE domain = ?
        AND field = ?
        AND message LIKE ?
    `).run("Converged GPU+DPU", "Model", `%${model}%`);
    refreshConvergedBatchStatus();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { ...readConvergedDomain(), message: `${model} approved for this domain.` };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function readRawBody(request, maxBytes = 7 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error("Uploaded file is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseMultipartFormData(buffer, contentType = "") {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error("Multipart boundary is missing.");
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const fields = {};
  const files = {};
  let offset = 0;

  while (offset < buffer.length) {
    const boundaryStart = buffer.indexOf(boundary, offset);
    if (boundaryStart < 0) break;
    let partStart = boundaryStart + boundary.length;
    if (buffer.slice(partStart, partStart + 2).toString() === "--") break;
    if (buffer.slice(partStart, partStart + 2).toString() === "\r\n") partStart += 2;

    const nextBoundary = buffer.indexOf(boundary, partStart);
    if (nextBoundary < 0) break;
    let part = buffer.slice(partStart, nextBoundary);
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd >= 0) {
      const rawHeaders = part.slice(0, headerEnd).toString("utf8");
      const content = part.slice(headerEnd + 4);
      const disposition = rawHeaders.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || "";
      const name = disposition.match(/name="([^"]+)"/)?.[1] || disposition.match(/name=([^;\s]+)/)?.[1] || "";
      const filename = disposition.match(/filename="([^"]*)"/)?.[1] || disposition.match(/filename=([^;\s]+)/)?.[1] || "";
      const type = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || "";
      if (name && filename) {
        files[name] = { filename, type, buffer: content };
      } else if (name) {
        fields[name] = content.toString("utf8");
      }
    }
    offset = nextBoundary;
  }

  return { fields, files };
}

function readAssetModelById(modelId) {
  const model = db.prepare(`
    SELECT id, category, model_name AS modelName, manufacturer, model_number AS modelNumber, image_path AS imagePath
    FROM asset_models
    WHERE id = ?
  `).get(modelId);
  if (!model) {
    const error = new Error(`Asset model '${modelId}' was not found.`);
    error.statusCode = 404;
    throw error;
  }
  return model;
}

function uploadedImagePathToFile(imagePath) {
  if (!imagePath || !imagePath.startsWith("/uploads/asset-models/")) return "";
  const filePath = path.normalize(path.join(dataDir, imagePath.replace(/^\/uploads\//, "uploads/")));
  return isInside(assetModelUploadsDir, filePath) ? filePath : "";
}

async function updateAssetModelImage(modelId, request) {
  const model = readAssetModelById(modelId);
  const { fields, files } = parseMultipartFormData(await readRawBody(request), request.headers["content-type"] || "");
  const image = files.image;
  const reason = String(fields.reason || "").trim();
  if (!reason) throw new Error("Reason is required before changing the model image.");
  if (!image?.buffer?.length) throw new Error("Choose an image file to upload.");
  if (image.buffer.length > 5 * 1024 * 1024) throw new Error("Image must be 5 MB or smaller.");

  const ext = path.extname(image.filename || "").toLowerCase();
  const allowedExt = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowedExt.has(ext) || (image.type && !allowedTypes.has(image.type))) {
    throw new Error("Upload a PNG, JPG, JPEG, or WebP image.");
  }

  fsSync.mkdirSync(assetModelUploadsDir, { recursive: true });
  const safeId = model.id.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  const fileName = `${safeId}-${Date.now()}${ext === ".jpeg" ? ".jpg" : ext}`;
  const filePath = path.join(assetModelUploadsDir, fileName);
  await fs.writeFile(filePath, image.buffer);
  const imagePath = `/uploads/asset-models/${fileName}`;
  const now = isoNow();

  db.prepare("UPDATE asset_models SET image_path = ?, updated_at = ? WHERE id = ?").run(imagePath, now, model.id);
  insertAssetActivity({
    action: "Model Image Upload",
    category: model.category,
    modelName: model.modelName,
    before: { imagePath: model.imagePath || "" },
    after: { imagePath },
    reason,
    actorName: fields.actorName || safeOwnerLabel(),
    actorEmail: fields.actorEmail || "imargulis-staff@nvidia.com",
    source: "Inventory 2.0 Admin"
  });

  return { ok: true, model: readAssetModelById(model.id), snapshot: buildSnapshot(), message: "Model image uploaded." };
}

async function removeAssetModelImage(modelId, payload) {
  const model = readAssetModelById(modelId);
  const reason = String(payload.reason || "").trim();
  if (!reason) throw new Error("Reason is required before removing the model image.");
  const filePath = uploadedImagePathToFile(model.imagePath || "");
  const now = isoNow();
  db.prepare("UPDATE asset_models SET image_path = '', updated_at = ? WHERE id = ?").run(now, model.id);
  if (filePath) {
    await fs.unlink(filePath).catch(() => {});
  }
  insertAssetActivity({
    action: "Model Image Remove",
    category: model.category,
    modelName: model.modelName,
    before: { imagePath: model.imagePath || "" },
    after: { imagePath: "" },
    reason,
    actorName: payload.actorName || safeOwnerLabel(),
    actorEmail: payload.actorEmail || "imargulis-staff@nvidia.com",
    source: "Inventory 2.0 Admin"
  });
  return { ok: true, model: readAssetModelById(model.id), snapshot: buildSnapshot(), message: "Model image removed." };
}

function recordStockTransaction(payload) {
  const sku = String(payload.sku || "").trim();
  const action = String(payload.action || "").trim().toLowerCase();
  const quantity = Math.max(1, numberValue(payload.quantity));
  const reason = String(payload.reason || "").trim();
  const lookupMethod = String(payload.lookupMethod || "Manual selection").trim();
  const operatorName = String(payload.operatorName || safeOwnerLabel()).trim();
  const operatorEmail = String(payload.operatorEmail || "imargulis-staff@nvidia.com").trim();
  const exceptionApproved = Boolean(payload.referenceException);
  let nvbug = normalizeNvbugReferences(payload.nvbug);

  if (!sku) throw new Error("Select a valid catalog record before recording an operation.");
  if (!["checkout", "restock"].includes(action)) throw new Error("Choose checkout or receive.");
  if (!reason) throw new Error("Business reason is required before updating inventory.");
  if (!nvbug && !exceptionApproved) throw new Error("Enter NVBug/reference or record an approved exception.");
  if (!nvbug && exceptionApproved) nvbug = "Exception recorded - no NVBug/reference available";

  const part = db.prepare("SELECT * FROM part_master WHERE sku = ?").get(sku);
  if (!part) throw new Error("The selected catalog record was not found.");

  const beforeQuantity = numberValue(part.available_qty);
  if (action === "checkout" && quantity > beforeQuantity) throw new Error("Checkout quantity cannot exceed active quantity.");
  const afterQuantity = action === "checkout" ? beforeQuantity - quantity : beforeQuantity + quantity;
  const timestamp = isoNow();
  const actionLabel = action === "checkout" ? "Checkout" : "Receive";

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
  if (!part) throw new Error("Select a valid catalog record before creating a request.");
  const requestedQty = Math.max(1, numberValue(payload.requestedQty));
  const notes = String(payload.notes || "").trim();
  const priority = String(payload.priority || "Normal").trim();
  const operatorName = String(payload.operatorName || safeOwnerLabel()).trim();
  const operatorEmail = String(payload.operatorEmail || "imargulis-staff@nvidia.com").trim();
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
    operatorName,
    operatorEmail,
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
    safeOwnerLabel(),
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
  const headers = ["Category", "Catalog ID", "Model", "Active Quantity", "Expected", "Status", "Building", "Storage", "Owner", "Criticality", "Code Mappings", "Aliases", "Metadata"];
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
  const headers = ["Timestamp", "Operator", "Email", "Action", "Catalog ID", "Model", "Category", "Quantity", "Before", "After", "Building", "Storage", "Reason", "NVBug/Reference", "Lookup Method"];
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

function assetActivityCsv(rows) {
  const headers = ["Timestamp", "Actor", "Email", "Action", "Asset ID", "Asset Tag", "Serial", "Category", "Model", "Reason", "NVBug/Reference", "Source", "Parent Action", "Before", "After"];
  const csvRows = rows.map((item) => [
    item.timestamp,
    item.actorName,
    item.actorEmail,
    item.action,
    item.assetId,
    item.assetTag,
    item.serialNo,
    item.category,
    item.modelName,
    item.reason,
    item.nvbug,
    item.source,
    item.parentActionId || "",
    JSON.stringify(item.before || {}),
    JSON.stringify(item.after || {})
  ]);
  return [headers.map(csvEscape).join(","), ...csvRows.map((row) => row.map(csvEscape).join(","))].join("\n");
}

function assetReportCsv(report) {
  const headers = ["Asset ID", "Asset Tag", "Serial", "Category", "Model", "Status", "Available", "Exception", "Location", "Owner", "Usage", "Borrowed/Lent", "NVBug"];
  const rows = report.results.map((item) => [
    item.assetId || item.id,
    item.assetTag,
    item.serialNo,
    item.category,
    item.modelName,
    item.status?.label || "",
    item.available ? "Yes" : "No",
    item.exception ? "Yes" : "No",
    item.location,
    item.owner,
    item.usage,
    item.borrowedLent,
    item.nvbug
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

async function serveUploadedAsset(requestUrl, response) {
  const relativePath = decodeURIComponent(requestUrl.pathname.replace(/^\/uploads\/asset-models\/?/, ""));
  const filePath = path.normalize(path.join(assetModelUploadsDir, relativePath));
  if (!relativePath || !isInside(assetModelUploadsDir, filePath)) {
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

    if (request.method === "GET" && requestUrl.pathname.startsWith("/uploads/asset-models/")) {
      await serveUploadedAsset(requestUrl, response);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/v2/bootstrap") {
      sendJson(response, 200, buildSnapshot());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/v2/device-domains") {
      sendJson(response, 200, readDeviceDomains());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/v2/device-domains/converged-gpu-dpu") {
      sendJson(response, 200, { ok: true, domain: readDeviceDomain(deviceDomainConfigs.find((item) => item.slug === "converged-gpu-dpu")) });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/v2/search") {
      sendJson(response, 200, searchInventory(requestUrl.searchParams));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/v2/reports") {
      sendJson(response, 200, readAssetReport(requestUrl.searchParams));
      return;
    }

    const assetDetailMatch = requestUrl.pathname.match(/^\/api\/v2\/assets\/([^/]+)$/);
    if (request.method === "GET" && assetDetailMatch) {
      sendJson(response, 200, buildAssetDetail(decodeURIComponent(assetDetailMatch[1])));
      return;
    }

    if (request.method === "PATCH" && assetDetailMatch) {
      sendJson(response, 200, updateAsset(decodeURIComponent(assetDetailMatch[1]), await readJsonBody(request)));
      return;
    }

    const assetActionMatch = requestUrl.pathname.match(/^\/api\/v2\/assets\/([^/]+)\/actions$/);
    if (request.method === "POST" && assetActionMatch) {
      sendJson(response, 200, recordAssetAction(decodeURIComponent(assetActionMatch[1]), await readJsonBody(request)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/v2/assets/bulk-actions") {
      sendJson(response, 200, recordBulkAssetAction(await readJsonBody(request)));
      return;
    }

    const modelImageMatch = requestUrl.pathname.match(/^\/api\/v2\/asset-models\/([^/]+)\/image$/);
    if (request.method === "POST" && modelImageMatch) {
      sendJson(response, 200, await updateAssetModelImage(decodeURIComponent(modelImageMatch[1]), request));
      return;
    }

    if (request.method === "DELETE" && modelImageMatch) {
      sendJson(response, 200, await removeAssetModelImage(decodeURIComponent(modelImageMatch[1]), await readJsonBody(request)));
      return;
    }

    const assetActivityMatch = requestUrl.pathname.match(/^\/api\/v2\/assets\/([^/]+)\/activity$/);
    if (request.method === "GET" && assetActivityMatch) {
      const params = new URLSearchParams(requestUrl.searchParams);
      params.set("asset", decodeURIComponent(assetActivityMatch[1]));
      sendJson(response, 200, readActivityLog(params));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/v2/activity") {
      sendJson(response, 200, readActivityLog(requestUrl.searchParams));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/v2/import/preview") {
      sendJson(response, 200, previewImport(await readJsonBody(request)));
      return;
    }

    const importCommitMatch = requestUrl.pathname.match(/^\/api\/v2\/import\/([^/]+)\/commit$/);
    if (request.method === "POST" && importCommitMatch) {
      sendJson(response, 200, commitImport(decodeURIComponent(importCommitMatch[1]), await readJsonBody(request)));
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

    if (request.method === "GET" && requestUrl.pathname === "/exports/asset-activity") {
      response.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="inventory-2.0-asset-activity.csv"',
        "Cache-Control": "no-store"
      });
      response.end(assetActivityCsv(readActivityLog(requestUrl.searchParams).results));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/exports/asset-report") {
      response.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="inventory-2.0-asset-report.csv"',
        "Cache-Control": "no-store"
      });
      response.end(assetReportCsv(readAssetReport(requestUrl.searchParams)));
      return;
    }

    await serveStatic(requestUrl, response);
  } catch (error) {
    sendJson(response, error.statusCode || 500, { ok: false, message: error.message });
  }
}

initDatabase();
http.createServer(handleRequest).listen(port, host, () => {
  console.log(`Inventory 2.0 running at http://${host}:${port}`);
});
