const {
  STATUSES,
  COMMON_FIELDS,
  CATEGORY_PROFILES,
  IMPORT_PROFILES,
} = require("../config/constants");
const { csvEscape } = require("../lib/utils");
const { httpError } = require("../lib/http");

const PROFILE_CATEGORY_SLUGS = {
  "assets-systems": ["server", "workstation", "pc"],
  "assets-mobile-monitor-cable-misc": ["mobile", "monitor", "cable", "misc"],
  "e-waste-broken": ["e-waste", "broken-devices"],
};

const FIELD_HELP = {
  category: {
    description: "Category name as shown in Inventory. Required when the import profile accepts multiple categories.",
    example: "GPU",
    acceptedValues: "",
  },
  model: {
    description: "Hardware model name. New models are created automatically during import.",
    example: "RTX Pro 6000",
    acceptedValues: "",
  },
  serial: {
    description: "Manufacturer serial number. Must be unique across active assets when provided.",
    example: "SN-GPU-EXAMPLE-001",
    acceptedValues: "",
  },
  assetTag: {
    description: "Lab asset tag printed on labels. Must be unique.",
    example: "GPU-900001",
    acceptedValues: "",
  },
  status: {
    description: "Current lifecycle status for the asset.",
    example: "Ready to Deploy",
    acceptedValues: STATUSES.join(", "),
  },
  owner: {
    description: "Owner or assignee display name. Matched to team members; created if new.",
    example: "Alex Rivera",
    acceptedValues: "",
  },
  location: {
    description: "Storage or deployment location. Matched to locations; created if new.",
    example: "Santa Clara E / Racks A1-A5",
    acceptedValues: "",
  },
  usage: {
    description: "Free-text usage note (project, bench, loan context).",
    example: "Validation bench",
    acceptedValues: "",
  },
  nvbug: {
    description: "NVBug number or comma-separated bug IDs tied to the asset.",
    example: "45678901",
    acceptedValues: "",
  },
  borrowedLent: {
    description: "Borrow/lend tracking flag when applicable.",
    example: "Borrowed",
    acceptedValues: "Borrowed, Lent, or leave blank",
  },
  notes: {
    description: "Additional notes stored on the asset record.",
    example: "Imported from lab spreadsheet",
    acceptedValues: "",
  },
  name: {
    description: "Person or organization display name.",
    example: "Alex Rivera",
    acceptedValues: "",
  },
  email: {
    description: "Email address used to match or create a team member.",
    example: "alex.rivera@lab-inventory.example",
    acceptedValues: "",
  },
  username: {
    description: "Optional short username for the team member.",
    example: "arivera",
    acceptedValues: "",
  },
  quantity: {
    description: "Quantity for consumable-style assets.",
    example: "25",
    acceptedValues: "Positive number",
  },
  requester: {
    description: "Person who requested the consumable item.",
    example: "Alex Rivera",
    acceptedValues: "",
  },
};

