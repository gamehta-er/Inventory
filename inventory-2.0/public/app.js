const state = {
  snapshot: null,
  view: "command",
  theme: localStorage.getItem("inventory-2.0-theme") || "light",
  currentUser: readSavedUser(),
  selectedSku: "",
  operationMode: "checkout",
  domainGroups: [],
  domainLabel: "",
  domainFilters: {},
  deviceDomains: null,
  selectedDeviceDomainSlug: "converged-gpu-dpu",
  deviceFilters: {},
  strictSearch: {
    query: "",
    filters: {},
    result: null,
    detail: null,
    detailTab: "overview",
    loading: false,
    error: ""
  },
  assetEditErrors: {},
  selectedSearchAssets: new Set(),
  actionModal: null,
  labelModal: null,
  report: null,
  reportFilters: {},
  reportLoading: false,
  reportError: "",
  importPreview: null,
  importCsvText: "",
  importFileName: "",
  importFileSize: 0,
  importProfile: "assets-gpu",
  importPasteOpen: false,
  activityFilters: {
    asset: "",
    action: "",
    actor: "",
    date: ""
  }
};

const viewCopy = {
  command: {
    title: "Search",
    description: "Find one asset, one device family, or one exact identifier without extra noise.",
    filters: false,
    inspector: false,
    metrics: false
  },
  import: {
    title: "Import",
    description: "Choose a CSV file, preview the rows, then commit only after validation is clean.",
    filters: false,
    inspector: false,
    metrics: false
  },
  devices: {
    title: "Parts Catalog",
    description: "Browse part families through focused records, field-level filters, and administrator rules.",
    filters: false,
    inspector: false,
    metrics: false
  },
  operations: {
    title: "Stock Workbench",
    description: "Scan, select, check out, and receive catalog records with a complete reason trail.",
    filters: true,
    inspector: true,
    metrics: true
  },
  replenishment: {
    title: "Requests",
    description: "Open support, transfer, repair, restock, and e-waste work.",
    filters: false,
    inspector: false,
    metrics: false
  },
  audit: {
    title: "Activity",
    description: "Trace every import, edit, lifecycle change, request, checkout, checkin, and label print.",
    filters: false,
    inspector: false,
    metrics: false
  },
  reports: {
    title: "Reports",
    description: "Granular management views with drilldown filters and export.",
    filters: false,
    inspector: false,
    metrics: false
  },
  governance: {
    title: "Data Quality",
    description: "Improve search accuracy, label mappings, aliases, and reference readiness.",
    filters: true,
    inspector: true,
    metrics: true
  },
  system: {
    title: "Admin",
    description: "Imports, backups, lifecycle settings, and field guidance.",
    filters: false,
    inspector: false,
    metrics: false
  }
};

const statusOptions = ["Ready to Deploy", "Idle", "In Use", "Broken", "EOL", "E-waste Pending", "E-Wasted", "Disposed", "Archived"];
const borrowedOptions = ["", "Borrowed", "Lent", "In Stock"];
const buildingOptions = ["Santa Clara Building R", "Santa Clara Building E", "Santa Clara Building S"];
const importProfiles = [
  { key: "assets-gpu", label: "Assets - GPU", hint: "GPU assets with model, serial or asset tag, status, owner, location, and GPU fields." },
  { key: "assets-dpu", label: "Assets - DPU", hint: "DPU/NIC assets with open part number, PSID, OPN family, and serial fields." },
  { key: "assets-converged", label: "Assets - Converged GPU+DPU", hint: "Combined accelerator assets with model, serial, SKU, edition, and lifecycle fields." },
  { key: "assets-systems", label: "Assets - Server/Workstation/PC", hint: "Systems with IP, CPU, motherboard, memory, disk, and owner/location fields." },
  { key: "assets-switch", label: "Assets - Switch", hint: "Network switch assets with IP/type and serial-tracked lifecycle fields." },
  { key: "assets-peripheral", label: "Assets - Mobile/Monitor/Cable/MISC", hint: "Peripheral or miscellaneous assets with category-specific optional fields." },
  { key: "consumables", label: "Low-price Consumables", hint: "Quantity-based items where quantity is required and serial is optional." },
  { key: "disposition", label: "E-Waste/Broken Devices", hint: "Disposition and repair queue records with reason/problem notes." },
  { key: "locations", label: "Locations", hint: "Location reference values used by asset dropdowns and filters." },
  { key: "users", label: "Users/Owners", hint: "Owner or assignee reference values for assignment workflows." },
  { key: "vendors", label: "Manufacturers/Suppliers", hint: "Manufacturer and supplier reference data." }
];

const teamMembers = [
  { name: "Armin Khosravi", email: "akhosravi@nvidia.com" },
  { name: "Ben Siemens", email: "bsiemens@nvidia.com" },
  { name: "Chris David", email: "cdavid@nvidia.com" },
  { name: "Denny Srun", email: "dsrun@nvidia.com" },
  { name: "Gaurav Mehta", email: "gamehta@nvidia.com" },
  { name: "Gladson Barbosa", email: "gbarbosa@nvidia.com" },
  { name: "Ilia Makeev", email: "imakeev@nvidia.com" },
  { name: "James Taylor", email: "jataylor@nvidia.com" },
  { name: "Javier Marquez", email: "jmarquez@nvidia.com" },
  { name: "Jiqing Wang", email: "jqwang@nvidia.com" },
  { name: "Karthikeyan Somasundaram", email: "ksomasundaram@nvidia.com" },
  { name: "Kevin Okubo", email: "kokubo@nvidia.com" },
  { name: "Leland Gee", email: "lgee@nvidia.com" },
  { name: "Linh Morales", email: "lmorales@nvidia.com" },
  { name: "Monica Martin", email: "monicam@nvidia.com" },
  { name: "Vince DeMaso", email: "vdemaso@nvidia.com" },
  { name: "Zachariah Zachariah", email: "zzachariah@nvidia.com" },
  { name: "Igor Margulis", email: "imargulis@nvidia.com" }
];

const generalFields = [
  { name: "Status", required: true, instruction: "Select one status: In Use, Idle, Broken, or E-waste Pending. If the right status is unclear, leave the status open and explain it in Notes." },
  { name: "Owner", required: true, instruction: "Required for In Use records. Use #imargulis-staff or the assigned team queue; Idle, Broken, and E-waste Pending records may stay unassigned." },
  { name: "NVBug #", instruction: "Record the latest NVBug, purchase, transfer, repair, or ownership reference for the device." },
  { name: "Stamp", instruction: "Use the date the related ticket closed or the latest logged edit date." },
  { name: "Location", required: true, instruction: "Use Santa Clara Building R, Building E, or Building S with lab, rack, cabinet, drawer, cube, or storage detail." },
  { name: "Usage", instruction: "Project or workflow using the device, such as validation, performance, lab bring-up, automation, or shared pool." },
  { name: "Setup/Arrive Date", instruction: "Use setup date for installed devices or arrive date for received devices. Leave blank when it does not apply." },
  { name: "Borrowed/Lent", instruction: "Mark Borrowed for assets from outside #imargulis-staff or Lent for assets loaned outside the team. Put person/team details in Notes." },
  { name: "Notes", instruction: "Add details that help a teammate understand exceptions, ownership, recovery work, or unusual device state." }
];

const domainDefinitions = {
  GPU: {
    label: "GPU",
    groups: ["GPU"],
    description: "Graphics cards and accelerator inventory.",
    fields: [
      { name: "Category", required: true, instruction: "Use GPU for graphics and accelerator cards." },
      { name: "Model", required: true, instruction: "Marketing name of the GPU. Use TBD only for unannounced hardware." },
      { name: "Serial No.", required: true, instruction: "Serial number from the device label or authorized system query." },
      ...generalFields,
      { name: "Chip", instruction: "Chip name from label, lookup table, or authorized hardware query." },
      { name: "SKU", instruction: "GPU SKU from label, lookup table, or authorized hardware query." },
      { name: "GPU Class", instruction: "Class such as GeForce, Tesla, Quadro, RTX, or data center accelerator." },
      { name: "Edition", instruction: "Revision or build such as TS1, TS2, TS3, FE, Retail, or equivalent." },
      { name: "Maker", instruction: "Manufacturer or board vendor." }
    ],
    filters: ["Model", "Serial No.", "Status", "Owner", "Building", "Usage", "Borrowed/Lent", "Chip", "SKU", "GPU Class", "Edition", "Maker"]
  },
  DPU: {
    label: "DPU",
    groups: ["Network Card"],
    description: "DPU and NIC-style networking devices.",
    fields: [
      { name: "Category", required: true, instruction: "Use DPU or NIC for BlueField and ConnectX-style devices." },
      { name: "Model", required: true, instruction: "Use one of BF2, BF3, CX-5, CX-6, or CX-7." },
      { name: "Serial No.", required: true, instruction: "Serial number from label or authorized system query." },
      ...generalFields,
      { name: "Open Part No.", required: true, instruction: "External part number from label or authorized firmware query." },
      { name: "PSID", instruction: "PSID from authorized firmware tooling." },
      { name: "OPN Family", instruction: "DPU or NIC family name." },
      { name: "Edition", instruction: "Hardware revision such as A0, A1, B4, or equivalent." },
      { name: "Production Key/Development Key", instruction: "Configured key state when applicable." }
    ],
    filters: ["Model", "Serial No.", "Status", "Owner", "Building", "Usage", "Open Part No.", "PSID", "OPN Family", "Edition", "Production Key/Development Key"]
  },
  "Converged GPU + DPU": {
    label: "Converged GPU + DPU",
    groups: ["GPU", "Network Card", "Transposer"],
    description: "Integrated accelerator platforms.",
    fields: [
      { name: "Category", required: true, instruction: "Use the converged platform category for combined GPU + DPU devices." },
      { name: "Model", required: true, instruction: "Use one of the defined enum values, such as A100+BF2 or A30+BF2." },
      { name: "Serial No.", required: true, instruction: "Serial number of the device from label or authorized system query." },
      ...generalFields,
      { name: "SKU", instruction: "Platform SKU when available." },
      { name: "Edition", instruction: "Revision of the device, for example TS1 or TS2." }
    ],
    filters: ["Model", "Serial No.", "Status", "Owner", "Building", "Usage", "Setup Date", "Borrowed/Lent", "SKU", "Edition"]
  },
  Server: {
    label: "Server",
    groups: ["Server"],
    description: "Lab servers and shared compute systems.",
    fields: [
      { name: "Category", required: true, instruction: "Use Server for rack, lab, and shared compute systems." },
      { name: "Model", required: true, instruction: "Model including manufacturer brand." },
      { name: "Serial No.", required: true, instruction: "System serial from chassis label or authorized OS query." },
      ...generalFields,
      { name: "IP", instruction: "Company network IP when the server is reachable on the lab network." },
      { name: "CPU", instruction: "CPU model and frequency when known." },
      { name: "Mother Board", instruction: "Motherboard brand and model when available." },
      { name: "Memory", instruction: "Memory type, size, and quantity." },
      { name: "Disk", instruction: "Disk type, capacity, and quantity." }
    ],
    filters: ["Model", "Serial No.", "Status", "Owner", "Building", "Usage", "IP", "CPU", "Memory", "Disk", "Borrowed/Lent"]
  },
  Workstation: {
    label: "Workstation",
    groups: ["WorkStation", "Workstation"],
    description: "Personal or team lab workstations.",
    fields: [
      { name: "Category", required: true, instruction: "Use Workstation or equivalent desktop workstation category." },
      { name: "Model", required: true, instruction: "Model including manufacturer brand." },
      { name: "Serial No.", required: true, instruction: "System serial from chassis label or authorized OS query." },
      ...generalFields,
      { name: "IP", instruction: "Network IP when assigned." },
      { name: "CPU", instruction: "CPU model and frequency." },
      { name: "Mother Board", instruction: "Motherboard brand and model." },
      { name: "Memory", instruction: "Memory type, size, and quantity." },
      { name: "Disk", instruction: "Disk type, capacity, and quantity." }
    ],
    filters: ["Model", "Serial No.", "Status", "Owner", "Building", "Usage", "IP", "CPU", "Memory", "Disk", "Borrowed/Lent"]
  },
  PC: {
    label: "PC",
    groups: ["PC"],
    description: "Testing PCs and bench systems.",
    fields: [
      { name: "Category", required: true, instruction: "Use PC for testing PCs and bench systems." },
      { name: "Model", required: true, instruction: "For DIY PCs, use the motherboard model." },
      { name: "Serial No.", required: true, instruction: "For DIY PCs, use motherboard serial number." },
      ...generalFields,
      { name: "CPU", required: true, instruction: "CPU model and base frequency." },
      { name: "Mother Board", instruction: "Motherboard brand and model." },
      { name: "GPU", instruction: "Installed GPU marketing name when stable; leave blank if frequently changed." },
      { name: "Memory", instruction: "Memory specification, stick capacity, and quantity." },
      { name: "Disk", instruction: "Disk type, capacity, and quantity." },
      { name: "PSU", instruction: "Power supply brand and rated output." }
    ],
    filters: ["Model", "Serial No.", "Status", "Owner", "Building", "Usage", "CPU", "Mother Board", "GPU", "Memory", "Disk", "PSU"]
  },
  Switch: {
    label: "Switch",
    groups: ["Switch"],
    description: "Network switches and fabric devices.",
    fields: [
      { name: "Category", required: true, instruction: "Use Switch for network switches." },
      { name: "Model", required: true, instruction: "Switch model including manufacturer brand." },
      { name: "Serial No.", required: true, instruction: "Serial number from device label." },
      ...generalFields,
      { name: "IP", instruction: "Company network IP when assigned." },
      { name: "Type", instruction: "Network type: ETH, IB, or RJ45." }
    ],
    filters: ["Model", "Serial No.", "Status", "Owner", "Building", "Usage", "IP", "Type", "Borrowed/Lent"]
  },
  Mobile: {
    label: "Mobile",
    groups: ["Mobile"],
    description: "Phones, tablets, laptops, and accessories.",
    fields: [
      { name: "Category", required: true, instruction: "Device category such as Notebook, Cell Phone, Tablet, or Accessory." },
      { name: "Model", required: true, instruction: "Model of the mobile device." },
      { name: "Serial No.", required: true, instruction: "Serial number from label; IMEI may be used for phones when appropriate." },
      ...generalFields,
      { name: "Maker", instruction: "Manufacturer." },
      { name: "CPU", instruction: "CPU model and frequency for laptops." },
      { name: "Memory", instruction: "RAM/ROM for phones and tablets, or total memory for laptops." },
      { name: "GPU", instruction: "Laptop graphics card marketing name when applicable." },
      { name: "Disk", instruction: "Storage capacity for laptops." },
      { name: "Resolution", instruction: "Native resolution such as 3840*2160." }
    ],
    filters: ["Category", "Model", "Serial No.", "Status", "Owner", "Building", "Usage", "Maker", "CPU", "Memory", "GPU", "Disk", "Resolution"]
  },
  Monitor: {
    label: "Monitor",
    groups: ["Monitor"],
    description: "Displays and visual test equipment.",
    fields: [
      { name: "Category", required: true, instruction: "Use Monitor for displays." },
      { name: "Model", required: true, instruction: "Monitor model." },
      { name: "Serial No.", required: true, instruction: "Serial number from device label." },
      ...generalFields,
      { name: "Maker", instruction: "Manufacturer." },
      { name: "Native Resolution", required: true, instruction: "Native resolution such as 2560*1440 or 3840*2160." },
      { name: "Connector", instruction: "Supported output interfaces, such as HDMI+DP." },
      { name: "Features", instruction: "Special features such as G-Sync, FreeSync, HDR, or Reflex Indicator." }
    ],
    filters: ["Model", "Serial No.", "Status", "Owner", "Building", "Usage", "Maker", "Native Resolution", "Connector", "Features"]
  },
  Cable: {
    label: "Cable",
    groups: ["Cables"],
    description: "Tracked lab cables and interconnects.",
    fields: [
      { name: "Category", required: true, instruction: "Use Cable for tracked cables and interconnects." },
      { name: "Model", required: true, instruction: "Cable model from label or authorized cable query." },
      { name: "Serial No.", required: true, instruction: "Serial number from device label." },
      ...generalFields
    ],
    filters: ["Model", "Serial No.", "Status", "Owner", "Building", "Usage", "Borrowed/Lent"]
  },
  Miscellaneous: {
    label: "Miscellaneous",
    groups: ["MISC", "Miscellaneous", "Hard Disk", "PDU", "PSU", "Riser Card", "Transposer", "Water Cool Hose"],
    description: "Other tracked hardware and lab parts.",
    fields: [
      { name: "Category", required: true, instruction: "Specific device category, such as optical module, storage, adapter, bridge, rack accessory, or lab part." },
      { name: "Model", required: true, instruction: "Model of the device." },
      { name: "Serial No.", required: true, instruction: "Serial number from label when the item is serial-tracked." },
      ...generalFields
    ],
    filters: ["Category", "Model", "Serial No.", "Status", "Owner", "Building", "Usage", "Borrowed/Lent", "Notes"]
  },
  "Low-price Consumables": {
    label: "Low-price Consumables",
    groups: ["Low price Consumables", "Low-price Consumables"],
    description: "Quantity-based items without serial tracking.",
    fields: [
      { name: "Category", required: true, instruction: "Consumable category, such as cable, adapter, mouse, keyboard, controller, or SIM card." },
      { name: "Model", required: true, instruction: "Consumable model or description." },
      { name: "Quantity", required: true, instruction: "Purchased or available quantity." },
      { name: "Requester", instruction: "Requesting team or owner queue, normally #imargulis-staff." },
      { name: "NVBug #", instruction: "Purchase or request reference when available." },
      { name: "Location", instruction: "Santa Clara Building R, Building E, or Building S storage detail." },
      { name: "Usage", instruction: "Project or lab purpose." },
      { name: "Arrive Date", instruction: "Arrival date if known." },
      { name: "Notes", instruction: "Additional detail for special, scarce, or exception items." }
    ],
    filters: ["Category", "Model", "Quantity", "Requester", "Building", "Usage", "Arrive Date", "Notes"]
  },
  "E-Wasted": {
    label: "E-Wasted",
    groups: ["E-Waste", "E-Wasted"],
    description: "Retired or disposal-tracked devices.",
    fields: [
      { name: "Category", required: true, instruction: "Original device category." },
      { name: "Model", required: true, instruction: "Original device model." },
      { name: "Serial No.", required: true, instruction: "Original serial number when available." },
      { name: "Status", required: true, instruction: "Use E-waste Pending before disposal and E-Wasted only after completed archival/disposal workflow." },
      { name: "Owner", instruction: "Last owner or responsible team queue." },
      { name: "NVBug #", instruction: "Disposal, repair, or archival reference." },
      { name: "Stamp", instruction: "Date of completed workflow or latest logged edit." },
      { name: "Location", instruction: "Last known Santa Clara storage or disposal staging location." },
      { name: "Usage", instruction: "Prior use when relevant." },
      { name: "Arrive Date", instruction: "Original arrive date when known." },
      { name: "Borrowed/Lent", instruction: "Loan state if it affects recovery or disposal." },
      { name: "Notes", instruction: "Reason for disposal and any data destruction or hazardous-material detail." }
    ],
    filters: ["Category", "Model", "Serial No.", "Status", "Owner", "Building", "NVBug #", "Notes"]
  },
  "Broken Devices": {
    label: "Broken Devices",
    groups: ["Broken Devices"],
    description: "Repair and e-waste pending exception queue.",
    fields: [
      { name: "Category", required: true, instruction: "Original device category." },
      { name: "Model", required: true, instruction: "Device model." },
      { name: "Serial No.", required: true, instruction: "Device serial number." },
      { name: "Status", required: true, instruction: "Use Broken while triage or repair is active." },
      { name: "Owner", instruction: "Owner or responsible team queue." },
      { name: "NVBug #", instruction: "Repair or disposition reference." },
      { name: "Stamp", instruction: "Latest logged edit or ticket closure date." },
      { name: "Location", instruction: "Santa Clara storage or repair staging location." },
      { name: "Problem", instruction: "Short description of the failure." },
      { name: "E-Waste-Pending", instruction: "Mark when the broken device should move into e-waste workflow." }
    ],
    filters: ["Category", "Model", "Serial No.", "Owner", "Building", "NVBug #", "Problem", "E-Waste-Pending"]
  }
};

