const fs = require("node:fs");
const { getRevision, getSchemaVersion, bumpRevision, logActivity } = require("../db");
const { now } = require("../lib/utils");
const { httpError, sendJson, sendText, parseBody } = require("../lib/http");
const logger = require("../lib/logger");
const { loginBootstrap, sessionSnapshot } = require("../domain/session");
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
const { listBackups, createBackup, backupPathById, restoreBackup } = require("../domain/backups");
const { listRequests } = require("../domain/requests");
const { validateImport, commitImport } = require("../domain/imports");
const { reportAssets, exportAssetsCsv } = require("../domain/reports");
const { uploadModelImage, removeModelImage } = require("../domain/images");
const { updateCategoryFields } = require("../domain/catalog");
const {
  createLocation,
  updateLocation,
  createMember,
  updateMember,
  createModel,
  deactivateModel,
} = require("../domain/masterData");
const {
  login,
  getSession,
  requireSession,
  requireAdmin,
  actorFromSession,
  sessionCookie,
} = require("../domain/auth");
const PUBLIC_PATHS = new Set([
  "/api/v3/health",
  "/api/v3/ready",
  "/api/v3/login",
  "/api/v3/bootstrap",
]);

function isPublic(pathname, method) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (method === "GET" && pathname.startsWith("/api/v3/")) return false;
  return false;
}

