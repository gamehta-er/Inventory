const { applySearch, getAllAssets, summarizeAssets, breakdown } = require("./assets");
const { csvEscape } = require("../lib/utils");

function reportAssets(query) {
  const search = applySearch(query);
  const meaningfulKeys = Object.keys(query).filter((key) => !["actorName", "includeArchived"].includes(key) && String(query[key] || "").trim());
  const assets = query.includeArchived === "1" ? getAllAssets(true) : meaningfulKeys.length ? search.assets : getAllAssets(false);
  return {
    summary: summarizeAssets(assets),
    breakdowns: {
      status: breakdown(assets, "status"),
      location: breakdown(assets, "location").slice(0, 20),
      owner: breakdown(assets, "owner").slice(0, 20),
      borrowedLent: breakdown(assets, "borrowedLent"),
    },
    assets,
  };
}

function exportAssetsCsv(assets) {
  const headers = ["Category", "Model", "Serial", "Asset Tag", "Status", "Owner", "Location", "Usage", "NVBug", "Borrowed/Lent", "Updated At"];
  const lines = [headers.join(",")];
  for (const asset of assets) {
    lines.push([asset.category, asset.model, asset.serial, asset.assetTag, asset.status, asset.owner, asset.location, asset.usage, asset.nvbug, asset.borrowedLent, asset.updatedAt].map(csvEscape).join(","));
  }
  return lines.join("\n");
}

module.exports = {
  reportAssets,
  exportAssetsCsv,
};
