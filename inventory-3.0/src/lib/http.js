const path = require("node:path");

function httpError(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 12 * 1024 * 1024) {
        reject(httpError(413, "Request is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const type = req.headers["content-type"] || "";
      if (type.includes("application/json")) {
        try {
          resolve(buffer.length ? JSON.parse(buffer.toString("utf8")) : {});
        } catch {
          reject(httpError(400, "Invalid JSON."));
        }
      } else if (type.includes("multipart/form-data")) {
        resolve(parseMultipart(buffer, type));
      } else {
        resolve({ text: buffer.toString("utf8") });
      }
    });
    req.on("error", reject);
  });
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) throw httpError(400, "Missing multipart boundary.");
  const boundaryValue = boundaryMatch[1].trim().replace(/^"|"$/g, "");
  const boundary = `--${boundaryValue}`;
  const raw = buffer.toString("binary");
  const parts = raw.split(boundary).slice(1, -1);
  const fields = {};
  const files = {};
  for (const part of parts) {
    const clean = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const split = clean.indexOf("\r\n\r\n");
    if (split < 0) continue;
    const headerText = clean.slice(0, split);
    const bodyBinary = clean.slice(split + 4);
    const nameMatch = headerText.match(/name="([^"]+)"/) || headerText.match(/name=([^;\r\n]+)/);
    if (!nameMatch) continue;
    const name = String(nameMatch[1]).trim();
    const filenameMatch = headerText.match(/filename="([^"]*)"/) || headerText.match(/filename=([^;\r\n]*)/);
    const filename = filenameMatch ? String(filenameMatch[1] || "").trim() : "";
    if (filename) {
      files[name] = { filename: path.basename(filename), data: Buffer.from(bodyBinary, "binary") };
    } else {
      fields[name] = Buffer.from(bodyBinary, "binary").toString("utf8");
    }
  }
  return { fields, files };
}

module.exports = {
  httpError,
  sendJson,
  sendText,
  parseBody,
};