async function handleApi(req, res, requestUrl) {
  const pathname = requestUrl.pathname;
  const query = Object.fromEntries(requestUrl.searchParams.entries());

  if (req.method === "GET" && pathname === "/api/v3/health") {
    return sendJson(res, 200, { ok: true, revision: getRevision() });
  }
  if (req.method === "GET" && pathname === "/api/v3/ready") {
    try {
      const version = getSchemaVersion();
      if (!version) throw new Error("schema missing");
      return sendJson(res, 200, { ok: true, schemaVersion: version, revision: getRevision() });
    } catch (error) {
      logger.error("ready check failed", { error: error.message });
      return sendJson(res, 503, { ok: false, error: "Database not ready." });
    }
  }
  if (req.method === "GET" && pathname === "/api/v3/bootstrap") {
    return sendJson(res, 200, loginBootstrap());
  }
  if (req.method === "POST" && pathname === "/api/v3/login") {
    const body = await parseBody(req);
    const session = login(body);
    res.setHeader("Set-Cookie", sessionCookie(session.token));
    return sendJson(res, 200, {
      user: {
        id: session.memberId,
        name: session.memberName,
        email: session.email,
        role: session.role,
      },
    });
  }

  if (!isPublic(pathname, req.method)) {
    const session = requireSession(req);
    req.session = session;
  }

  const session = req.session || getSession(req);
  const actor = session ? actorFromSession(session) : "System";
  const actorMemberId = session?.memberId || null;

  if (req.method === "GET" && pathname === "/api/v3/revision") return sendJson(res, 200, { revision: getRevision(), updatedAt: now() });
  if (req.method === "GET" && pathname === "/api/v3/session") return sendJson(res, 200, sessionSnapshot(session));

  if (req.method === "GET" && pathname === "/api/v3/search") {
    const result = applySearch(query);
    const body = { ...result, assets: result.assets, revision: getRevision() };
    if (result.mode !== "empty") body.summary = summarizeAssets(result.assets);
    return sendJson(res, 200, body);
  }

  if (req.method === "POST" && pathname === "/api/v3/assets") {
    requireAdmin(session);
    const body = await parseBody(req);
    return sendJson(res, 200, createAsset(body, actor));
  }

  const assetMatch = pathname.match(/^\/api\/v3\/assets\/(\d+)$/);
  if (req.method === "GET" && assetMatch) {
    const detail = assetDetail(Number(assetMatch[1]));
    if (!detail) throw httpError(404, "Asset not found.");
    return sendJson(res, 200, detail);
  }
  if (req.method === "PATCH" && assetMatch) {
    requireAdmin(session);
    const body = await parseBody(req);
    return sendJson(res, 200, updateAsset(Number(assetMatch[1]), body, actor));
  }

  const actionMatch = pathname.match(/^\/api\/v3\/assets\/(\d+)\/actions$/);
  if (req.method === "POST" && actionMatch) {
    const body = await parseBody(req);
    return sendJson(res, 200, applyAction(Number(actionMatch[1]), body.action, body, null, actor, actorMemberId));
  }

  const activityMatch = pathname.match(/^\/api\/v3\/assets\/(\d+)\/activity$/);
  if (req.method === "GET" && activityMatch) return sendJson(res, 200, { activity: listAssetActivity(Number(activityMatch[1])) });

  if (req.method === "POST" && pathname === "/api/v3/assets/bulk-preview") {
    const body = await parseBody(req);
    return sendJson(res, 200, previewBulk(body));
  }
  if (req.method === "POST" && pathname === "/api/v3/assets/bulk-commit") {
    const body = await parseBody(req);
    return sendJson(res, 200, commitBulk(body, actor));
  }

  if (req.method === "GET" && pathname === "/api/v3/activity") return sendJson(res, 200, { activity: listActivity() });
  if (req.method === "GET" && pathname === "/api/v3/backups") {
    requireAdmin(session);
    return sendJson(res, 200, { backups: listBackups() });
  }
  if (req.method === "POST" && pathname === "/api/v3/backups") {
    requireAdmin(session);
    await parseBody(req).catch(() => ({}));
    return sendJson(res, 200, createBackup(actor));
  }
  if (req.method === "POST" && pathname === "/api/v3/backups/restore") {
    requireAdmin(session);
    const body = await parseBody(req);
    return sendJson(res, 200, restoreBackup(body, actor));
  }
  const backupMatch = pathname.match(/^\/api\/v3\/backups\/([^/]+)\/download$/);
  if (req.method === "GET" && backupMatch) {
    requireAdmin(session);
    const backup = backupPathById(backupMatch[1]);
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${backup.filename}"`,
      "cache-control": "no-store",
    });
    fs.createReadStream(backup.fullPath).pipe(res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/v3/requests") return sendJson(res, 200, { requests: listRequests() });

  if (req.method === "POST" && pathname === "/api/v3/import/preview") {
    requireAdmin(session);
    const body = await parseBody(req);
    const profile = body.fields?.importProfile || body.importProfile || "assets-gpu";
    const file = body.files?.file;
    const text = file ? file.data.toString("utf8") : body.fields?.csvText || body.csvText || body.text || "";
    return sendJson(res, 200, validateImport(profile, file?.filename || body.filename || "pasted.csv", text, actor));
  }
  const commitMatch = pathname.match(/^\/api\/v3\/import\/(\d+)\/commit$/);
  if (req.method === "POST" && commitMatch) {
    requireAdmin(session);
    await parseBody(req).catch(() => ({}));
    return sendJson(res, 200, commitImport(Number(commitMatch[1]), actor));
  }

  if (req.method === "GET" && pathname === "/api/v3/reports/assets") return sendJson(res, 200, reportAssets(query));
  if (req.method === "GET" && pathname === "/api/v3/reports/export") {
    const report = reportAssets(query);
    logActivity({ actorName: actor, action: "report-export", summary: "Exported report CSV", source: "reports", metadata: { rows: report.assets.length } });
    bumpRevision();
    return sendText(res, 200, exportAssetsCsv(report.assets), "text/csv; charset=utf-8");
  }

  const imageMatch = pathname.match(/^\/api\/v3\/asset-models\/(\d+)\/image$/);
  if (req.method === "POST" && imageMatch) {
    requireAdmin(session);
    const body = await parseBody(req);
    return sendJson(res, 200, uploadModelImage(Number(imageMatch[1]), body.files?.image, actor));
  }
  if (req.method === "DELETE" && imageMatch) {
    requireAdmin(session);
    await parseBody(req).catch(() => ({}));
    return sendJson(res, 200, removeModelImage(Number(imageMatch[1]), actor));
  }

  const fieldSettingsMatch = pathname.match(/^\/api\/v3\/categories\/(\d+)\/fields$/);
  if (req.method === "PATCH" && fieldSettingsMatch) {
    requireAdmin(session);
    const body = await parseBody(req);
    body.actorName = actor;
    return sendJson(res, 200, updateCategoryFields(Number(fieldSettingsMatch[1]), body));
  }

  if (req.method === "POST" && pathname === "/api/v3/locations") {
    requireAdmin(session);
    const body = await parseBody(req);
    return sendJson(res, 200, createLocation(body, actor));
  }
  const locationMatch = pathname.match(/^\/api\/v3\/locations\/(\d+)$/);
  if (req.method === "PATCH" && locationMatch) {
    requireAdmin(session);
    const body = await parseBody(req);
    return sendJson(res, 200, updateLocation(Number(locationMatch[1]), body, actor));
  }
  if (req.method === "POST" && pathname === "/api/v3/members") {
    requireAdmin(session);
    const body = await parseBody(req);
    return sendJson(res, 200, createMember(body, actor));
  }
  const memberMatch = pathname.match(/^\/api\/v3\/members\/(\d+)$/);
  if (req.method === "PATCH" && memberMatch) {
    requireAdmin(session);
    const body = await parseBody(req);
    return sendJson(res, 200, updateMember(Number(memberMatch[1]), body, actor));
  }
  if (req.method === "POST" && pathname === "/api/v3/asset-models") {
    requireAdmin(session);
    const body = await parseBody(req);
    return sendJson(res, 200, createModel(body, actor));
  }
  const modelMatch = pathname.match(/^\/api\/v3\/asset-models\/(\d+)$/);
  if (req.method === "DELETE" && modelMatch) {
    requireAdmin(session);
    return sendJson(res, 200, deactivateModel(Number(modelMatch[1]), actor));
  }

  throw httpError(404, "API route not found.");
}

module.exports = {
  handleApi,
};
