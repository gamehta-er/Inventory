const lowThreshold = 5;
const userStorageKey = "labInventoryUser";
const adminEmails = new Set(["gamehta@nvidia.com", "monicam@nvidia.com"]);
const replenishmentColumns = [
  { key: "New Request", label: "New Requests", help: "Restock requests waiting for review or assignment." },
  { key: "Submitted", label: "Submitted", help: "The request has been acknowledged and routed." },
  { key: "In Progress", label: "In Progress", help: "Restock, transfer, or replacement work is active." },
  { key: "Completed", label: "Completed", help: "Inventory was refilled or the request was closed." }
];

const state = {
  user: null,
  catalog: null,
  inventory: null,
  replenishment: null,
  activeRoute: "",
  members: [],
  adminCsv: null,
  controlSettings: null,
  managementReport: null,
  importDraft: null,
  pendingReview: null,
  searchResult: null,
  candidate: null,
  confirmedPart: null,
  lookupContext: { method: "Manual Search", code: "" }
};

const elements = {
  loginGate: document.querySelector("#loginGate"),
  loginForm: document.querySelector("#loginForm"),
  memberSelect: document.querySelector("#memberSelect"),
  loginName: document.querySelector("#loginName"),
  guestNameLabel: document.querySelector("#guestNameLabel"),
  loginEmail: document.querySelector("#loginEmail"),
  roleChoice: document.querySelector("#roleChoice"),
  loginStatus: document.querySelector("#loginStatus"),
  userChip: document.querySelector("#userChip"),
  logoutButton: document.querySelector("#logoutButton"),
  saveStatus: document.querySelector("#saveStatus"),
  overviewHeader: document.querySelector("#overviewHeader"),
  refreshButton: document.querySelector("#refreshButton"),
  lookupMethodInputs: [...document.querySelectorAll("input[name='lookupMethod']")],
  manualLookupPanel: document.querySelector("#manualLookupPanel"),
  codeLookupPanel: document.querySelector("#codeLookupPanel"),
  categoryHint: document.querySelector("#categoryHint"),
  detailHint: document.querySelector("#detailHint"),
  skuHint: document.querySelector("#skuHint"),
  scanHints: document.querySelector("#scanHints"),
  scanStatus: document.querySelector("#scanStatus"),
  analyzeButton: document.querySelector("#analyzeButton"),
  partCodeInput: document.querySelector("#partCodeInput"),
  lookupCodeButton: document.querySelector("#lookupCodeButton"),
  codeLookupStatus: document.querySelector("#codeLookupStatus"),
  matchPanel: document.querySelector("#matchPanel"),
  matchPanelTitle: document.querySelector("#matchPanelTitle"),
  matchResult: document.querySelector("#matchResult"),
  matchActionRow: document.querySelector("#matchActionRow"),
  confirmMatchButton: document.querySelector("#confirmMatchButton"),
  rejectMatchButton: document.querySelector("#rejectMatchButton"),
  evaluationPanel: document.querySelector("#evaluationPanel"),
  evaluationReason: document.querySelector("#evaluationReason"),
  sendEvaluationButton: document.querySelector("#sendEvaluationButton"),
  movementPanel: document.querySelector("#movementPanel"),
  confirmedPart: document.querySelector("#confirmedPart"),
  movementAction: document.querySelector("#movementAction"),
  movementQuantity: document.querySelector("#movementQuantity"),
  movementReason: document.querySelector("#movementReason"),
  movementNvbug: document.querySelector("#movementNvbug"),
  movementNoNvbug: document.querySelector("#movementNoNvbug"),
  updateInventoryButton: document.querySelector("#updateInventoryButton"),
  finishSignOutButton: document.querySelector("#finishSignOutButton"),
  locationPanel: document.querySelector("#locationPanel"),
  locationResult: document.querySelector("#locationResult"),
  inventoryHeader: document.querySelector("#inventoryHeader"),
  inventoryRow: document.querySelector("#inventoryRow"),
  inventorySource: document.querySelector("#inventorySource"),
  replenishmentSku: document.querySelector("#replenishmentSku"),
  replenishmentItem: document.querySelector("#replenishmentItem"),
  replenishmentQuantity: document.querySelector("#replenishmentQuantity"),
  replenishmentPriority: document.querySelector("#replenishmentPriority"),
  replenishmentNotes: document.querySelector("#replenishmentNotes"),
  replenishmentCreate: document.querySelector("#replenishmentCreate"),
  replenishmentRefresh: document.querySelector("#replenishmentRefresh"),
  replenishmentSummary: document.querySelector("#replenishmentSummary"),
  replenishmentBoard: document.querySelector("#replenishmentBoard"),
  replenishmentStatus: document.querySelector("#replenishmentStatus"),
  managementCategory: document.querySelector("#managementCategory"),
  managementSku: document.querySelector("#managementSku"),
  managementLocation: document.querySelector("#managementLocation"),
  managementStockStatus: document.querySelector("#managementStockStatus"),
  managementSearch: document.querySelector("#managementSearch"),
  managementRefresh: document.querySelector("#managementRefresh"),
  managementReset: document.querySelector("#managementReset"),
  managementExport: document.querySelector("#managementExport"),
  managementEmptyState: document.querySelector("#managementEmptyState"),
  managementFilterSummary: document.querySelector("#managementFilterSummary"),
  managementGrid: document.querySelector("#managementGrid"),
  managementSections: [...document.querySelectorAll("[data-management-section]")],
  managementSummary: document.querySelector("#managementSummary"),
  managementCategoryTable: document.querySelector("#managementCategoryTable"),
  managementSkuTable: document.querySelector("#managementSkuTable"),
  managementLocationTable: document.querySelector("#managementLocationTable"),
  managementStatus: document.querySelector("#managementStatus"),
  controlRefresh: document.querySelector("#controlRefresh"),
  controlHero: document.querySelector("#controlHero"),
  controlApplicationList: document.querySelector("#controlApplicationList"),
  controlAccessList: document.querySelector("#controlAccessList"),
  controlInventoryList: document.querySelector("#controlInventoryList"),
  controlReviewList: document.querySelector("#controlReviewList"),
  controlReviewStatus: document.querySelector("#controlReviewStatus"),
  controlDataList: document.querySelector("#controlDataList"),
  controlSettingsForm: document.querySelector("#controlSettingsForm"),
  controlSupportEmail: document.querySelector("#controlSupportEmail"),
  controlBackupDirectory: document.querySelector("#controlBackupDirectory"),
  controlBrowseBackup: document.querySelector("#controlBrowseBackup"),
  controlBackupFolderInput: document.querySelector("#controlBackupFolderInput"),
  controlUseDefaultBackup: document.querySelector("#controlUseDefaultBackup"),
  controlSaveSettings: document.querySelector("#controlSaveSettings"),
  controlRunBackup: document.querySelector("#controlRunBackup"),
  controlStatus: document.querySelector("#controlStatus"),
  adminCsvFile: document.querySelector("#adminCsvFile"),
  adminCsvTable: document.querySelector("#adminCsvTable"),
  adminCsvAddRow: document.querySelector("#adminCsvAddRow"),
  adminCsvNewColumn: document.querySelector("#adminCsvNewColumn"),
  adminCsvAddColumn: document.querySelector("#adminCsvAddColumn"),
  adminCsvImportFile: document.querySelector("#adminCsvImportFile"),
  adminCsvImporter: document.querySelector("#adminCsvImporter"),
  adminCsvImportMode: document.querySelector("#adminCsvImportMode"),
  adminCsvImportPrompt: document.querySelector("#adminCsvImportPrompt"),
  adminCsvImportMapping: document.querySelector("#adminCsvImportMapping"),
  adminCsvImportActions: document.querySelector("#adminCsvImportActions"),
  adminCsvImportApply: document.querySelector("#adminCsvImportApply"),
  adminCsvReviewPanel: document.querySelector("#adminCsvReviewPanel"),
  adminCsvReviewSummary: document.querySelector("#adminCsvReviewSummary"),
  adminCsvBeforePreview: document.querySelector("#adminCsvBeforePreview"),
  adminCsvAfterPreview: document.querySelector("#adminCsvAfterPreview"),
  adminCsvReviewers: document.querySelector("#adminCsvReviewers"),
  adminCsvCommitReview: document.querySelector("#adminCsvCommitReview"),
  adminCsvDeclineReview: document.querySelector("#adminCsvDeclineReview"),
  adminCsvReload: document.querySelector("#adminCsvReload"),
  adminCsvSave: document.querySelector("#adminCsvSave"),
  adminCsvDownload: document.querySelector("#adminCsvDownload"),
  adminCsvStatus: document.querySelector("#adminCsvStatus"),
  reportForm: document.querySelector("#reportForm"),
  reportStatus: document.querySelector("#reportStatus"),
  reportEmail: document.querySelector("#reportEmail"),
  comments: document.querySelector("#comments"),
  characterCount: document.querySelector("#characterCount")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setSaveStatus(message, tone = "") {
  elements.saveStatus.className = `save-state ${tone}`.trim();
  elements.saveStatus.innerHTML = `<span class="save-dot" aria-hidden="true"></span>${escapeHtml(message)}`;
}

function setInlineStatus(element, message, tone = "") {
  if (!element) return;
  element.textContent = message;
  element.className = `inline-status ${tone}`.trim();
}

function selectedLookupMethod() {
  return elements.lookupMethodInputs.find((input) => input.checked)?.value || "manual";
}

function resetPartFlow() {
  state.searchResult = null;
  state.candidate = null;
  state.confirmedPart = null;
  elements.matchPanel.hidden = true;
  elements.evaluationPanel.hidden = true;
  elements.movementPanel.hidden = true;
  elements.locationPanel.hidden = true;
  elements.confirmMatchButton.disabled = true;
  elements.matchActionRow.hidden = false;
}

function setLookupMethod(method) {
  const useCodeLookup = method === "code";
  elements.manualLookupPanel.hidden = useCodeLookup;
  elements.codeLookupPanel.hidden = !useCodeLookup;
  if (useCodeLookup) {
    window.setTimeout(() => elements.partCodeInput?.focus(), 0);
  }
  setInlineStatus(elements.scanStatus, "", "");
  setInlineStatus(elements.codeLookupStatus, "", "");
  resetPartFlow();
}

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (quoted && char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (!quoted && char === ",") {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function parseCsvText(text) {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return headers.map((_, index) => values[index] ?? "");
  });
  return { headers, rows };
}

function stringifyCsv(headers, rows) {
  const headerLine = headers.map(csvEscape).join(",");
  const rowLines = rows.map((row) => headers.map((_, index) => csvEscape(row[index])).join(","));
  return `${[headerLine, ...rowLines].join("\n")}\n`;
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase();
}

function findHeaderIndex(headers, headerName) {
  const target = normalizeHeader(headerName);
  return headers.findIndex((header) => normalizeHeader(header) === target);
}

function cloneRows(rows) {
  return rows.map((row) => [...row]);
}

function rowToObject(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}

function padRowsToHeaders(rows, headers) {
  return rows.map((row) => headers.map((_, index) => row[index] ?? ""));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

function loadUser() {
  try {
    state.user = JSON.parse(localStorage.getItem(userStorageKey) || "null");
  } catch {
    state.user = null;
  }
  renderUser();
}

function renderUser() {
  if (state.user?.name && state.user?.email) {
    elements.loginGate.classList.add("is-hidden");
    const roleLabel = isAdmin() ? "Admin" : state.user.type === "guest" ? "Guest" : "Regular";
    elements.userChip.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 21a8 8 0 0 0-16 0" />
        <path d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      </svg>
      <span>${escapeHtml(state.user.name)}<small>${escapeHtml(roleLabel)} - ${escapeHtml(state.user.email)}</small></span>
    `;
    syncAdminImporter();
    applyRoleAccess();
    if (isAdmin()) {
      loadAdminCsv().catch((error) => setInlineStatus(elements.adminCsvStatus, error.message, "error"));
    }
    return;
  }

  elements.loginGate.classList.remove("is-hidden");
  elements.userChip.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 21a8 8 0 0 0-16 0" />
      <path d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
    </svg>
    Not signed in
  `;
  applyRoleAccess();
}

function requireUser() {
  if (!state.user?.name || !state.user?.email) {
    renderUser();
    throw new Error("Sign in before changing inventory.");
  }
  return state.user;
}

function isAdminCapable(email = state.user?.email) {
  return adminEmails.has(String(email || "").trim().toLowerCase());
}

function isAdmin() {
  return state.user?.role === "admin" && isAdminCapable(state.user.email);
}

function applyRoleAccess() {
  const admin = isAdmin();
  document.querySelectorAll("[data-admin-only]").forEach((element) => {
    element.hidden = !admin;
  });

  if (!admin && state.user && ["#admin", "#management", "#control"].includes(window.location.hash)) {
    window.location.hash = "#scan";
  }
  renderControlCenter();
  syncActiveNavFromHash();
}

async function loadAll() {
  setSaveStatus("Loading catalog...", "busy");
  const [catalog, inventory, memberData, replenishment] = await Promise.all([
    requestJson("/api/catalog"),
    requestJson("/api/inventory"),
    requestJson("/api/members"),
    requestJson("/api/replenishment")
  ]);
  state.catalog = catalog;
  state.inventory = inventory;
  state.members = memberData.members || [];
  state.replenishment = replenishment;
  renderAll();
  setSaveStatus("Ready");
}

function renderAll() {
  renderCategoryOptions();
  renderGuidedSearchOptions();
  renderMemberOptions();
  renderManagementFilterOptions();
  renderInventorySheet();
  renderReplenishmentPartOptions();
  renderReplenishmentBoard();
  renderControlCenter();
  applyRoleAccess();
  elements.reportEmail.textContent = state.catalog?.reportEmail || "gamehta@nvidia.com";
  if (isAdmin()) {
    loadControlSettings().catch((error) => setInlineStatus(elements.controlStatus, error.message, "error"));
  }
}

function setSelectOptions(select, options, allLabel = "All") {
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = [
    `<option value="all">${escapeHtml(allLabel)}</option>`,
    ...options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
  ].join("");
  if ([...select.options].some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
}

function renderManagementFilterOptions() {
  const parts = state.catalog?.parts || [];
  const categoryOptions = [...new Set(parts.map((part) => part.category).filter(Boolean))]
    .sort()
    .map((category) => ({ value: category, label: category }));
  const selectedCategory = elements.managementCategory?.value || "all";
  const selectedSku = elements.managementSku?.value || "all";
  const scopedParts = parts.filter((part) => selectedCategory === "all" || part.category === selectedCategory);
  const locationScope = scopedParts.filter((part) => selectedSku === "all" || part.sku === selectedSku);
  const skuOptions = scopedParts
    .slice()
    .sort((left, right) => String(left.sku).localeCompare(String(right.sku)))
    .map((part) => ({ value: part.sku, label: `${part.sku} - ${part.name}` }));
  const locationOptions = [
    ...new Map(
      locationScope
        .filter((part) => part.aisle || part.bin)
        .map((part) => [
          `${part.aisle}||${part.bin}`,
          { value: `${part.aisle}||${part.bin}`, label: `Aisle ${part.aisle} / Bin ${part.bin}` }
        ])
    ).values()
  ].sort((left, right) => left.label.localeCompare(right.label));

  setSelectOptions(elements.managementCategory, categoryOptions, "All categories");
  setSelectOptions(elements.managementSku, skuOptions, "All SKUs");
  setSelectOptions(elements.managementLocation, locationOptions, "All locations");
}

function renderMemberOptions() {
  const currentValue = elements.memberSelect.value;
  const memberOptions = state.members
    .map(
      (member) =>
        `<option value="${escapeHtml(member.email)}" data-name="${escapeHtml(member.name)}">${escapeHtml(member.name)}</option>`
    )
    .join("");
  elements.memberSelect.innerHTML = `
    <option value="">Select member...</option>
    ${memberOptions}
    <option value="__guest__">Guest / not listed</option>
  `;

  if (currentValue && [...elements.memberSelect.options].some((option) => option.value === currentValue)) {
    elements.memberSelect.value = currentValue;
  }

  syncLoginFields();
}

function syncLoginFields() {
  const selectedOption = elements.memberSelect.selectedOptions[0];
  const isGuest = elements.memberSelect.value === "__guest__";
  const canAdmin = isAdminCapable(elements.memberSelect.value);
  elements.guestNameLabel.hidden = !isGuest;
  elements.loginName.hidden = !isGuest;
  elements.loginName.required = isGuest;
  elements.loginEmail.readOnly = !isGuest && Boolean(elements.memberSelect.value);
  elements.roleChoice.hidden = !canAdmin || isGuest;

  if (isGuest) {
    elements.loginName.value = "";
    elements.loginEmail.value = "";
    elements.loginEmail.placeholder = "guest@example.com";
    elements.loginForm.querySelector("input[name='loginRole'][value='user']").checked = true;
    return;
  }

  if (selectedOption?.value) {
    elements.loginName.value = selectedOption.dataset.name || selectedOption.textContent.trim();
    elements.loginEmail.value = selectedOption.value;
    elements.loginEmail.placeholder = "";
    elements.loginForm.querySelector("input[name='loginRole'][value='user']").checked = true;
    return;
  }

  elements.loginName.value = "";
  elements.loginEmail.value = "";
  elements.loginEmail.readOnly = true;
  elements.loginEmail.placeholder = "Select a member first";
}

function renderCategoryOptions() {
  const currentValue = elements.categoryHint.value;
  const categories = state.catalog?.categories || [];
  elements.categoryHint.innerHTML = [
    '<option value="">Unknown or mixed</option>',
    ...categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
  ].join("");

  if (currentValue && categories.includes(currentValue)) {
    elements.categoryHint.value = currentValue;
  }
}

function clientPartSearchText(part) {
  return [
    part.sku,
    part.name,
    part.category,
    part.distinguishers,
    part.aliases,
    part.metadata,
    part.location
  ].join(" ");
}

function includesTerm(part, term) {
  return clientPartSearchText(part).toLowerCase().includes(String(term || "").toLowerCase());
}

function detailOptionsForParts(parts) {
  const preferred = [
    "A100",
    "H100",
    "L40S",
    "48GB",
    "80GB",
    "2TB",
    "4TB",
    "18TB",
    "20TB",
    "SATA",
    "SAS",
    "NVMe",
    "M.2",
    "PCIe",
    "ConnectX-6",
    "200GbE",
    "MiniSAS",
    "SFF-8643",
    "C13",
    "C14",
    "32A",
    "3PH",
    "2400W",
    "R760",
    "4U",
    "QD"
  ];
  return preferred.filter((term) => parts.some((part) => includesTerm(part, term)));
}

function guidedFilteredParts() {
  const category = elements.categoryHint.value;
  const detail = elements.detailHint.value;
  return (state.catalog?.parts || []).filter((part) => {
    const categoryMatch = !category || part.category === category;
    const detailMatch = !detail || includesTerm(part, detail);
    return categoryMatch && detailMatch;
  });
}

function renderGuidedSearchOptions(changedField = "") {
  if (!state.catalog?.parts) return;

  if (changedField === "category") {
    elements.detailHint.value = "";
    elements.skuHint.value = "";
  }
  if (changedField === "detail") {
    elements.skuHint.value = "";
  }

  const category = elements.categoryHint.value;
  const categoryParts = (state.catalog.parts || []).filter((part) => !category || part.category === category);
  const currentDetail = elements.detailHint.value;
  const detailOptions = detailOptionsForParts(categoryParts);
  elements.detailHint.innerHTML = [
    `<option value="">${category ? "Any detail" : "Select a part family first"}</option>`,
    ...detailOptions.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
  ].join("");
  if (currentDetail && detailOptions.includes(currentDetail)) {
    elements.detailHint.value = currentDetail;
  }

  const currentSku = elements.skuHint.value;
  const filteredParts = guidedFilteredParts();
  elements.skuHint.innerHTML = [
    `<option value="">${filteredParts.length ? "Show best match" : "No matching SKU yet"}</option>`,
    ...filteredParts.map(
      (part) =>
        `<option value="${escapeHtml(part.sku)}">${escapeHtml(part.sku)} - ${escapeHtml(part.name)}</option>`
    )
  ].join("");
  if (currentSku && filteredParts.some((part) => part.sku === currentSku)) {
    elements.skuHint.value = currentSku;
  }
}

function inventoryState(quantity) {
  if (quantity <= 0) {
    return { label: "Critical Low", tone: "missing" };
  }
  if (quantity <= lowThreshold) {
    return { label: "Low Inventory", tone: "low" };
  }
  return { label: "In Stock", tone: "good" };
}

function renderInventorySheet() {
  const inventory = state.inventory;
  if (!inventory) return;
  elements.inventorySource.textContent = inventory.source;
  elements.inventoryHeader.innerHTML = '<th scope="col"></th>';
  elements.inventoryRow.innerHTML = `<th scope="row">${escapeHtml(inventory.rowLabel)}</th>`;

  inventory.columns.forEach((column) => {
    const quantity = Number(inventory.quantities[column] || 0);
    const currentState = inventoryState(quantity);
    elements.inventoryHeader.insertAdjacentHTML("beforeend", `<th scope="col">${escapeHtml(column)}</th>`);
    elements.inventoryRow.insertAdjacentHTML(
      "beforeend",
      `
      <td>
        <div class="quantity-cell">
          <strong>${quantity}</strong>
          <span class="inventory-state ${currentState.tone}">${currentState.label}</span>
        </div>
      </td>
      `
    );
  });
}

function renderReplenishmentPartOptions() {
  if (!elements.replenishmentSku || !state.catalog?.parts) return;
  const currentValue = elements.replenishmentSku.value;
  elements.replenishmentSku.innerHTML = [
    '<option value="">Part not listed / pending SKU</option>',
    ...state.catalog.parts.map(
      (part) =>
        `<option value="${escapeHtml(part.sku)}">${escapeHtml(part.sku)} - ${escapeHtml(part.name)}</option>`
    )
  ].join("");
  if (currentValue && state.catalog.parts.some((part) => part.sku === currentValue)) {
    elements.replenishmentSku.value = currentValue;
  }
}

function selectedReplenishmentPart() {
  const sku = elements.replenishmentSku.value;
  return state.catalog?.parts?.find((part) => part.sku === sku) || null;
}

function syncReplenishmentItemFromSku() {
  const part = selectedReplenishmentPart();
  if (!part) return;
  elements.replenishmentItem.value = part.name;
  elements.replenishmentQuantity.value = Math.max(1, Number(part.minQuantity || 1) * 2 - Number(part.quantity || 0));
}

async function loadReplenishmentBoard() {
  state.replenishment = await requestJson("/api/replenishment");
  renderReplenishmentBoard();
  renderControlCenter();
}

function renderReplenishmentBoard() {
  if (!elements.replenishmentBoard || !state.replenishment) return;
  const cards = state.replenishment.cards || [];
  const summary = state.replenishment.summary || {};
  elements.replenishmentSummary.innerHTML = `
    <div class="report-metric">
      <span>Open requests</span>
      <strong>${escapeHtml(summary.openRequests ?? 0)}</strong>
    </div>
    <div class="report-metric">
      <span>Critical</span>
      <strong>${escapeHtml(summary.critical ?? 0)}</strong>
    </div>
    <div class="report-metric">
      <span>In progress</span>
      <strong>${escapeHtml(summary.inProgress ?? 0)}</strong>
    </div>
    <div class="report-metric">
      <span>Completed</span>
      <strong>${escapeHtml(summary.refilled ?? 0)}</strong>
    </div>
  `;
  elements.replenishmentBoard.innerHTML = replenishmentColumns
    .map((column) => {
      const columnCards = cards.filter((card) => card.status === column.key);
      return `
        <section class="progress-column">
          <div class="progress-column-heading">
            <div>
              <h3>${escapeHtml(column.label)}</h3>
              <p>${escapeHtml(column.help)}</p>
            </div>
            <span>${columnCards.length}</span>
          </div>
          <div class="progress-card-list">
            ${
              columnCards.length
                ? columnCards.map(renderReplenishmentCard).join("")
                : `<p class="empty-state">No requests in this status.</p>`
            }
          </div>
        </section>
      `;
    })
    .join("");
}

function renderReplenishmentCard(card) {
  const nextStatus = nextReplenishmentStatus(card.status);
  const priority = String(card.priority || "Normal");
  const priorityClass = ["Normal", "High", "Critical"].includes(priority) ? priority.toLowerCase() : "normal";
  const timeLabel = formatReplenishmentTime(card.updatedAt || card.createdAt);
  const adminControls = isAdmin();
  const displayId = replenishmentDisplayId(card.id);
  return `
    <article class="progress-card priority-${priorityClass}">
      <div class="progress-card-title">
        <span>${escapeHtml(displayId)}</span>
        <strong>${escapeHtml(card.partName || card.sku || "Part pending SKU")}</strong>
      </div>
      <div class="progress-card-tags">
        <span class="priority-chip">${escapeHtml(priority)}</span>
        <span>${escapeHtml(card.category || "Uncategorized")}</span>
      </div>
      <div class="progress-card-meta">
        <div>
          <span>SKU</span>
          <strong>${escapeHtml(card.sku || "Pending")}</strong>
        </div>
        <div>
          <span>Location</span>
          <strong>${escapeHtml([card.aisle, card.bin].filter(Boolean).join(" / ") || "Needs detail")}</strong>
        </div>
        <div>
          <span>Current</span>
          <strong>${escapeHtml(card.currentQuantity || "-")}</strong>
        </div>
        <div>
          <span>Request</span>
          <strong>${escapeHtml(card.requestedQuantity || "1")}</strong>
        </div>
      </div>
      ${card.notes ? `<p>${escapeHtml(card.notes)}</p>` : ""}
      <div class="progress-card-footer">
        <span>Updated ${escapeHtml(timeLabel)}</span>
        ${
          adminControls
            ? nextStatus
              ? `<button class="mini-button" type="button" data-replenishment-id="${escapeHtml(card.id)}" data-replenishment-status="${escapeHtml(nextStatus)}">Update to ${escapeHtml(replenishmentStatusLabel(nextStatus))}</button>`
              : `<button class="mini-button" type="button" data-replenishment-id="${escapeHtml(card.id)}" data-replenishment-status="New Request">Reopen Request</button>`
            : ""
        }
      </div>
    </article>
  `;
}

function replenishmentDisplayId(id) {
  return String(id || "") || "REQ";
}

function replenishmentStatusLabel(status) {
  return replenishmentColumns.find((column) => column.key === status)?.label || status;
}

function nextReplenishmentStatus(status) {
  const index = replenishmentColumns.findIndex((column) => column.key === status);
  if (index === -1 || index >= replenishmentColumns.length - 1) return "";
  return replenishmentColumns[index + 1].key;
}

function formatReplenishmentTime(timestamp) {
  const date = new Date(timestamp || "");
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatControlTime(timestamp) {
  const date = new Date(timestamp || "");
  if (Number.isNaN(date.getTime())) return "Not run yet";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

async function createReplenishmentRequest() {
  try {
    const user = requireUser();
    const part = selectedReplenishmentPart();
    const item = elements.replenishmentItem.value.trim();
    if (!part && !item) {
      throw new Error("Choose a part or describe the item that needs replenishment.");
    }
    elements.replenishmentCreate.disabled = true;
    setInlineStatus(elements.replenishmentStatus, "Creating replenishment request...", "busy");
    const result = await requestJson("/api/replenishment", {
      method: "POST",
      body: JSON.stringify({
        user,
        sku: part?.sku || "",
        item,
        requestedQuantity: elements.replenishmentQuantity.value,
        priority: elements.replenishmentPriority.value,
        notes: elements.replenishmentNotes.value
      })
    });
    state.replenishment = result.board;
    elements.replenishmentSku.value = "";
    elements.replenishmentItem.value = "";
    elements.replenishmentQuantity.value = "1";
    elements.replenishmentPriority.value = "Normal";
    elements.replenishmentNotes.value = "";
    renderReplenishmentBoard();
    renderControlCenter();
    setInlineStatus(elements.replenishmentStatus, result.message, "success");
  } catch (error) {
    setInlineStatus(elements.replenishmentStatus, error.message, "error");
  } finally {
    elements.replenishmentCreate.disabled = false;
  }
}

async function updateReplenishmentStatus(id, status) {
  try {
    const user = requireUser();
    setInlineStatus(elements.replenishmentStatus, "Updating replenishment card...", "busy");
    const result = await requestJson("/api/replenishment/status", {
      method: "POST",
      body: JSON.stringify({ user, id, status })
    });
    state.replenishment = result.board;
    renderReplenishmentBoard();
    renderControlCenter();
    setInlineStatus(elements.replenishmentStatus, result.message, "success");
  } catch (error) {
    setInlineStatus(elements.replenishmentStatus, error.message, "error");
  }
}

function selectedOptionText(select) {
  return select?.selectedOptions?.[0]?.textContent?.trim() || "";
}

function currentManagementFilters() {
  return {
    category: elements.managementCategory.value || "all",
    sku: elements.managementSku.value || "all",
    location: elements.managementLocation.value || "all",
    stockStatus: elements.managementStockStatus.value || "all",
    search: elements.managementSearch.value.trim()
  };
}

function managementFilterLabels() {
  const filters = currentManagementFilters();
  const labels = [];

  if (filters.category !== "all") labels.push(`Category: ${selectedOptionText(elements.managementCategory)}`);
  if (filters.sku !== "all") labels.push(`SKU: ${selectedOptionText(elements.managementSku)}`);
  if (filters.location !== "all") labels.push(`Location: ${selectedOptionText(elements.managementLocation)}`);
  if (filters.stockStatus !== "all") labels.push(`Availability: ${selectedOptionText(elements.managementStockStatus)}`);
  if (filters.search) labels.push(`Keyword: ${filters.search}`);

  return labels.length ? labels : ["Scope: All inventory"];
}

function resetManagementReportView(message = "Choose filters and click Generate Report.") {
  state.managementReport = null;
  if (elements.managementEmptyState) elements.managementEmptyState.hidden = false;
  if (elements.managementSummary) {
    elements.managementSummary.hidden = true;
    elements.managementSummary.innerHTML = "";
  }
  if (elements.managementFilterSummary) {
    elements.managementFilterSummary.hidden = true;
    elements.managementFilterSummary.innerHTML = "";
  }
  if (elements.managementGrid) elements.managementGrid.hidden = true;
  elements.managementSections.forEach((section) => {
    section.hidden = true;
  });
  if (elements.managementExport) elements.managementExport.disabled = true;
  setInlineStatus(elements.managementStatus, message, "busy");
}

async function loadManagementReport() {
  if (!isAdmin() || !elements.managementSummary) return;
  setInlineStatus(elements.managementStatus, "Generating current inventory report...", "busy");
  const data = buildInventoryManagementReport();
  state.managementReport = data;
  renderManagementReport(data);
  const count = data.details?.length ?? 0;
  setInlineStatus(elements.managementStatus, `${count} SKU${count === 1 ? "" : "s"} found for the selected inventory filters.`, "success");
}

function inventoryStatus(part) {
  const quantity = Number(part.quantity || 0);
  const minQuantity = Number(part.minQuantity || 0);
  if (quantity <= 0) return { key: "missing", label: "Missing", tone: "danger" };
  if (quantity <= minQuantity) return { key: "low", label: "Low stock", tone: "caution" };
  return { key: "available", label: "Available", tone: "good" };
}

function partManagementSearchText(part) {
  const aliases = Array.isArray(part.aliases) ? part.aliases.join(" ") : part.aliases;
  return [
    part.sku,
    part.name,
    part.category,
    part.aisle,
    part.bin,
    part.location,
    aliases,
    part.distinguishers,
    part.metadata
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatPartAliases(part) {
  return Array.isArray(part.aliases) ? part.aliases.join("; ") : String(part.aliases || "");
}

function partMatchesManagementFilters(part, filters) {
  const status = inventoryStatus(part);
  const locationValue = `${part.aisle || ""}||${part.bin || ""}`;
  return (
    (filters.category === "all" || part.category === filters.category) &&
    (filters.sku === "all" || part.sku === filters.sku) &&
    (filters.location === "all" || locationValue === filters.location) &&
    (filters.stockStatus === "all" || status.key === filters.stockStatus) &&
    (!filters.search || partManagementSearchText(part).includes(filters.search.toLowerCase()))
  );
}

function buildInventoryManagementReport() {
  const filters = currentManagementFilters();
  const parts = (state.catalog?.parts || []).filter((part) => partMatchesManagementFilters(part, filters));
  const statusCounts = parts.reduce(
    (counts, part) => {
      counts[inventoryStatus(part).key] += 1;
      return counts;
    },
    { available: 0, low: 0, missing: 0 }
  );
  const locations = new Set(parts.map((part) => `${part.aisle || ""} / ${part.bin || ""}`).filter((location) => location.trim() !== "/"));
  const details = parts
    .slice()
    .sort((left, right) => String(left.category).localeCompare(String(right.category)) || String(left.sku).localeCompare(String(right.sku)))
    .map((part) => {
      const status = inventoryStatus(part);
      return {
        category: part.category || "Uncategorized",
        sku: part.sku,
        partName: part.name,
        quantity: Number(part.quantity || 0),
        minQuantity: Number(part.minQuantity || 0),
        status: status.label,
        statusKey: status.key,
        statusTone: status.tone,
        aisle: part.aisle || "",
        bin: part.bin || "",
        location: `Aisle ${part.aisle || "-"} / Bin ${part.bin || "-"}`,
        distinguishers: part.distinguishers || "",
        aliases: formatPartAliases(part),
        metadata: part.metadata || ""
      };
    });

  const categoryRows = [...details.reduce((map, row) => {
    if (!map.has(row.category)) {
      map.set(row.category, {
        category: row.category,
        totalQuantity: 0,
        skuCount: 0,
        availableSkus: 0,
        lowSkus: 0,
        missingSkus: 0,
        locations: new Set()
      });
    }
    const category = map.get(row.category);
    category.totalQuantity += row.quantity;
    category.skuCount += 1;
    if (row.statusKey === "available") category.availableSkus += 1;
    if (row.statusKey === "low") category.lowSkus += 1;
    if (row.statusKey === "missing") category.missingSkus += 1;
    category.locations.add(row.location);
    return map;
  }, new Map()).values()]
    .map((row) => ({ ...row, locations: row.locations.size }))
    .sort((left, right) => right.totalQuantity - left.totalQuantity || left.category.localeCompare(right.category));

  const locationRows = [...details.reduce((map, row) => {
    if (!map.has(row.location)) {
      map.set(row.location, {
        location: row.location,
        totalQuantity: 0,
        skuCount: 0,
        lowSkus: 0,
        missingSkus: 0,
        categories: new Set()
      });
    }
    const location = map.get(row.location);
    location.totalQuantity += row.quantity;
    location.skuCount += 1;
    if (row.statusKey === "low") location.lowSkus += 1;
    if (row.statusKey === "missing") location.missingSkus += 1;
    location.categories.add(row.category);
    return map;
  }, new Map()).values()]
    .map((row) => ({ ...row, categories: [...row.categories].sort().join(", ") }))
    .sort((left, right) => left.location.localeCompare(right.location));

  return {
    filters,
    summary: {
      totalQuantity: details.reduce((total, row) => total + row.quantity, 0),
      totalSkus: details.length,
      availableSkus: statusCounts.available,
      lowSkus: statusCounts.low,
      missingSkus: statusCounts.missing,
      locations: locations.size
    },
    byCategory: categoryRows,
    byLocation: locationRows,
    details
  };
}

function reportMetric(label, value) {
  return `
    <div class="report-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value ?? 0)}</strong>
    </div>
  `;
}

function renderTableBody(rows, columns, emptyMessage) {
  if (!rows.length) {
    return `<tr><td class="empty-state" colspan="${columns.length}">${escapeHtml(emptyMessage)}</td></tr>`;
  }
  return rows
    .map(
      (row) => `
        <tr>
          ${columns.map((column) => `<td>${column.render(row)}</td>`).join("")}
        </tr>
      `
    )
    .join("");
}

function renderReportTable(table, columns, rows, emptyMessage) {
  table.innerHTML = `
    <thead>
      <tr>
        ${columns.map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${renderTableBody(rows, columns, emptyMessage)}
    </tbody>
  `;
}

function renderManagementReport(data) {
  const summary = data.summary || {};

  elements.managementEmptyState.hidden = true;
  elements.managementSummary.hidden = false;
  elements.managementGrid.hidden = false;
  elements.managementExport.disabled = false;
  elements.managementFilterSummary.hidden = false;
  elements.managementFilterSummary.innerHTML = managementFilterLabels()
    .map((label) => `<span>${escapeHtml(label)}</span>`)
    .join("");
  elements.managementSections.forEach((section) => {
    section.hidden = false;
  });

  elements.managementSummary.innerHTML = `
    ${reportMetric("Total available", summary.totalQuantity)}
    ${reportMetric("Matching SKUs", summary.totalSkus)}
    ${reportMetric("Available SKUs", summary.availableSkus)}
    ${reportMetric("Low-stock SKUs", summary.lowSkus)}
    ${reportMetric("Missing SKUs", summary.missingSkus)}
    ${reportMetric("Locations", summary.locations)}
  `;

  renderReportTable(
    elements.managementCategoryTable,
    [
      { label: "Category", render: (row) => `<strong>${escapeHtml(row.category)}</strong>` },
      { label: "Total available", render: (row) => escapeHtml(row.totalQuantity) },
      { label: "SKUs", render: (row) => escapeHtml(row.skuCount) },
      { label: "Available", render: (row) => escapeHtml(row.availableSkus) },
      { label: "Low", render: (row) => escapeHtml(row.lowSkus) },
      { label: "Missing", render: (row) => escapeHtml(row.missingSkus) },
      { label: "Locations", render: (row) => escapeHtml(row.locations) }
    ],
    data.byCategory || [],
    "No inventory found for these filters."
  );

  renderReportTable(
    elements.managementSkuTable,
    [
      { label: "SKU", render: (row) => `<strong>${escapeHtml(row.sku)}</strong><br /><span>${escapeHtml(row.partName)}</span>` },
      { label: "Category", render: (row) => escapeHtml(row.category) },
      { label: "Available", render: (row) => `<strong>${escapeHtml(row.quantity)}</strong>` },
      { label: "Minimum", render: (row) => escapeHtml(row.minQuantity) },
      { label: "Status", render: (row) => `<span class="stock-pill ${escapeHtml(row.statusTone)}">${escapeHtml(row.status)}</span>` },
      { label: "Location", render: (row) => `<span class="nowrap">${escapeHtml(row.location)}</span>` },
      { label: "Details", render: (row) => escapeHtml(row.distinguishers || row.aliases || row.metadata || "-") }
    ],
    data.details || [],
    "No SKU inventory found for these filters."
  );

  renderReportTable(
    elements.managementLocationTable,
    [
      { label: "Location", render: (row) => `<strong class="nowrap">${escapeHtml(row.location)}</strong>` },
      { label: "Total available", render: (row) => escapeHtml(row.totalQuantity) },
      { label: "SKUs", render: (row) => escapeHtml(row.skuCount) },
      { label: "Low", render: (row) => escapeHtml(row.lowSkus) },
      { label: "Missing", render: (row) => escapeHtml(row.missingSkus) },
      { label: "Categories", render: (row) => escapeHtml(row.categories || "-") }
    ],
    data.byLocation || [],
    "No location inventory found for these filters."
  );
}

function resetManagementFilters() {
  elements.managementCategory.value = "all";
  elements.managementSku.value = "all";
  elements.managementLocation.value = "all";
  elements.managementStockStatus.value = "all";
  elements.managementSearch.value = "";
  renderManagementFilterOptions();
  resetManagementReportView("Filters reset. Click Generate Report when ready.");
}

function exportManagementReport() {
  const details = state.managementReport?.details || [];
  if (!state.managementReport) {
    setInlineStatus(elements.managementStatus, "Generate a report before exporting.", "error");
    return;
  }
  const summary = state.managementReport.summary || {};
  const headers = [
    "Category",
    "SKU",
    "Part Name",
    "Available Quantity",
    "Minimum Quantity",
    "Status",
    "Aisle",
    "Bin",
    "Distinguishers",
    "Aliases",
    "Metadata"
  ];
  const rows = details.map((row) => [
    row.category,
    row.sku,
    row.partName,
    row.quantity,
    row.minQuantity,
    row.status,
    row.aisle,
    row.bin,
    row.distinguishers,
    row.aliases,
    row.metadata
  ]);
  const contextRows = [
    ["Report generated", new Date().toLocaleString()],
    ["Selected filters", managementFilterLabels().join(" | ")],
    ["Total available", summary.totalQuantity ?? 0],
    ["Matching SKUs", summary.totalSkus ?? 0],
    ["Low-stock SKUs", summary.lowSkus ?? 0],
    ["Missing SKUs", summary.missingSkus ?? 0],
    []
  ];
  const csv = [
    ...contextRows.map((row) => row.map(csvEscape).join(",")),
    headers.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(","))
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  link.href = URL.createObjectURL(blob);
  link.download = `management-report-${stamp}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  setInlineStatus(elements.managementStatus, `Report exported with ${details.length} SKU${details.length === 1 ? "" : "s"}.`, "success");
}

function renderDefinitionList(element, rows) {
  if (!element) return;
  element.innerHTML = rows
    .map(
      ([label, value]) => `
        <div>
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>
      `
    )
    .join("");
}

function currentControlSettings() {
  return {
    supportEmail: state.catalog?.reportEmail || "gamehta@nvidia.com",
    backupDirectory: "data/backups",
    backupResolvedPath: "data/backups",
    backupLastRunAt: "",
    backupLastStatus: "Not run",
    backupLastPath: "",
    databaseDisplayPath: state.inventory?.source || "data/inventory.db",
    databaseResolvedPath: state.inventory?.source || "data/inventory.db",
    ...(state.controlSettings || {})
  };
}

function syncControlInputs(settings) {
  if (elements.controlSupportEmail && document.activeElement !== elements.controlSupportEmail) {
    elements.controlSupportEmail.value = settings.supportEmail || "";
  }
  if (elements.controlBackupDirectory && document.activeElement !== elements.controlBackupDirectory) {
    elements.controlBackupDirectory.value = settings.backupDirectory || "";
  }
}

function renderControlCenter() {
  if (!isAdmin() || !elements.controlHero) return;
  const parts = state.catalog?.parts || [];
  const lowParts = parts.filter((part) => Number(part.quantity) <= Number(part.minQuantity || lowThreshold));
  const missingParts = parts.filter((part) => Number(part.quantity) <= 0);
  const openRequests = state.replenishment?.summary?.openRequests ?? 0;
  const pendingEvaluations = Number(state.catalog?.pendingEvaluationCount ?? state.catalog?.evaluations?.length ?? 0);
  const codeCount = Number(state.catalog?.partCodeCount ?? state.catalog?.partCodes?.length ?? 0);
  const adminNames = state.members
    .filter((member) => isAdminCapable(member.email))
    .map((member) => member.name)
    .join(", ");
  const settings = currentControlSettings();
  syncControlInputs(settings);

  elements.controlHero.innerHTML = `
    <div>
      <span>Inventory health</span>
      <strong>${escapeHtml(lowParts.length)}</strong>
      <p>SKU${lowParts.length === 1 ? "" : "s"} at or below minimum quantity</p>
    </div>
    <div>
      <span>Open restock requests</span>
      <strong>${escapeHtml(openRequests)}</strong>
      <p>Visible on Replenishment Progress</p>
    </div>
    <div>
      <span>Admin reviews</span>
      <strong>${escapeHtml(pendingEvaluations)}</strong>
      <p>Unknown codes or rejected matches</p>
    </div>
  `;

  renderDefinitionList(elements.controlApplicationList, [
    ["Application", "Lab Hardware Inventory"],
    ["Phase", "Phase 1 pilot"],
    ["Database file", settings.databaseDisplayPath || "data/inventory.db"],
    ["Full DB path", settings.databaseResolvedPath || settings.databaseDisplayPath || "data/inventory.db"]
  ]);

  renderDefinitionList(elements.controlAccessList, [
    ["Administrators", adminNames || "Gaurav Mehta, Monica Martin"],
    ["Guest access", "Allowed with name and email"],
    ["Admin screens", "Hidden from regular users"],
    ["Change approval", "Two administrators required for database commits"]
  ]);

  renderDefinitionList(elements.controlInventoryList, [
    ["Tracked SKUs", String(parts.length)],
    ["Low-stock SKUs", String(lowParts.length)],
    ["Missing SKUs", String(missingParts.length)],
    ["Transaction reason", "Required for add/take updates"],
    ["NVBug tracking", "Required when available; bypass is logged"]
  ]);

  renderDefinitionList(elements.controlReviewList, [
    ["Pending admin reviews", String(pendingEvaluations)],
    ["Open restock requests", String(openRequests)],
    ["Barcode/QR mappings", String(codeCount)],
    ["Unknown codes", "Routed to evaluation queue"]
  ]);

  const reviewTone = pendingEvaluations || openRequests ? "caution" : "good";
  elements.controlReviewStatus.className = `status-pill ${reviewTone}`.trim();
  elements.controlReviewStatus.textContent = pendingEvaluations || openRequests ? "Needs review" : "Clear";

  renderDefinitionList(elements.controlDataList, [
    ["Runtime source", "SQLite database"],
    ["Backup folder", settings.backupResolvedPath || settings.backupDirectory || "data/backups"],
    ["Last backup", formatControlTime(settings.backupLastRunAt)],
    ["Backup status", settings.backupLastStatus || "Not run"],
    ["Last backup file", settings.backupLastPath || "No backup created yet"]
  ]);
}

async function loadControlSettings(showStatus = false) {
  if (!isAdmin()) return;
  const data = await requestJson("/api/admin/settings", {
    headers: adminHeaders()
  });
  state.controlSettings = data.settings;
  renderControlCenter();
  if (showStatus) {
    setInlineStatus(elements.controlStatus, "Control Center status refreshed.", "success");
  }
}

async function refreshControlCenter() {
  try {
    setInlineStatus(elements.controlStatus, "Refreshing Control Center...", "busy");
    await Promise.all([loadControlSettings(), loadReplenishmentBoard()]);
    renderControlCenter();
    setInlineStatus(elements.controlStatus, "Control Center status refreshed.", "success");
  } catch (error) {
    setInlineStatus(elements.controlStatus, error.message, "error");
  }
}

async function saveControlSettings(event) {
  event?.preventDefault();
  try {
    requireUser();
    if (!isAdmin()) {
      throw new Error("Only administrators can change Control Center settings.");
    }
    elements.controlSaveSettings.disabled = true;
    setInlineStatus(elements.controlStatus, "Saving Control Center settings...", "busy");
    const result = await requestJson("/api/admin/settings", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        supportEmail: elements.controlSupportEmail.value,
        backupDirectory: elements.controlBackupDirectory.value
      })
    });
    state.controlSettings = result.settings;
    if (state.catalog) {
      state.catalog.reportEmail = result.settings.supportEmail;
    }
    elements.reportEmail.textContent = result.settings.supportEmail;
    renderControlCenter();
    setInlineStatus(elements.controlStatus, result.message, "success");
  } catch (error) {
    setInlineStatus(elements.controlStatus, error.message, "error");
  } finally {
    elements.controlSaveSettings.disabled = false;
  }
}

function useDefaultBackupFolder() {
  if (!elements.controlBackupDirectory) return;
  elements.controlBackupDirectory.value = "data/backups";
  elements.controlBackupDirectory.focus();
  setInlineStatus(elements.controlStatus, "Default backup folder selected. Save settings to apply it.", "busy");
}

function updateBackupFolderFromFileSelection(files) {
  const firstFile = files?.[0];
  if (!firstFile) return;
  const relativePath = firstFile.webkitRelativePath || "";
  const rootFolder = relativePath.split("/")[0] || "";

  if (firstFile.path && relativePath) {
    const normalizedFilePath = firstFile.path.replaceAll("\\", "/");
    const normalizedRelativePath = relativePath.replaceAll("\\", "/");
    const folderPath = normalizedFilePath.slice(0, normalizedFilePath.length - normalizedRelativePath.length).replaceAll("/", "\\").replace(/[\\/]$/, "");
    if (folderPath) {
      elements.controlBackupDirectory.value = folderPath;
      setInlineStatus(elements.controlStatus, "Backup folder selected. Save settings to apply it.", "busy");
      return;
    }
  }

  setInlineStatus(
    elements.controlStatus,
    rootFolder
      ? `Selected ${rootFolder}, but this browser hides the full Windows path. Paste the full backup folder path, then save settings.`
      : "This browser hides the full folder path. Paste the backup folder path, then save settings.",
    "busy"
  );
}

async function browseBackupFolder() {
  try {
    if (window.showDirectoryPicker) {
      const directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      setInlineStatus(
        elements.controlStatus,
        `Selected ${directoryHandle.name}, but the browser does not expose the full server path. Paste the full backup folder path, then save settings.`,
        "busy"
      );
      return;
    }

    if (elements.controlBackupFolderInput) {
      elements.controlBackupFolderInput.click();
      return;
    }

    throw new Error("Folder browsing is not available in this browser. Paste the backup folder path, then save settings.");
  } catch (error) {
    if (error.name === "AbortError") return;
    setInlineStatus(elements.controlStatus, error.message, "error");
  }
}

async function runControlBackup() {
  try {
    requireUser();
    if (!isAdmin()) {
      throw new Error("Only administrators can run database backups.");
    }
    elements.controlRunBackup.disabled = true;
    setInlineStatus(elements.controlStatus, "Running database backup...", "busy");
    const result = await requestJson("/api/admin/backup", {
      method: "POST",
      headers: adminHeaders()
    });
    state.controlSettings = result.settings;
    renderControlCenter();
    setInlineStatus(elements.controlStatus, result.message, "success");
  } catch (error) {
    await loadControlSettings().catch(() => {});
    setInlineStatus(elements.controlStatus, error.message, "error");
  } finally {
    elements.controlRunBackup.disabled = false;
  }
}

function partImageSrc(imagePath) {
  let value = String(imagePath || "").trim().replace(/\\/g, "/");
  if (!value) return "";
  if (/^(https?:|data:|\/)/i.test(value)) return value;
  if (value.startsWith("data/reference_images/")) {
    value = value.replace("data/reference_images/", "reference-images/");
  }
  if (value.startsWith("reference_images/")) {
    value = value.replace("reference_images/", "reference-images/");
  }
  if (value.startsWith("reference-images/")) {
    return `/${value}`;
  }
  return `/reference-images/${value}`;
}

function renderUnknownCodeResult(result) {
  elements.matchPanel.hidden = false;
  elements.matchPanelTitle.textContent = "Code Review Required";
  elements.confirmMatchButton.disabled = true;
  elements.matchActionRow.hidden = false;
  elements.matchResult.innerHTML = `
    <div class="search-summary">
      <strong>${escapeHtml(result.message || "Code requires administrator review.")}</strong>
      <span>${escapeHtml(result.code || "")} is not available for inventory movement until an administrator maps or resolves it.</span>
    </div>
  `;
}

function renderCatalogTiles(parts) {
  const catalogParts = [...(parts || [])].sort((left, right) => {
    const categoryCompare = String(left.category || "").localeCompare(String(right.category || ""));
    return categoryCompare || String(left.sku || "").localeCompare(String(right.sku || ""));
  });
  elements.matchPanel.hidden = false;
  elements.matchPanelTitle.textContent = "Catalog Tiles";
  elements.confirmMatchButton.disabled = true;
  elements.matchActionRow.hidden = true;
  state.searchResult = {
    ok: true,
    match: null,
    candidates: catalogParts.map((part) => ({
      part,
      confidence: 0.6,
      score: 10,
      reasons: ["Selected from catalog tile"]
    })),
    refinements: [],
    summary: "Catalog browse mode",
    needsAdminEvaluation: false
  };
  elements.matchResult.innerHTML = `
    <div class="catalog-summary">
      <strong>Browse catalog tiles</strong>
      <span>Select a part family, detail, or SKU above to narrow results. Choose a tile when you recognize the correct SKU.</span>
    </div>
    <div class="catalog-tile-grid">
      ${catalogParts
        .map(
          (part) => `
            <article class="catalog-tile">
              <div>
                <span>${escapeHtml(part.category)}</span>
                <h4>${escapeHtml(part.sku)}</h4>
                <p>${escapeHtml(part.name)}</p>
              </div>
              <div class="catalog-tile-meta">
                <strong>${escapeHtml(part.quantity)} available</strong>
                <span>Aisle ${escapeHtml(part.aisle)} / Bin ${escapeHtml(part.bin)}</span>
              </div>
              <button class="mini-button" type="button" data-candidate-sku="${escapeHtml(part.sku)}">Review SKU</button>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

async function lookupPartCode(lookupMethod = "Manual Code Entry") {
  try {
    requireUser();
    resetPartFlow();
    const code = elements.partCodeInput.value.trim();
    state.lookupContext = { method: lookupMethod, code };
    setInlineStatus(elements.codeLookupStatus, "Looking up code...", "busy");

    const result = await requestJson("/api/part-code-lookup", {
      method: "POST",
      body: JSON.stringify({
        user: state.user,
        code,
        lookupMethod
      })
    });

    state.lookupContext = { method: lookupMethod, code: result.code || code };
    if (!result.found) {
      renderUnknownCodeResult(result);
      setInlineStatus(elements.codeLookupStatus, result.message, "error");
      return;
    }

    state.searchResult = result;
    state.candidate = result.match;
    renderMatch(result);
    setInlineStatus(elements.codeLookupStatus, result.message, "success");
    setInlineStatus(elements.scanStatus, result.message, "success");
  } catch (error) {
    setInlineStatus(elements.codeLookupStatus, error.message, "error");
  }
}

async function analyzePart() {
  try {
    requireUser();
    resetPartFlow();
    state.lookupContext = { method: "Manual Search", code: "" };
    const category = elements.categoryHint.value;
    const detail = elements.detailHint.value;
    const selectedSku = elements.skuHint.value;
    const extraTerms = elements.scanHints.value.trim();

    if (!category && !detail && !selectedSku && !extraTerms) {
      renderCatalogTiles(state.catalog?.parts || []);
      setInlineStatus(elements.scanStatus, "Showing catalog tiles. Use the dropdowns to narrow the list.", "success");
      return;
    }

    if (selectedSku) {
      const part = state.catalog?.parts?.find((item) => item.sku === selectedSku);
      if (!part) {
        throw new Error("Selected SKU is no longer available in the catalog.");
      }
      const candidate = {
        part,
        confidence: 0.99,
        score: 100,
        reasons: ["Selected from guided SKU dropdown"]
      };
      state.searchResult = {
        ok: true,
        match: candidate,
        candidates: [candidate],
        refinements: [],
        summary: "Guided selection found one SKU.",
        needsAdminEvaluation: false
      };
      state.candidate = candidate;
      renderMatch(state.searchResult);
      setInlineStatus(elements.scanStatus, "Guided SKU selection is ready. Confirm the part before updating inventory.", "success");
      return;
    }

    const hints = [extraTerms, category, detail].filter(Boolean).join(" ");
    setInlineStatus(elements.scanStatus, "Searching the catalog...", "busy");

    const result = await requestJson("/api/analyze-part", {
      method: "POST",
      body: JSON.stringify({
        mode: "manual",
        hints,
        categoryHint: category
      })
    });

    state.searchResult = result;
    state.candidate = result.match;
    renderMatch(result);
    setInlineStatus(elements.scanStatus, result.message, result.needsAdminEvaluation ? "error" : "success");
  } catch (error) {
    setInlineStatus(elements.scanStatus, error.message, "error");
  }
}

function renderMatch(result) {
  elements.matchPanel.hidden = false;
  elements.matchPanelTitle.textContent = "Recommended Match";
  elements.matchActionRow.hidden = false;
  const candidates = result.candidates || [];
  if (!candidates.length) {
    elements.matchResult.innerHTML = `
      <p class="empty-state">No confident match found. Try a broader phrase like GPU, hard drive, SSD, cable, or send this to admin evaluation.</p>
    `;
    elements.confirmMatchButton.disabled = true;
    return;
  }

  const recommended = result.match || candidates[0];
  const bestPart = recommended.part;
  const confidence = Math.round((recommended.confidence || 0) * 100);
  const alternatives =
    recommended.confidence < 0.85 ? candidates.filter((candidate) => candidate.part.sku !== bestPart.sku).slice(0, 8) : [];
  const refinementGroups = recommended.confidence < 0.85 ? result.refinements || [] : [];
  elements.confirmMatchButton.disabled = !recommended;
  elements.matchResult.innerHTML = `
    <section class="recommended-match">
      <div class="recommended-match-header">
        <div>
          <span class="result-eyebrow">Recommended SKU</span>
          <h4>${escapeHtml(bestPart.sku)}</h4>
          <p>${escapeHtml(bestPart.name)} - ${escapeHtml(bestPart.category)}</p>
        </div>
        <span class="confidence large">${confidence}% confidence</span>
      </div>
      <div class="recommended-metrics" aria-label="Recommended part details">
        <div>
          <span>Available</span>
          <strong>${escapeHtml(bestPart.quantity)}</strong>
        </div>
        <div>
          <span>Aisle</span>
          <strong>${escapeHtml(bestPart.aisle)}</strong>
        </div>
        <div>
          <span>Bin</span>
          <strong>${escapeHtml(bestPart.bin)}</strong>
        </div>
      </div>
      <p class="recommended-detail">${escapeHtml(bestPart.distinguishers)}</p>
      ${
        recommended.reasons?.length
          ? `<div class="match-reasons">${recommended.reasons
              .slice(0, 3)
              .map((reason) => `<span>${escapeHtml(reason)}</span>`)
              .join("")}</div>`
          : ""
      }
      <button class="button primary recommended-action" type="button" data-candidate-sku="${escapeHtml(bestPart.sku)}">
        Use This SKU
      </button>
    </section>
    ${
      refinementGroups.length
        ? `<div class="refinement-panel">
            ${refinementGroups
              .map(
                (group) => `
                  <div>
                    <span>${escapeHtml(group.label)}</span>
                    <div class="candidate-strip">
                      ${group.options
                        .map(
                          (option) =>
                            `<button class="mini-button" type="button" data-refine-term="${escapeHtml(option)}">${escapeHtml(option)}</button>`
                        )
                        .join("")}
                    </div>
                  </div>
                `
              )
              .join("")}
          </div>`
        : ""
    }
    ${
      alternatives.length
        ? `<section class="alternate-matches">
            <div class="match-group-heading">
              <h4>Other Possible Matches</h4>
              <span>${alternatives.length} option${alternatives.length === 1 ? "" : "s"}</span>
            </div>
            <div class="part-result-list">
              ${alternatives
                .map((candidate) => {
                  const part = candidate.part;
                  const optionConfidence = Math.round(candidate.confidence * 100);
                  return `
                    <article class="part-result alternate">
                      <div class="part-result-main">
                        <span class="confidence">${optionConfidence}% match</span>
                        <h4>${escapeHtml(part.sku)}</h4>
                        <p><strong>${escapeHtml(part.name)}</strong></p>
                        <p>${escapeHtml(part.category)} - Aisle ${escapeHtml(part.aisle)} / Bin ${escapeHtml(part.bin)} - ${escapeHtml(part.quantity)} available</p>
                      </div>
                      <div class="part-result-actions">
                        <button class="mini-button" type="button" data-candidate-sku="${escapeHtml(part.sku)}">Review SKU</button>
                      </div>
                    </article>
                  `;
                })
                .join("")}
            </div>
          </section>`
        : ""
    }
  `;
}

function confirmCandidate(candidate = state.candidate) {
  if (!candidate?.part) return;
  state.confirmedPart = candidate.part;
  elements.movementPanel.hidden = false;
  elements.locationPanel.hidden = false;
  elements.evaluationPanel.hidden = true;
  renderConfirmedPart();
}

function rejectCandidate() {
  elements.evaluationPanel.hidden = false;
  elements.movementPanel.hidden = true;
  elements.locationPanel.hidden = true;
}

function renderConfirmedPart() {
  const part = state.confirmedPart;
  const imageSrc = partImageSrc(part.imagePath);
  elements.confirmedPart.innerHTML = `
    ${imageSrc ? `<img class="part-photo compact" src="${escapeHtml(imageSrc)}" alt="${escapeHtml(part.name)} reference photo" />` : ""}
    <p><strong>${escapeHtml(part.name)}</strong></p>
    <p>${escapeHtml(part.sku)} - ${escapeHtml(part.category)} - ${escapeHtml(part.quantity)} available</p>
  `;
  elements.locationResult.innerHTML = `
    <div class="location-card">
      <span>Aisle</span>
      <strong>${escapeHtml(part.aisle)}</strong>
    </div>
    <div class="location-card">
      <span>Bin</span>
      <strong>${escapeHtml(part.bin)}</strong>
    </div>
    <p>${escapeHtml(part.distinguishers)}</p>
  `;
}

function syncNvbugInput() {
  const noNvbug = elements.movementNoNvbug?.checked;
  elements.movementNvbug.disabled = noNvbug;
  if (noNvbug) {
    elements.movementNvbug.value = "";
  }
}

async function submitEvaluation() {
  try {
    requireUser();
    const result = await requestJson("/api/evaluation", {
      method: "POST",
      body: JSON.stringify({
        user: state.user,
        hints: elements.scanHints.value,
        candidate: state.candidate,
        reason: elements.evaluationReason.value || "User rejected catalog match",
        code: state.lookupContext.code,
        lookupMethod: state.lookupContext.method
      })
    });
    setInlineStatus(elements.scanStatus, result.message, "success");
    elements.evaluationPanel.hidden = true;
    await loadAll();
  } catch (error) {
    setInlineStatus(elements.scanStatus, error.message, "error");
  }
}

async function updateInventoryFromSearch() {
  try {
    requireUser();
    if (!state.confirmedPart) {
      throw new Error("Confirm a part before updating inventory.");
    }

    const result = await requestJson("/api/transaction", {
      method: "POST",
      body: JSON.stringify({
        user: state.user,
        sku: state.confirmedPart.sku,
        action: elements.movementAction.value,
        quantity: elements.movementQuantity.value,
        reason: elements.movementReason.value,
        nvbug: elements.movementNoNvbug.checked ? "No NVBug# Available" : elements.movementNvbug.value,
        lookupMethod: state.lookupContext.method,
        partCode: state.lookupContext.code
      })
    });

    setInlineStatus(elements.scanStatus, `${result.message} Location: Aisle ${result.location.aisle}, Bin ${result.location.bin}.`, "success");
    state.confirmedPart = result.part;
    renderConfirmedPart();
    await loadAll();
  } catch (error) {
    setInlineStatus(elements.scanStatus, error.message, "error");
  }
}

function adminHeaders() {
  return { "X-Admin-Email": state.user?.email || "" };
}

function normalizeAdminCsvShape(parsed, key) {
  if (key === "parts" && !parsed.headers.includes("Metadata")) {
    parsed.headers.push("Metadata");
    parsed.rows.forEach((row) => row.push(""));
  }
  if (key === "partcodes") {
    ["Code", "Code Type", "SKU", "Status"].forEach((header) => {
      if (!parsed.headers.includes(header)) {
        parsed.headers.push(header);
        parsed.rows.forEach((row) => row.push(""));
      }
    });
  }
  parsed.rows = parsed.rows.map((row) => parsed.headers.map((_, index) => row[index] ?? ""));
  return parsed;
}

function renderAdminCsvTable() {
  if (!state.adminCsv) return;
  const { headers, rows } = state.adminCsv;
  elements.adminCsvTable.innerHTML = `
    <thead>
      <tr>
        <th scope="col" class="row-number">#</th>
        ${headers
          .map(
            (header, index) => `
              <th scope="col">
                <input class="csv-header-input" value="${escapeHtml(header)}" data-header-index="${index}" aria-label="Field ${index + 1}" />
              </th>
            `
          )
          .join("")}
        <th scope="col" class="row-actions">Action</th>
      </tr>
    </thead>
    <tbody>
      ${
        rows.length
          ? rows
              .map(
                (row, rowIndex) => `
                  <tr>
                    <th scope="row" class="row-number">${rowIndex + 1}</th>
                    ${headers
                      .map(
                        (_, columnIndex) => `
                          <td>
                            <textarea class="csv-cell" data-row-index="${rowIndex}" data-column-index="${columnIndex}" aria-label="Record ${rowIndex + 1}, ${escapeHtml(headers[columnIndex])}">${escapeHtml(row[columnIndex] ?? "")}</textarea>
                          </td>
                        `
                      )
                      .join("")}
                    <td class="row-actions">
                      <button class="mini-button" type="button" data-delete-row="${rowIndex}">Delete</button>
                    </td>
                  </tr>
                `
              )
              .join("")
          : `<tr><td class="empty-state" colspan="${headers.length + 2}">No records yet.</td></tr>`
      }
    </tbody>
  `;
}

function serializeAdminCsv() {
  if (!state.adminCsv) return "";
  const headers = state.adminCsv.headers.map((header) => header.trim());
  return stringifyCsv(headers, state.adminCsv.rows);
}

function setAdminCsvDirty(message = "Unsaved data changes.") {
  if (!state.adminCsv) return;
  state.adminCsv.dirty = true;
  state.pendingReview = null;
  elements.adminCsvReviewPanel.hidden = true;
  elements.adminCsvCommitReview.disabled = true;
  setInlineStatus(elements.adminCsvStatus, message, "busy");
}

async function loadAdminCsv() {
  if (!isAdmin()) return;
  const file = elements.adminCsvFile.value || "parts";
  setInlineStatus(elements.adminCsvStatus, "Loading data area...", "busy");
  const data = await requestJson(`/api/admin/csv?file=${encodeURIComponent(file)}`, {
    headers: adminHeaders()
  });
  const parsed = normalizeAdminCsvShape(parseCsvText(data.content), data.key);
  const label = data.label || data.fileName || "Selected data area";
  state.adminCsv = {
    ...parsed,
    key: data.key,
    label,
    fileName: data.fileName,
    dirty: false,
    originalContent: stringifyCsv(parsed.headers, parsed.rows),
    originalHeaders: [...parsed.headers],
    originalRows: cloneRows(parsed.rows)
  };
  clearAdminImport("Import a file to preview its fields before anything changes.");
  clearAdminReview();
  syncAdminImporter();
  elements.adminCsvDownload.href = data.exportPath || `/${data.fileName}`;
  elements.adminCsvDownload.textContent = `Export ${label}`;
  renderAdminCsvTable();
  setInlineStatus(elements.adminCsvStatus, `${label} loaded from the database.`, "success");
}

function startAdminCsvReview() {
  try {
    requireUser();
    if (!isAdmin()) {
      throw new Error("Only Gaurav or Monica can save administrative data changes.");
    }
    if (!state.adminCsv) {
      throw new Error("Load a data area before starting review.");
    }

    const importer = elements.adminCsvImporter.value.trim();
    if (!importer) {
      throw new Error("Confirm who is importing or requesting this change.");
    }

    const content = serializeAdminCsv();
    if (content === state.adminCsv.originalContent) {
      throw new Error("There are no changes to review yet.");
    }

    state.pendingReview = {
      file: elements.adminCsvFile.value,
      before: state.adminCsv.originalContent,
      after: content,
      importer
    };
    renderAdminCsvReview();
    elements.adminCsvReviewPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setInlineStatus(elements.adminCsvStatus, "Review is ready. Two distinct administrator approvals are required before commit.", "busy");
  } catch (error) {
    setInlineStatus(elements.adminCsvStatus, error.message, "error");
  }
}

async function commitAdminCsvReview() {
  try {
    requireUser();
    if (!isAdmin()) {
      throw new Error("Only Gaurav or Monica can commit administrative data changes.");
    }
    if (!state.pendingReview) {
      throw new Error("Start a review before committing.");
    }

    const approvals = collectAdminReviewApprovals();
    elements.adminCsvCommitReview.disabled = true;
    setInlineStatus(elements.adminCsvStatus, "Committing approved database change...", "busy");
    const result = await requestJson("/api/admin/csv", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        file: state.pendingReview.file,
        content: state.pendingReview.after,
        importer: state.pendingReview.importer,
        approvals
      })
    });
    setInlineStatus(elements.adminCsvStatus, result.message, "success");
    clearAdminReview();
    await loadAll();
    await loadAdminCsv();
  } catch (error) {
    setInlineStatus(elements.adminCsvStatus, error.message, "error");
  } finally {
    syncReviewCommitState();
  }
}

function addAdminCsvRow() {
  if (!state.adminCsv) return;
  state.adminCsv.rows.push(state.adminCsv.headers.map(() => ""));
  renderAdminCsvTable();
  setAdminCsvDirty("Added a new record.");
}

function addAdminCsvColumn() {
  if (!state.adminCsv) return;
  const columnName = elements.adminCsvNewColumn.value.trim();
  if (!columnName) {
    setInlineStatus(elements.adminCsvStatus, "Enter a field name first.", "error");
    return;
  }
  if (state.adminCsv.headers.some((header) => header.toLowerCase() === columnName.toLowerCase())) {
    setInlineStatus(elements.adminCsvStatus, "That field already exists.", "error");
    return;
  }
  state.adminCsv.headers.push(columnName);
  state.adminCsv.rows.forEach((row) => row.push(""));
  elements.adminCsvNewColumn.value = "";
  renderAdminCsvTable();
  setAdminCsvDirty(`Added field ${columnName}.`);
}

function syncAdminImporter() {
  if (!elements.adminCsvImporter || !state.user) return;
  if (!elements.adminCsvImporter.value.trim()) {
    elements.adminCsvImporter.value = `${state.user.name} <${state.user.email}>`;
  }
}

function clearAdminImport(message) {
  state.importDraft = null;
  if (elements.adminCsvImportFile) {
    elements.adminCsvImportFile.value = "";
  }
  elements.adminCsvImportMapping.hidden = true;
  elements.adminCsvImportMapping.innerHTML = "";
  elements.adminCsvImportActions.hidden = true;
  elements.adminCsvImportPrompt.textContent = message || "Import cleared.";
}

function clearAdminReview() {
  state.pendingReview = null;
  elements.adminCsvReviewPanel.hidden = true;
  elements.adminCsvReviewSummary.innerHTML = "";
  elements.adminCsvBeforePreview.textContent = "";
  elements.adminCsvAfterPreview.textContent = "";
  elements.adminCsvCommitReview.disabled = true;
  elements.adminCsvReviewers.querySelectorAll("select").forEach((select) => {
    select.value = "";
  });
  elements.adminCsvReviewers.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.checked = false;
  });
}

async function handleAdminCsvImport() {
  try {
    if (!state.adminCsv) {
      throw new Error("Load a data area before importing records.");
    }
    const file = elements.adminCsvImportFile.files?.[0];
    if (!file) return;
    const parsed = parseCsvText(await file.text());
    if (!parsed.headers.length) {
      throw new Error("Imported file must include a header row.");
    }
    if (!parsed.rows.length) {
      throw new Error("Imported file has no records to apply.");
    }
    state.importDraft = {
      fileName: file.name,
      headers: parsed.headers.map((header) => header.trim()),
      rows: padRowsToHeaders(parsed.rows, parsed.headers)
    };
    renderAdminImportPrompt();
    setInlineStatus(elements.adminCsvStatus, `Imported ${file.name}. Review field mapping before applying.`, "busy");
  } catch (error) {
    state.importDraft = null;
    renderAdminImportPrompt();
    setInlineStatus(elements.adminCsvStatus, error.message, "error");
  }
}

function renderAdminImportPrompt() {
  const draft = state.importDraft;
  if (!draft || !state.adminCsv) {
    elements.adminCsvImportPrompt.textContent = "Import a file to preview its fields before anything changes.";
    elements.adminCsvImportMapping.hidden = true;
    elements.adminCsvImportActions.hidden = true;
    elements.adminCsvImportMapping.innerHTML = "";
    return;
  }

  const importOptions = draft.headers
    .map((header, index) => `<option value="${index}">${escapeHtml(header)}</option>`)
    .join("");
  const existingMappings = state.adminCsv.headers
    .map((header, targetIndex) => {
      const matchIndex = findHeaderIndex(draft.headers, header);
      return `
        <label>
          ${escapeHtml(header)}
          <select data-import-map-target="${targetIndex}">
            <option value="">Do not import into this field</option>
            ${draft.headers
              .map(
                (importHeader, importIndex) =>
                  `<option value="${importIndex}" ${importIndex === matchIndex ? "selected" : ""}>${escapeHtml(importHeader)}</option>`
              )
              .join("")}
          </select>
        </label>
      `;
    })
    .join("");
  const extraHeaders = draft.headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => findHeaderIndex(state.adminCsv.headers, header) === -1);
  const extraColumnMarkup = extraHeaders.length
    ? `
      <fieldset class="extra-column-choice">
        <legend>New imported fields</legend>
        <p>Keep checked to add these as new database fields.</p>
        ${extraHeaders
          .map(
            ({ header, index }) => `
              <label>
                <input type="checkbox" data-extra-import-column="${index}" checked />
                ${escapeHtml(header)}
              </label>
            `
          )
          .join("")}
      </fieldset>
    `
    : `<p class="admin-note">No new fields were found in this import.</p>`;
  const defaultMatchIndex =
    findHeaderIndex(state.adminCsv.headers, "SKU") !== -1
      ? findHeaderIndex(state.adminCsv.headers, "SKU")
      : findHeaderIndex(state.adminCsv.headers, "Email") !== -1
        ? findHeaderIndex(state.adminCsv.headers, "Email")
        : 0;

  elements.adminCsvImportPrompt.innerHTML = `
    <strong>${escapeHtml(draft.fileName)}</strong> has ${draft.rows.length} records and ${draft.headers.length} fields.
    Confirm the mappings below, then apply the import to the editable data area.
  `;
  elements.adminCsvImportMapping.hidden = false;
  elements.adminCsvImportActions.hidden = false;
  elements.adminCsvImportMapping.innerHTML = `
    <div class="mapping-section">
      <div>
        <h4>Map imported fields</h4>
        <p>Use only the fields you want. Unmapped values stay blank.</p>
      </div>
      <div class="mapping-grid">${existingMappings}</div>
    </div>
    <div class="mapping-section">
      ${extraColumnMarkup}
    </div>
    <label class="match-column-control">
      Match existing records by
      <select data-import-match-column>
        ${state.adminCsv.headers
          .map(
            (header, index) =>
              `<option value="${index}" ${index === defaultMatchIndex ? "selected" : ""}>${escapeHtml(header)}</option>`
          )
          .join("")}
      </select>
    </label>
  `;
}

function collectAdminImportPlan() {
  const draft = state.importDraft;
  const headers = [...state.adminCsv.headers];
  const existingRows = padRowsToHeaders(state.adminCsv.rows, headers);
  const mappings = [...elements.adminCsvImportMapping.querySelectorAll("[data-import-map-target]")]
    .map((select) => ({
      targetIndex: Number(select.dataset.importMapTarget),
      sourceIndex: select.value === "" ? -1 : Number(select.value)
    }))
    .filter((mapping) => mapping.sourceIndex >= 0);
  const extraColumns = [...elements.adminCsvImportMapping.querySelectorAll("[data-extra-import-column]:checked")]
    .map((checkbox) => Number(checkbox.dataset.extraImportColumn))
    .filter((sourceIndex) => Number.isInteger(sourceIndex));

  extraColumns.forEach((sourceIndex) => {
    const header = draft.headers[sourceIndex];
    if (findHeaderIndex(headers, header) === -1) {
      headers.push(header);
      existingRows.forEach((row) => row.push(""));
    }
  });

  const extraMappings = extraColumns.map((sourceIndex) => ({
    targetIndex: findHeaderIndex(headers, draft.headers[sourceIndex]),
    sourceIndex
  }));
  const allMappings = [...mappings, ...extraMappings];
  if (!allMappings.length) {
    throw new Error("Choose at least one imported field before applying the import.");
  }

  return {
    headers,
    existingRows,
    mappings: allMappings,
    mode: elements.adminCsvImportMode.value,
    matchIndex: Number(elements.adminCsvImportMapping.querySelector("[data-import-match-column]")?.value || 0)
  };
}

function buildImportedRow(importedRow, plan) {
  const row = plan.headers.map(() => "");
  plan.mappings.forEach(({ targetIndex, sourceIndex }) => {
    row[targetIndex] = importedRow[sourceIndex] ?? "";
  });
  return row;
}

function applyAdminCsvImport() {
  try {
    if (!state.importDraft || !state.adminCsv) {
      throw new Error("Import a file before applying data.");
    }
    const importer = elements.adminCsvImporter.value.trim();
    if (!importer) {
      throw new Error("Confirm who is importing or requesting this data.");
    }
    const plan = collectAdminImportPlan();
    const importedRows = state.importDraft.rows.map((row) => buildImportedRow(row, plan));
    let nextRows = plan.existingRows;

    if (plan.mode === "replace") {
      nextRows = importedRows;
    } else if (plan.mode === "update") {
      const lookup = new Map(
        nextRows
          .map((row, index) => [normalizeHeader(row[plan.matchIndex]), index])
          .filter(([key]) => Boolean(key))
      );
      importedRows.forEach((importedRow) => {
        const key = normalizeHeader(importedRow[plan.matchIndex]);
        const existingIndex = key ? lookup.get(key) : undefined;
        if (existingIndex === undefined) {
          nextRows.push(importedRow);
          if (key) lookup.set(key, nextRows.length - 1);
          return;
        }
        plan.mappings.forEach(({ targetIndex }) => {
          nextRows[existingIndex][targetIndex] = importedRow[targetIndex] ?? "";
        });
      });
    } else {
      nextRows = [...nextRows, ...importedRows];
    }

    state.adminCsv.headers = plan.headers;
    state.adminCsv.rows = padRowsToHeaders(nextRows, plan.headers);
    renderAdminCsvTable();
    const fileName = state.importDraft.fileName;
    clearAdminImport(`Applied ${fileName}. Start review before committing.`);
    setAdminCsvDirty(`Applied import from ${fileName}. Start two-admin review before committing.`);
  } catch (error) {
    setInlineStatus(elements.adminCsvStatus, error.message, "error");
  }
}

function summarizeCsvChange(beforeContent, afterContent) {
  const before = parseCsvText(beforeContent);
  const after = parseCsvText(afterContent);
  const addedColumns = after.headers.filter((header) => findHeaderIndex(before.headers, header) === -1);
  const removedColumns = before.headers.filter((header) => findHeaderIndex(after.headers, header) === -1);
  const allHeaders = [...new Set([...before.headers, ...after.headers])];
  const maxRows = Math.max(before.rows.length, after.rows.length);
  let changedCells = 0;

  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    const beforeRow = rowToObject(before.headers, before.rows[rowIndex] || []);
    const afterRow = rowToObject(after.headers, after.rows[rowIndex] || []);
    allHeaders.forEach((header) => {
      if ((beforeRow[header] ?? "") !== (afterRow[header] ?? "")) {
        changedCells += 1;
      }
    });
  }

  return {
    beforeRows: before.rows.length,
    afterRows: after.rows.length,
    beforeColumns: before.headers.length,
    afterColumns: after.headers.length,
    addedColumns,
    removedColumns,
    changedCells
  };
}

function previewCsvContent(content, maxLines = 12) {
  const lines = String(content || "").trimEnd().split(/\r?\n/);
  const visible = lines.slice(0, maxLines).join("\n");
  const remaining = lines.length - maxLines;
  return remaining > 0 ? `${visible}\n... ${remaining} more line${remaining === 1 ? "" : "s"}` : visible;
}

function renderAdminCsvReview() {
  const review = state.pendingReview;
  if (!review) return;
  const summary = summarizeCsvChange(review.before, review.after);
  elements.adminCsvReviewPanel.hidden = false;
  elements.adminCsvReviewSummary.innerHTML = `
    <div class="summary-card">
      <span>Importer</span>
      <strong>${escapeHtml(review.importer)}</strong>
    </div>
    <div class="summary-card">
      <span>Records</span>
      <strong>${summary.beforeRows} -> ${summary.afterRows}</strong>
    </div>
    <div class="summary-card">
      <span>Fields</span>
      <strong>${summary.beforeColumns} -> ${summary.afterColumns}</strong>
    </div>
    <div class="summary-card">
      <span>Changed cells</span>
      <strong>${summary.changedCells}</strong>
    </div>
    <div class="summary-card wide">
      <span>Field changes</span>
      <strong>
        ${summary.addedColumns.length ? `Added: ${escapeHtml(summary.addedColumns.join(", "))}` : "No added fields"}
        ${summary.removedColumns.length ? ` Removed fields: ${escapeHtml(summary.removedColumns.join(", "))}` : ""}
      </strong>
    </div>
  `;
  elements.adminCsvBeforePreview.textContent = previewCsvContent(review.before);
  elements.adminCsvAfterPreview.textContent = previewCsvContent(review.after);
  syncReviewCommitState();
}

function collectAdminReviewApprovals() {
  const selects = [...elements.adminCsvReviewers.querySelectorAll("[data-reviewer-slot]")];
  const approvals = selects
    .map((select, index) => ({
      email: select.value.trim().toLowerCase(),
      approved: elements.adminCsvReviewers.querySelector(`[data-reviewer-approval="${index}"]`)?.checked
    }))
    .filter((approval) => approval.email && approval.approved);
  const uniqueEmails = [...new Set(approvals.map((approval) => approval.email))];
  if (uniqueEmails.length < 2) {
    throw new Error("Two different administrators must approve this change.");
  }
  uniqueEmails.forEach((email) => {
    if (!isAdminCapable(email)) {
      throw new Error("Reviewer must be an authorized administrator.");
    }
  });
  return uniqueEmails.map((email) => ({ email }));
}

function syncReviewCommitState() {
  if (!state.pendingReview) {
    elements.adminCsvCommitReview.disabled = true;
    return;
  }
  try {
    collectAdminReviewApprovals();
    elements.adminCsvCommitReview.disabled = false;
  } catch {
    elements.adminCsvCommitReview.disabled = true;
  }
}

function declineAdminCsvReview() {
  if (!state.adminCsv) return;
  const parsed = parseCsvText(state.adminCsv.originalContent || "");
  state.adminCsv.headers = [...parsed.headers];
  state.adminCsv.rows = padRowsToHeaders(parsed.rows, parsed.headers);
  state.adminCsv.dirty = false;
  renderAdminCsvTable();
  clearAdminReview();
  setInlineStatus(elements.adminCsvStatus, "Change declined. The data area was reset to the last saved version.", "success");
}

async function submitReport(event) {
  event.preventDefault();
  const button = elements.reportForm.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const result = await requestJson("/api/report", {
      method: "POST",
      body: JSON.stringify({ comments: elements.comments.value.trim() })
    });
    setInlineStatus(elements.reportStatus, result.message, "success");
    window.location.href = result.mailto;
    elements.comments.value = "";
    updateCharacterCount();
  } catch (error) {
    setInlineStatus(elements.reportStatus, error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function updateCharacterCount() {
  elements.characterCount.textContent = `${elements.comments.value.length} / 500 characters`;
}

function syncActiveNavFromHash() {
  const hash = window.location.hash || "#scan";
  const fallback = document.querySelector(".nav-item[href='#scan']");
  const target = document.querySelector(`.nav-item[href='${hash}']`);
  const activeItem = target && !target.hidden ? target : fallback;
  const activeHash = activeItem?.getAttribute("href") || "#scan";

  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("is-active"));
  activeItem?.classList.add("is-active");
  document.querySelectorAll(".main-content > .panel").forEach((panel) => {
    const panelHash = `#${panel.id}`;
    const adminOnly = panel.hasAttribute("data-admin-only");
    panel.hidden = panelHash !== activeHash || (adminOnly && !isAdmin());
  });

  if (elements.overviewHeader) {
    elements.overviewHeader.hidden = activeHash !== "#scan";
  }

  if (hash !== activeHash) {
    history.replaceState(null, "", activeHash);
  }

  if (state.activeRoute !== activeHash) {
    state.activeRoute = activeHash;
    window.scrollTo({ top: 0, left: 0 });
  }
}

function bindEvents() {
  elements.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const isGuest = elements.memberSelect.value === "__guest__";
    const selectedOption = elements.memberSelect.selectedOptions[0];
    const name = isGuest
      ? elements.loginName.value.trim()
      : selectedOption?.dataset.name || selectedOption?.textContent.trim() || "";
    const email = elements.loginEmail.value.trim();

    if (!name || !email) {
      setInlineStatus(elements.loginStatus, "Select a member or enter guest name and email.", "error");
      return;
    }

    const requestedRole = elements.loginForm.querySelector("input[name='loginRole']:checked")?.value || "user";
    const role = !isGuest && isAdminCapable(email) && requestedRole === "admin" ? "admin" : "user";

    state.user = {
      name,
      email,
      type: isGuest ? "guest" : "member",
      role
    };
    localStorage.setItem(userStorageKey, JSON.stringify(state.user));
    setInlineStatus(elements.loginStatus, "", "");
    renderUser();
  });

  elements.memberSelect.addEventListener("change", syncLoginFields);
  elements.logoutButton.addEventListener("click", signOut);
  elements.refreshButton.addEventListener("click", loadAll);
  elements.lookupMethodInputs.forEach((input) => {
    input.addEventListener("change", () => setLookupMethod(selectedLookupMethod()));
  });
  elements.categoryHint.addEventListener("change", () => renderGuidedSearchOptions("category"));
  elements.detailHint.addEventListener("change", () => renderGuidedSearchOptions("detail"));
  elements.lookupCodeButton.addEventListener("click", () => lookupPartCode("Manual Code Entry"));
  elements.partCodeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      lookupPartCode("Manual Code Entry");
    }
  });
  elements.movementNoNvbug.addEventListener("change", syncNvbugInput);
  elements.replenishmentSku.addEventListener("change", syncReplenishmentItemFromSku);
  elements.replenishmentCreate.addEventListener("click", createReplenishmentRequest);
  elements.replenishmentRefresh.addEventListener("click", () => {
    loadReplenishmentBoard()
      .then(() => setInlineStatus(elements.replenishmentStatus, "Replenishment progress refreshed.", "success"))
      .catch((error) => setInlineStatus(elements.replenishmentStatus, error.message, "error"));
  });
  elements.controlRefresh.addEventListener("click", refreshControlCenter);
  elements.controlSettingsForm.addEventListener("submit", saveControlSettings);
  elements.controlBrowseBackup.addEventListener("click", browseBackupFolder);
  elements.controlUseDefaultBackup.addEventListener("click", useDefaultBackupFolder);
  elements.controlBackupFolderInput.addEventListener("change", () => {
    updateBackupFolderFromFileSelection(elements.controlBackupFolderInput.files);
    elements.controlBackupFolderInput.value = "";
  });
  elements.controlRunBackup.addEventListener("click", runControlBackup);
  elements.managementRefresh.addEventListener("click", loadManagementReport);
  elements.managementReset.addEventListener("click", resetManagementFilters);
  elements.managementExport.addEventListener("click", exportManagementReport);
  [elements.managementCategory, elements.managementSku, elements.managementLocation, elements.managementStockStatus].forEach((control) =>
    control.addEventListener("change", () => {
      renderManagementFilterOptions();
      resetManagementReportView("Filters changed. Click Generate Report to refresh results.");
    })
  );
  elements.managementSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadManagementReport();
      return;
    }
  });
  elements.managementSearch.addEventListener("input", () => resetManagementReportView("Filters changed. Click Generate Report to refresh results."));
  elements.analyzeButton.addEventListener("click", analyzePart);
  elements.confirmMatchButton.addEventListener("click", () => confirmCandidate());
  elements.rejectMatchButton.addEventListener("click", rejectCandidate);
  elements.sendEvaluationButton.addEventListener("click", submitEvaluation);
  elements.updateInventoryButton.addEventListener("click", updateInventoryFromSearch);
  elements.finishSignOutButton.addEventListener("click", signOut);
  elements.adminCsvFile.addEventListener("change", loadAdminCsv);
  elements.adminCsvAddRow.addEventListener("click", addAdminCsvRow);
  elements.adminCsvAddColumn.addEventListener("click", addAdminCsvColumn);
  elements.adminCsvImportFile.addEventListener("change", handleAdminCsvImport);
  elements.adminCsvImportMode.addEventListener("change", renderAdminImportPrompt);
  elements.adminCsvImportApply.addEventListener("click", applyAdminCsvImport);
  elements.adminCsvReload.addEventListener("click", loadAdminCsv);
  elements.adminCsvSave.addEventListener("click", startAdminCsvReview);
  elements.adminCsvCommitReview.addEventListener("click", commitAdminCsvReview);
  elements.adminCsvDeclineReview.addEventListener("click", declineAdminCsvReview);
  elements.adminCsvReviewers.addEventListener("change", syncReviewCommitState);
  elements.adminCsvTable.addEventListener("input", (event) => {
    const headerIndex = event.target.dataset.headerIndex;
    const rowIndex = event.target.dataset.rowIndex;
    const columnIndex = event.target.dataset.columnIndex;
    if (headerIndex !== undefined) {
      state.adminCsv.headers[Number(headerIndex)] = event.target.value;
      setAdminCsvDirty();
      return;
    }
    if (rowIndex !== undefined && columnIndex !== undefined) {
      state.adminCsv.rows[Number(rowIndex)][Number(columnIndex)] = event.target.value;
      setAdminCsvDirty();
    }
  });
  elements.comments.addEventListener("input", updateCharacterCount);
  elements.reportForm.addEventListener("submit", submitReport);
  window.addEventListener("hashchange", syncActiveNavFromHash);

  document.addEventListener("click", (event) => {
    const searchPreset = event.target.closest("[data-search-preset]")?.dataset.searchPreset;
    if (searchPreset) {
      elements.scanHints.value = searchPreset;
      analyzePart();
      return;
    }

    const refineTerm = event.target.closest("[data-refine-term]")?.dataset.refineTerm;
    if (refineTerm) {
      const current = elements.scanHints.value.trim();
      elements.scanHints.value = current ? `${current} ${refineTerm}` : refineTerm;
      analyzePart();
      return;
    }

    const replenishmentId = event.target.closest("[data-replenishment-id]")?.dataset.replenishmentId;
    const replenishmentStatus = event.target.closest("[data-replenishment-status]")?.dataset.replenishmentStatus;
    if (replenishmentId && replenishmentStatus) {
      updateReplenishmentStatus(replenishmentId, replenishmentStatus);
      return;
    }

    const deleteRow = event.target.closest("[data-delete-row]")?.dataset.deleteRow;
    if (deleteRow !== undefined && state.adminCsv) {
      state.adminCsv.rows.splice(Number(deleteRow), 1);
      renderAdminCsvTable();
      setAdminCsvDirty("Deleted record.");
      return;
    }

    const candidateSku = event.target.closest("[data-candidate-sku]")?.dataset.candidateSku;
    if (!candidateSku) return;
    const candidate =
      state.searchResult?.candidates?.find((item) => item.part.sku === candidateSku) ||
      (state.catalog.parts.find((part) => part.sku === candidateSku)
        ? { part: state.catalog.parts.find((part) => part.sku === candidateSku), confidence: 0.7, reasons: ["User selected result"] }
        : null);
    if (candidate) {
      state.candidate = candidate;
      if (state.searchResult) {
        renderMatch({ ...state.searchResult, match: candidate });
      }
      confirmCandidate(candidate);
      setInlineStatus(elements.scanStatus, `${candidate.part.name} selected. Review location and quantity.`, "success");
    }
  });

  document.querySelectorAll(".nav-item[href^='#']").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("is-active"));
      link.classList.add("is-active");
    });
  });
}

