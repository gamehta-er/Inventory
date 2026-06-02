const state = {
  snapshot: null,
  view: "command",
  selectedSku: "",
  operationMode: "checkout"
};

const viewCopy = {
  command: {
    title: "Command Center",
    description: "Executive inventory position with SKU-level drilldown, risk visibility, and stock controls.",
    filters: true,
    inspector: true
  },
  explorer: {
    title: "Inventory Explorer",
    description: "Part Master records with identifiers, locations, aliases, and metadata for search accuracy.",
    filters: true,
    inspector: true
  },
  operations: {
    title: "Stock Operations",
    description: "Record checkout, restock, and 2D barcode lookup activity against the Stock Ledger.",
    filters: true,
    inspector: true
  },
  replenishment: {
    title: "Replenishment",
    description: "Review low-stock exposure and open replenishment requests by SKU, priority, and owner.",
    filters: true,
    inspector: true
  },
  audit: {
    title: "Transaction Audit",
    description: "Detailed Stock Ledger for management review, accountability, and exception tracking.",
    filters: false,
    inspector: false
  },
  governance: {
    title: "Catalog Governance",
    description: "Maintain Part Master quality, code mappings, image readiness, and SKU search coverage.",
    filters: true,
    inspector: true
  },
  system: {
    title: "System Operations",
    description: "Runtime status, database path, source model, exports, and backup controls.",
    filters: false,
    inspector: false
  }
};

const elements = {
  navList: document.querySelector("#navList"),
  viewCrumb: document.querySelector("#viewCrumb"),
  viewTitle: document.querySelector("#viewTitle"),
  viewDescription: document.querySelector("#viewDescription"),
  runtimeChip: document.querySelector("#runtimeChip"),
  refreshButton: document.querySelector("#refreshButton"),
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

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
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

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.message || "Request failed.");
  return data;
}

