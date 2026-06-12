const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { db, tx, logActivity } = require("../db");
const { uploadDir } = require("../config/paths");
const { now } = require("../lib/utils");
const { httpError } = require("../lib/http");

function uploadModelImage(modelId, file, actorName) {
  if (!file || !file.filename) throw httpError(400, "Image file is required.");
  const ext = path.extname(file.filename).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw httpError(400, "Only PNG, JPG, JPEG, or WEBP images are accepted.");
  if (file.data.length > 5 * 1024 * 1024) throw httpError(400, "Image must be 5 MB or smaller.");
  const model = db.prepare("SELECT * FROM asset_models WHERE id = ?").get(modelId);
  if (!model) throw httpError(404, "Asset model not found.");
  const safeName = `${modelId}-${crypto.randomUUID()}${ext}`;
  const diskPath = path.join(uploadDir, safeName);
  fs.writeFileSync(diskPath, file.data);
  const webPath = `/uploads/${safeName}`;
  return tx(() => {
    db.prepare("UPDATE asset_models SET image_path = ?, updated_at = ? WHERE id = ?").run(webPath, now(), modelId);
    logActivity({
      modelId,
      actorName: actorName || "Admin User",
      action: "model-image-upload",
      summary: `Updated model image for ${model.name}`,
      before: { imagePath: model.image_path || "" },
      after: { imagePath: webPath },
      reason: "Admin image upload",
    });
    return { imagePath: webPath };
  });
}

function removeModelImage(modelId, actorName) {
  const model = db.prepare("SELECT * FROM asset_models WHERE id = ?").get(modelId);
  if (!model) throw httpError(404, "Asset model not found.");
  return tx(() => {
    db.prepare("UPDATE asset_models SET image_path = NULL, updated_at = ? WHERE id = ?").run(now(), modelId);
    logActivity({
      modelId,
      actorName: actorName || "Admin User",
      action: "model-image-remove",
      summary: `Removed model image for ${model.name}`,
      before: { imagePath: model.image_path || "" },
      after: { imagePath: "" },
      reason: "Admin image removal",
    });
    return { ok: true };
  });
}

module.exports = {
  uploadModelImage,
  removeModelImage,
};