const CATEGORY_FIELD_HELP = {
  arriveDate: { description: "Date the asset arrived in the lab.", example: "2026-01-15", acceptedValues: "YYYY-MM-DD or MM/DD/YYYY" },
  setupDate: { description: "Date the asset was set up or commissioned.", example: "2026-02-01", acceptedValues: "YYYY-MM-DD or MM/DD/YYYY" },
  chip: { description: "GPU chip or silicon name.", example: "Blackwell", acceptedValues: "" },
  sku: { description: "SKU or internal part identifier.", example: "SK-EX-001", acceptedValues: "" },
  gpuClass: { description: "GPU product class.", example: "Data Center", acceptedValues: "GeForce, RTX, Data Center, Professional" },
  edition: { description: "Edition or variant label.", example: "Lab Edition", acceptedValues: "" },
  maker: { description: "Manufacturer or vendor name.", example: "NVIDIA", acceptedValues: "" },
  openPartNo: { description: "Open part number for DPU/NIC inventory.", example: "OPN-9000-0001", acceptedValues: "" },
  psid: { description: "PSID identifier when tracked.", example: "MT_0000000001", acceptedValues: "" },
  opnFamily: { description: "OPN family grouping.", example: "ConnectX-7", acceptedValues: "" },
  ip: { description: "Network address when the asset is networked.", example: "10.34.1.50", acceptedValues: "" },
  cpu: { description: "CPU model string.", example: "Intel Xeon Gold 6430", acceptedValues: "" },
  motherBoard: { description: "Motherboard model.", example: "X13DEI", acceptedValues: "" },
  memory: { description: "Installed memory summary.", example: "512 GB DDR5", acceptedValues: "" },
  disk: { description: "Storage configuration.", example: "2x 1.92 TB NVMe", acceptedValues: "" },
  nvAssetNumber: { description: "Internal NV asset number when assigned.", example: "NV-ASSET-10001", acceptedValues: "" },
  gpu: { description: "Installed GPU summary for PC/mobile assets.", example: "RTX 5090", acceptedValues: "" },
  psu: { description: "Power supply details.", example: "1200W ATX", acceptedValues: "" },
  type: { description: "Switch fabric type.", example: "ETH", acceptedValues: "ETH, IB, RJ45" },
  resolution: { description: "Display resolution for mobile devices.", example: "2560x1600", acceptedValues: "" },
  nativeResolution: { description: "Native panel resolution.", example: "3840x2160", acceptedValues: "" },
  refreshRate: { description: "Panel refresh rate.", example: "144 Hz", acceptedValues: "" },
  connector: { description: "Primary display connector.", example: "DisplayPort 1.4", acceptedValues: "" },
  features: { description: "Notable display features.", example: "HDR, G-SYNC", acceptedValues: "" },
  oldLocation: { description: "Previous location before move.", example: "Santa Clara E / Cage 3", acceptedValues: "" },
  problem: { description: "Problem description for broken-device queue.", example: "No POST after power event", acceptedValues: "" },
  eWastePending: { description: "Whether the device is queued for e-waste.", example: "Yes", acceptedValues: "Yes, No" },
};

function categoryBySlug(slug) {
  return CATEGORY_PROFILES.find((profile) => profile.slug === slug) || null;
}

function categorySlugsForProfile(profile) {
  if (profile.categorySlug) return [profile.categorySlug];
  return PROFILE_CATEGORY_SLUGS[profile.id] || [];
}

function fieldMeta(key, label, type, required, options) {
  const help = FIELD_HELP[key] || CATEGORY_FIELD_HELP[key] || {
    description: `${label} value for this profile.`,
    example: "",
    acceptedValues: options?.length ? options.join(", ") : "",
  };
  return {
    key,
    label,
    header: label,
    type,
    required: Boolean(required),
    description: help.description,
    example: help.example || "",
    acceptedValues: help.acceptedValues || (options?.length ? options.join(", ") : ""),
  };
}

function referenceColumns(profile) {
  if (profile.referenceType === "locations") {
    return [fieldMeta("location", "Location", "text", true)];
  }
  if (profile.referenceType === "owners") {
    return [
      fieldMeta("name", "Name", "text", true),
      fieldMeta("email", "Email", "text", true),
      fieldMeta("username", "Username", "text", false),
    ];
  }
  if (profile.referenceType === "suppliers") {
    return [fieldMeta("name", "Name", "text", true)];
  }
  return null;
}

function columnsForProfile(profile) {
  const reference = referenceColumns(profile);
  if (reference) return reference;

  const required = new Set(profile.required || []);
  const columns = [];
  const seen = new Set();

  const push = (meta) => {
    if (seen.has(meta.key)) return;
    seen.add(meta.key);
    columns.push(meta);
  };

  if (!profile.categorySlug) {
    push(fieldMeta("category", "Category", "select", required.has("category")));
  }

  for (const [key, label, type] of COMMON_FIELDS) {
    if (key === "category") continue;
    const include = required.has(key) || ["model", "serial", "assetTag", "status", "location", "owner", "nvbug", "usage", "notes"].includes(key);
    if (include) push(fieldMeta(key, label, type, required.has(key)));
  }

  for (const slug of categorySlugsForProfile(profile)) {
    const category = categoryBySlug(slug);
    if (!category) continue;
    for (const field of category.fields) {
      const [key, label, type, fieldRequired, options] = field;
      push(fieldMeta(key, label, type, required.has(key) || Boolean(fieldRequired), options));
    }
  }

  return columns;
}