function optionMarkup(value, label, selectedValue) {
  return `<option value="${escapeHtml(value)}" ${String(value) === String(selectedValue) ? "selected" : ""}>${escapeHtml(label)}</option>`;
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

function filteredParts() {
  const filters = currentFilters();
  return (state.snapshot?.parts || []).filter((part) => {
    return (
      (filters.category === "all" || part.category === filters.category) &&
      (filters.sku === "all" || part.sku === filters.sku) &&
      (filters.location === "all" || part.location === filters.location) &&
      (filters.status === "all" || part.status.key === filters.status) &&
      (!filters.search || searchableText(part).includes(filters.search))
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
    metricCard("Total on hand", formatNumber(totalOnHand), "Filtered stock quantity", "green"),
    metricCard("Part Master records", formatNumber(parts.length), "SKU-level records", "neutral"),
    metricCard("Stocked SKUs", formatNumber(stockedSkus), "Available inventory", "blue"),
    metricCard("Low stock", formatNumber(lowStock), "At or below minimum", lowStock ? "amber" : "neutral"),
    metricCard("Missing", formatNumber(missing), "No stock on hand", missing ? "red" : "neutral"),
    metricCard("Locations", formatNumber(locations), "Aisle and bin coverage", "green")
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
  return `<span class="status-pill ${escapeHtml(status.key)}">${escapeHtml(status.label)}</span>`;
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
      { label: "Total on hand", render: (row) => formatNumber(row.totalOnHand) },
      { label: "SKU records", render: (row) => formatNumber(row.skuCount) },
      { label: "Stocked SKUs", render: (row) => formatNumber(row.stockedSkus) },
      { label: "Low stock", render: (row) => `<span class="${row.lowStock ? "text-amber" : ""}">${formatNumber(row.lowStock)}</span>` },
      { label: "Missing", render: (row) => `<span class="${row.missing ? "text-red" : ""}">${formatNumber(row.missing)}</span>` },
      { label: "Locations", render: (row) => formatNumber(row.locations) }
    ],
    rows,
    "No category position matches the current filters."
  );
}

function renderStockList(parts, compact = false) {
  return renderTable(
    [
      { label: "SKU", render: (part) => `<strong>${escapeHtml(part.sku)}</strong><span class="subtext">${escapeHtml(part.partName)}</span>` },
      { label: "Category", render: (part) => escapeHtml(part.category) },
      { label: "Available", render: (part) => `<strong>${formatNumber(part.quantity)}</strong>` },
      { label: "Minimum", render: (part) => formatNumber(part.minimum) },
      { label: "Status", render: (part) => renderStatusPill(part.status) },
      { label: "Location", render: (part) => escapeHtml(part.location) },
      { label: "Last movement", render: (part) => escapeHtml(formatDate(part.lastMovement)) },
      { label: "Owner", render: (part) => escapeHtml(part.owner) }
    ],
    parts,
    "No SKU records match the current filters.",
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
    return `<div class="empty-panel"><strong>No active stock risk in this view.</strong><span>Low and missing SKUs will appear here as filters change.</span></div>`;
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
              <em>${formatNumber(part.quantity)} on hand, minimum ${formatNumber(part.minimum)} - ${escapeHtml(part.location)}</em>
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

function commandView(parts) {
  return [
    renderPanel("Category Overview", "Bird-eye inventory position by part family, with every total traceable to SKU detail.", renderCategoryOverview(parts)),
    renderPanel(
      "SKU Stock List",
      "Current availability, minimum threshold, status, physical location, and responsible owner.",
      renderStockList(parts)
    ),
    renderPanel("Operational Risk Queue", "Missing and low-stock SKUs that require replenishment or owner review.", renderRiskQueue(parts))
  ].join("");
}

function explorerView(parts) {
  const rows = parts.map((part) => ({
    ...part,
    aliasText: (part.aliases || []).join("; ") || "Not defined",
    imageState: part.imagePath ? "Reference linked" : "Image needed"
  }));

  return renderPanel(
    "Part Master Catalog",
    "Searchable SKU baseline with identifiers, physical storage, visual distinguishers, and metadata.",
    renderTable(
      [
        { label: "SKU", render: (part) => `<strong>${escapeHtml(part.sku)}</strong><span class="subtext">${escapeHtml(part.partName)}</span>` },
        { label: "Family", render: (part) => escapeHtml(part.category) },
        { label: "Availability", render: (part) => `${formatNumber(part.quantity)} / min ${formatNumber(part.minimum)}` },
        { label: "Storage", render: (part) => escapeHtml(part.location) },
        { label: "Image", render: (part) => `<span class="quality-pill ${part.imagePath ? "ready" : "review"}">${escapeHtml(part.imageState)}</span>` },
        { label: "Distinguishers", render: (part) => `<span class="metadata-cell">${escapeHtml(part.distinguishers || "Not defined")}</span>` },
        { label: "Aliases", render: (part) => `<span class="metadata-cell">${escapeHtml(part.aliasText)}</span>` }
      ],
      rows,
      "No Part Master records match the current filters.",
      {
        tall: true,
        tableClass: "selectable-table wide-table",
        rowClass: (part) => (part.sku === state.selectedSku ? "selected-row" : ""),
        rowAttrs: (part) => `data-sku-row="${escapeHtml(part.sku)}"`
      }
    )
  );
}

function operationForm(part) {
  if (!part) {
    return `<div class="empty-panel"><strong>Select a SKU to continue.</strong><span>Use filters, barcode lookup, or the Stock List to choose the right Part Master record.</span></div>`;
  }
  return `
    <form class="operation-form" id="stockOperationForm">
      <div class="operation-summary">
        <span>${renderStatusPill(part.status)}</span>
        <strong>${escapeHtml(part.sku)}</strong>
        <small>${escapeHtml(part.partName)} - ${escapeHtml(part.location)}</small>
      </div>
      <div class="segmented-control" role="group" aria-label="Operation type">
        <button class="${state.operationMode === "checkout" ? "active" : ""}" type="button" data-operation-mode="checkout">Checkout</button>
        <button class="${state.operationMode === "restock" ? "active" : ""}" type="button" data-operation-mode="restock">Restock</button>
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
          <input id="operationNvbug" placeholder="NVBug, Jira, RMA, or request ID" />
        </label>
        <label>
          Operator
          <input id="operationOperator" value="Gaurav Mehta" />
        </label>
      </div>
      <label>
        Business reason
        <textarea id="operationReason" placeholder="Project, test system, RMA, replenishment, allocation, or approved exception"></textarea>
      </label>
      <label class="checkbox-row">
        <input id="referenceException" type="checkbox" />
        <span>No NVBug/reference available - record this as an approved exception.</span>
      </label>
      <div class="form-actions">
        <button class="button primary" type="submit">Record ${state.operationMode === "checkout" ? "Checkout" : "Restock"}</button>
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
              <input id="codeLookupInput" placeholder="Example: QR-GPU-A100-80GB-PCIE" />
            </label>
            <button class="button secondary" id="runCodeLookup" type="button">Find SKU</button>
          </div>
          <div class="code-hints">
            ${(state.snapshot?.codeMappings || [])
              .slice(0, 5)
              .map((code) => `<button type="button" data-code-sample="${escapeHtml(code.code)}">${escapeHtml(code.code)}</button>`)
              .join("")}
          </div>
        `
      )}
      ${renderPanel("Stock Ledger Entry", "Every inventory change records operator, action, quantity, reason, and NVBug/reference status.", operationForm(part))}
    </section>
    ${renderPanel("Matching SKU Stock List", "Use the current filters to narrow the operation target.", renderStockList(parts, true))}
  `;
}

function replenishmentView(parts) {
  const part = selectedPart();
  const requests = state.snapshot?.replenishment || [];
  const requestRows = requests.filter((request) => {
    if (!part) return true;
    const categoryMatch = currentFilters().category === "all" || request.category === currentFilters().category;
    return categoryMatch;
  });

  return `
    <section class="two-column">
      ${renderPanel(
        "Create Replenishment Request",
        "Open a restock signal for the selected SKU with owner, priority, and business context.",
        part
          ? `
            <form class="operation-form" id="replenishmentForm">
              <div class="operation-summary">
                <span>${renderStatusPill(part.status)}</span>
                <strong>${escapeHtml(part.sku)}</strong>
                <small>${escapeHtml(part.partName)} - ${formatNumber(part.quantity)} on hand, minimum ${formatNumber(part.minimum)}</small>
              </div>
              <div class="form-grid">
                <label>
                  Requested quantity
                  <input id="requestQuantity" type="number" min="1" step="1" value="${Math.max(part.minimum * 2 - part.quantity, 1)}" />
                </label>
                <label>
                  Priority
                  <select id="requestPriority">
                    <option>Normal</option>
                    <option>High</option>
                    <option>Critical</option>
                  </select>
                </label>
              </div>
              <label>
                Notes
                <textarea id="requestNotes" placeholder="Need-by date, project, system family, supplier, or replacement context"></textarea>
              </label>
              <button class="button primary" type="submit">Create Request</button>
            </form>
          `
          : `<div class="empty-panel"><strong>No SKU selected.</strong><span>Select a SKU from the Stock List or Risk Queue.</span></div>`
      )}
      ${renderPanel("Stock Risk Queue", "SKUs below policy threshold, sorted by severity.", renderRiskQueue(parts))}
    </section>
    ${renderPanel(
      "Open Replenishment Requests",
      "Requests are operational signals until procurement, transfer, or refill work is complete.",
      renderTable(
        [
          { label: "Request", render: (row) => `<strong>${escapeHtml(row.id)}</strong><span class="subtext">${escapeHtml(row.status)}</span>` },
          { label: "SKU", render: (row) => `<strong>${escapeHtml(row.sku)}</strong><span class="subtext">${escapeHtml(row.part_name || row.partName || "")}</span>` },
          { label: "Category", render: (row) => escapeHtml(row.category) },
          { label: "Current", render: (row) => formatNumber(row.current_qty) },
          { label: "Minimum", render: (row) => formatNumber(row.min_qty) },
          { label: "Requested", render: (row) => formatNumber(row.requested_qty) },
          { label: "Priority", render: (row) => `<span class="quality-pill ${String(row.priority).toLowerCase()}">${escapeHtml(row.priority || "Normal")}</span>` },
          { label: "Owner", render: (row) => escapeHtml(row.owner) }
        ],
        requestRows,
        "No replenishment requests match this view.",
        { tall: true }
      )
    )}
  `;
}

function auditView() {
  const transactions = state.snapshot?.transactions || [];
  return renderPanel(
    "Stock Ledger",
    "Detailed, exportable transaction history for accountability and management reporting.",
    `
      <div class="panel-toolbar">
        <span>${formatNumber(transactions.length)} ledger entries</span>
        <a class="button secondary" href="/exports/stock-ledger">Export Stock Ledger</a>
      </div>
      ${renderTable(
        [
          { label: "When", render: (row) => `<strong>${escapeHtml(formatDate(row.timestamp))}</strong><span class="subtext">${escapeHtml(row.timestamp)}</span>` },
          { label: "Operator", render: (row) => `<strong>${escapeHtml(row.operator_name)}</strong><span class="subtext">${escapeHtml(row.operator_email)}</span>` },
          { label: "Action", render: (row) => escapeHtml(row.action) },
          { label: "SKU", render: (row) => `<strong>${escapeHtml(row.sku)}</strong><span class="subtext">${escapeHtml(row.part_name)}</span>` },
          { label: "Qty", render: (row) => formatNumber(row.quantity) },
          { label: "Before", render: (row) => formatNumber(row.before_qty) },
          { label: "After", render: (row) => formatNumber(row.after_qty) },
          { label: "NVBug / Reference", render: (row) => escapeHtml(row.nvbug || "Not provided") },
          { label: "Reason", render: (row) => `<span class="metadata-cell">${escapeHtml(row.reason || "No reason provided")}</span>` }
        ],
        transactions,
        "No stock ledger entries are available.",
        { tall: true, tableClass: "wide-table" }
      )}
    `
  );
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
      "Part Master Quality",
      "Administrative view of the fields that determine search accuracy and future image-based matching readiness.",
      renderTable(
        [
          { label: "SKU", render: (part) => `<strong>${escapeHtml(part.sku)}</strong><span class="subtext">${escapeHtml(part.partName)}</span>` },
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
      "Active code mappings connect physical labels to SKU-level inventory records.",
      renderTable(
        [
          { label: "Code", render: (row) => `<strong>${escapeHtml(row.code)}</strong>` },
          { label: "Type", render: (row) => escapeHtml(row.code_type) },
          { label: "SKU", render: (row) => escapeHtml(row.sku) },
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

function systemView() {
  const system = state.snapshot?.system || {};
  const summary = state.snapshot?.summary || {};
  return `
    <section class="system-grid">
      ${systemCard("Runtime Source", "SQLite database", [
        ["Database", system.databaseRelativePath || ""],
        ["Full path", system.databaseAbsolutePath || ""],
        ["Seed source", system.seedSource || ""],
        ["Mode", system.phase || ""]
      ])}
      ${systemCard("Data Safety", "Backup and export controls", [
        ["Backup folder", system.backupDirectory || ""],
        ["Last backup", system.lastBackupAt ? formatDate(system.lastBackupAt) : "Not run"],
        ["Backup status", system.lastBackupStatus || "Not run"],
        ["Last backup file", system.lastBackupPath || "No backup created yet"]
      ], `
        <div class="button-row">
          <button class="button primary" id="runBackupButton" type="button">Run Backup Now</button>
          <a class="button secondary" href="/exports/inventory-snapshot">Export Inventory</a>
          <a class="button secondary" href="/exports/stock-ledger">Export Ledger</a>
        </div>
      `)}
      ${systemCard("Operational Coverage", "What this comparison build contains", [
        ["Part Master records", formatNumber(summary.partMasterRecords)],
        ["Code mappings", formatNumber(summary.codeMappings)],
        ["Open replenishment", formatNumber(summary.openRestock)],
        ["Lookup model", "2D barcode and manual lookup only"]
      ])}
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
        <span>SKU Details</span>
        <strong>No SKU selected</strong>
      </div>
      <div class="inspector-body">
        <p class="subtext">Select a row to review Part Master, Stock Policy, identifiers, and actions.</p>
      </div>
    `;
    return;
  }

  state.selectedSku = part.sku;
  const codes = (state.snapshot?.codeMappings || []).filter((code) => code.sku === part.sku);
  elements.inspector.innerHTML = `
    <div class="inspector-header">
      <div>
        <span>SKU Details</span>
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
        <h3>Part Master</h3>
        <dl class="definition-list">
          <div><dt>Part name</dt><dd>${escapeHtml(part.partName)}</dd></div>
          <div><dt>Category</dt><dd>${escapeHtml(part.category)}</dd></div>
          <div><dt>Responsible owner</dt><dd>${escapeHtml(part.owner)}</dd></div>
          <div><dt>Reference image</dt><dd>${escapeHtml(part.imagePath || "Administrator maintained image needed")}</dd></div>
        </dl>
      </section>
      <section class="detail-section">
        <h3>Stock Policy</h3>
        <dl class="definition-list compact">
          <div><dt>Available</dt><dd>${formatNumber(part.quantity)}</dd></div>
          <div><dt>Minimum</dt><dd>${formatNumber(part.minimum)}</dd></div>
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
        <button class="button secondary" type="button" data-view="operations" data-operation-mode="restock">Restock</button>
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
    optionMarkup("all", "All SKUs", current.sku),
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
  const copy = viewCopy[state.view];
  const parts = filteredParts();

  elements.viewCrumb.textContent = copy.title;
  elements.viewTitle.textContent = copy.title;
  elements.viewDescription.textContent = copy.description;
  elements.filterPanel.hidden = !copy.filters;
  elements.runtimeChip.textContent = `${state.snapshot.system.runtime} Online`;
  elements.runtimeChip.title = state.snapshot.system.databaseAbsolutePath || "";

  renderMetrics(copy.filters ? parts : state.snapshot.parts);

  if (state.view === "command") elements.viewContent.innerHTML = commandView(parts);
  if (state.view === "explorer") elements.viewContent.innerHTML = explorerView(parts);
  if (state.view === "operations") elements.viewContent.innerHTML = operationsView(parts);
  if (state.view === "replenishment") elements.viewContent.innerHTML = replenishmentView(parts);
  if (state.view === "audit") elements.viewContent.innerHTML = auditView();
  if (state.view === "governance") elements.viewContent.innerHTML = governanceView(parts);
  if (state.view === "system") elements.viewContent.innerHTML = systemView();

  renderInspector();
  document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === state.view));
}

