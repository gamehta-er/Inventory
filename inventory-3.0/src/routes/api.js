const fs = require("node:fs");
const { getRevision, bumpRevision, logActivity } = require("../db");
const { now } = require("../lib/utils");
const { httpError, sendJson, sendText, parseBody } = require("../lib/http");
const { sessionSnapshot } = require("../domain/session");
const {
  applySearch,
  summarizeAssets,
  assetDetail,
  updateAsset,
  createAsset,
  applyAction,
  previewBulk,
  commitBulk,
} = require("../domain/assets");
const { listAssetActivity, listActivity } = require("../domain/activity");
const { listBackups, createBackup, backupPathById } = require("../domain/backups");
const { listRequests } = require("../domain/requests");
const { validateImport, commitImport } = require("../domain/imports");
const { reportAssets, exportAssetsCsv } = require("../domain/reports");
const { uploadModelImage, removeModelImage } = require("../domain/images");
const { updateCategoryFields } = require("../domain/catalog");

async function handleApi(req, res, requestUrl) {
  const query = Object.fromEntries(requestUrl.searchParams.entries());
  if (req.method === "GET" && requestUrl.pathname === "/api/v3/health") return sendJson(res, 200, { ok: true, revision: getRevision() });
  if (req.method === "GET" && requestUrl.pathname === "/api/v3/revision") return sendJson(res, 200, { revision: getRevision(), updatedAt: now() });
  if (req.method === "GET" && requestUrl.pathname === "/api/v3/session") return sendJson(res, 200, sessionSnapshot());
  if (req.method === "GET" && requestUrl.pathname === "/api/v3/search") {
    const result = applySearch(query);
    return sendJson(res, 200, { ...result, summary: summarizeAssets(result.assets), assets: result.assets, revision: getRevision() });
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/v3/assets") {
    const body = await parseBody(req);
    return sendJson(res, 200, createAsset(body));
  }

  const assetMatch = requestUrl.pathname.match(/^\/api\/v3\/assets\/(\d+)$/);
  if (req.method === "GET" && assetMatch) {
    const detail = assetDetail(Number(assetMatch[1]));
    if (!detail) throw httpError(404, "Asset not found.");
    return sendJson(res, 200, detail);
  }
  if (req.method === "PATCH" && assetMatch) {
    const body = await parseBody(req);
    return sendJson(res, 200, updateAsset(Number(assetMatch[1]), body));
  }

  const actionMatch = requestUrl.pathname.match(/^\/api\/v3\/assets\/(\d+)\/actions$/);
  if (req.method === "POST" && actionMatch) {
    const body = await parseBody(req);
    return sendJson(res, 200, applyAction(Number(actionMatch[1]), body.action, body));
  }

  const activityMatch = requestUrl.pathname.match(/^\/api\/v3\/assets\/(\d+)\/activity$/);
  if (req.method === "GET" && activityMatch) return sendJson(res, 200, { activity: listAssetActivity(Number(activityMatch[1])) });

  if (req.method === "POST" && requestUrl.pathname === "/api/v3/assets/bulk-preview") {
    const body = await parseBody(req);
    return sendJson(res, 200, previewBulk(body));
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/v3/assets/bulk-commit") {
    const body = await parseBody(req);
    return sendJson(res, 200, commitBulk(body));
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/v3/activity") return sendJson(res, 200, { activity: listActivity() });
  if (req.method === "GET" && requestUrl.pathname === "/api/v3/backups") return sendJson(res, 200, { backups: listBackups() });
  if (req.method === "POST" && requestUrl.pathname === "/api/v3/backups") {
    const body = await parseBody(req).catch(() => ({}));
    return sendJson(res, 200, createBackup(body.actorName || "Admin User"));
  }
  const backupMatch = requestUrl.pathname.match(/^\/api\/v3\/backups\/([^/]+)\/download$/);
  if (req.method === "GET" && backupMatch) {
    const backup = backupPathById(backupMatch[1]);
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${backup.filename}"`,
      "cache-control": "no-store",
    });
    fs.createReadStream(backup.fullPath).pipe(res);
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/v3/requests") return sendJson(res, 200, { requests: listRequests() });

  if (req.method === "POST" && requestUrl.pathname === "/api/v3/import/preview") {
    const body = await parseBody(req);
    const profile = body.fields?.importProfile || body.importProfile || "assets-gpu";
    const file = body.files?.file;
    const text = file ? file.data.toString("utf8") : body.fields?.csvText || body.csvText || body.text || "";
    return sendJson(res, 200, validateImport(profile, file?.filename || body.filename || "pasted.csv", text));
  }
  const commitMatch = requestUrl.pathname.match(/^\/api\/v3\/import\/(\d+)\/commit$/);
  if (req.method === "POST" && commitMatch) {
    const body = await parseBody(req);
    return sendJson(res, 200, commitImport(Number(commitMatch[1]), body.actorName || "Import User"));
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/v3/reports/assets") return sendJson(res, 200, reportAssets(query));
  if (req.method === "GET" && requestUrl.pathname === "/api/v3/reports/export") {
    const report = reportAssets(query);
    logActivity({ actorName: query.actorName || "Report User", action: "report-export", summary: "Exported report CSV", source: "reports", metadata: { rows: report.assets.length } });
    bumpRevision();
    return sendText(res, 200, exportAssetsCsv(report.assets), "text/csv; charset=utf-8");
  }

  const imageMatch = requestUrl.pathname.match(/^\/api\/v3\/asset-models\/(\d+)\/image$/);
  if (req.method === "POST" && imageMatch) {
    const body = await parseBody(req);
    return sendJson(res, 200, uploadModelImage(Number(imageMatch[1]), body.files?.image, body.fields?.actorName || "Admin User"));
  }
  if (req.method === "DELETE" && imageMatch) {
    const body = await parseBody(req).catch(() => ({}));
    return sendJson(res, 200, removeModelImage(Number(imageMatch[1]), body.actorName || "Admin User"));
  }

  const fieldSettingsMatch = requestUrl.pathname.match(/^\/api\/v3\/categories\/(\d+)\/fields$/);
  if (req.method === "PATCH" && fieldSettingsMatch) {
    const body = await parseBody(req);
    return sendJson(res, 200, updateCategoryFields(Number(fieldSettingsMatch[1]), body));
  }
  throw httpError(404, "API route not found.");
}

module.exports = {
  handleApi,
};