function sampleValue(key, context) {
  const map = {
    category: context.categoryName,
    model: context.model,
    serial: context.serial,
    assetTag: context.assetTag,
    status: context.status,
    owner: context.owner || "",
    location: context.location,
    usage: context.usage || "",
    nvbug: context.nvbug || "",
    borrowedLent: context.borrowedLent || "",
    notes: context.notes || "",
    name: context.name || "Alex Rivera",
    email: context.email || "alex.rivera@lab-inventory.example",
    username: context.username || "arivera",
    quantity: context.quantity || "10",
    requester: context.requester || "Alex Rivera",
    arriveDate: "2026-01-15",
    setupDate: "2026-02-01",
    chip: "Blackwell",
    sku: "SK-EX-001",
    gpuClass: "Data Center",
    edition: "Lab Edition",
    maker: "NVIDIA",
    openPartNo: "OPN-9000-0001",
    psid: "MT_0000000001",
    opnFamily: "ConnectX-7",
    ip: "10.34.1.50",
    cpu: "Intel Xeon Gold 6430",
    motherBoard: "X13DEI",
    memory: "512 GB DDR5",
    disk: "2x 1.92 TB NVMe",
    nvAssetNumber: "NV-ASSET-10001",
    gpu: "RTX 5090",
    psu: "1200W ATX",
    type: "ETH",
    resolution: "2560x1600",
    nativeResolution: "3840x2160",
    refreshRate: "144 Hz",
    connector: "DisplayPort 1.4",
    features: "HDR, G-SYNC",
    oldLocation: "Santa Clara E / Cage 3",
    problem: "No POST after power event",
    eWastePending: "Yes",
  };
  return map[key] ?? "";
}