async function loadSnapshot() {
  setStatus("Refreshing Inventory 2.0 from SQLite...", "busy");
  state.snapshot = await requestJson("/api/v2/bootstrap");
  if (!state.selectedSku && state.snapshot.parts.length) state.selectedSku = state.snapshot.parts[0].sku;
  populateFilters();
  renderView();
  setStatus(`Inventory 2.0 loaded from ${state.snapshot.system.databaseRelativePath}.`);
}

function resetFilters() {
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
  const headers = ["Category", "SKU", "Part Name", "Available", "Minimum", "Status", "Location", "Owner", "Aliases", "Metadata"];
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
  setStatus(`${formatNumber(parts.length)} filtered SKU records exported.`);
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
  try {
    setStatus("Recording Stock Ledger entry...", "busy");
    const result = await requestJson("/api/v2/stock/transaction", {
      method: "POST",
      body: JSON.stringify({
        sku: part.sku,
        action: state.operationMode,
        quantity: document.querySelector("#operationQuantity").value,
        lookupMethod: document.querySelector("#operationLookup").value,
        nvbug: document.querySelector("#operationNvbug").value.trim(),
        operatorName: document.querySelector("#operationOperator").value.trim(),
        operatorEmail: "gamehta@nvidia.com",
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
  try {
    setStatus("Creating replenishment request...", "busy");
    const result = await requestJson("/api/v2/replenishment", {
      method: "POST",
      body: JSON.stringify({
        sku: part.sku,
        requestedQty: document.querySelector("#requestQuantity").value,
        priority: document.querySelector("#requestPriority").value,
        notes: document.querySelector("#requestNotes").value.trim(),
        operatorName: "Gaurav Mehta",
        operatorEmail: "gamehta@nvidia.com"
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
    setStatus("Running SQLite backup...", "busy");
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
  state.view = view;
  populateFilters();
  renderView();
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", loadSnapshot);
  elements.clearFiltersButton.addEventListener("click", resetFilters);
  elements.exportFilteredButton.addEventListener("click", exportFilteredCsv);

  [elements.categoryFilter, elements.skuFilter, elements.locationFilter, elements.availabilityFilter].forEach((control) => {
    control.addEventListener("change", () => {
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

  document.addEventListener("click", (event) => {
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
    if (event.target.id === "stockOperationForm") submitStockOperation(event);
    if (event.target.id === "replenishmentForm") submitReplenishment(event);
  });
}

bindEvents();
loadSnapshot().catch((error) => setStatus(error.message, "error"));
