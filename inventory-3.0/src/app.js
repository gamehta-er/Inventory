const http = require("node:http");
const { URL } = require("node:url");
const { sendJson } = require("./lib/http");
const { handleApi } = require("./routes/api");
const { serveStatic } = require("./routes/static");

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (requestUrl.pathname.startsWith("/api/v3/")) {
      await handleApi(req, res, requestUrl);
      return;
    }
    serveStatic(req, res, requestUrl);
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || "Internal server error.",
      errors: error.errors || undefined,
      preview: error.preview || undefined,
      currentRevision: error.currentRevision || undefined,
      revision: error.currentRevision || undefined,
    });
  }
}

function start({ host = process.env.HOST || "127.0.0.1", port = Number(process.env.PORT || 3003) } = {}) {
  return http.createServer(handleRequest).listen(port, host, () => {
    console.log(`Inventory 3.0 running at http://${host}:${port}`);
  });
}

module.exports = {
  handleRequest,
  start,
};