function sampleContextsForProfile(profile) {
  if (profile.referenceType === "locations") {
    return [
      {
        title: "Example rack location",
        description: "Creates or matches a location by full display name.",
        values: { location: "Santa Clara E / Racks A1-A5" },
      },
      {
        title: "Example bench location",
        description: "Use the same location format you expect operators to pick in the UI.",
        values: { location: "Santa Clara E / Bench 12" },
      },
    ];
  }
  if (profile.referenceType === "owners") {
    return [
      {
        title: "Example team member",
        description: "Imports a user/owner record used by asset assignment and checkout flows.",
        values: { name: "Alex Rivera", email: "alex.rivera@lab-inventory.example", username: "arivera" },
      },
      {
        title: "Example guest-style owner",
        description: "Email is used to match existing members; username is optional.",
        values: { name: "Lab Guest", email: "lab.guest@lab-inventory.example", username: "labguest" },
      },
    ];
  }
  if (profile.referenceType === "suppliers") {
    return [
      {
        title: "Example supplier",
        description: "Reference data row for manufacturer or supplier tracking.",
        values: { name: "NVIDIA Lab Supplier" },
      },
    ];
  }

  const slugs = categorySlugsForProfile(profile);
  if (slugs.length > 1) {
    return slugs.slice(0, 2).map((slug, index) => {
      const category = categoryBySlug(slug);
      const prefix = category?.prefix || "INV";
      return {
        title: `Example ${category?.name || slug} asset`,
        description: index === 0
          ? "Shows a ready-to-deploy row with the required fields for this category."
          : "Shows an in-use row with owner and optional tracking fields filled in.",
        values: {
          category: category?.name || slug,
          model: category?.models?.[0] || "Lab Model",
          serial: `SN-${prefix}-EXAMPLE-${String(index + 1).padStart(3, "0")}`,
          assetTag: `${prefix}-90000${index + 1}`,
          status: index === 0 ? "Ready to Deploy" : "In Use",
          location: index === 0 ? "Santa Clara E / Racks A1-A5" : "Santa Clara E / Bench 12",
          owner: index === 0 ? "" : "Alex Rivera",
          nvbug: index === 0 ? "" : "45678901",
          usage: index === 0 ? "" : "Validation bench",
          notes: "Sample import row — replace with real inventory data.",
          openPartNo: slug === "dpu" ? "OPN-9000-0001" : "",
          quantity: slug === "low-price-consumables" ? "25" : "",
          problem: slug === "broken-devices" ? "No POST after power event" : "",
          eWastePending: slug === "broken-devices" ? "Yes" : "",
        },
      };
    });
  }

  const category = categoryBySlug(profile.categorySlug || slugs[0] || "gpu");
  const prefix = category?.prefix || "INV";
  const modelA = category?.models?.[0] || "Lab Model";
  const modelB = category?.models?.[1] || modelA;
  return [
    {
      title: `Example ${category?.name || "asset"} ready to deploy`,
      description: "Includes all required columns for this profile plus common optional fields.",
      values: {
        category: category?.name || "",
        model: modelA,
        serial: `SN-${prefix}-EXAMPLE-001`,
        assetTag: `${prefix}-900001`,
        status: "Ready to Deploy",
        location: "Santa Clara E / Racks A1-A5",
        chip: profile.categorySlug === "gpu" ? "Blackwell" : "",
        sku: ["gpu", "converged-gpu-dpu"].includes(profile.categorySlug) ? "SK-EX-001" : "",
        openPartNo: profile.categorySlug === "dpu" ? "OPN-9000-0001" : "",
        quantity: profile.id === "low-price-consumables" ? "25" : "",
        notes: "Sample import row — replace with real inventory data.",
      },
    },
    {
      title: `Example ${category?.name || "asset"} in use`,
      description: "Shows owner, NVBug, and usage fields for active assignments.",
      values: {
        category: category?.name || "",
        model: modelB,
        serial: `SN-${prefix}-EXAMPLE-002`,
        assetTag: `${prefix}-900002`,
        status: "In Use",
        location: "Santa Clara E / Bench 12",
        owner: "Alex Rivera",
        nvbug: "45678901",
        usage: "Validation bench",
        problem: profile.id === "e-waste-broken" ? "No POST after power event" : "",
        eWastePending: profile.id === "e-waste-broken" ? "Yes" : "",
      },
    },
  ];
}

function buildSampleCsv(columns, rowContexts) {
  const headers = columns.map((col) => col.header);
  const lines = [headers.map(csvEscape).join(",")];
  for (const context of rowContexts) {
    const cells = columns.map((col) => csvEscape(sampleValue(col.key, context.values)));
    lines.push(cells.join(","));
  }
  return `${lines.join("\n")}\n`;
}

function getImportSample(profileId) {
  const profile = IMPORT_PROFILES.find((entry) => entry.id === profileId);
  if (!profile) throw httpError(400, "Unknown import profile.");

  const columns = columnsForProfile(profile);
  const rowContexts = sampleContextsForProfile(profile);
  const sampleRows = rowContexts.map((context, index) => ({
    rowNumber: index + 2,
    title: context.title,
    description: context.description,
    values: Object.fromEntries(columns.map((col) => [col.key, sampleValue(col.key, context.values)]).filter(([, value]) => String(value || "").trim())),
  }));

  const notes = [
    "Row 1 must be the header row. Column names are flexible — Inventory maps common aliases like \"Asset Tag\" and \"Serial No.\" automatically.",
    "Each data row represents one asset or reference record to create during commit.",
    "Delete the sample rows before importing production data, or replace them with your real inventory.",
  ];
  if (!profile.referenceType && !profile.categorySlug) {
    notes.push(`This profile accepts categories: ${categorySlugsForProfile(profile).map((slug) => categoryBySlug(slug)?.name || slug).join(", ")}.`);
  }
  if (profile.referenceType) {
    notes.push("This profile imports reference data only — no assets are created.");
  }

  return {
    profile: profile.id,
    profileLabel: profile.label,
    filename: `inventory-3-sample-${profile.id}.csv`,
    columns,
    sampleRows,
    rowNotes: notes,
    csv: buildSampleCsv(columns, rowContexts),
  };
}

module.exports = {
  getImportSample,
};
