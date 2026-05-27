const http = require("http");
const fs = require("fs/promises");
const path = require("path");

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
const referenceImagesDir = path.join(dataDir, "reference_images");
const reportEmail = "gamehta@nvidia.com";
const rowLabel = "Available Quantity";
const port = Number(process.env.PORT || 3000);
const adminEmails = new Set(["gamehta@nvidia.com", "monicam@nvidia.com"]);

const csvFiles = {
  parts: { path: partsPath, fileName: "parts.csv", label: "SKU Catalog" },
  members: { path: membersPath, fileName: "members.csv", label: "Members" },
  transactions: { path: transactionsPath, fileName: "transactions.csv", label: "Transactions Log" },
  evaluations: { path: evaluationPath, fileName: "evaluation_queue.csv", label: "Admin Review Queue" },
  replenishment: { path: replenishmentPath, fileName: "replenishment.csv", label: "Replenishment Board" }
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
    categories: ["PSU", "PDU", "Cables"],
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
  "Reason"
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
  "Status"
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
  "Bin Threshold Reached",
  "Signal Sent",
  "Reorder in Progress",
  "Bin Refilled"
];

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
  const csv = await fs.readFile(partsPath, "utf8");
  return parseCsv(csv).rows.map((row) => ({
    ...normalizePart(row),
    raw: row
  }));
}

async function writeParts(parts) {
  const existing = parseCsv(await fs.readFile(partsPath, "utf8"));
  const headers = [...existing.headers];
  partsHeaders.forEach((header) => {
    if (!headers.includes(header)) {
      headers.push(header);
    }
  });
  await fs.writeFile(partsPath, writeCsv(headers, parts.map((part) => denormalizePart(part, headers))), "utf8");
  await syncCategoryInventory(parts);
}

async function syncCategoryInventory(parts) {
  await fs.writeFile(inventoryPath, quantitiesToCsv(aggregateByCategory(parts)), "utf8");
}

async function readInventory() {
  const csv = await fs.readFile(inventoryPath, "utf8");
  const [headerLine, dataLine] = csv.trim().split(/\r?\n/);
  const headers = parseCsvLine(headerLine || "");
  const values = parseCsvLine(dataLine || "");
  const quantities = {};
  headers.slice(1).forEach((column) => {
    quantities[column] = toNumber(values[headers.indexOf(column)]);
  });

  return {
    columns: headers.slice(1),
    rowLabel: values[0] || rowLabel,
    quantities,
    source: "data/inventory.csv",
    reportEmail
  };
}

async function readMembers() {
  const csv = await fs.readFile(membersPath, "utf8");
  return parseCsv(csv).rows
    .map((row) => ({
      name: String(row.Member || "").trim(),
      email: String(row.Email || "").trim()
    }))
    .filter((member) => member.name && member.email);
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
    status: replenishmentStatuses.includes(row.Status) ? row.Status : "Bin Threshold Reached",
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
  try {
    const csv = await fs.readFile(replenishmentPath, "utf8");
    return parseCsv(csv).rows.map(normalizeReplenishmentCard).filter((card) => card.id);
  } catch {
    return [];
  }
}

async function writeReplenishmentCards(cards) {
  await fs.writeFile(
    replenishmentPath,
    writeCsv(replenishmentHeaders, cards.map(denormalizeReplenishmentCard)),
    "utf8"
  );
}