const deviceDomains = Object.values(domainDefinitions);

const elements = {
  navList: document.querySelector("#navList"),
  viewCrumb: document.querySelector("#viewCrumb"),
  viewTitle: document.querySelector("#viewTitle"),
  viewDescription: document.querySelector("#viewDescription"),
  runtimeChip: document.querySelector("#runtimeChip"),
  themeSelect: document.querySelector("#themeSelect"),
  refreshButton: document.querySelector("#refreshButton"),
  userChip: document.querySelector("#userChip"),
  userInitials: document.querySelector("#userInitials"),
  userName: document.querySelector("#userName"),
  userRole: document.querySelector("#userRole"),
  signOutButton: document.querySelector("#signOutButton"),
  metricGrid: document.querySelector("#metricGrid"),
  filterPanel: document.querySelector("#filterPanel"),
  categoryFilter: document.querySelector("#categoryFilter"),
  skuFilter: document.querySelector("#skuFilter"),
  locationFilter: document.querySelector("#locationFilter"),
  availabilityFilter: document.querySelector("#availabilityFilter"),
  searchFilter: document.querySelector("#searchFilter"),
  clearFiltersButton: document.querySelector("#clearFiltersButton"),
  exportFilteredButton: document.querySelector("#exportFilteredButton"),
  workGrid: document.querySelector("#workGrid"),
  viewContent: document.querySelector("#viewContent"),
  inspector: document.querySelector("#inspector"),
  statusLine: document.querySelector("#statusLine")
};

function readSavedUser() {
  try {
    const saved = JSON.parse(localStorage.getItem("inventory-2.0-user") || "null");
    return saved && saved.name && saved.email
      ? {
          name: String(saved.name),
          email: String(saved.email),
          role: saved.role === "admin" ? "admin" : "regular"
        }
      : null;
  } catch {
    return null;
  }
}

function saveCurrentUser(user) {
  state.currentUser = user;
  if (user) {
    localStorage.setItem("inventory-2.0-user", JSON.stringify(user));
  } else {
    localStorage.removeItem("inventory-2.0-user");
  }
  updateUserHeader();
}