function signOut() {
  localStorage.removeItem(userStorageKey);
  state.user = null;
  state.candidate = null;
  state.confirmedPart = null;
  state.lookupContext = { method: "Manual Search", code: "" };
  elements.matchPanel.hidden = true;
  elements.evaluationPanel.hidden = true;
  elements.movementPanel.hidden = true;
  elements.locationPanel.hidden = true;
  state.adminCsv = null;
  state.controlSettings = null;
  state.importDraft = null;
  state.pendingReview = null;
  elements.adminCsvTable.innerHTML = "";
  elements.adminCsvImportMapping.innerHTML = "";
  elements.adminCsvImportMapping.hidden = true;
  elements.adminCsvImportActions.hidden = true;
  elements.adminCsvImportPrompt.textContent = "Import a file to preview its fields before anything changes.";
  elements.adminCsvReviewPanel.hidden = true;
  setInlineStatus(elements.scanStatus, "", "");
  setInlineStatus(elements.adminCsvStatus, "", "");
  if (["#admin", "#management", "#control"].includes(window.location.hash)) {
    window.location.hash = "#scan";
  }
  renderUser();
}

bindEvents();
loadUser();
updateCharacterCount();
syncActiveNavFromHash();
setLookupMethod(selectedLookupMethod());
syncNvbugInput();
loadAll().catch((error) => {
  setSaveStatus(error.message, "error");
});
