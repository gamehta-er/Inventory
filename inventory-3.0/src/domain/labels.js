const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { printJobsDir } = require("../config/paths");
const { getAsset } = require("./assets");
const logger = require("../lib/logger");

const LABEL_WIDTH_IN = 2.125;
const LABEL_HEIGHT_IN = 1;
const LABEL_WIDTH_PT = LABEL_WIDTH_IN * 72;
const LABEL_HEIGHT_PT = LABEL_HEIGHT_IN * 72;

const CODE128_PATTERNS = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100", "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110", "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100", "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000", "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110", "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000", "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100", "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010", "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100", "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110", "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", "11010000100", "11010010000", "11010011100", "1100011101011",
];

const CODE128_START_B = 104;
const CODE128_STOP = 106;

const jobs = new Map();
const queue = [];
let queueRunning = false;

function parseConfiguredPrinters() {
  const rawJson = process.env.LABEL_PRINTERS_JSON;
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (error) {
      logger.warn("invalid LABEL_PRINTERS_JSON", { error: error.message });
    }
  }

  const rawNames = String(process.env.LABEL_PRINTERS || "").trim();
  if (rawNames) {
    return rawNames.split(",").map((item, index) => ({
      id: `printer-${index + 1}`,
      name: item.trim(),
      isDefault: index === 0,
    })).filter((item) => item.name);
  }

  return [{
    id: "default-label-printer",
    name: process.env.DEFAULT_LABEL_PRINTER || "Server Label Queue",
    isDefault: true,
  }];
}

function listLabelPrinters() {
  return parseConfiguredPrinters().map((printer, index) => ({
    id: String(printer.id || `printer-${index + 1}`),
    name: String(printer.name || `Label Printer ${index + 1}`),
    enabled: printer.enabled !== false,
    isDefault: Boolean(printer.isDefault) || index === 0,
    status: printer.enabled === false ? "offline" : "online",
  }));
}

function getPrinter(printerId) {
  const printers = listLabelPrinters();
  if (printerId) {
    return printers.find((printer) => printer.id === printerId);
  }
  return printers.find((printer) => printer.isDefault) || printers[0];
}

function getLabelHealth() {
  const printers = listLabelPrinters();
  return {
    ok: true,
    queueMode: "centralized",
    dymoRequired: false,
    template: "30336",
    labelSizeIn: { width: LABEL_WIDTH_IN, height: LABEL_HEIGHT_IN },
    printersOnline: printers.filter((printer) => printer.enabled).length,
    printersTotal: printers.length,
    note: "Labels are rendered and queued on the server using the configured default queue.",
  };
}

function normalizeLabelAsset(asset) {
  const model = String(asset?.model || "").trim();
  const assetTag = String(asset?.assetTag || "").trim();
  const serial = String(asset?.serial || assetTag || "").trim();
  return {
    id: Number(asset.id),
    model,
    assetTag,
    serial,
    barcode: assetTag || serial || "INV3",
  };
}

function resolveAssets(assetIds) {
  const list = [];
  for (const id of assetIds) {
    const asset = getAsset(Number(id), true);
    if (!asset) throw new Error(`Asset not found: ${id}`);
    list.push(normalizeLabelAsset(asset));
  }
  return list;
}

function escapePdfText(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function centerXForText(text, fontSize) {
  const estimated = String(text || "").length * fontSize * 0.52;
  return Math.max(4, (LABEL_WIDTH_PT - estimated) / 2);
}

function encodeCode128B(text) {
  const value = String(text || "").trim();
  if (!value) throw new Error("Barcode value is required.");
  const codes = [CODE128_START_B];
  let checksum = CODE128_START_B;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i) - 32;
    if (code < 0 || code > 94) throw new Error(`Barcode cannot encode character: ${value[i]}`);
    codes.push(code);
    checksum += code * (i + 1);
  }
  codes.push(checksum % 103);
  codes.push(CODE128_STOP);

  const modules = [];
  codes.forEach((code) => {
    const pattern = CODE128_PATTERNS[code];
    if (!pattern) throw new Error("Invalid Code128 sequence.");
    let isBar = true;
    for (let i = 0; i < pattern.length; i += 1) {
      const previous = modules[modules.length - 1];
      if (previous && previous.bar === isBar) previous.width += 1;
      else modules.push({ bar: isBar, width: 1 });
      isBar = !isBar;
    }
  });
  return modules;
}

function barcodeRectCommands(value) {
  const modules = encodeCode128B(value);
  const moduleWidthPt = 0.78;
  const quietModules = 10;
  const barcodeHeightPt = 22;
  const y = 20;
  const totalModules = modules.reduce((sum, row) => sum + row.width, 0) + (quietModules * 2);
  const totalWidth = totalModules * moduleWidthPt;
  let x = Math.max(2, (LABEL_WIDTH_PT - totalWidth) / 2) + (quietModules * moduleWidthPt);
  let commands = "";
  modules.forEach((module) => {
    const width = module.width * moduleWidthPt;
    if (module.bar) {
      commands += `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${barcodeHeightPt.toFixed(2)} re f\n`;
    }
    x += width;
  });
  return commands;
}