function userInitials(name) {
  const words = String(name || "#imargulis-staff").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "IM";
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function currentActor() {
  const user = state.currentUser || {};
  return {
    actorName: user.name || "#imargulis-staff",
    actorEmail: user.email || "imargulis-staff@nvidia.com"
  };
}

function isAdminUser() {
  return state.currentUser?.role === "admin";
}

function updateUserHeader() {
  const user = state.currentUser;
  const name = user?.name || "#imargulis-staff";
  if (elements.userInitials) elements.userInitials.textContent = userInitials(name);
  if (elements.userName) elements.userName.textContent = name;
  if (elements.userRole) elements.userRole.textContent = user?.role === "admin" ? "Admin user" : user ? "Regular user" : "Not signed in";
  if (elements.signOutButton) elements.signOutButton.hidden = !user;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function nvbugReferences(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const refs = new Set();
  for (const match of text.matchAll(/nvbugspro\.nvidia\.com\/bug\/(\d{4,})/gi)) refs.add(match[1]);
  for (const match of text.matchAll(/\b\d{4,}\b/g)) refs.add(match[0]);
  return [...refs];
}

function renderNvbugLinks(value, emptyText = "None") {
  const text = String(value || "").trim();
  if (!text) return escapeHtml(emptyText);
  const refs = nvbugReferences(text);
  if (!refs.length) return escapeHtml(text);
  return refs
    .map((ref) => `<a class="inline-link" href="https://nvbugspro.nvidia.com/bug/${escapeHtml(ref)}" target="_blank" rel="noopener">${escapeHtml(ref)}</a>`)
    .join(", ");
}

const code39Patterns = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw",
  "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn",
  A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn",
  F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn",
  K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww", O: "wnnnwnnwn",
  P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
  U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn",
  Z: "nwwnwnnnn", "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "$": "nwnwnwnnn",
  "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn", "*": "nwnnwnwnn"
};

function code39Value(value) {
  return String(value || "ASSET")
    .toUpperCase()
    .replace(/[^0-9A-Z-. $/+%]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 42) || "ASSET";
}

function renderBarcodeSvg(value) {
  const encoded = `*${code39Value(value)}*`;
  const narrow = 2;
  const wide = 5;
  const height = 58;
  let x = 0;
  const rects = [];
  for (const char of encoded) {
    const pattern = code39Patterns[char] || code39Patterns["-"];
    [...pattern].forEach((widthCode, index) => {
      const width = widthCode === "w" ? wide : narrow;
      if (index % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${width}" height="${height}"></rect>`);
      x += width;
    });
    x += narrow;
  }
  return `<svg class="barcode-svg" viewBox="0 0 ${x} ${height}" preserveAspectRatio="none" role="img" aria-label="Barcode for ${escapeHtml(value)}">${rects.join("")}</svg>`;
}

function activeAssets() {
  return (state.snapshot?.assets || []).filter((asset) => asset.lifecycle?.active !== false && !asset.archivedAt);
}

function categoryCounts() {
  return [...activeAssets().reduce((map, asset) => {
    const category = asset.category || "Uncategorized";
    map.set(category, (map.get(category) || 0) + 1);
    return map;
  }, new Map()).entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return "No activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function setStatus(message, tone = "success") {
  elements.statusLine.textContent = message || "";
  elements.statusLine.dataset.tone = tone;
}

function applyTheme() {
  const theme = ["light", "dark", "classic"].includes(state.theme) ? state.theme : "light";
  document.documentElement.dataset.theme = theme;
  if (elements.themeSelect) elements.themeSelect.value = theme;
  localStorage.setItem("inventory-2.0-theme", theme);
}

function selectedLoginMember(name) {
  return teamMembers.find((member) => member.name === name) || null;
}

function syncLoginEmail(memberName) {
  const emailInput = document.querySelector("#loginEmail");
  if (!emailInput) return;
  const member = selectedLoginMember(memberName);
  if (member) {
    emailInput.value = member.email;
    emailInput.readOnly = true;
  } else {
    emailInput.value = "";
    emailInput.readOnly = false;
    emailInput.placeholder = memberName ? "Enter email" : "Select a member first";
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.message || "Request failed.");
  return data;
}

async function requestFormData(url, formData) {
  const response = await fetch(url, { method: "POST", body: formData });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.message || "Request failed.");
  return data;
}

function optionMarkup(value, label, selectedValue) {
  return `<option value="${escapeHtml(value)}" ${String(value) === String(selectedValue) ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function uniqueSortedOptions(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function ownerOptions(current = "") {
  return uniqueSortedOptions([
    "#imargulis-staff",
    current,
    ...(state.snapshot?.assets || []).map((asset) => asset.owner),
    ...teamMembers.map((member) => member.name)
  ]);
}

function locationOptions(current = "") {
  return uniqueSortedOptions([
    current,
    ...buildingOptions,
    ...(state.snapshot?.assets || []).map((asset) => asset.location)
  ]);
}

function selectOptions(values, selectedValue, placeholder = "") {
  const selected = String(selectedValue || "");
  const options = placeholder ? [optionMarkup("", placeholder, selected)] : [];
  const normalized = uniqueSortedOptions([selected, ...values]);
  return options.concat(normalized.map((value) => optionMarkup(value, value, selected))).join("");
}

function assetById(assetId) {
  return (state.snapshot?.assets || []).find((asset) => asset.id === assetId || asset.assetId === assetId) || null;
}

function actionModalAsset() {
  const modal = state.actionModal || {};
  return state.strictSearch.detail?.asset || assetById(modal.assetId) || {};
}

function currentFilters() {
  return {
    category: elements.categoryFilter.value || "all",
    sku: elements.skuFilter.value || "all",
    location: elements.locationFilter.value || "all",
    status: elements.availabilityFilter.value || "all",
    search: elements.searchFilter.value.trim().toLowerCase()
  };
}

function searchableText(part) {
  return [
    part.sku,
    part.partName,
    part.category,
    part.location,
    part.owner,
    part.criticality,
    part.status?.label,
    part.distinguishers,
    Array.isArray(part.aliases) ? part.aliases.join(" ") : part.aliases,
    part.metadata
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function activeDomainDefinition() {
  return state.domainLabel ? domainDefinitions[state.domainLabel] : null;
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function domainFieldText(part, fieldName) {
  const aliases = Array.isArray(part.aliases) ? part.aliases.join(" ") : part.aliases;
  const allText = searchableText(part);
  const map = {
    Category: part.category,
    Model: `${part.partName} ${part.sku} ${aliases}`,
    "Serial No.": `${part.metadata} ${part.sku}`,
    Status: part.status?.label,
    Owner: part.owner,
    Building: part.location,
    Location: part.location,
    Usage: `${part.metadata} ${part.distinguishers}`,
    "Borrowed/Lent": allText,
    Chip: part.metadata,
    SKU: part.sku,
    "GPU Class": part.metadata,
    Edition: `${part.metadata} ${part.distinguishers}`,
    Maker: part.metadata,
    "Open Part No.": part.metadata,
    PSID: part.metadata,
    "OPN Family": part.metadata,
    "Production Key/Development Key": part.metadata,
    IP: part.metadata,
    CPU: part.metadata,
    "Mother Board": part.metadata,
    GPU: `${part.partName} ${part.metadata}`,
    Memory: part.metadata,
    Disk: part.metadata,
    PSU: part.metadata,
    Type: part.metadata,
    "Native Resolution": part.metadata,
    Resolution: part.metadata,
    Connector: part.metadata,
    Features: part.metadata,
    Quantity: String(part.quantity),
    Requester: part.owner,
    "NVBug #": allText,
    "Arrive Date": allText,
    "Setup Date": allText,
    Notes: `${part.metadata} ${part.distinguishers}`,
    Problem: `${part.metadata} ${part.distinguishers}`,
    "E-Waste-Pending": allText
  };
  return normalizedText(map[fieldName] || allText);
}

function matchesDomainFilters(part) {
  return Object.entries(state.domainFilters || {}).every(([fieldName, rawValue]) => {
    const value = normalizedText(rawValue);
    if (!value || value === "all") return true;
    return domainFieldText(part, fieldName).includes(value);
  });
}

function filteredParts() {
  const filters = currentFilters();
  return (state.snapshot?.parts || []).filter((part) => {
    return (
      (!state.domainGroups.length || state.domainGroups.includes(part.category)) &&
      (filters.category === "all" || part.category === filters.category) &&
      (filters.sku === "all" || part.sku === filters.sku) &&
      (filters.location === "all" || part.location === filters.location) &&
      (filters.status === "all" || part.status.key === filters.status) &&
      (!filters.search || searchableText(part).includes(filters.search)) &&
      matchesDomainFilters(part)
    );
  });
}

function selectedPart() {
  const parts = state.snapshot?.parts || [];
  return parts.find((part) => part.sku === state.selectedSku) || filteredParts()[0] || parts[0] || null;
}

function metricCard(label, value, detail, tone = "neutral") {
  return `
    <article class="metric-card ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

function renderMetrics(parts) {
  const totalOnHand = parts.reduce((total, part) => total + part.quantity, 0);
  const locations = new Set(parts.map((part) => part.location)).size;
  const lowStock = parts.filter((part) => part.status.key === "low").length;
  const missing = parts.filter((part) => part.status.key === "missing").length;
  const stockedSkus = parts.filter((part) => part.quantity > 0).length;

  elements.metricGrid.innerHTML = [
    metricCard("Active quantity", formatNumber(totalOnHand), "Filtered catalog quantity", "green"),
    metricCard("Catalog records", formatNumber(parts.length), "Device-family records", "neutral"),
    metricCard("Active records", formatNumber(stockedSkus), "Available or assigned assets", "blue"),
    metricCard("Needs review", formatNumber(lowStock), "Below expected state", lowStock ? "amber" : "neutral"),
    metricCard("Unavailable", formatNumber(missing), "Broken or pending disposal", missing ? "red" : "neutral"),
    metricCard("Locations", formatNumber(locations), "Santa Clara building coverage", "green")
  ].join("");
}

function renderTable(columns, rows, emptyMessage, options = {}) {
  const rowClass = options.rowClass || (() => "");
  const rowAttrs = options.rowAttrs || (() => "");
  return `
    <div class="table-wrap ${options.tall ? "tall" : ""}">
      <table class="data-table ${options.tableClass || ""}">
        <thead>
          <tr>${columns.map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (row) => `
                      <tr class="${escapeHtml(rowClass(row))}" ${rowAttrs(row)}>
                        ${columns.map((column) => `<td>${column.render(row)}</td>`).join("")}
                      </tr>
                    `
                  )
                  .join("")
              : `<tr><td colspan="${columns.length}" class="empty-cell">${escapeHtml(emptyMessage)}</td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;
}

function renderStatusPill(status) {
  const normalized = typeof status === "object" && status
    ? { key: status.key || String(status.label || "unknown").toLowerCase().replace(/\s+/g, "-"), label: status.label || status.key || "Unknown" }
    : { key: String(status || "unknown").toLowerCase().replace(/\s+/g, "-"), label: String(status || "Unknown") };
  return `<span class="status-pill ${escapeHtml(normalized.key)}">${escapeHtml(normalized.label)}</span>`;
}

function renderCategoryOverview(parts) {
  const rows = [...parts.reduce((map, part) => {
    if (!map.has(part.category)) {
      map.set(part.category, { category: part.category, totalOnHand: 0, skuCount: 0, stockedSkus: 0, lowStock: 0, missing: 0, locations: new Set() });
    }
    const row = map.get(part.category);
    row.totalOnHand += part.quantity;
    row.skuCount += 1;
    row.stockedSkus += part.quantity > 0 ? 1 : 0;
    if (part.status.key === "low") row.lowStock += 1;
    if (part.status.key === "missing") row.missing += 1;
    row.locations.add(part.location);
    return map;
  }, new Map()).values()]
    .map((row) => ({ ...row, locations: row.locations.size }))
    .sort((left, right) => right.totalOnHand - left.totalOnHand || left.category.localeCompare(right.category));

  return renderTable(
    [
      { label: "Category", render: (row) => `<strong>${escapeHtml(row.category)}</strong>` },
      { label: "Active quantity", render: (row) => formatNumber(row.totalOnHand) },
      { label: "Catalog records", render: (row) => formatNumber(row.skuCount) },
      { label: "Active records", render: (row) => formatNumber(row.stockedSkus) },
      { label: "Needs review", render: (row) => `<span class="${row.lowStock ? "text-amber" : ""}">${formatNumber(row.lowStock)}</span>` },
      { label: "Unavailable", render: (row) => `<span class="${row.missing ? "text-red" : ""}">${formatNumber(row.missing)}</span>` },
      { label: "Locations", render: (row) => formatNumber(row.locations) }
    ],
    rows,
    "No category position matches the current filters."
  );
}

function renderStockList(parts, compact = false) {
  return renderTable(
    [
      { label: "Catalog ID", render: (part) => `<strong>${escapeHtml(part.sku)}</strong><span class="subtext">${escapeHtml(part.partName)}</span>` },
      { label: "Category", render: (part) => escapeHtml(part.category) },
      { label: "Quantity", render: (part) => `<strong>${formatNumber(part.quantity)}</strong>` },
      { label: "Expected", render: (part) => formatNumber(part.minimum) },
      { label: "Status", render: (part) => renderStatusPill(part.status) },
      { label: "Location", render: (part) => escapeHtml(part.location) },
      { label: "Last movement", render: (part) => escapeHtml(formatDate(part.lastMovement)) },
      { label: "Owner", render: (part) => escapeHtml(part.owner) }
    ],
    parts,
    "No catalog records match the current filters.",
    {
      tall: !compact,
      tableClass: "selectable-table",
      rowClass: (part) => (part.sku === state.selectedSku ? "selected-row" : ""),
      rowAttrs: (part) => `data-sku-row="${escapeHtml(part.sku)}"`
    }
  );
}

function renderRiskQueue(parts) {
  const riskItems = parts.filter((part) => part.status.key !== "available");
  if (!riskItems.length) {
    return `<div class="empty-panel"><strong>No active catalog risk in this view.</strong><span>Broken, unavailable, or below-expected records will appear here as filters change.</span></div>`;
  }
  return `
    <div class="risk-grid">
      ${riskItems
        .slice(0, 8)
        .map(
          (part) => `
            <button class="risk-card" type="button" data-sku-row="${escapeHtml(part.sku)}">
              <span>${renderStatusPill(part.status)}</span>
              <strong>${escapeHtml(part.sku)}</strong>
              <small>${escapeHtml(part.partName)}</small>
              <em>${formatNumber(part.quantity)} active, expected ${formatNumber(part.minimum)} - ${escapeHtml(part.location)}</em>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderPanel(title, description, body, action = "") {
  return `
    <section class="panel">
      <div class="panel-heading">
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(description)}</p>
        </div>
        ${action}
      </div>
      ${body}
    </section>
  `;
}

function normalizedAction(action) {
  const text = String(action || "").toLowerCase();
  if (text === "take" || text === "checkout") return "Checkout";
  if (text === "restock" || text === "receive") return "Receive";
  return action || "Activity";
}

function openReplenishmentRequests() {
  return (state.snapshot?.replenishment || []).filter(
    (request) => !["completed", "closed", "refilled"].includes(String(request.status || "").toLowerCase())
  );
}

function renderHomeHero(parts) {
  const summary = state.snapshot?.summary || {};
  const generatedAt = state.snapshot?.generatedAt ? formatDate(state.snapshot.generatedAt) : "just now";
  const riskCount = (state.snapshot?.riskQueue || []).length;
  const openRequests = openReplenishmentRequests().length;
  const stockedSkus = parts.filter((part) => part.quantity > 0).length;

  return `
    <section class="home-hero" aria-label="Inventory overview">
      <div class="home-hero-copy">
        <h2>Accurate lab inventory, ready for the next hardware move.</h2>
        <p>Current catalog status, open requests, and recent movement are summarized here so operators can start with the right task instead of searching through every table.</p>
        <div class="home-actions">
          <button class="button primary" type="button" data-view="devices">Browse Parts Catalog</button>
          <button class="button secondary" type="button" data-view="operations" data-operation-mode="restock">Receive Record</button>
          <button class="button secondary" type="button" data-view="replenishment">Create Request</button>
        </div>
      </div>
      <div class="home-hero-panel">
        <span>Updated ${escapeHtml(generatedAt)}</span>
        <strong>${formatNumber(summary.totalOnHand || 0)}</strong>
        <small>active quantity across ${formatNumber(summary.partMasterRecords || parts.length)} catalog records</small>
        <div class="hero-facts">
          <div><b>${formatNumber(riskCount)}</b><span>needs attention</span></div>
          <div><b>${formatNumber(openRequests)}</b><span>open requests</span></div>
          <div><b>${formatNumber(stockedSkus)}</b><span>active records</span></div>
        </div>
      </div>
    </section>
  `;
}

function renderAttentionList(parts) {
  const riskItems = (state.snapshot?.riskQueue || parts.filter((part) => part.status.key !== "available")).slice(0, 4);
  const requests = openReplenishmentRequests().slice(0, 2);
  const items = [
    ...riskItems.map((part) => ({
      tone: part.status.key,
      title: `${part.status.label}: ${part.sku}`,
      detail: `${part.partName} has ${formatNumber(part.quantity)} active, expected ${formatNumber(part.minimum)}.`,
      meta: part.owner,
      attrs: `data-sku-row="${escapeHtml(part.sku)}"`
    })),
    ...requests.map((request) => ({
      tone: "request",
      title: `${request.status}: ${request.id}`,
      detail: `${request.sku} needs ${formatNumber(request.requested_qty)} units for follow-up.`,
      meta: request.owner || request.created_by || "Unassigned",
      attrs: `data-view="replenishment"`
    }))
  ];

  if (!items.length) {
    return `<div class="empty-panel"><strong>No urgent inventory work.</strong><span>Unavailable records, records needing review, and open requests will appear here.</span></div>`;
  }

  return `
    <div class="attention-list">
      ${items
        .map(
          (item) => `
            <button class="attention-item ${escapeHtml(item.tone)}" type="button" ${item.attrs}>
              <span></span>
              <div>
                <strong>${escapeHtml(item.title)}</strong>
                <small>${escapeHtml(item.detail)}</small>
              </div>
              <em>${escapeHtml(item.meta)}</em>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderInventoryHealth(parts) {
  const summary = state.snapshot?.summary || {};
  const lowStock = parts.filter((part) => part.status.key === "low").length;
  const missing = parts.filter((part) => part.status.key === "missing").length;
  const categories = new Set(parts.map((part) => part.category)).size;

  return `
    <div class="health-grid">
      <div>
        <span>Active quantity</span>
        <strong>${formatNumber(summary.totalOnHand || 0)}</strong>
        <small>Active quantity currently recorded</small>
      </div>
      <div>
        <span>Catalog records</span>
        <strong>${formatNumber(parts.length)}</strong>
        <small>${formatNumber(categories)} hardware families</small>
      </div>
      <div>
        <span>Exceptions</span>
        <strong>${formatNumber(lowStock + missing)}</strong>
        <small>${formatNumber(lowStock)} needs review, ${formatNumber(missing)} unavailable</small>
      </div>
      <div>
        <span>Locations</span>
        <strong>${formatNumber(summary.locations || 0)}</strong>
        <small>Santa Clara building and storage coverage</small>
      </div>
    </div>
  `;
}

function renderRecentMovement() {
  const transactions = (state.snapshot?.transactions || []).slice(0, 5);
  if (!transactions.length) {
    return `<div class="empty-panel"><strong>No catalog movement yet.</strong><span>Checkouts and receipts will appear as soon as operators record them.</span></div>`;
  }

  return `
    <div class="movement-list">
      ${transactions
        .map(
          (item) => `
            <button class="movement-item" type="button" data-view="audit">
              <span>${escapeHtml(normalizedAction(item.action))}</span>
              <div>
                <strong>${escapeHtml(item.sku)}</strong>
                <small>${formatNumber(item.quantity)} unit${Number(item.quantity) === 1 ? "" : "s"} by ${escapeHtml(item.operator_name || "Unknown")} - ${escapeHtml(formatDate(item.timestamp))}</small>
              </div>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderQuickWorkflows() {
  return `
    <div class="workflow-grid">
      <button class="workflow-tile" type="button" data-view="devices">
        <span class="workflow-icon find" aria-hidden="true"></span>
        <strong>Browse Parts Catalog</strong>
        <small>Choose a family, then filter by model, owner, location, or identifier.</small>
      </button>
      <button class="workflow-tile" type="button" data-view="operations" data-operation-mode="checkout">
        <span class="workflow-icon issue" aria-hidden="true"></span>
        <strong>Issue Record</strong>
        <small>Record checkout with quantity, operator, and business reason.</small>
      </button>
      <button class="workflow-tile" type="button" data-view="operations" data-operation-mode="restock">
        <span class="workflow-icon receive" aria-hidden="true"></span>
        <strong>Receive Record</strong>
        <small>Receive assets and keep the ledger accurate.</small>
      </button>
      <button class="workflow-tile" type="button" data-view="replenishment">
        <span class="workflow-icon request" aria-hidden="true"></span>
        <strong>Create Request</strong>
        <small>Turn catalog exceptions into owned follow-up work.</small>
      </button>
    </div>
  `;
}

function searchQueryParams() {
  const params = new URLSearchParams();
  if (state.strictSearch.query.trim()) params.set("q", state.strictSearch.query.trim());
  Object.entries(state.strictSearch.filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params;
}

function reportQueryParams() {
  const params = new URLSearchParams();
  Object.entries(state.reportFilters || {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params;
}

function searchModeLabel(mode) {
  const labels = {
    "exact-asset": "Exact asset",
    category: "Device family",
    text: "Matching records",
    all: "All records"
  };
  return labels[mode] || "Results";
}

function renderSearchFacet(title, key, rows = []) {
  if (!rows.length) {
    return "";
  }
  const currentValue = state.strictSearch.filters[key] || "";
  return `
    <section class="search-facet">
      <h3>${escapeHtml(title)}</h3>
      <div class="search-facet-list">
        ${rows
          .slice(0, 12)
          .map((row) => {
            const active = currentValue === row.value;
            return `
              <button class="${active ? "active" : ""}" type="button" data-search-facet="${escapeHtml(key)}" data-search-value="${escapeHtml(row.value)}">
                <span>${escapeHtml(row.label)}</span>
                <em>${formatNumber(row.count)}</em>
              </button>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderSearchFilterControl(field, facets = {}) {
  const value = state.strictSearch.filters[field.key] || "";
  const rows = facets[field.key] || [];
  const id = `search-filter-${field.key}`;
  if (field.type === "select" && rows.length) {
    return `
      <label class="stacked-filter">
        ${escapeHtml(field.label)}
        <select id="${escapeHtml(id)}" data-search-filter-control="${escapeHtml(field.key)}">
          ${optionMarkup("", `All ${field.label}`, value)}
          ${rows.map((row) => optionMarkup(row.value, `${row.label} (${formatNumber(row.count)})`, value)).join("")}
        </select>
      </label>
    `;
  }
  return `
    <label class="stacked-filter">
      ${escapeHtml(field.label)}
      <input id="${escapeHtml(id)}" data-search-filter-control="${escapeHtml(field.key)}" value="${escapeHtml(value)}" placeholder="Filter ${escapeHtml(field.label)}" />
    </label>
  `;
}

function renderSearchFilters() {
  const result = state.strictSearch.result;
  if (!result) {
    return "";
  }

  const hasFilters = Object.values(state.strictSearch.filters).some(Boolean);
  const schema = result.filterSchema || {};
  const common = schema.common || [];
  const distinctive = schema.distinctive || [];
  return `
    <aside class="search-sidebar">
      <div class="search-sidebar-title">
        <h2>Filter by</h2>
        ${hasFilters ? `<button type="button" data-clear-search-filters>Clear Filters</button>` : ""}
      </div>
      <div class="search-filter-stack">
        ${common.map((field) => renderSearchFilterControl(field, result.facets || {})).join("")}
      </div>
      ${distinctive.length
        ? `
          <div class="search-filter-section">
            <h3>${escapeHtml(schema.activeCategory || "Category")} fields</h3>
            <div class="search-filter-stack">
              ${distinctive.map((field) => renderSearchFilterControl(field, result.facets || {})).join("")}
            </div>
          </div>
        `
        : ""}
    </aside>
  `;
}

function renderSearchBulkToolbar() {
  const count = state.selectedSearchAssets.size;
  if (!count) return "";
  return `
    <div class="bulk-toolbar">
      <strong>${formatNumber(count)} selected</strong>
      <button class="button secondary" type="button" data-bulk-asset-action="check-out">Check Out</button>
      <button class="button secondary" type="button" data-bulk-asset-action="check-in">Check In</button>
      <button class="button secondary" type="button" data-bulk-asset-action="print-label">Print Labels</button>
      <button class="button secondary" type="button" data-export-selected-assets>Export Selected</button>
      <button class="button ghost" type="button" data-clear-selected-assets>Clear</button>
    </div>
  `;
}

function categoryInitials(category = "") {
  const text = String(category || "Asset").replace(/[^a-z0-9 ]+/gi, " ").trim();
  return text
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "A";
}

function renderAssetThumb(item = {}) {
  if (item.imagePath) {
    return `
      <div class="asset-thumb image">
        <img src="${escapeHtml(item.imagePath)}" alt="${escapeHtml(item.modelName || item.category || "Asset image")}" loading="lazy" />
      </div>
    `;
  }
  return `
    <div class="asset-thumb fallback" aria-hidden="true">
      <span>${escapeHtml(categoryInitials(item.category))}</span>
    </div>
  `;
}

function requiredLabel(label, required = false) {
  return `${escapeHtml(label)}${required ? ` <span class="required-asterisk">*</span><span class="required-note">Required</span>` : ""}`;
}

function fieldError(name) {
  const message = state.assetEditErrors?.[name];
  return message ? `<small class="field-error">${escapeHtml(message)}</small>` : "";
}

function fieldClass(name) {
  return state.assetEditErrors?.[name] ? "field invalid" : "field";
}

function renderAssetImageEditor(asset, model = {}) {
  if (!isAdminUser()) return "";
  const modelId = model?.id || asset.modelId || "";
  if (!modelId) return "";
  const imagePath = model?.imagePath || asset.imagePath || "";
  return `
    <section class="asset-image-editor">
      <div class="asset-image-preview">
        ${renderAssetThumb({ ...asset, imagePath })}
      </div>
      <div class="asset-image-copy">
        <strong>Model image</strong>
        <span>Applies to this SKU/model across matching assets.</span>
        <label class="field required">
          ${requiredLabel("Reason", true)}
          <input id="modelImageReason" placeholder="Required for traceability" />
        </label>
        <label class="file-picker">
          <input id="modelImageFile" type="file" accept="image/png,image/jpeg,image/webp" />
          <span>Choose image</span>
        </label>
        <div class="button-row">
          <button class="button primary compact" type="button" data-upload-model-image="${escapeHtml(modelId)}">Upload image</button>
          ${imagePath ? `<button class="button secondary compact" type="button" data-remove-model-image="${escapeHtml(modelId)}">Remove image</button>` : ""}
        </div>
        <small class="help-text">PNG, JPG, JPEG, or WebP. Max 5 MB.</small>
      </div>
    </section>
  `;
}

function renderSearchResultCard(item) {
  const checked = state.selectedSearchAssets.has(item.assetId || item.id);
  const assetId = item.assetId || item.id;
  const availability = item.available ? "Available" : item.exception ? "Exception" : "Unavailable";
  return `
    <article class="asset-row-card ${checked ? "selected" : ""}">
      <label class="asset-row-select">
        <input type="checkbox" data-select-search-asset="${escapeHtml(assetId)}" ${checked ? "checked" : ""} />
        <span class="sr-only">Select ${escapeHtml(assetId)}</span>
      </label>
      ${renderAssetThumb(item)}
      <div class="asset-row-identity">
        <span class="result-family">${escapeHtml(item.category)}</span>
        <h3>${escapeHtml(item.modelName || item.assetId || item.id)}</h3>
        <p>${escapeHtml(item.assetTag || item.serialNo || item.assetId || item.id)}</p>
      </div>
      <dl class="asset-row-facts">
        <div><dt>Serial</dt><dd>${escapeHtml(item.serialNo || "Not listed")}</dd></div>
        <div><dt>Asset Tag</dt><dd>${escapeHtml(item.assetTag || assetId)}</dd></div>
        <div><dt>Location</dt><dd>${escapeHtml(item.location || "No location")}</dd></div>
        <div><dt>Owner</dt><dd>${escapeHtml(item.owner || "#imargulis-staff")}</dd></div>
        <div><dt>NVBug</dt><dd>${renderNvbugLinks(item.nvbug)}</dd></div>
      </dl>
      <div class="asset-row-state">
        ${renderStatusPill(item.status)}
        <small>${escapeHtml(availability)}</small>
      </div>
      <div class="asset-row-actions">
        <button class="button primary compact" type="button" data-search-details="${escapeHtml(assetId)}">Details</button>
        ${isAdminUser() ? `<button class="button secondary compact" type="button" data-search-edit="${escapeHtml(assetId)}">Edit</button>` : ""}
        <button class="button secondary compact" type="button" data-asset-action="check-out" data-asset-id="${escapeHtml(assetId)}">Check Out</button>
        <button class="button secondary compact" type="button" data-asset-action="check-in" data-asset-id="${escapeHtml(assetId)}">Check In</button>
        <button class="button secondary compact" type="button" data-asset-action="print-label" data-asset-id="${escapeHtml(assetId)}">Print</button>
        <button class="button secondary compact" type="button" data-asset-action="request" data-asset-id="${escapeHtml(assetId)}">Request</button>
      </div>
    </article>
  `;
}

function renderSearchResults() {
  const search = state.strictSearch;
  if (search.loading) {
    return `<section class="search-results-panel"><div class="empty-panel"><strong>Searching inventory...</strong><span>Checking exact identifiers, then matching records.</span></div></section>`;
  }
  if (search.error) {
    return `<section class="search-results-panel"><div class="empty-panel error"><strong>Search failed.</strong><span>${escapeHtml(search.error)}</span></div></section>`;
  }
  if (!search.result) {
    return `
      <section class="search-results-panel">
        <div class="search-empty-state">
          <strong>Search inventory</strong>
          <span>Enter a device family like GPU or DPU, or an exact serial/catalog ID.</span>
        </div>
      </section>
    `;
  }

  const result = search.result;
  return `
    <section class="search-results-panel">
      <div class="search-results-heading">
        <div>
          <span>${escapeHtml(searchModeLabel(result.mode))}</span>
          <h2>${formatNumber(result.total)} record${result.total === 1 ? "" : "s"} found</h2>
        </div>
      </div>
      ${renderSearchBulkToolbar()}
      <div class="search-result-list">
        ${result.results.length
          ? result.results.map(renderSearchResultCard).join("")
          : `<div class="empty-panel"><strong>No records found.</strong><span>Change the search term or remove a filter.</span></div>`}
      </div>
    </section>
  `;
}

function editableMetadataFields(asset) {
  const commonLabels = new Set(["Category", "Model", "Model name", "Serial No.", "Serial number", "Asset Tag", "Status", "Owner", "Requester", "Location", "Usage", "NVBug #", "Borrowed/Lent", "Notes", "Stamp"]);
  return Object.entries(asset.metadata || {})
    .map(([key, entry]) => ({
      key,
      label: entry && typeof entry === "object" ? entry.label || key : key,
      value: entry && typeof entry === "object" ? entry.value ?? "" : entry ?? ""
    }))
    .filter((field) => !commonLabels.has(field.label));
}

function renderAssetEditSection(asset, model = {}) {
  const categories = [...new Set([asset.category, ...categoryCounts().map((category) => category.label)].filter(Boolean))].sort();
  const metadataFields = editableMetadataFields(asset);
  return `
    <section class="asset-section admin-edit-section">
      ${renderAssetImageEditor(asset, model)}
      ${Object.keys(state.assetEditErrors || {}).length ? `<div class="form-error-summary">Please fix the highlighted fields before saving.</div>` : ""}
      <form id="assetEditForm" class="asset-edit-form" data-edit-asset="${escapeHtml(asset.id)}">
        <label class="${fieldClass("category")}">${requiredLabel("Category", true)}<select name="category">${categories.map((option) => optionMarkup(option, option, asset.category || "")).join("")}</select>${fieldError("category")}</label>
        <label class="${fieldClass("modelName")}">${requiredLabel("Model", true)}<input name="modelName" value="${escapeHtml(asset.modelName || "")}" />${fieldError("modelName")}</label>
        <label class="${fieldClass("serialOrAsset")}">${requiredLabel("Serial No. or Asset Tag", true)}<input name="serialNo" value="${escapeHtml(asset.serialNo || "")}" />${fieldError("serialOrAsset")}</label>
        <label class="${fieldClass("serialOrAsset")}">${requiredLabel("Asset Tag")}<input name="assetTag" value="${escapeHtml(asset.assetTag || "")}" /></label>
        <label class="${fieldClass("status")}">${requiredLabel("Status", true)}<select name="status">${statusOptions.map((option) => optionMarkup(option, option, asset.status || asset.statusLabel || "")).join("")}</select>${fieldError("status")}</label>
        <label class="${fieldClass("owner")}">${requiredLabel("Owner / Assignee", asset.status === "In Use" || asset.statusLabel === "In Use")}<select name="owner">${selectOptions(ownerOptions(asset.owner), asset.owner || "", "Select owner / assignee")}</select>${fieldError("owner")}</label>
        <label class="${fieldClass("location")}">${requiredLabel("Location", true)}<select name="location">${selectOptions(locationOptions(asset.location), asset.location || "", "Select location")}</select>${fieldError("location")}</label>
        <label class="field">${requiredLabel("Usage")}<input name="usage" value="${escapeHtml(asset.usage || "")}" /></label>
        <label class="field">${requiredLabel("Borrowed/Lent")}<select name="borrowedLent">${borrowedOptions.map((option) => optionMarkup(option, option || "In Stock", asset.borrowedLent || "")).join("")}</select></label>
        <label class="field">${requiredLabel("NVBug #")}<input name="nvbug" value="${escapeHtml(asset.nvbug || "")}" placeholder="9000001" /></label>
        <label class="field">${requiredLabel("Stamp")}<input name="stamp" value="${escapeHtml(asset.stamp || "")}" /></label>
        <label class="field">${requiredLabel("EOL Date")}<input name="eolDate" value="${escapeHtml(asset.eolDate || "")}" placeholder="YYYY-MM-DD" /></label>
        ${metadataFields.map((field) => `
          <label class="field">${requiredLabel(field.label)}
            <input name="metadata.${escapeHtml(field.key)}" value="${escapeHtml(field.value)}" />
          </label>
        `).join("")}
        <label class="field wide">${requiredLabel("Notes")}<textarea name="notes">${escapeHtml(asset.notes || "")}</textarea></label>
        <label class="${fieldClass("reason")} wide">${requiredLabel("Reason", true)}<textarea name="reason" placeholder="Required for traceability"></textarea>${fieldError("reason")}</label>
        <div class="sheet-save-bar">
          <button class="button secondary" type="button" data-close-search-detail>Cancel</button>
          <button class="button primary" type="submit">Save Changes</button>
        </div>
      </form>
    </section>
  `;
}

function renderWorkspaceTab(tab, label) {
  const active = state.strictSearch.detailTab === tab;
  return `<button class="${active ? "active" : ""}" type="button" data-asset-sheet-tab="${escapeHtml(tab)}">${escapeHtml(label)}</button>`;
}

function renderAssetOverview(asset, metadataRows) {
  return `
    <section class="asset-section">
      <h3>Overview</h3>
      <dl class="definition-list compact">
        <div><dt>Family</dt><dd>${escapeHtml(asset.category || "")}</dd></div>
        <div><dt>Status</dt><dd>${escapeHtml(asset.statusLabel || asset.status || "")}</dd></div>
        <div><dt>Asset Tag</dt><dd>${escapeHtml(asset.assetTag || "")}</dd></div>
        <div><dt>Serial</dt><dd>${escapeHtml(asset.serialNo || "")}</dd></div>
        <div><dt>Location</dt><dd>${escapeHtml(asset.location || "")}</dd></div>
        <div><dt>Owner</dt><dd>${escapeHtml(asset.owner || "")}</dd></div>
        <div><dt>Borrowed/Lent</dt><dd>${escapeHtml(asset.borrowedLent || "In Stock")}</dd></div>
        <div><dt>NVBug</dt><dd>${renderNvbugLinks(asset.nvbug)}</dd></div>
      </dl>
    </section>
    <section class="asset-section">
      <h3>Source Fields</h3>
      <div class="compact-list">
        ${metadataRows.length
          ? metadataRows.slice(0, 18).map((entry) => `
            <div class="field-row">
              <strong>${escapeHtml(entry.label || "")}</strong>
              <span>${entry.label === "NVBug #" ? renderNvbugLinks(entry.value) : escapeHtml(entry.value || "")}</span>
            </div>
          `).join("")
          : `<div class="empty-panel"><strong>No source fields.</strong><span>This asset was created manually or from a compact import.</span></div>`}
      </div>
    </section>
  `;
}

function renderAssetOperations(asset, requests) {
  return `
    <section class="asset-section asset-ops-panel">
      <h3>Operations</h3>
      <div class="asset-action-row">
        <button class="button primary" type="button" data-detail-asset-action="check-out" data-asset-id="${escapeHtml(asset.id)}">Check Out</button>
        <button class="button secondary" type="button" data-detail-asset-action="check-in" data-asset-id="${escapeHtml(asset.id)}">Check In</button>
        <button class="button secondary" type="button" data-detail-asset-action="transfer" data-asset-id="${escapeHtml(asset.id)}">Transfer</button>
        <button class="button secondary" type="button" data-detail-asset-action="print-label" data-asset-id="${escapeHtml(asset.id)}">Print Label</button>
        <button class="button secondary" type="button" data-detail-asset-action="request" data-asset-id="${escapeHtml(asset.id)}">Request</button>
      </div>
      <small>Each operation writes an immutable activity entry.</small>
    </section>
    <section class="asset-section">
      <h3>Requests</h3>
      <div class="compact-list">
        ${requests.length
          ? requests.slice(0, 8).map((request) => `
            <div class="activity-row">
              <strong>${escapeHtml(request.requestType || "Request")}</strong>
              <span>${escapeHtml(request.status || "")} - ${escapeHtml(request.priority || "Normal")}</span>
              <small>${escapeHtml(request.notes || request.id)}</small>
            </div>
          `).join("")
          : `<div class="empty-panel"><strong>No open request.</strong><span>Create one only when follow-up work is needed.</span></div>`}
      </div>
    </section>
  `;
}

function renderAssetHistory(events) {
  return `
    <section class="asset-section">
      <h3>History</h3>
      <div class="activity-list compact-list">
        ${events.length
          ? events.slice(0, 24).map((event) => `
            <div class="activity-row">
              <strong>${escapeHtml(event.type)}</strong>
              <span>${escapeHtml(event.summary || "")}</span>
              <small>${escapeHtml(formatDate(event.at))} by ${escapeHtml(event.actor || "")}</small>
            </div>
          `).join("")
          : `<div class="empty-panel"><strong>No history yet.</strong><span>Actions and edits will appear here.</span></div>`}
      </div>
    </section>
  `;
}

function renderSearchDetail() {
  const detail = state.strictSearch.detail;
  if (!detail) return "";
  const asset = detail.asset || {};
  const model = detail.model || {};
  const metadataRows = Object.entries(asset.metadata || {}).map(([key, entry]) => ({
    label: entry && typeof entry === "object" ? entry.label || key : key,
    value: entry && typeof entry === "object" ? entry.value ?? "" : entry ?? ""
  }));
  const requests = detail.requests || [];
  const events = detail.events || [];
  const activeTab = state.strictSearch.detailTab || "overview";
  const tabContent = activeTab === "operations"
    ? renderAssetOperations(asset, requests)
    : activeTab === "edit" && isAdminUser()
      ? renderAssetEditSection(asset, model)
      : activeTab === "history"
        ? renderAssetHistory(events)
        : renderAssetOverview(asset, metadataRows);
  return `
    <aside class="asset-workspace-sheet" role="dialog" aria-modal="false" aria-label="Asset workspace">
      <div class="asset-sheet-header">
        ${renderAssetThumb({ ...asset, imagePath: model.imagePath || asset.imagePath })}
        <div>
          <h2>${escapeHtml(asset.modelName || asset.id || "Asset Details")}</h2>
          <p><span>${escapeHtml(asset.assetTag || asset.id || "")}</span>${asset.nvbug ? ` ${renderNvbugLinks(asset.nvbug)}` : ""}</p>
        </div>
        ${renderStatusPill(asset.status)}
        <button class="icon-button" type="button" data-close-search-detail aria-label="Close">×</button>
      </div>
      <div class="asset-sheet-tabs">
        ${renderWorkspaceTab("overview", "Overview")}
        ${renderWorkspaceTab("operations", "Operations")}
        ${isAdminUser() ? renderWorkspaceTab("edit", "Edit") : ""}
        ${renderWorkspaceTab("history", "History")}
      </div>
      <div class="asset-sheet-body">
        ${tabContent}
      </div>
    </aside>
  `;
}

function renderStrictSearchPage() {
  const categories = categoryCounts();
  const hasSearch = Boolean(state.strictSearch.query || Object.values(state.strictSearch.filters).some(Boolean));
  return `
    <section class="search-command-panel">
      <form id="inventorySearchForm" class="search-command-form">
        <label>
          Search inventory
          <input id="homeSearchQuery" value="${escapeHtml(state.strictSearch.query)}" placeholder="GPU, DPU, serial number, asset tag, model, location, NVBug" autocomplete="off" />
        </label>
        <button class="button primary" type="submit">Search</button>
        ${hasSearch ? `<button class="button secondary" type="button" data-clear-search-all>Clear Search</button>` : ""}
      </form>
      <div class="category-command-grid" aria-label="Search by category">
        ${categories.map((category) => `
          <button class="category-command ${state.strictSearch.query.toLowerCase() === category.label.toLowerCase() ? "active" : ""}" type="button" data-search-category="${escapeHtml(category.label)}">
            <strong>${escapeHtml(category.label)}</strong>
            <span>${formatNumber(category.count)}</span>
          </button>
        `).join("")}
      </div>
    </section>
    <section class="search-layout">
      ${renderSearchFilters()}
      ${renderSearchResults()}
    </section>
  `;
}

function renderDomainLauncherPanel(parts) {
  const apiDomains = state.deviceDomains?.domains || [];
  const cards = apiDomains.length
    ? apiDomains.map((domain) => ({
        label: domain.label,
        description: domain.description,
        count: domain.summary?.records || 0,
        attrs: `data-device-domain="${escapeHtml(domain.slug)}"`
      }))
    : deviceDomains.map((domain) => ({
        label: domain.label,
        description: domain.description,
        count: 0,
        attrs: `data-domain-label="${escapeHtml(domain.label)}" data-domain-groups="${escapeHtml((domain.groups || []).join("|"))}"`
      }));

  return `
    <section class="panel domain-panel">
      <div class="panel-heading">
        <div>
          <h2>Parts Catalog</h2>
          <p>Choose a part family first, then search within the fields that matter for that equipment type.</p>
        </div>
      </div>
      <div class="domain-grid">
        ${cards
          .map(
            (domain) => `
              <button class="domain-tile" type="button" ${domain.attrs}>
                <strong>${escapeHtml(domain.label)}</strong>
                <span>${formatNumber(domain.count)} records</span>
                <small>${escapeHtml(domain.description)}</small>
              </button>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function commandView(parts) {
  return renderStrictSearchPage(parts);
}

function optionsForDomainFilter(domain, fieldName) {
  if (fieldName === "Status") return domain.label === "E-Wasted" ? ["E-waste Pending", "E-Wasted", "Broken"] : statusOptions;
  if (fieldName === "Building") return buildingOptions;
  if (fieldName === "Borrowed/Lent") return borrowedOptions;
  if (fieldName === "Type") return ["ETH", "IB", "RJ45"];
  if (fieldName === "GPU Class") return ["GeForce", "Tesla", "Quadro", "RTX", "Data Center"];
  if (fieldName === "E-Waste-Pending") return ["Y", "N"];
  if (fieldName === "Model" && domain.label === "DPU") return ["BF2", "BF3", "CX-5", "CX-6", "CX-7"];
  if (fieldName === "Model" && domain.label === "Converged GPU + DPU") return ["A100+BF2", "A30+BF2"];
  return null;
}

function renderDomainFilterControl(domain, fieldName) {
  const id = `domain-filter-${fieldName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const value = state.domainFilters[fieldName] || "";
  const options = optionsForDomainFilter(domain, fieldName);
  if (options) {
    return `
      <label>
        ${escapeHtml(fieldName)}
        <select id="${escapeHtml(id)}" data-domain-filter="${escapeHtml(fieldName)}">
          ${optionMarkup("", `All ${fieldName}`, value)}
          ${options.map((option) => optionMarkup(option, option, value)).join("")}
        </select>
      </label>
    `;
  }
  return `
    <label>
      ${escapeHtml(fieldName)}
      <input id="${escapeHtml(id)}" data-domain-filter="${escapeHtml(fieldName)}" value="${escapeHtml(value)}" placeholder="Filter ${escapeHtml(fieldName.toLowerCase())}" />
    </label>
  `;
}

function renderDomainInstructions(domain) {
  return `
    <section class="panel instruction-panel">
      <div class="panel-heading">
        <div>
          <h2>${escapeHtml(domain.label)} Instructions</h2>
          <p>These rules are the basis for entering, reviewing, and validating this device type before go-live.</p>
        </div>
      </div>
      <div class="instruction-table-wrap">
        <table class="instruction-table">
          <tbody>
            ${domain.fields
              .map(
                (field) => `
                  <tr>
                    <th scope="row">
                      ${escapeHtml(field.name)}
                      ${field.required ? '<span>Required</span>' : ""}
                    </th>
                    <td>${escapeHtml(field.instruction)}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderDomainFilters(domain) {
  return `
    <section class="panel domain-filter-panel">
      <div class="panel-heading">
        <div>
          <h2>${escapeHtml(domain.label)} Filters</h2>
          <p>Filters mirror the important fields for ${escapeHtml(domain.label)} so users can narrow records in the way this device family is managed.</p>
        </div>
        <button class="button secondary" type="button" data-clear-domain-filters>Clear Domain Filters</button>
      </div>
      <div class="domain-filter-grid">
        ${domain.filters.map((fieldName) => renderDomainFilterControl(domain, fieldName)).join("")}
      </div>
    </section>
  `;
}

function activeDeviceDomain() {
  const domains = state.deviceDomains?.domains || [];
  return domains.find((domain) => domain.slug === state.selectedDeviceDomainSlug) || domains[0] || null;
}

function deviceValue(record, field) {
  return String(record?.values?.[field.key] ?? "").trim();
}

function filteredDeviceRecords(domain) {
  if (!domain?.records) return [];
  const filters = state.deviceFilters || {};
  return domain.records.filter((record) => {
    return domain.fields.every((field) => {
      const rawValue = String(filters[field.key] || "").trim().toLowerCase();
      if (!rawValue) return true;
      return deviceValue(record, field).toLowerCase().includes(rawValue);
    });
  });
}

function renderDeviceDomainSelector(activeDomain) {
  const domains = state.deviceDomains?.domains || [];
  return `
    <section class="panel domain-switch-panel">
      <div class="panel-heading">
        <div>
          <h2>Catalog Families</h2>
          <p>Select a family to see its own fields, filters, records, and administrator review state.</p>
        </div>
      </div>
      <div class="domain-switch-grid">
        ${domains
          .map(
            (domain) => `
              <button class="domain-switch ${domain.slug === activeDomain?.slug ? "active" : ""}" type="button" data-select-device-domain="${escapeHtml(domain.slug)}">
                <strong>${escapeHtml(domain.label)}</strong>
                <span>${formatNumber(domain.summary?.records || 0)}</span>
              </button>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderDeviceSummary(domain) {
  const summary = domain.summary || {};
  const batch = domain.latestBatch || {};
  return `
    <section class="panel device-domain-hero">
      <div class="panel-heading">
        <div>
          <h2>${escapeHtml(domain.label)}</h2>
          <p>${escapeHtml(domain.description)} Field-level filters and administrator rules keep this catalog family focused and reviewable.</p>
        </div>
        <span class="quality-pill ready">Active</span>
      </div>
      <div class="device-summary-grid">
        ${metricCard("Records", formatNumber(summary.records), "Tracked devices", "green")}
        ${metricCard("In Use", formatNumber(summary.inUse), "Owner required", "blue")}
        ${metricCard("Idle", formatNumber(summary.idle), "Owner may be blank", "neutral")}
        ${metricCard("Warnings", formatNumber(summary.warnings), "Admin review items", summary.warnings ? "amber" : "neutral")}
        ${metricCard("Errors", formatNumber(summary.errors), "Go-live blockers", summary.errors ? "red" : "neutral")}
        ${metricCard("Validation Status", batch.status || "Not checked", batch.importedAt ? formatDate(batch.importedAt) : "No validation date", "green")}
      </div>
    </section>
  `;
}

function deviceRuleText(field) {
  return [field.required ? "Required." : "", field.conditional ? `${field.conditional}.` : "", field.instruction]
    .filter(Boolean)
    .join(" ");
}

function renderFilterLabel(field) {
  const ruleText = deviceRuleText(field);
  return `
    <span class="filter-label-row">
      <span>${escapeHtml(field.label)}</span>
      <span class="info-tag" tabindex="0" role="button" aria-label="${escapeHtml(`${field.label} rule: ${ruleText}`)}" data-tooltip="${escapeHtml(ruleText)}">i</span>
    </span>
  `;
}

function renderDeviceFilterControl(domain, field) {
  const id = `device-filter-${domain.slug}-${field.key}`;
  const value = state.deviceFilters[field.key] || "";
  const selectKeys = new Set(["category", "model", "status", "owner", "requester", "location", "usage", "borrowedLent", "sku", "edition", "maker", "type", "gpuClass", "nativeResolution", "refreshRate", "connector", "features", "eWastePending"]);
  const options = field.key === "status" ? domain.statusOptions : domain.filterOptions[field.key] || [];

  if (selectKeys.has(field.key) && options.length) {
    return `
      <label>
        ${renderFilterLabel(field)}
        <select id="${escapeHtml(id)}" data-device-filter="${escapeHtml(field.key)}">
          ${optionMarkup("", `All ${field.label}`, value)}
          ${options.map((option) => optionMarkup(option, option, value)).join("")}
        </select>
      </label>
    `;
  }

  return `
    <label>
      ${renderFilterLabel(field)}
      <input id="${escapeHtml(id)}" data-device-filter="${escapeHtml(field.key)}" value="${escapeHtml(value)}" placeholder="Filter ${escapeHtml(field.label)}" />
    </label>
  `;
}

function renderDeviceFilters(domain) {
  return `
    <section class="panel domain-filter-panel">
      <div class="panel-heading">
        <div>
          <h2>${escapeHtml(domain.label)} Filters</h2>
          <p>Use these filters to narrow this device family by ownership, status, location, model, and identifiers.</p>
        </div>
        <button class="button secondary" type="button" data-clear-device-filters>Clear Filters</button>
      </div>
      <div class="domain-filter-grid">
        ${domain.fields.map((field) => renderDeviceFilterControl(domain, field)).join("")}
      </div>
    </section>
  `;
}

function renderDeviceValidation(domain) {
  const issues = domain.validationIssues || [];
  if (!issues.length) {
    return renderPanel(
      "Validation",
      "No validation issues are active.",
      `<div class="empty-panel"><strong>All checks passed.</strong><span>This device family has no blocking validation issues.</span></div>`
    );
  }

  const groupedIssues = [...issues.reduce((map, issue) => {
    const key = `${issue.severity}|${issue.field}|${issue.message}`;
    if (!map.has(key)) {
      map.set(key, { ...issue, rows: [] });
    }
    map.get(key).rows.push(issue.sourceRow);
    return map;
  }, new Map()).values()];
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const errorCount = issues.filter((issue) => issue.severity === "error").length;

  return renderPanel(
    "Validation",
    `${formatNumber(groupedIssues.length)} validation group${groupedIssues.length === 1 ? "" : "s"} from ${formatNumber(issues.length)} row checks. Errors must be corrected before import or release.`,
    `
      <div class="review-grid">
        ${groupedIssues
          .map((issue) => {
            const rowText = issue.rows.length > 1 ? `${issue.rows[0]}-${issue.rows[issue.rows.length - 1]}` : String(issue.rows[0] || "");
            const resolution = "Correct the affected records or update the field setting so the data follows the rule.";
            return `
              <article class="review-card ${escapeHtml(issue.severity)}">
                <div>
                  <span class="quality-pill ${issue.severity === "error" ? "error" : "review"}">${escapeHtml(issue.severity)}</span>
                  <strong>${escapeHtml(issue.field)} needs correction</strong>
                  <small>Rows ${escapeHtml(rowText)} - ${formatNumber(issue.rows.length)} records</small>
                </div>
                <p>${escapeHtml(issue.message)}</p>
                <dl class="definition-list compact">
                  <div><dt>Meaning</dt><dd>${escapeHtml(issue.severity === "error" ? "This blocks import or release for this data set." : "This is a data quality warning. Users can still browse records.")}</dd></div>
                  <div><dt>Resolve</dt><dd>${escapeHtml(resolution)}</dd></div>
                </dl>
              </article>
            `;
          })
          .join("")}
      </div>
      <div class="review-footnote">
        <strong>${formatNumber(warningCount)} warning${warningCount === 1 ? "" : "s"}</strong>
        <span>${formatNumber(errorCount)} error${errorCount === 1 ? "" : "s"}</span>
      </div>
    `
  );
}

function renderDeviceRecords(domain) {
  const rows = filteredDeviceRecords(domain);
  return renderPanel(
    `${domain.label} Records`,
    `${formatNumber(rows.length)} matching records with device identifiers, ownership, location, usage, and lifecycle status.`,
    renderTable(
      domain.fields.map((field) => ({
        label: field.label,
        render: (record) => {
          const value = deviceValue(record, field);
          if (field.key === "status") return `<span class="status-pill ${value === "In Use" ? "available" : "low"}">${escapeHtml(value || "Blank")}</span>`;
          if (field.key === "notes") return `<span class="metadata-cell">${escapeHtml(value)}</span>`;
          return escapeHtml(value || "-");
        }
      })),
      rows,
      `No ${domain.label} records match the current filters.`,
      { tall: true, tableClass: "wide-table" }
    )
  );
}

function devicesView() {
  const domain = activeDeviceDomain();
  if (!domain) {
    return renderPanel(
      "Parts Catalog",
      "Loading device records.",
      `<div class="empty-panel"><strong>Loading catalog records.</strong><span>Preparing the catalog family view.</span></div>`
    );
  }

  return [
    renderDeviceDomainSelector(domain),
    renderDeviceSummary(domain),
    renderDeviceFilters(domain),
    renderDeviceValidation(domain),
    renderDeviceRecords(domain)
  ].join("");
}

function operationForm(part) {
  if (!part) {
    return `<div class="empty-panel"><strong>Select a catalog record to continue.</strong><span>Use filters, label lookup, or the catalog list to choose the right record.</span></div>`;
  }
  const actor = currentActor();
  return `
    <form class="operation-form" id="stockOperationForm">
      <div class="operation-summary">
        <span>${renderStatusPill(part.status)}</span>
        <strong>${escapeHtml(part.sku)}</strong>
        <small>${escapeHtml(part.partName)} - ${escapeHtml(part.location)}</small>
      </div>
      <div class="segmented-control" role="group" aria-label="Operation type">
        <button class="${state.operationMode === "checkout" ? "active" : ""}" type="button" data-operation-mode="checkout">Checkout</button>
        <button class="${state.operationMode === "restock" ? "active" : ""}" type="button" data-operation-mode="restock">Receive</button>
      </div>
      <div class="form-grid">
        <label>
          Quantity
          <input id="operationQuantity" type="number" min="1" step="1" value="1" />
        </label>
        <label>
          Lookup method
          <select id="operationLookup">
            <option>Manual selection</option>
            <option>2D barcode scanner</option>
            <option>Admin correction</option>
          </select>
        </label>
        <label>
          NVBug or reference
          <input id="operationNvbug" placeholder="9000001, RMA, or request ID" />
        </label>
        <label>
          Operator
          <input id="operationOperator" value="${escapeHtml(actor.actorName)}" />
        </label>
      </div>
      <label>
        Business reason
        <textarea id="operationReason" placeholder="Project, test system, RMA, follow-up, allocation, or traceability exception"></textarea>
      </label>
      <label class="checkbox-row">
        <input id="referenceException" type="checkbox" />
        <span>No NVBug/reference available - record this as a traceability exception.</span>
      </label>
      <div class="form-actions">
        <button class="button primary" type="submit">Record ${state.operationMode === "checkout" ? "Checkout" : "Receive"}</button>
        <button class="button secondary" type="button" data-clear-operation>Reset</button>
      </div>
    </form>
  `;
}

function operationsView(parts) {
  const part = selectedPart();
  return `
    <section class="two-column">
      ${renderPanel(
        "Barcode / QR Lookup",
        "Phase 1 supports connected 2D scanner input and manual entry.",
        `
          <div class="lookup-row">
            <label>
              Scan or enter code
              <input id="codeLookupInput" placeholder="Example: QR-GPU-00001" />
            </label>
            <button class="button secondary" id="runCodeLookup" type="button">Find Record</button>
          </div>
          <div class="code-hints">
            ${(state.snapshot?.codeMappings || [])
              .slice(0, 5)
              .map((code) => `<button type="button" data-code-sample="${escapeHtml(code.code)}">${escapeHtml(code.code)}</button>`)
              .join("")}
          </div>
        `
      )}
      ${renderPanel("Activity Ledger Entry", "Every catalog action records operator, quantity, reason, and NVBug/reference status.", operationForm(part))}
    </section>
    ${renderPanel("Matching Catalog Records", "Use the current filters to narrow the operation target.", renderStockList(parts, true))}
  `;
}

function replenishmentView(parts) {
  const requests = state.snapshot?.assetRequests || [];
  const open = requests.filter((request) => !["Closed", "Completed", "Cancelled"].includes(request.status));

  return `
    ${renderPanel(
      "Open Requests",
      "Asset-level work signals created from search details or row actions.",
      `
        <div class="request-summary-row">
          ${metricCard("Open", open.length, "Awaiting owner action", "amber")}
          ${metricCard("Total", requests.length, "Traceable request records", "blue")}
        </div>
      ` +
      renderTable(
        [
          { label: "Request", render: (row) => `<strong>${escapeHtml(row.id)}</strong><span class="subtext">${escapeHtml(row.status)}</span>` },
          { label: "Asset", render: (row) => `<strong>${escapeHtml(row.assetId)}</strong><span class="subtext">${escapeHtml(row.modelName || "")}</span>` },
          { label: "Category", render: (row) => escapeHtml(row.category) },
          { label: "Type", render: (row) => escapeHtml(row.requestType || "Support") },
          { label: "Priority", render: (row) => `<span class="quality-pill ${String(row.priority).toLowerCase()}">${escapeHtml(row.priority || "Normal")}</span>` },
          { label: "Owner", render: (row) => escapeHtml(row.owner || "#imargulis-staff") },
          { label: "Notes", render: (row) => `<span class="metadata-cell">${escapeHtml(row.notes || "")}</span>` }
        ],
        requests,
        "No asset requests have been created.",
        {
          tall: true,
          tableClass: "selectable-table",
          rowClass: () => "clickable-request-row",
          rowAttrs: (row) => `data-request-asset="${escapeHtml(row.assetId)}"`
        }
      )
    )}
  `;
}

function auditView() {
  const activity = state.snapshot?.activityLog?.results || [];
  return renderPanel(
    "Activity",
    "Immutable asset history for imports, edits, actions, requests, labels, and lifecycle changes.",
    `
      <div class="panel-toolbar">
        <span>${formatNumber(activity.length)} log entries</span>
        <a class="button secondary" href="/exports/asset-activity">Export Activity</a>
      </div>
      ${renderTable(
        [
          { label: "When", render: (row) => `<strong>${escapeHtml(formatDate(row.timestamp))}</strong><span class="subtext">${escapeHtml(row.timestamp)}</span>` },
          { label: "Actor", render: (row) => `<strong>${escapeHtml(row.actorName)}</strong><span class="subtext">${escapeHtml(row.actorEmail)}</span>` },
          { label: "Action", render: (row) => escapeHtml(row.action) },
          { label: "Asset", render: (row) => `<strong>${escapeHtml(row.assetId || "Bulk")}</strong><span class="subtext">${escapeHtml(row.modelName || "")}</span>` },
          { label: "Serial", render: (row) => escapeHtml(row.serialNo || "") },
          { label: "Asset Tag", render: (row) => escapeHtml(row.assetTag || "") },
          { label: "NVBug / Reference", render: (row) => renderNvbugLinks(row.nvbug, "Not provided") },
          { label: "Reason", render: (row) => `<span class="metadata-cell">${escapeHtml(row.reason || "No reason provided")}</span>` }
        ],
        activity,
        "No asset activity log entries are available.",
        { tall: true, tableClass: "wide-table" }
      )}
    `
  );
}

function renderReportFilterControl(key, label, options = []) {
  const value = state.reportFilters[key] || "";
  if (options.length) {
    return `
      <label>
        ${escapeHtml(label)}
        <select data-report-filter="${escapeHtml(key)}">
          ${optionMarkup("", `All ${label}`, value)}
          ${options.map((option) => optionMarkup(option, option, value)).join("")}
        </select>
      </label>
    `;
  }
  return `
    <label>
      ${escapeHtml(label)}
      <input data-report-filter="${escapeHtml(key)}" value="${escapeHtml(value)}" placeholder="Filter ${escapeHtml(label)}" />
    </label>
  `;
}

function reportOptions(fieldKey) {
  const rows = state.report?.facets?.[fieldKey] || [];
  return rows.map((row) => row.value);
}

function renderBreakdown(title, rows) {
  return `
    <section class="report-breakdown">
      <h3>${escapeHtml(title)}</h3>
      <div>
        ${(rows || []).slice(0, 10).map((row) => `
          <button type="button" data-report-filter-pill="${escapeHtml(title.toLowerCase())}" data-report-filter-value="${escapeHtml(row.label)}">
            <span>${escapeHtml(row.label)}</span>
            <strong>${formatNumber(row.count)}</strong>
          </button>
        `).join("") || `<p class="subtext">No data in this view.</p>`}
      </div>
    </section>
  `;
}

function reportsView() {
  const report = state.report;
  const summary = report?.summary || {};
  const exportUrl = `/exports/asset-report?${reportQueryParams().toString()}`;
  return `
    <section class="panel reports-panel">
      <div class="panel-heading">
        <div>
          <h2>Reports</h2>
          <p>Filter, drill down, and export management-ready asset views.</p>
        </div>
        <div class="button-row">
          <button class="button secondary" type="button" data-clear-report-filters>Clear Filters</button>
          <a class="button secondary" href="${escapeHtml(exportUrl)}">Export Report</a>
        </div>
      </div>
      <div class="report-filter-grid">
        ${renderReportFilterControl("category", "Category", reportOptions("category"))}
        ${renderReportFilterControl("status", "Status", reportOptions("status"))}
        ${renderReportFilterControl("location", "Location", reportOptions("location"))}
        ${renderReportFilterControl("owner", "Owner", reportOptions("owner"))}
        ${renderReportFilterControl("borrowedLent", "Borrowed/Lent", reportOptions("borrowedLent"))}
        ${renderReportFilterControl("nvbug", "NVBug #")}
      </div>
    </section>
    ${state.reportLoading ? `<div class="empty-panel"><strong>Loading report...</strong><span>Preparing filtered management view.</span></div>` : ""}
    ${state.reportError ? `<div class="empty-panel error"><strong>Report failed.</strong><span>${escapeHtml(state.reportError)}</span></div>` : ""}
    ${report ? `
      <section class="search-summary-strip report-summary-strip">
        ${metricCard("Active", formatNumber(summary.active), "Filtered active assets", "green")}
        ${metricCard("Available", formatNumber(summary.available), "Ready or idle", "blue")}
        ${metricCard("Unavailable", formatNumber(summary.unavailable), "Assigned or unavailable", "amber")}
        ${metricCard("Exceptions", formatNumber(summary.exceptions), "Broken, EOL, pending", "red")}
        ${metricCard("Borrowed", formatNumber(summary.borrowed), "Separate borrowed count", "neutral")}
        ${metricCard("Lent", formatNumber(summary.lent), "Owned but unavailable", "neutral")}
      </section>
      <section class="report-breakdown-grid">
        ${renderBreakdown("Status", report.breakdowns?.status)}
        ${renderBreakdown("Location", report.breakdowns?.location)}
        ${renderBreakdown("Owner / Assignee", report.breakdowns?.owner)}
        ${renderBreakdown("Borrowed/Lent", report.breakdowns?.borrowedLent)}
      </section>
      ${renderPanel(
        "Report Drilldown",
        `${formatNumber(report.total)} asset${report.total === 1 ? "" : "s"} match the current report filters.`,
        `<div class="search-result-list">${report.results?.length ? report.results.slice(0, 80).map(renderSearchResultCard).join("") : `<div class="empty-panel"><strong>No assets match this report.</strong><span>Clear a filter to widen the view.</span></div>`}</div>`
      )}
    ` : `<div class="empty-panel"><strong>No report loaded.</strong><span>Reports load automatically when this page opens.</span></div>`}
  `;
}

async function loadReport() {
  try {
    state.reportLoading = true;
    state.reportError = "";
    renderView();
    state.report = await requestJson(`/api/v2/reports?${reportQueryParams().toString()}`);
    state.reportError = "";
  } catch (error) {
    state.reportError = error.message;
  } finally {
    state.reportLoading = false;
    renderView();
  }
}

function governanceView(parts) {
  const codeMappings = state.snapshot?.codeMappings || [];
  const qualityRows = parts.map((part) => ({
    ...part,
    aliasCount: (part.aliases || []).length,
    metadataReady: part.metadata ? "Ready" : "Needs metadata",
    imageReady: part.imagePath ? "Ready" : "Needs image"
  }));

  return `
    ${renderPanel(
      "Catalog Quality",
      "Administrative view of the fields that determine search accuracy and future image-based matching readiness.",
      renderTable(
        [
          { label: "Catalog ID", render: (part) => `<strong>${escapeHtml(part.sku)}</strong><span class="subtext">${escapeHtml(part.partName)}</span>` },
          { label: "Family", render: (part) => escapeHtml(part.category) },
          { label: "Aliases", render: (part) => formatNumber(part.aliasCount) },
          { label: "Metadata", render: (part) => `<span class="quality-pill ${part.metadata ? "ready" : "review"}">${escapeHtml(part.metadataReady)}</span>` },
          { label: "Reference image", render: (part) => `<span class="quality-pill ${part.imagePath ? "ready" : "review"}">${escapeHtml(part.imageReady)}</span>` },
          { label: "Code mappings", render: (part) => formatNumber(part.barcodeCount) },
          { label: "Distinguishers", render: (part) => `<span class="metadata-cell">${escapeHtml(part.distinguishers || "Not defined")}</span>` }
        ],
        qualityRows,
        "No catalog governance records match this filter.",
        {
          tall: true,
          tableClass: "selectable-table wide-table",
          rowClass: (part) => (part.sku === state.selectedSku ? "selected-row" : ""),
          rowAttrs: (part) => `data-sku-row="${escapeHtml(part.sku)}"`
        }
      )
    )}
    ${renderPanel(
      "Barcode / QR Code Mappings",
      "Active code mappings connect physical labels to catalog records.",
      renderTable(
        [
          { label: "Code", render: (row) => `<strong>${escapeHtml(row.code)}</strong>` },
          { label: "Type", render: (row) => escapeHtml(row.code_type) },
          { label: "Catalog ID", render: (row) => escapeHtml(row.sku) },
          { label: "Status", render: (row) => `<span class="quality-pill ready">${escapeHtml(row.status)}</span>` },
          { label: "Notes", render: (row) => `<span class="metadata-cell">${escapeHtml(row.notes || "")}</span>` }
        ],
        codeMappings,
        "No code mappings are available.",
        { tall: true }
      )
    )}
  `;
}

function readinessTone(isReady) {
  return isReady ? "ready" : "review";
}

function renderReadinessChecklist() {
  const summary = state.snapshot?.summary || {};
  const system = state.snapshot?.system || {};
  const activity = state.snapshot?.activityLog?.results || [];
  const openRequests = (state.snapshot?.assetRequests || []).filter((request) => !["Closed", "Completed", "Cancelled"].includes(request.status)).length;
  const items = [
    {
      label: "Lifecycle",
      status: "Configured",
      tone: "ready",
      detail: "Ready to Deploy, In Use, Broken, EOL, E-waste Pending, Archived, Borrowed, and Lent are count-aware."
    },
    {
      label: "Asset coverage",
      status: summary.assetsTotalActive ? "Ready" : "Needs data",
      tone: readinessTone(summary.assetsTotalActive),
      detail: `${formatNumber(summary.assetsTotalActive || 0)} active assets, ${formatNumber(summary.assetsAvailable || 0)} available, ${formatNumber(summary.assetsExceptions || 0)} exceptions.`
    },
    {
      label: "Requests",
      status: openRequests ? "Open work" : "Clear",
      tone: openRequests ? "review" : "ready",
      detail: `${formatNumber(openRequests)} open request${openRequests === 1 ? "" : "s"} currently tracked.`
    },
    {
      label: "Backup and exports",
      status: system.lastBackupStatus === "Completed" ? "Ready" : "Run backup",
      tone: system.lastBackupStatus === "Completed" ? "ready" : "review",
      detail: system.lastBackupAt
        ? `Last backup completed ${formatDate(system.lastBackupAt)}. CSV exports are available.`
        : "Run a backup before release review. CSV exports are available."
    },
    {
      label: "Activity history",
      status: activity.length ? "Ready" : "Needs activity",
      tone: readinessTone(activity.length),
      detail: `${formatNumber(activity.length)} immutable log entr${activity.length === 1 ? "y" : "ies"} available for audit review.`
    }
  ];

  return `
    <section class="panel system-card wide-card">
      <div class="panel-heading">
        <div>
          <h2>Release Readiness</h2>
          <p>Compact administrator checks for access, records, requests, backup, and audit proof.</p>
        </div>
      </div>
      <div class="readiness-list">
        ${items
          .map(
            (item) => `
              <div class="readiness-item ${escapeHtml(item.tone)}">
                <span aria-hidden="true"></span>
                <div>
                  <strong>${escapeHtml(item.label)}</strong>
                  <small>${escapeHtml(item.detail)}</small>
                </div>
                <em>${escapeHtml(item.status)}</em>
              </div>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function systemView() {
  const system = state.snapshot?.system || {};
  const summary = state.snapshot?.summary || {};
  return `
    <section class="system-grid">
      ${systemCard("Inventory Counts", "Lifecycle-aware totals", [
        ["Last refreshed", state.snapshot?.generatedAt ? formatDate(state.snapshot.generatedAt) : "Just now"],
        ["Active assets", formatNumber(summary.assetsTotalActive)],
        ["Available", formatNumber(summary.assetsAvailable)],
        ["Unavailable", formatNumber(summary.assetsUnavailable)],
        ["Exceptions", formatNumber(summary.assetsExceptions)],
        ["Borrowed", formatNumber(summary.assetsBorrowed)],
        ["Lent", formatNumber(summary.assetsLent)]
      ])}
      ${systemCard("Backups", "Administrator data safety controls", [
        ["Last backup", system.lastBackupAt ? formatDate(system.lastBackupAt) : "Not run"],
        ["Backup status", system.lastBackupStatus || "Not run"]
      ], `
        <div class="button-row">
          <button class="button primary" id="runBackupButton" type="button">Run Backup Now</button>
          <a class="button secondary" href="/exports/inventory-snapshot">Export Inventory</a>
          <a class="button secondary" href="/exports/asset-activity">Export Activity</a>
        </div>
      `)}
      ${systemCard("Field Settings", "Current edit rules", [
        ["Status", "Dropdown lifecycle values"],
        ["Location", "Text entry, required"],
        ["Owner", "Required when In Use"],
        ["Borrowed/Lent", "Borrowed, Lent, In Stock"],
        ["Dates", "EOL uses YYYY-MM-DD"],
        ["Reason", "Required for edits and asset actions"]
      ])}
      ${systemCard("Import", "CSV preview before commit", [
        ["Required identity", "Category, model/name, serial or asset tag"],
        ["Validation", "Errors block commit"],
        ["Traceability", "Open Import from the sidebar"]
      ])}
      ${renderReadinessChecklist()}
    </section>
  `;
}

function systemCard(title, description, rows, footer = "") {
  return `
    <section class="panel system-card">
      <div class="panel-heading">
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(description)}</p>
        </div>
      </div>
      <dl class="definition-list">
        ${rows
          .map(
            ([label, value]) => `
              <div>
                <dt>${escapeHtml(label)}</dt>
                <dd>${escapeHtml(value)}</dd>
              </div>
            `
          )
          .join("")}
      </dl>
      ${footer}
    </section>
  `;
}

function renderImportPanel() {
  const preview = state.importPreview;
  const hasCsv = Boolean(state.importCsvText.trim());
  const issueCount = (preview?.issues || []).length;
  const hasBlockingErrors = (preview?.issues || []).some((issue) => issue.severity === "error");
  const previewRows = preview?.rows || [];
  return `
    <section class="panel system-card wide-card">
      <div class="panel-heading">
        <div>
          <h2>Import Batch Review</h2>
          <p>Choose a CSV file, preview readable rows and validation, then commit only when the batch is clean.</p>
        </div>
      </div>
      <form id="importPreviewForm" class="import-form">
        <label class="wide">
          Import type
          <select id="importProfile" name="importProfile">
            ${importProfiles.map((profile) => optionMarkup(profile.key, profile.label, state.importProfile)).join("")}
          </select>
          <span class="field-hint">${escapeHtml(importProfiles.find((profile) => profile.key === state.importProfile)?.hint || "")}</span>
        </label>
        <div class="import-file-drop wide">
          <label>
            CSV file
            <input id="importCsvFile" type="file" accept=".csv,text/csv" />
          </label>
          <div class="import-file-summary">
            <strong>${escapeHtml(state.importFileName || "No file selected")}</strong>
            <span>${state.importFileName ? `${formatFileSize(state.importFileSize)} loaded for preview` : "Select a CSV file from your machine."}</span>
          </div>
          ${state.importFileName ? `<button class="button secondary compact" type="button" data-clear-import-file>Remove file</button>` : ""}
        </div>
        <button class="button ghost compact import-paste-toggle" type="button" data-toggle-import-paste>
          ${state.importPasteOpen ? "Hide paste CSV fallback" : "Paste CSV instead"}
        </button>
        <label class="wide import-paste-area ${state.importPasteOpen ? "open" : ""}">
          CSV content
          <textarea id="importCsvText" placeholder="Full Name,Email,Username,item Name,Category,Model name,Manufacturer,Model Number,Serial number,Asset Tag,Location,Notes,Purchase Date,Purchase Cost,Company,Status,Warranty,Supplier">${escapeHtml(state.importCsvText || "")}</textarea>
        </label>
        <div class="button-row">
          <button class="button primary" type="submit" ${hasCsv ? "" : "disabled"}>Preview Import</button>
          ${preview?.batchId && !hasBlockingErrors ? `<button class="button secondary" type="button" data-commit-import="${escapeHtml(preview.batchId)}">Commit Import</button>` : ""}
        </div>
      </form>
      ${preview
        ? `
          <div class="import-preview">
            <strong>${formatNumber(preview.rowCount || 0)} rows read</strong>
            <span>${formatNumber(issueCount)} issue${issueCount === 1 ? "" : "s"}</span>
            <span>${escapeHtml(state.importFileName || "Pasted CSV")}</span>
            <span>${escapeHtml(preview.profileLabel || "Generic import")}</span>
          </div>
          ${(preview.mappedColumns || []).length
            ? `<div class="mapped-column-list">
                ${(preview.mappedColumns || []).map((column) => `<span>${escapeHtml(column.field)} <em>${escapeHtml(column.source)}</em></span>`).join("")}
              </div>`
            : ""}
          ${previewRows.length
            ? renderTable(
                (preview.headers || []).slice(0, 8).map((header) => ({
                  label: header,
                  render: (row) => escapeHtml(row.values?.[header] || "")
                })),
                previewRows.slice(0, 8),
                "No preview rows.",
                { tableClass: "compact-table" }
              )
            : ""}
          ${(preview.issues || []).length
            ? renderTable(
                [
                  { label: "Severity", render: (row) => `<span class="quality-pill ${escapeHtml(row.severity)}">${escapeHtml(row.severity)}</span>` },
                  { label: "Row", render: (row) => escapeHtml(row.row) },
                  { label: "Field", render: (row) => escapeHtml(row.field) },
                  { label: "Message", render: (row) => escapeHtml(row.message) }
                ],
                preview.issues,
                "No import issues.",
                { tall: true }
              )
            : `<div class="empty-panel"><strong>Preview is clean.</strong><span>Commit is available for this batch.</span></div>`}
        `
        : ""}
    </section>
  `;
}

function importView() {
  return renderImportPanel();
}

function renderInspector() {
  const visible = viewCopy[state.view].inspector;
  elements.inspector.hidden = !visible;
  elements.workGrid.classList.toggle("inspector-hidden", !visible);
  if (!visible) {
    elements.inspector.innerHTML = "";
    return;
  }

  const part = selectedPart();
  if (!part) {
    elements.inspector.innerHTML = `
      <div class="inspector-header">
        <span>Catalog Details</span>
        <strong>No catalog record selected</strong>
      </div>
      <div class="inspector-body">
        <p class="subtext">Select a row to review catalog details, status policy, identifiers, and actions.</p>
      </div>
    `;
    return;
  }

  state.selectedSku = part.sku;
  const codes = (state.snapshot?.codeMappings || []).filter((code) => code.sku === part.sku);
  elements.inspector.innerHTML = `
    <div class="inspector-header">
      <div>
        <span>Catalog Details</span>
        <strong>${escapeHtml(part.sku)}</strong>
        <small>${escapeHtml(part.partName)} - ${escapeHtml(part.category)}</small>
      </div>
      ${renderStatusPill(part.status)}
    </div>
    <div class="inspector-tabs">
      <button class="active" type="button">Overview</button>
      <button type="button" data-view="operations">Operations</button>
      <button type="button" data-view="governance">Governance</button>
    </div>
    <div class="inspector-body">
      <section class="detail-section">
        <h3>Catalog Record</h3>
        <dl class="definition-list">
          <div><dt>Part name</dt><dd>${escapeHtml(part.partName)}</dd></div>
          <div><dt>Category</dt><dd>${escapeHtml(part.category)}</dd></div>
          <div><dt>Responsible owner</dt><dd>${escapeHtml(part.owner)}</dd></div>
          <div><dt>Reference image</dt><dd>${escapeHtml(part.imagePath || "Administrator maintained image needed")}</dd></div>
        </dl>
      </section>
      <section class="detail-section">
        <h3>Status Policy</h3>
        <dl class="definition-list compact">
          <div><dt>Active quantity</dt><dd>${formatNumber(part.quantity)}</dd></div>
          <div><dt>Expected</dt><dd>${formatNumber(part.minimum)}</dd></div>
          <div><dt>Criticality</dt><dd>${escapeHtml(part.criticality)}</dd></div>
          <div><dt>Location</dt><dd>${escapeHtml(part.location)}</dd></div>
        </dl>
      </section>
      <section class="detail-section">
        <h3>Identifiers</h3>
        <div class="tag-list">
          ${(part.aliases || []).map((alias) => `<span>${escapeHtml(alias)}</span>`).join("") || "<span>No aliases defined</span>"}
        </div>
        <dl class="definition-list">
          <div><dt>Code mappings</dt><dd>${escapeHtml(codes.length ? codes.map((code) => code.code).join(", ") : "No active mappings")}</dd></div>
          <div><dt>Metadata</dt><dd>${escapeHtml(part.metadata || "No metadata defined")}</dd></div>
        </dl>
      </section>
      <div class="inspector-actions">
        <button class="button primary" type="button" data-view="operations" data-operation-mode="checkout">Checkout</button>
        <button class="button secondary" type="button" data-view="operations" data-operation-mode="restock">Receive</button>
      </div>
    </div>
  `;
}

function populateFilters() {
  const parts = state.snapshot?.parts || [];
  const current = currentFilters();
  const categories = [...new Set(parts.map((part) => part.category))].sort();
  const categoryScoped = parts.filter((part) => current.category === "all" || part.category === current.category);
  const skuScoped = categoryScoped.filter((part) => current.sku === "all" || part.sku === current.sku);
  const locations = [...new Set(skuScoped.map((part) => part.location))].sort();

  if (current.category !== "all" && !categories.includes(current.category)) elements.categoryFilter.value = "all";
  elements.categoryFilter.innerHTML = [
    optionMarkup("all", "All categories", current.category),
    ...categories.map((category) => optionMarkup(category, category, current.category))
  ].join("");

  elements.skuFilter.innerHTML = [
    optionMarkup("all", "All catalog IDs", current.sku),
    ...categoryScoped
      .slice()
      .sort((left, right) => left.sku.localeCompare(right.sku))
      .map((part) => optionMarkup(part.sku, `${part.sku} - ${part.partName}`, current.sku))
  ].join("");

  elements.locationFilter.innerHTML = [
    optionMarkup("all", "All locations", current.location),
    ...locations.map((location) => optionMarkup(location, location, current.location))
  ].join("");
}

function renderView() {
  if (!state.snapshot) return;
  const copy = viewCopy[state.view] || viewCopy.command;
  if (!viewCopy[state.view]) state.view = "command";
  const parts = copy.filters ? filteredParts() : state.snapshot.parts;

  updateUserHeader();
  elements.viewCrumb.textContent = copy.title;
  elements.viewTitle.textContent = copy.title;
  elements.viewDescription.textContent =
    state.view === "explorer" && state.domainLabel
      ? `${state.domainLabel} records in a focused device-domain view. Use search or filters to narrow further.`
      : copy.description;
  elements.filterPanel.hidden = !copy.filters;
  elements.metricGrid.hidden = !copy.metrics;
  elements.runtimeChip.textContent = `Updated ${formatDate(state.snapshot.generatedAt)}`;
  elements.runtimeChip.title = "Inventory data is current for this session.";

  if (copy.metrics) renderMetrics(parts);

  if (state.view === "command") elements.viewContent.innerHTML = commandView(parts);
  if (state.view === "import") elements.viewContent.innerHTML = importView();
  if (state.view === "devices") elements.viewContent.innerHTML = devicesView();
  if (state.view === "operations") elements.viewContent.innerHTML = operationsView(parts);
  if (state.view === "replenishment") elements.viewContent.innerHTML = replenishmentView(parts);
  if (state.view === "audit") elements.viewContent.innerHTML = auditView();
  if (state.view === "reports") elements.viewContent.innerHTML = reportsView();
  if (state.view === "governance") elements.viewContent.innerHTML = governanceView(parts);
  if (state.view === "system") elements.viewContent.innerHTML = systemView();

  renderInspector();
  renderOverlays();
  document
    .querySelectorAll(".nav-item[data-view], .inspector-tabs [data-view]")
    .forEach((item) => item.classList.toggle("active", item.dataset.view === state.view));
}

async function loadSnapshot() {
  setStatus("Refreshing inventory data...", "busy");
  applyTheme();
  updateUserHeader();
  const snapshot = await requestJson("/api/v2/session");
  state.snapshot = snapshot;
  state.deviceDomains = { ok: true, domains: [] };
  if (!state.selectedSku && state.snapshot.parts.length) {
    state.selectedSku = state.snapshot.parts.find((part) => part.quantity > 0)?.sku || state.snapshot.parts[0].sku;
  }
  populateFilters();
  renderView();
  if (state.view === "reports") loadReport();
  setStatus("Inventory data refreshed.");
}

function resetTransientWorkspace() {
  state.domainGroups = [];
  state.domainLabel = "";
  state.domainFilters = {};
  state.deviceFilters = {};
  state.strictSearch = {
    query: "",
    filters: {},
    result: null,
    detail: null,
    detailTab: "overview",
    loading: false,
    error: ""
  };
  state.assetEditErrors = {};
  state.selectedSearchAssets = new Set();
  state.actionModal = null;
  state.labelModal = null;
  state.report = null;
  state.reportFilters = {};
  state.reportLoading = false;
  state.reportError = "";
  state.importPreview = null;
  state.importCsvText = "";
  state.importFileName = "";
  state.importFileSize = 0;
  state.importProfile = "assets-gpu";
  state.importPasteOpen = false;
}

function resetFilters() {
  state.domainGroups = [];
  state.domainLabel = "";
  state.domainFilters = {};
  elements.categoryFilter.value = "all";
  elements.skuFilter.value = "all";
  elements.locationFilter.value = "all";
  elements.availabilityFilter.value = "all";
  elements.searchFilter.value = "";
  populateFilters();
  renderView();
  setStatus("Filters cleared.");
}

function exportFilteredCsv() {
  const parts = filteredParts();
  const headers = ["Category", "Catalog ID", "Model", "Active Quantity", "Expected", "Status", "Location", "Owner", "Aliases", "Metadata"];
  const csv = [
    headers.map(csvEscape).join(","),
    ...parts.map((part) =>
      [
        part.category,
        part.sku,
        part.partName,
        part.quantity,
        part.minimum,
        part.status.label,
        part.location,
        part.owner,
        (part.aliases || []).join("; "),
        part.metadata
      ]
        .map(csvEscape)
        .join(",")
    )
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "inventory-2.0-filtered-snapshot.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus(`${formatNumber(parts.length)} filtered catalog records exported.`);
}

function findByCode(codeValue) {
  const normalized = String(codeValue || "").trim().toLowerCase();
  if (!normalized) {
    setStatus("Enter or scan a 2D barcode value first.", "error");
    return;
  }
  const mapping = (state.snapshot?.codeMappings || []).find((code) => String(code.code).toLowerCase() === normalized);
  if (!mapping) {
    setStatus("Unknown code. In production this would route to Catalog Governance for administrator review.", "error");
    return;
  }
  state.selectedSku = mapping.sku;
  state.operationMode = "checkout";
  renderView();
  setStatus(`Code ${mapping.code} matched to ${mapping.sku}.`);
}

async function submitStockOperation(event) {
  event.preventDefault();
  const part = selectedPart();
  if (!part) return;
  const actor = currentActor();
  try {
    setStatus("Recording activity ledger entry...", "busy");
    const result = await requestJson("/api/v2/stock/transaction", {
      method: "POST",
      body: JSON.stringify({
        sku: part.sku,
        action: state.operationMode,
        quantity: document.querySelector("#operationQuantity").value,
        lookupMethod: document.querySelector("#operationLookup").value,
        nvbug: document.querySelector("#operationNvbug").value.trim(),
        operatorName: document.querySelector("#operationOperator").value.trim() || actor.actorName,
        operatorEmail: actor.actorEmail,
        reason: document.querySelector("#operationReason").value.trim(),
        referenceException: document.querySelector("#referenceException").checked
      })
    });
    state.snapshot = result.snapshot;
    populateFilters();
    renderView();
    setStatus(result.message);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function submitReplenishment(event) {
  event.preventDefault();
  const part = selectedPart();
  if (!part) return;
  const actor = currentActor();
  try {
    setStatus("Creating catalog request...", "busy");
    const result = await requestJson("/api/v2/replenishment", {
      method: "POST",
      body: JSON.stringify({
        sku: part.sku,
        requestedQty: document.querySelector("#requestQuantity").value,
        priority: document.querySelector("#requestPriority").value,
        notes: document.querySelector("#requestNotes").value.trim(),
        operatorName: actor.actorName,
        operatorEmail: actor.actorEmail
      })
    });
    state.snapshot = result.snapshot;
    renderView();
    setStatus(result.message);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function runBackup() {
  try {
    setStatus("Running database backup...", "busy");
    const result = await requestJson("/api/v2/system/backup", { method: "POST", body: "{}" });
    state.snapshot = result.snapshot;
    renderView();
    setStatus(result.message);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function setView(view) {
  if (!viewCopy[view]) return;
  if (state.view !== view) resetTransientWorkspace();
  state.view = view;
  populateFilters();
  renderView();
  if (view === "reports") loadReport();
}

function updateDomainFilter(control) {
  const fieldName = control.dataset.domainFilter;
  if (!fieldName) return;
  const value = control.value.trim();
  if (value) {
    state.domainFilters[fieldName] = value;
  } else {
    delete state.domainFilters[fieldName];
  }
  renderView();
  setStatus(`${fieldName} filter updated.`);
}

function updateDeviceFilter(control) {
  const fieldName = control.dataset.deviceFilter;
  if (!fieldName) return;
  const value = control.value.trim();
  if (value) {
    state.deviceFilters[fieldName] = value;
  } else {
    delete state.deviceFilters[fieldName];
  }
  renderView();
  setStatus("Device filters updated.");
}

async function runStrictSearch({ resetFilters = false, preserveDetail = false } = {}) {
  const input = document.querySelector("#homeSearchQuery");
  if (input) state.strictSearch.query = input.value.trim();
  if (resetFilters) {
    state.strictSearch.filters = {};
  }
  if (!state.strictSearch.query) {
    state.strictSearch.result = null;
    state.strictSearch.detail = null;
    state.strictSearch.error = "";
    state.strictSearch.loading = false;
    renderView();
    setStatus("Enter a search term to load matching inventory.");
    return;
  }
  state.strictSearch.loading = true;
  state.strictSearch.error = "";
  if (!preserveDetail) state.strictSearch.detail = null;
  renderView();

  try {
    const result = await requestJson(`/api/v2/search?${searchQueryParams().toString()}`);
    state.strictSearch.result = result;
    const visibleIds = new Set((result.results || []).map((item) => item.assetId || item.id));
    state.selectedSearchAssets = new Set([...state.selectedSearchAssets].filter((id) => visibleIds.has(id)));
    state.strictSearch.error = "";
    setStatus(`${formatNumber(result.total)} search result${result.total === 1 ? "" : "s"} loaded.`);
  } catch (error) {
    state.strictSearch.error = error.message;
    state.strictSearch.result = null;
    setStatus(error.message, "error");
  } finally {
    state.strictSearch.loading = false;
    renderView();
  }
}

async function openSearchDetail(sku) {
  try {
    setStatus(`Opening details for ${sku}...`, "busy");
    const detail = await requestJson(`/api/v2/assets/${encodeURIComponent(sku)}`);
    state.strictSearch.detail = detail;
    if (!state.strictSearch.detailTab) state.strictSearch.detailTab = "overview";
    state.assetEditErrors = {};
    renderView();
    setStatus(`${sku} details opened.`);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function openSearchWorkspace(assetId, tab = "overview") {
  state.strictSearch.detailTab = tab;
  await openSearchDetail(assetId);
  state.strictSearch.detailTab = tab;
  renderView();
}

function actionTitle(action) {
  const titles = {
    "check-out": "Check Out",
    "check-in": "Check In",
    transfer: "Transfer",
    request: "Create Request",
    "print-label": "Print Label"
  };
  return titles[action] || action;
}

function openAssetActionModal(assetId, action, isBulk = false) {
  if (action === "print-label" && !isBulk) {
    openLabelPreview(assetId);
    return;
  }
  state.actionModal = {
    assetId,
    action,
    isBulk,
    assetIds: isBulk ? [...state.selectedSearchAssets] : [assetId]
  };
  renderView();
}

async function openLabelPreview(assetId) {
  try {
    setStatus(`Preparing label preview for ${assetId}...`, "busy");
    const detail = state.strictSearch.detail?.asset?.id === assetId
      ? state.strictSearch.detail
      : await requestJson(`/api/v2/assets/${encodeURIComponent(assetId)}`);
    state.labelModal = { asset: detail.asset };
    renderView();
    setStatus("Label preview ready.");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function closeModal() {
  state.actionModal = null;
  state.labelModal = null;
  renderView();
}

async function performAssetAction(assetId, action, payload) {
  try {
    setStatus(`${action} for ${assetId}...`, "busy");
    const result = await requestJson(`/api/v2/assets/${encodeURIComponent(assetId)}/actions`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.snapshot = result.snapshot;
    state.strictSearch.detail = result.detail;
    await runStrictSearch({ preserveDetail: true });
    setStatus(result.message || `${action} recorded.`);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function performBulkAssetAction(action, payload) {
  const assetIds = [...state.selectedSearchAssets];
  try {
    setStatus(`Running bulk ${action}...`, "busy");
    const result = await requestJson("/api/v2/assets/bulk-actions", {
      method: "POST",
      body: JSON.stringify({ ...payload, assetIds })
    });
    state.snapshot = result.snapshot;
    state.selectedSearchAssets = new Set();
    await runStrictSearch();
    setStatus(result.message || "Bulk action recorded.");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function submitActionModal(form) {
  const modal = state.actionModal;
  if (!modal) return;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.action = modal.action;
  Object.assign(payload, currentActor());
  if (["check-out", "check-in"].includes(modal.action) && !String(payload.status || "").trim()) {
    setStatus("Status is required for check-in and check-out.", "error");
    return;
  }
  if (modal.action === "check-out" && !String(payload.owner || "").trim()) {
    setStatus("Owner / assignee is required for check-out.", "error");
    return;
  }
  if (["check-out", "check-in", "transfer"].includes(modal.action) && !String(payload.location || "").trim()) {
    setStatus("Location is required for this action.", "error");
    return;
  }
  if (!payload.reason && modal.action !== "print-label") {
    setStatus("Reason is required for traceability.", "error");
    return;
  }
  state.actionModal = null;
  if (modal.isBulk) {
    await performBulkAssetAction(modal.action, payload);
  } else {
    await performAssetAction(modal.assetId, modal.action, payload);
  }
}

async function recordLabelPrint(mode) {
  const asset = state.labelModal?.asset;
  if (!asset?.id) return;
  const payload = {
    action: "print-label",
    reason: mode === "pdf" ? "Label preview saved as PDF." : "Label preview printed.",
    nvbug: asset.nvbug || "",
    ...currentActor()
  };
  await performAssetAction(asset.id, "print-label", payload);
  state.labelModal = { asset };
  renderView();
  window.print();
}

async function saveAssetEdit(form) {
  const assetId = form.dataset.editAsset;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  Object.assign(payload, currentActor());
  state.assetEditErrors = validateAssetEditPayload(payload);
  if (Object.keys(state.assetEditErrors).length) {
    renderView();
    setStatus("Please fix the required fields before saving.", "error");
    return;
  }
  try {
    setStatus(`Saving ${assetId}...`, "busy");
    const result = await requestJson(`/api/v2/assets/${encodeURIComponent(assetId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    state.snapshot = result.snapshot;
    state.strictSearch.detail = result.detail;
    state.strictSearch.detailTab = "overview";
    state.assetEditErrors = {};
    await runStrictSearch({ preserveDetail: true });
    setStatus(result.message || `${assetId} saved.`);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function validateAssetEditPayload(payload) {
  const errors = {};
  if (!String(payload.category || "").trim()) errors.category = "Category is required.";
  if (!String(payload.modelName || "").trim()) errors.modelName = "Model is required.";
  if (!String(payload.serialNo || "").trim() && !String(payload.assetTag || "").trim()) {
    errors.serialOrAsset = "Enter a serial number or asset tag.";
  }
  if (!String(payload.status || "").trim()) errors.status = "Status is required.";
  if (String(payload.status || "").trim() === "In Use" && !String(payload.owner || "").trim()) {
    errors.owner = "Owner is required when status is In Use.";
  }
  if (!String(payload.location || "").trim()) errors.location = "Location is required.";
  if (!String(payload.reason || "").trim()) errors.reason = "Reason is required for traceability.";
  return errors;
}

async function uploadModelImage(modelId) {
  const fileInput = document.querySelector("#modelImageFile");
  const reasonInput = document.querySelector("#modelImageReason");
  const file = fileInput?.files?.[0];
  const reason = reasonInput?.value?.trim() || "";
  if (!file) {
    setStatus("Choose an image file first.", "error");
    return;
  }
  if (!reason) {
    setStatus("Reason is required before changing the model image.", "error");
    reasonInput?.focus();
    return;
  }
  const formData = new FormData();
  formData.append("image", file);
  formData.append("reason", reason);
  const actor = currentActor();
  formData.append("actorName", actor.actorName);
  formData.append("actorEmail", actor.actorEmail);
  try {
    setStatus("Uploading model image...", "busy");
    const result = await requestFormData(`/api/v2/asset-models/${encodeURIComponent(modelId)}/image`, formData);
    state.snapshot = result.snapshot;
    if (state.strictSearch.detail?.asset?.id) {
      state.strictSearch.detail = await requestJson(`/api/v2/assets/${encodeURIComponent(state.strictSearch.detail.asset.id)}`);
      state.strictSearch.detailTab = "edit";
    }
    await runStrictSearch({ preserveDetail: true });
    setStatus(result.message || "Model image uploaded.");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function removeModelImage(modelId) {
  const reasonInput = document.querySelector("#modelImageReason");
  const reason = reasonInput?.value?.trim() || "";
  if (!reason) {
    setStatus("Reason is required before removing the model image.", "error");
    reasonInput?.focus();
    return;
  }
  try {
    setStatus("Removing model image...", "busy");
    const result = await requestJson(`/api/v2/asset-models/${encodeURIComponent(modelId)}/image`, {
      method: "DELETE",
      body: JSON.stringify({ reason, ...currentActor() })
    });
    state.snapshot = result.snapshot;
    if (state.strictSearch.detail?.asset?.id) {
      state.strictSearch.detail = await requestJson(`/api/v2/assets/${encodeURIComponent(state.strictSearch.detail.asset.id)}`);
      state.strictSearch.detailTab = "edit";
    }
    await runStrictSearch({ preserveDetail: true });
    setStatus(result.message || "Model image removed.");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function handleImportFile(file) {
  if (!file) return;
  const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv" || file.type === "application/vnd.ms-excel";
  if (!isCsv) {
    setStatus("Choose a CSV file for import.", "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    state.importCsvText = String(reader.result || "");
    state.importFileName = file.name;
    state.importFileSize = file.size;
    state.importPreview = null;
    state.importPasteOpen = false;
    renderView();
    setStatus(`${file.name} loaded. Preview the import before committing.`);
  };
  reader.onerror = () => setStatus("Could not read that CSV file.", "error");
  reader.readAsText(file);
}

async function previewImport(event) {
  event.preventDefault();
  const csvText = document.querySelector("#importCsvText")?.value || "";
  state.importCsvText = csvText;
  const fileName = state.importFileName || "pasted-csv-preview.csv";
  try {
    setStatus("Reading CSV preview...", "busy");
    state.importPreview = await requestJson("/api/v2/import/preview", {
      method: "POST",
      body: JSON.stringify({ csvText, fileName })
    });
    await loadSnapshot();
    state.view = "import";
    renderView();
    setStatus("Import preview ready.");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function commitImport(batchId) {
  try {
    setStatus("Committing import batch...", "busy");
    const result = await requestJson(`/api/v2/import/${encodeURIComponent(batchId)}/commit`, {
      method: "POST",
      body: JSON.stringify({ csvText: state.importCsvText, fileName: state.importFileName || "pasted-csv-commit.csv" })
    });
    state.snapshot = result.snapshot;
    state.importPreview = null;
    state.importCsvText = "";
    state.importFileName = "";
    state.importFileSize = 0;
    state.importPasteOpen = false;
    renderView();
    setStatus(result.message || "Import committed.");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function exportSelectedAssets() {
  const resultRows = state.strictSearch.result?.results || [];
  const selected = resultRows.filter((item) => state.selectedSearchAssets.has(item.assetId || item.id));
  const headers = ["Asset ID", "Asset Tag", "Serial", "Category", "Model", "Status", "Location", "Owner", "NVBug"];
  const csv = [
    headers.map(csvEscape).join(","),
    ...selected.map((item) => [
      item.assetId || item.id,
      item.assetTag,
      item.serialNo,
      item.category,
      item.modelName,
      item.status?.label,
      item.location,
      item.owner,
      item.nvbug
    ].map(csvEscape).join(","))
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "inventory-2.0-selected-assets.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus(`${formatNumber(selected.length)} selected assets exported.`);
}

function renderActionModal() {
  const modal = state.actionModal;
  if (!modal) return "";
  const title = `${modal.isBulk ? "Bulk " : ""}${actionTitle(modal.action)}`;
  const assetCount = modal.assetIds?.length || 1;
  const actionAsset = actionModalAsset();
  const locationValue = actionAsset.location || "Santa Clara Building R";
  const ownerValue = actionAsset.owner || "#imargulis-staff";
  const checkOutStatus = actionAsset.status === "In Use" ? actionAsset.status : "In Use";
  const checkInStatus = ["Ready to Deploy", "Idle"].includes(actionAsset.status) ? actionAsset.status : "Ready to Deploy";
  return `
    <div class="modal-backdrop" data-modal-backdrop>
      <section class="action-modal" role="dialog" aria-modal="true" aria-labelledby="actionModalTitle">
        <div class="modal-heading">
          <div>
            <h2 id="actionModalTitle">${escapeHtml(title)}</h2>
            <p>${modal.isBulk ? `${formatNumber(assetCount)} selected assets` : escapeHtml(modal.assetId)}</p>
          </div>
          <button class="icon-button" type="button" data-close-modal aria-label="Close">&times;</button>
        </div>
        <form id="assetActionForm" class="modal-form">
          ${modal.action === "check-out" ? `
            <label>${requiredLabel("Status", true)}<select name="status" required>${selectOptions(statusOptions, checkOutStatus, "Select status")}</select></label>
            <label>${requiredLabel("Owner / assignee", true)}<select name="owner" required>${selectOptions(ownerOptions(ownerValue), ownerValue, "Select owner / assignee")}</select></label>
            <label>${requiredLabel("Usage / project")}<input name="usage" placeholder="Project, lab, system, or workflow" /></label>
            <label>${requiredLabel("Location", true)}<select name="location" required>${selectOptions(locationOptions(locationValue), locationValue, "Select location")}</select></label>
          ` : ""}
          ${modal.action === "check-in" ? `
            <label>${requiredLabel("Destination status", true)}
              <select name="status" required>${selectOptions(statusOptions, checkInStatus, "Select destination status")}</select>
            </label>
            <label>${requiredLabel("Return location", true)}<select name="location" required>${selectOptions(locationOptions(locationValue), locationValue, "Select return location")}</select></label>
          ` : ""}
          ${modal.action === "transfer" ? `
            <label>${requiredLabel("New owner")}<select name="owner">${selectOptions(ownerOptions(ownerValue), ownerValue, "Select owner / assignee")}</select></label>
            <label>${requiredLabel("New location", true)}<select name="location" required>${selectOptions(locationOptions(locationValue), locationValue, "Select location")}</select></label>
          ` : ""}
          ${modal.action === "request" ? `
            <label>${requiredLabel("Request type", true)}
              <select name="requestType">
                <option>Support</option>
                <option>Transfer</option>
                <option>Repair</option>
                <option>E-waste</option>
                <option>Restock</option>
              </select>
            </label>
            <label>${requiredLabel("Priority", true)}
              <select name="priority">
                <option>Normal</option>
                <option>High</option>
                <option>Critical</option>
              </select>
            </label>
            <label>${requiredLabel("Owner / assignee")}<select name="owner">${selectOptions(ownerOptions(ownerValue), ownerValue, "Select owner / assignee")}</select></label>
            <label>${requiredLabel("Location")}<select name="location">${selectOptions(locationOptions(locationValue), locationValue, "Select location")}</select></label>
          ` : ""}
          <label>${requiredLabel("NVBug #")}<input name="nvbug" placeholder="9000001" /></label>
          <label class="wide">${requiredLabel("Reason", modal.action !== "print-label")}<textarea name="reason" placeholder="Required: why this change is being made"></textarea></label>
          <div class="form-actions">
            <button class="button primary" type="submit">${escapeHtml(actionTitle(modal.action))}</button>
            <button class="button secondary" type="button" data-close-modal>Cancel</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function labelBarcodeValue(asset) {
  return asset.serialNo || asset.assetTag || asset.id || "";
}

function renderLabelModal() {
  const asset = state.labelModal?.asset;
  if (!asset) return "";
  const identifier = asset.assetTag || asset.id || asset.serialNo || "";
  const barcode = labelBarcodeValue(asset);
  return `
    <div class="modal-backdrop" data-modal-backdrop>
      <section class="action-modal label-preview-modal" role="dialog" aria-modal="true" aria-labelledby="labelPreviewTitle">
        <div class="modal-heading no-print">
          <div>
            <h2 id="labelPreviewTitle">Label Preview</h2>
            <p>Select Print, then choose an installed USB/network printer or save as PDF.</p>
          </div>
          <button class="icon-button" type="button" data-close-modal aria-label="Close">&times;</button>
        </div>
        <div class="label-print-sheet">
          <div class="asset-label-card">
            <strong>${escapeHtml(asset.modelName || asset.category || "Inventory Asset")}</strong>
            <span>${escapeHtml(identifier)}</span>
            ${renderBarcodeSvg(barcode)}
            <em>${escapeHtml(barcode)}</em>
          </div>
        </div>
        <div class="form-actions no-print">
          <button class="button primary" type="button" data-label-print="print">Print</button>
          <button class="button secondary" type="button" data-label-print="pdf">Save as PDF</button>
          <button class="button secondary" type="button" data-close-modal>Cancel</button>
        </div>
      </section>
    </div>
  `;
}

function renderLoginOverlay() {
  if (state.currentUser) return "";
  return `
    <div class="login-backdrop">
      <section class="login-card" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
        <div class="login-brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <strong>NVIDIA</strong>
        </div>
        <h2 id="loginTitle">Inventory Sign In</h2>
        <p>Select your name to auto-fill email. Guests and non-registered users can enter details manually.</p>
        <form id="loginForm" class="login-form">
          <label>
            Member
            <select id="loginMember" name="member" required>
              <option value="">Select member...</option>
              ${teamMembers.map((member) => optionMarkup(member.name, member.name, "")).join("")}
              <option value="Guest / not listed">Guest / not listed</option>
            </select>
          </label>
          <label>
            Email
            <input id="loginEmail" name="email" placeholder="Select a member first" autocomplete="email" required />
          </label>
          <fieldset class="login-mode">
            <legend>Login mode</legend>
            <label><input type="radio" name="role" value="regular" checked /> Regular User</label>
            <label><input type="radio" name="role" value="admin" /> Admin User</label>
          </fieldset>
          <button class="button primary" type="submit">Continue</button>
        </form>
      </section>
    </div>
  `;
}

function renderOverlays() {
  let root = document.querySelector("#overlayRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "overlayRoot";
    document.body.append(root);
  }
  root.innerHTML = `${renderSearchDetail()}${renderLoginOverlay()}${renderActionModal()}${renderLabelModal()}`;
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", loadSnapshot);
  elements.signOutButton?.addEventListener("click", () => {
    saveCurrentUser(null);
    renderView();
    setStatus("Signed out.");
  });
  elements.themeSelect?.addEventListener("change", () => {
    state.theme = elements.themeSelect.value;
    applyTheme();
    setStatus(`${state.theme} mode applied.`);
  });
  elements.clearFiltersButton.addEventListener("click", resetFilters);
  elements.exportFilteredButton.addEventListener("click", exportFilteredCsv);

  [elements.categoryFilter, elements.skuFilter, elements.locationFilter, elements.availabilityFilter].forEach((control) => {
    control.addEventListener("change", () => {
      state.domainGroups = [];
      state.domainLabel = "";
      state.domainFilters = {};
      if (control === elements.categoryFilter) {
        elements.skuFilter.value = "all";
        elements.locationFilter.value = "all";
      }
      if (control === elements.skuFilter) elements.locationFilter.value = "all";
      populateFilters();
      renderView();
      setStatus("Filters changed. Results updated.");
    });
  });
  elements.searchFilter.addEventListener("input", renderView);

  document.addEventListener("change", (event) => {
    if (event.target.id === "loginMember") {
      syncLoginEmail(event.target.value);
      return;
    }

    if (event.target.id === "importCsvFile") {
      handleImportFile(event.target.files?.[0]);
      return;
    }

    const selectedAsset = event.target.closest("[data-select-search-asset]");
    if (selectedAsset) {
      const assetId = selectedAsset.dataset.selectSearchAsset;
      if (selectedAsset.checked) {
        state.selectedSearchAssets.add(assetId);
      } else {
        state.selectedSearchAssets.delete(assetId);
      }
      renderView();
      setStatus(`${formatNumber(state.selectedSearchAssets.size)} asset${state.selectedSearchAssets.size === 1 ? "" : "s"} selected.`);
      return;
    }

    const domainFilter = event.target.closest("[data-domain-filter]");
    if (domainFilter) updateDomainFilter(domainFilter);

    const deviceFilter = event.target.closest("[data-device-filter]");
    if (deviceFilter) updateDeviceFilter(deviceFilter);

    const searchFilter = event.target.closest("[data-search-filter-control]");
    if (searchFilter) {
      const key = searchFilter.dataset.searchFilterControl;
      state.strictSearch.filters[key] = searchFilter.value.trim();
      if (!state.strictSearch.filters[key]) delete state.strictSearch.filters[key];
      runStrictSearch();
      return;
    }

    const reportFilter = event.target.closest("[data-report-filter]");
    if (reportFilter) {
      const key = reportFilter.dataset.reportFilter;
      state.reportFilters[key] = reportFilter.value.trim();
      if (!state.reportFilters[key]) delete state.reportFilters[key];
      loadReport();
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.id === "importCsvText") {
      state.importCsvText = event.target.value;
      state.importFileName = state.importFileName && state.importCsvText ? state.importFileName : "";
      state.importFileSize = state.importFileName ? state.importFileSize : 0;
      state.importPreview = null;
    }

    const deviceFilter = event.target.closest("input[data-device-filter]");
    if (deviceFilter) updateDeviceFilter(deviceFilter);

    const searchFilter = event.target.closest("input[data-search-filter-control]");
    if (searchFilter) state.strictSearch.filters[searchFilter.dataset.searchFilterControl] = searchFilter.value.trim();

    const reportFilter = event.target.closest("input[data-report-filter]");
    if (reportFilter) state.reportFilters[reportFilter.dataset.reportFilter] = reportFilter.value.trim();
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-toggle-import-paste]")) {
      state.importPasteOpen = !state.importPasteOpen;
      renderView();
      return;
    }

    if (event.target.closest("[data-clear-import-file]")) {
      state.importCsvText = "";
      state.importFileName = "";
      state.importFileSize = 0;
      state.importPreview = null;
      state.importPasteOpen = false;
      renderView();
      setStatus("Import file removed.");
      return;
    }

    const searchFacet = event.target.closest("[data-search-facet]");
    if (searchFacet) {
      const key = searchFacet.dataset.searchFacet;
      const value = searchFacet.dataset.searchValue || "";
      state.strictSearch.filters[key] = state.strictSearch.filters[key] === value ? "" : value;
      runStrictSearch();
      return;
    }

    if (event.target.closest("[data-clear-search-filters]")) {
      state.strictSearch.filters = {};
      runStrictSearch();
      return;
    }

    if (event.target.closest("[data-clear-search-all]")) {
      state.strictSearch.query = "";
      state.strictSearch.filters = {};
      state.strictSearch.result = null;
      state.strictSearch.detail = null;
      state.strictSearch.detailTab = "overview";
      state.assetEditErrors = {};
      state.selectedSearchAssets = new Set();
      renderView();
      setStatus("Search cleared.");
      return;
    }

    const searchCategory = event.target.closest("[data-search-category]");
    if (searchCategory) {
      state.strictSearch.query = searchCategory.dataset.searchCategory || "";
      state.strictSearch.filters = {};
      const input = document.querySelector("#homeSearchQuery");
      if (input) input.value = state.strictSearch.query;
      runStrictSearch({ resetFilters: true });
      return;
    }

    const searchDetails = event.target.closest("[data-search-details]");
    if (searchDetails) {
      openSearchWorkspace(searchDetails.dataset.searchDetails, "overview");
      return;
    }

    const searchEdit = event.target.closest("[data-search-edit]");
    if (searchEdit) {
      openSearchWorkspace(searchEdit.dataset.searchEdit, "edit");
      return;
    }

    const sheetTab = event.target.closest("[data-asset-sheet-tab]");
    if (sheetTab) {
      state.strictSearch.detailTab = sheetTab.dataset.assetSheetTab || "overview";
      state.assetEditErrors = {};
      renderView();
      return;
    }

    if (event.target.closest("[data-close-search-detail]")) {
      state.strictSearch.detail = null;
      state.strictSearch.detailTab = "overview";
      state.assetEditErrors = {};
      renderView();
      setStatus("Details closed.");
      return;
    }

    const uploadImage = event.target.closest("[data-upload-model-image]");
    if (uploadImage) {
      uploadModelImage(uploadImage.dataset.uploadModelImage);
      return;
    }

    const removeImage = event.target.closest("[data-remove-model-image]");
    if (removeImage) {
      removeModelImage(removeImage.dataset.removeModelImage);
      return;
    }

    const assetAction = event.target.closest("[data-asset-action]");
    if (assetAction) {
      openAssetActionModal(assetAction.dataset.assetId, assetAction.dataset.assetAction);
      return;
    }

    const detailAction = event.target.closest("[data-detail-asset-action]");
    if (detailAction) {
      openAssetActionModal(detailAction.dataset.assetId, detailAction.dataset.detailAssetAction);
      return;
    }

    const bulkAction = event.target.closest("[data-bulk-asset-action]");
    if (bulkAction) {
      openAssetActionModal("", bulkAction.dataset.bulkAssetAction, true);
      return;
    }

    const labelPrint = event.target.closest("[data-label-print]");
    if (labelPrint) {
      recordLabelPrint(labelPrint.dataset.labelPrint);
      return;
    }

    if (event.target.closest("[data-close-modal]")) {
      closeModal();
      return;
    }

    if (event.target.matches("[data-modal-backdrop]")) {
      closeModal();
      return;
    }

    if (event.target.closest("[data-clear-report-filters]")) {
      state.reportFilters = {};
      loadReport();
      return;
    }

    const reportPill = event.target.closest("[data-report-filter-pill]");
    if (reportPill) {
      const map = { status: "status", location: "location", "owner / assignee": "owner", "borrowed/lent": "borrowedLent" };
      const key = map[reportPill.dataset.reportFilterPill] || "";
      if (key) {
        state.reportFilters[key] = reportPill.dataset.reportFilterValue || "";
        loadReport();
      }
      return;
    }

    if (event.target.closest("[data-clear-selected-assets]")) {
      state.selectedSearchAssets = new Set();
      renderView();
      setStatus("Selection cleared.");
      return;
    }

    if (event.target.closest("[data-export-selected-assets]")) {
      exportSelectedAssets();
      return;
    }

    const requestAsset = event.target.closest("[data-request-asset]");
    if (requestAsset) {
      openSearchWorkspace(requestAsset.dataset.requestAsset, "operations");
      setStatus(`${requestAsset.dataset.requestAsset} opened from Requests.`);
      return;
    }

    const commitButton = event.target.closest("[data-commit-import]");
    if (commitButton) {
      commitImport(commitButton.dataset.commitImport);
      return;
    }

    const selectDeviceDomain = event.target.closest("[data-select-device-domain]");
    if (selectDeviceDomain) {
      state.selectedDeviceDomainSlug = selectDeviceDomain.dataset.selectDeviceDomain || state.selectedDeviceDomainSlug;
      state.deviceFilters = {};
      renderView();
      setStatus(`${activeDeviceDomain()?.label || "Catalog family"} opened.`);
      return;
    }

    const domainTile = event.target.closest("[data-domain-label]");
    if (domainTile) {
      if (domainTile.dataset.deviceDomain === "converged-gpu-dpu") {
        state.view = "devices";
        state.selectedDeviceDomainSlug = domainTile.dataset.deviceDomain;
        state.domainLabel = "";
        state.domainGroups = [];
        state.domainFilters = {};
        state.deviceFilters = {};
        renderView();
        setStatus("Converged GPU+DPU opened.");
        return;
      }

      state.view = "devices";
      state.domainLabel = "";
      state.domainGroups = [];
      state.domainFilters = {};
      state.deviceFilters = {};
      renderView();
      setStatus("Parts Catalog opened.");
      return;
    }

    const deviceDomainTile = event.target.closest("[data-device-domain]");
    if (deviceDomainTile) {
      state.view = "devices";
      state.selectedDeviceDomainSlug = deviceDomainTile.dataset.deviceDomain || state.selectedDeviceDomainSlug;
      state.domainLabel = "";
      state.domainGroups = [];
      state.domainFilters = {};
      state.deviceFilters = {};
      renderView();
      setStatus(`${activeDeviceDomain()?.label || "Catalog family"} opened.`);
      return;
    }

    if (event.target.closest("[data-clear-device-filters]")) {
      state.deviceFilters = {};
      renderView();
      setStatus("Device filters cleared.");
      return;
    }

    if (event.target.closest("[data-clear-domain-filters]")) {
      state.domainFilters = {};
      renderView();
      setStatus("Domain filters cleared.");
      return;
    }

    const codeSample = event.target.closest("[data-code-sample]");
    if (codeSample) {
      const input = document.querySelector("#codeLookupInput");
      if (input) input.value = codeSample.dataset.codeSample;
      findByCode(codeSample.dataset.codeSample);
      return;
    }

    if (event.target.closest("#runCodeLookup")) {
      findByCode(document.querySelector("#codeLookupInput")?.value);
      return;
    }

    const operationMode = event.target.closest("[data-operation-mode]");
    if (operationMode) {
      state.operationMode = operationMode.dataset.operationMode;
      const view = operationMode.dataset.view;
      if (view) state.view = view;
      renderView();
      return;
    }

    if (event.target.closest("[data-clear-operation]")) {
      renderView();
      setStatus("Operation form reset.");
      return;
    }

    const row = event.target.closest("[data-sku-row]");
    if (row) {
      state.selectedSku = row.dataset.skuRow;
      renderView();
      setStatus(`${state.selectedSku} selected.`);
      return;
    }

    const nav = event.target.closest("[data-view]");
    if (nav) {
      setView(nav.dataset.view);
      setStatus(`${viewCopy[state.view].title} opened.`);
      return;
    }

    if (event.target.closest("#runBackupButton")) {
      runBackup();
    }
  });

  document.addEventListener("submit", (event) => {
    if (event.target.id === "loginForm") {
      event.preventDefault();
      const formData = new FormData(event.target);
      const memberName = String(formData.get("member") || "").trim();
      const email = String(formData.get("email") || "").trim();
      const role = String(formData.get("role") || "regular") === "admin" ? "admin" : "regular";
      if (!memberName || !email) {
        setStatus("Select a member and confirm email.", "error");
        return;
      }
      saveCurrentUser({ name: memberName, email, role });
      renderView();
      setStatus(`${memberName} signed in as ${role === "admin" ? "Admin user" : "Regular user"}.`);
      return;
    }

    if (event.target.id === "inventorySearchForm") {
      event.preventDefault();
      runStrictSearch({ resetFilters: true });
    }
    if (event.target.id === "assetEditForm") {
      event.preventDefault();
      saveAssetEdit(event.target);
    }
    if (event.target.id === "assetActionForm") {
      event.preventDefault();
      submitActionModal(event.target);
    }
    if (event.target.id === "importPreviewForm") {
      previewImport(event);
    }
    if (event.target.id === "stockOperationForm") submitStockOperation(event);
    if (event.target.id === "replenishmentForm") submitReplenishment(event);
  });
}

bindEvents();
loadSnapshot().catch((error) => setStatus(error.message, "error"));
