const fs = require("node:fs");
const path = require("node:path");
const { publicDir, uploadDir } = require("../config/paths");
const { sendText } = require("../lib/http");

function serveStatic(req, res, requestUrl) {
  let filePath;
  if (requestUrl.pathname.startsWith("/uploads/")) {
    filePath = path.join(uploadDir, path.basename(requestUrl.pathname));
  } else {
    const requested = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
    filePath = path.join(publicDir, path.normalize(requested).replace(/^(\.\.[/\\])+/, ""));
  }
  if (!filePath.startsWith(publicDir) && !filePath.startsWith(uploadDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendText(res, 404, "Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

module.exports = {
  serveStatic,
};