function labelPageContent(asset) {
  const model = asset.model || "";
  const assetTag = asset.assetTag || "";
  const serial = asset.serial || assetTag || "";
  const barcode = asset.barcode || serial || assetTag || "INV3";

  return [
    "q",
    "0 g",
    `BT /F2 7 Tf ${centerXForText(model, 7).toFixed(2)} 61 Td (${escapePdfText(model)}) Tj ET`,
    `BT /F2 16 Tf ${centerXForText(assetTag, 16).toFixed(2)} 42 Td (${escapePdfText(assetTag)}) Tj ET`,
    barcodeRectCommands(barcode),
    `BT /F1 12 Tf ${centerXForText(serial, 12).toFixed(2)} 7 Td (${escapePdfText(serial)}) Tj ET`,
    "Q",
  ].join("\n");
}

function createPdfBuffer(assets) {
  const objects = [null];
  const createObject = (content = "") => {
    objects.push(content);
    return objects.length - 1;
  };
  const setObject = (id, content) => {
    objects[id] = content;
  };

  const catalogId = createObject();
  const pagesId = createObject();
  const fontRegularId = createObject();
  const fontBoldId = createObject();

  const pageIds = [];
  for (const asset of assets) {
    const content = labelPageContent(asset);
    const contentId = createObject(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
    const pageId = createObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${LABEL_WIDTH_PT} ${LABEL_HEIGHT_PT}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  setObject(fontRegularId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  setObject(fontBoldId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  setObject(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  setObject(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(body, "utf8");
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length}\n`;
  body += "0000000000 65535 f \n";
  for (let id = 1; id < objects.length; id += 1) {
    body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body, "utf8");
}

function renderLabelPdfBuffer(assetIds) {
  const ids = (Array.isArray(assetIds) ? assetIds : [assetIds]).map(Number).filter(Boolean);
  if (!ids.length) throw new Error("No assets selected for labels.");
  const assets = resolveAssets(ids);
  return createPdfBuffer(assets);
}

function runDispatchCommand(filePath, printerName) {
  const commandTemplate = String(process.env.LABEL_PRINT_COMMAND || "").trim();
  if (!commandTemplate) {
    return Promise.resolve({
      dispatched: false,
      message: "No LABEL_PRINT_COMMAND configured. Generated PDF is available on the server.",
    });
  }

  const quotedPath = `"${filePath.replace(/"/g, '\\"')}"`;
  const quotedPrinter = `"${String(printerName || "").replace(/"/g, '\\"')}"`;
  const command = commandTemplate
    .replace(/\{file\}/g, quotedPath)
    .replace(/\{printer\}/g, quotedPrinter);

  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, windowsHide: true });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ dispatched: true, message: stdout.trim() || "Dispatched to printer queue." });
        return;
      }
      reject(new Error(stderr.trim() || `Print dispatch command failed with code ${code}.`));
    });
  });
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    printerId: job.printerId,
    printerName: job.printerName,
    assetIds: [...job.assetIds],
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    error: job.error || "",
    message: job.message || "",
  };
}

function enqueueJob({ assetIds, printerId, actorName }) {
  const printer = getPrinter(printerId);
  if (!printer) throw new Error("Selected printer was not found.");
  if (!printer.enabled) throw new Error(`Printer "${printer.name}" is currently offline.`);

  const ids = (Array.isArray(assetIds) ? assetIds : [assetIds]).map(Number).filter(Boolean);
  if (!ids.length) throw new Error("At least one asset is required for label print.");

  const job = {
    id: crypto.randomUUID(),
    status: "queued",
    printerId: printer.id,
    printerName: printer.name,
    assetIds: ids,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    error: "",
    message: "",
    actorName: actorName || "Inventory User",
  };
  jobs.set(job.id, job);
  queue.push(job.id);
  void processQueue();
  return publicJob(job);
}

async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (queue.length) {
      const jobId = queue.shift();
      const job = jobs.get(jobId);
      if (!job || job.status !== "queued") continue;

      job.status = "printing";
      job.startedAt = new Date().toISOString();
      try {
        const pdf = renderLabelPdfBuffer(job.assetIds);
        const filePath = path.join(printJobsDir, `${job.id}.pdf`);
        fs.writeFileSync(filePath, pdf);
        const dispatch = await runDispatchCommand(filePath, job.printerName);
        job.status = "done";
        job.message = dispatch.message;
        logger.info("label print job completed", {
          jobId: job.id,
          printer: job.printerName,
          count: job.assetIds.length,
          dispatched: dispatch.dispatched,
        });
      } catch (error) {
        job.status = "failed";
        job.error = error.message || String(error);
        logger.error("label print job failed", { jobId: job.id, error: job.error });
      }
      job.completedAt = new Date().toISOString();
    }
  } finally {
    queueRunning = false;
  }
}

function getPrintJob(jobId) {
  const job = jobs.get(String(jobId || ""));
  return job ? publicJob(job) : null;
}

module.exports = {
  LABEL_WIDTH_IN,
  LABEL_HEIGHT_IN,
  getLabelHealth,
  listLabelPrinters,
  enqueueJob,
  getPrintJob,
  renderLabelPdfBuffer,
};
