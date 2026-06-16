const { ALIASES } = require("../config/constants");

function now() {
  return new Date().toISOString();
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function json(value) {
  return JSON.stringify(value ?? {});
}

function normalizeBug(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const matches = raw.match(/\d{5,12}/g);
  return matches ? matches.join(", ") : raw;
}

function bugLinks(value) {
  const normalized = normalizeBug(value);
  if (!normalized) return [];
  return normalized.split(/[,\s]+/).filter(Boolean).map((part) => (
    /^\d{5,12}$/.test(part)
      ? { value: part, url: `https://nvbugspro.nvidia.com/bug/${part}` }
      : { value: part, url: "" }
  ));
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function canonicalField(value) {
  const key = normalizeHeader(value);
  return ALIASES.get(key) || slugify(value).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function csvEscape(value) {
  const s = String(value ?? "");
  const needsQuote = /[",\n\r]/.test(s) || /^[=+\-@\t]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

module.exports = {
  now,
  slugify,
  safeJsonParse,
  json,
  normalizeBug,
  bugLinks,
  normalizeHeader,
  canonicalField,
  csvEscape,
};
