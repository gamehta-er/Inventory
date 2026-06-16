const fs = require("node:fs");
const path = require("node:path");
const { logDir } = require("../config/paths");

const logPath = path.join(logDir, "app.log");

function write(level, message, meta = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...meta });
  try {
    fs.appendFileSync(logPath, `${line}\n`, "utf8");
  } catch {
    console.error(line);
  }
}

module.exports = {
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
};