function nextReplenishmentId(cards) {
  const maxId = cards.reduce((max, card) => {
    const value = Number(String(card.id || "").replace(/\D/g, ""));
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 1000);
  return `KBN-${maxId + 1}`;
}

function summarizeReplenishment(cards) {
  return {
    openSignals: cards.filter((card) => card.status !== "Bin Refilled").length,
    critical: cards.filter((card) => card.priority === "Critical" && card.status !== "Bin Refilled").length,
    inProgress: cards.filter((card) => card.status === "Reorder in Progress").length,
    refilled: cards.filter((card) => card.status === "Bin Refilled").length
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

async function createReplenishmentSignal(payload) {
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
    status: "Bin Threshold Reached",
    owner: "",
    notes
  };

  await writeReplenishmentCards([...cards, card]);
  return {
    ok: true,
    message: `${card.id} added to the replenishment board.`,
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
    message: `${updatedCard.id} moved to ${status}.`,
    card: updatedCard,
    board: await replenishmentBoard()
  };
}

function assertAdminRequest(request) {
  const email = String(request.headers["x-admin-email"] || "").trim().toLowerCase();
  if (!adminEmails.has(email)) {
    throw new Error("Admin CSV access requires Gaurav or Monica signed in as admin.");
  }
}

function resolveCsvFile(key) {
  const file = csvFiles[String(key || "").trim()];
  if (!file) {
    throw new Error("Choose a valid CSV file.");
  }
  return file;
}

function validateCsvForSave(key, content) {
  const parsed = parseCsv(content);
  if (!parsed.headers.length) {
    throw new Error("CSV must include a header row.");
  }

  if (key === "parts") {
    ["SKU", "Part Name", "Category", "Available Quantity", "Metadata"].forEach((header) => {
      if (!parsed.headers.includes(header)) {
        throw new Error(`parts.csv must keep the ${header} column.`);
      }
    });
  }

  if (key === "members") {
    ["Member", "Email"].forEach((header) => {
      if (!parsed.headers.includes(header)) {
        throw new Error(`members.csv must keep the ${header} column.`);
      }
    });
  }

  if (key === "replenishment") {
    ["Id", "Part Name", "Requested Quantity", "Status"].forEach((header) => {
      if (!parsed.headers.includes(header)) {
        throw new Error(`replenishment.csv must keep the ${header} column.`);
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
    throw new Error("Two different administrators must approve CSV changes before saving.");
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
    content: await fs.readFile(file.path, "utf8")
  };
}

async function saveAdminCsv(payload) {
  const key = String(payload.file || "").trim();
  const file = resolveCsvFile(key);
  const content = String(payload.content || "");
  const approvals = validateAdminApprovals(payload);
  validateCsvForSave(key, content);
  await fs.writeFile(file.path, content.endsWith("\n") ? content : `${content}\n`, "utf8");

  if (key === "parts") {
    await syncCategoryInventory(await readParts());
  }

  return {
    ok: true,
    message: `${file.fileName} saved after ${approvals.length} admin approvals.`,
    fileName: file.fileName
  };
}

async function readCatalog() {
  const parts = await readParts();
  return {
    parts,
    categories: categoryOrder,
    reportEmail
  };
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
    type: String(user?.type || "member").trim() || "member"
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
      score += aliases.includes(term) ? 65 : 32;
      reasons.push(`${aliases.includes(term) ? "Alias" : "Metadata"} matched: ${term}`);
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

function uniqueRefinements(profiles, candidates) {
  const profileRefinements = profiles.flatMap((profile) => profile.refinements || []);
  const catalogOptions = new Map();

  candidates.forEach((candidate) => {
    const text = partSearchText(candidate.part);
    ["SATA", "SAS", "SSD", "M.2", "NVMe", "1TB", "2TB", "4TB", "10TB", "18TB", "20TB", "48GB", "80GB"].forEach((option) => {
      if (includesNormalized(text, option)) {
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
    refinements: uniqueRefinements(profiles, candidates),
    summary,
    needsAdminEvaluation: !match || match.confidence < 0.7,
    message: match
      ? "Matching results are ready. Select the closest part or add one more detail to narrow results."
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
    Status: "Pending"
  };

  await fs.appendFile(evaluationPath, writeCsv(evaluationHeaders, [row]).split("\n").slice(1).join("\n"), "utf8");
  return { ok: true, message: "Search result was sent to administrator evaluation.", row };
}

async function applyTransaction(payload) {
  const user = normalizeUser(payload.user);
  const sku = String(payload.sku || "").trim();
  const action = String(payload.action || "").trim();
  const quantity = Math.floor(Number(payload.quantity));
  const reason = String(payload.reason || "").trim();

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
    Reason: reason
  };

  await fs.appendFile(
    transactionsPath,
    writeCsv(transactionHeaders, [transaction]).split("\n").slice(1).join("\n"),
    "utf8"
  );

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
  try {
    const csv = await fs.readFile(transactionsPath, "utf8");
    return parseCsv(csv).rows;
  } catch {
    return [];
  }
}

async function managementReport(params) {
  assertValidPeriod(params.period);
  const period = params.period || "week";
  const action = String(params.action || "all").trim().toLowerCase();
  const start = periodStart(period);
  const transactions = (await readTransactions()).filter((row) => {
    const timestamp = new Date(row.Timestamp || "");
    const actionMatches = action === "all" || String(row.Action || "").toLowerCase() === action;
    const dateMatches = !start || (!Number.isNaN(timestamp.getTime()) && timestamp >= start);
    return actionMatches && dateMatches;
  });

  const byUserMap = new Map();
  const skuSet = new Set();
  let quantityMoved = 0;

  transactions.forEach((row) => {
    const email = String(row.Email || "").trim().toLowerCase();
    const key = email || row["User Name"] || "Unknown";
    const quantity = toNumber(row.Quantity);
    quantityMoved += quantity;
    if (row.SKU) skuSet.add(row.SKU);
    if (!byUserMap.has(key)) {
      byUserMap.set(key, {
        name: row["User Name"] || "Unknown",
        email: row.Email || "",
        transactions: 0,
        taken: 0,
        restocked: 0,
        skuCounts: new Map()
      });
    }
    const user = byUserMap.get(key);
    user.transactions += 1;
    if (String(row.Action || "").toLowerCase() === "take") {
      user.taken += quantity;
    }
    if (String(row.Action || "").toLowerCase() === "add") {
      user.restocked += quantity;
    }
    if (row.SKU) {
      user.skuCounts.set(row.SKU, (user.skuCounts.get(row.SKU) || 0) + quantity);
    }
  });

  const byUser = [...byUserMap.values()]
    .map((user) => ({
      name: user.name,
      email: user.email,
      transactions: user.transactions,
      taken: user.taken,
      restocked: user.restocked,
      topSku:
        [...user.skuCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || ""
    }))
    .sort((left, right) => right.transactions - left.transactions);

  const recent = transactions
    .slice()
    .sort((left, right) => new Date(right.Timestamp || 0) - new Date(left.Timestamp || 0))
    .slice(0, 12)
    .map((row) => ({
      when: formatReportTime(row.Timestamp),
      userName: row["User Name"] || "",
      email: row.Email || "",
      action: row.Action || "",
      actionLabel: String(row.Action || "").toLowerCase() === "add" ? "Restocked" : "Checked out",
      sku: row.SKU || "",
      partName: row["Part Name"] || "",
      category: row.Category || "",
      quantity: toNumber(row.Quantity),
      reason: row.Reason || ""
    }));

  return {
    ok: true,
    period,
    action,
    summary: {
      transactionCount: transactions.length,
      quantityMoved,
      uniqueUsers: byUser.length,
      uniqueSkus: skuSet.size
    },
    byUser,
    recent,
    message: `${transactions.length} movement${transactions.length === 1 ? "" : "s"} found.`
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

  await fs.appendFile(reportsPath, `${reportRow}\n`, "utf8");

  const bodyLines = [
    "Missing/Low Inventory Report",
    "",
    `Comments: ${comment}`,
    "",
    "Current Available Quantity:",
    ...inventory.columns.map((column) => `- ${column}: ${inventory.quantities[column]}`)
  ];

  const mailto =
    `mailto:${reportEmail}` +
    `?subject=${encodeURIComponent("Missing/Low Inventory Report")}` +
    `&body=${encodeURIComponent(bodyLines.join("\n"))}`;

  return {
    ok: true,
    message: "Report saved. Opening a pre-filled email draft.",
    mailto,
    reportEmail
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

  if (requestUrl.pathname === "/inventory.csv") {
    await sendCsv(response, inventoryPath, "inventory.csv");
    return;
  }

  if (requestUrl.pathname === "/parts.csv") {
    await sendCsv(response, partsPath, "parts.csv");
    return;
  }

  if (requestUrl.pathname === "/members.csv") {
    await sendCsv(response, membersPath, "members.csv");
    return;
  }

  if (requestUrl.pathname === "/transactions.csv") {
    await sendCsv(response, transactionsPath, "transactions.csv");
    return;
  }

  if (requestUrl.pathname === "/evaluation_queue.csv") {
    await sendCsv(response, evaluationPath, "evaluation_queue.csv");
    return;
  }

  if (requestUrl.pathname === "/replenishment.csv") {
    await sendCsv(response, replenishmentPath, "replenishment.csv");
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
      "Content-Type": mimeTypes[ext] || "application/octet-stream"
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
        source: "data/members.csv"
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
          action: requestUrl.searchParams.get("action")
        })
      );
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/admin/csv") {
      assertAdminRequest(request);
      sendJson(response, 200, await saveAdminCsv(await readJsonBody(request)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/analyze-part") {
      sendJson(response, 200, await analyzePart(await readJsonBody(request)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/evaluation") {
      sendJson(response, 200, await recordEvaluation(await readJsonBody(request)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/replenishment") {
      sendJson(response, 200, await createReplenishmentSignal(await readJsonBody(request)));
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

  const parts = await readParts();
  await syncCategoryInventory(parts);

  try {
    await fs.access(reportsPath);
  } catch {
    const reportHeaders = ["Timestamp", "Comments", ...Object.keys(aggregateByCategory(parts))];
    await fs.writeFile(reportsPath, reportHeaders.map(csvEscape).join(",") + "\n", "utf8");
  }

  try {
    await fs.access(transactionsPath);
  } catch {
    await fs.writeFile(transactionsPath, transactionHeaders.map(csvEscape).join(",") + "\n", "utf8");
  }

  try {
    await fs.access(evaluationPath);
  } catch {
    await fs.writeFile(evaluationPath, evaluationHeaders.map(csvEscape).join(",") + "\n", "utf8");
  }

  try {
    await fs.access(replenishmentPath);
  } catch {
    await fs.writeFile(replenishmentPath, replenishmentHeaders.map(csvEscape).join(",") + "\n", "utf8");
  }
}

ensureDataFiles()
  .then(() => {
    http.createServer(handleRequest).listen(port, () => {
      console.log(`Inventory app running at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
