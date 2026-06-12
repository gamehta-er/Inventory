  function renderSheet() {
    const { asset, fields, requests, activity } = state.detail;
    const tabs = state.user.role === "Admin User" ? ["Overview", "Operations", "Edit", "History"] : ["Overview", "Operations", "History"];
    return `
      <div class="sheet-backdrop" data-sheet-backdrop>
        <aside class="sheet" role="dialog" aria-label="Asset workspace">
          <div class="sheet-header">
            <div class="sheet-title">
              ${renderAssetImage(asset)}
              <div>
                <h2>${esc(asset.model)}</h2>
                <div><span class="role-pill">${esc(asset.assetTag)}</span> ${renderBugLinks(asset.nvbugLinks)}</div>
              </div>
              <button class="close-button" data-close-sheet>&times;</button>
            </div>
            <div class="tabs">
              ${tabs.map((tab) => `<button class="${state.detailTab === tab ? "active" : ""}" data-tab="${tab}">${tab}</button>`).join("")}
            </div>
          </div>
          <div class="sheet-body">
            ${state.detailTab === "Overview" ? renderOverview(asset, fields, requests) : ""}
            ${state.detailTab === "Operations" ? renderOperations(asset, requests) : ""}
            ${state.detailTab === "Edit" ? renderEdit(asset, fields) : ""}
            ${state.detailTab === "History" ? renderHistory(activity) : ""}
          </div>
        </aside>
      </div>
    `;
  }

  function renderOverview(asset, fields, requests) {
    const sourceFields = [
      ["Category", asset.category],
      ["Model", asset.model],
      ["Serial No.", asset.serial || "Not serialized"],
      ["Asset Tag", asset.assetTag],
      ["Status", asset.status],
      ["Owner / Assignee", asset.owner || "Unassigned"],
      ["Location", asset.location],
      ["Usage", asset.usage],
      ["Borrowed/Lent", asset.borrowedLent || "None"],
      ["NVBug #", renderBugLinks(asset.nvbugLinks) || "None"],
      ...fields.filter((field) => !commonFilters.includes(field.key)).map((field) => [field.label, asset.extra[field.key] || ""]),
      ["Notes", asset.notes],
    ];
    return `
      <div class="info-grid">
        ${sourceFields.map(([label, value]) => `<div class="info-card"><span class="meta-label">${esc(label)}</span><div class="meta-value">${typeof value === "string" ? value : value}</div></div>`).join("")}
      </div>
      <h3 style="margin-top:22px">Open Requests</h3>
      ${requests.length ? requests.map(renderRequestMini).join("") : `<p class="subtitle">No open requests for this asset.</p>`}
    `;
  }

  function renderRequestMini(request) {
    return `<button class="info-card" style="width:100%;text-align:left;margin-bottom:8px" data-request-open-asset="${request.asset_id || request.assetId}"><strong>${esc(request.type)}</strong><span class="meta-value">${esc(request.status)} - ${esc(request.priority)}</span></button>`;
  }

  function renderOperations(asset, requests) {
    return `
      <div class="grid-2">
        <button class="primary-button" data-action="check-out" data-id="${asset.id}">Check Out</button>
        <button class="secondary-button" data-action="check-in" data-id="${asset.id}">Check In</button>
        <button class="secondary-button" data-action="print-label" data-id="${asset.id}">Print Label</button>
        <button class="secondary-button" data-action="request" data-id="${asset.id}">Create Request</button>
      </div>
      <h3 style="margin-top:24px">Requests</h3>
      ${requests.length ? requests.map(renderRequestMini).join("") : `<p class="subtitle">No requests yet.</p>`}
    `;
  }

  function renderEdit(asset, fields) {
    const extraFields = fields.filter((field) => !commonFilters.includes(field.key));
    return `
      <form id="editForm" class="form-grid">
        ${inputField("model", "Model", asset.model, true)}
        ${inputField("serial", "Serial No.", asset.serial, false)}
        ${inputField("assetTag", "Asset Tag", asset.assetTag, true)}
        ${selectField("status", "Status", asset.status, state.session.statuses.map((s) => [s, s]), true)}
        ${selectField("ownerId", "Owner / Assignee", asset.ownerId, [["", "Unassigned"], ...state.session.members.map((m) => [m.id, m.name])], asset.status === "In Use")}
        ${selectField("locationId", "Location", asset.locationId, state.session.locations.map((l) => [l.id, l.name]), true)}
        ${inputField("usage", "Usage", asset.usage, false)}
        ${inputField("nvbug", "NVBug #", asset.nvbug, false)}
        ${selectField("borrowedLent", "Borrowed/Lent", asset.borrowedLent, [["", "None"], ["Borrowed", "Borrowed"], ["Lent", "Lent"]], false)}
        ${extraFields.map((field) => field.type === "textarea"
          ? textareaField(`extra.${field.key}`, field.label, asset.extra[field.key] || "", field.required)
          : inputField(`extra.${field.key}`, field.label, asset.extra[field.key] || "", field.required)).join("")}
        ${textareaField("notes", "Notes", asset.notes, false)}
        ${textareaField("reason", "Reason", "", true)}
        <input type="hidden" name="revision" value="${esc(asset.revision)}" />
      </form>
      <div class="panel import-box" style="margin-top:18px">
        <h3>Model Image</h3>
        <p class="subtitle">Images apply to every asset using this model.</p>
        <input type="file" accept=".png,.jpg,.jpeg,.webp" id="modelImageFile" />
        <div style="display:flex;gap:10px">
          <button class="secondary-button" data-upload-image="${asset.modelId}">Upload Image</button>
          <button class="danger-button" data-remove-image="${asset.modelId}">Remove Image</button>
        </div>
      </div>
      <div class="sticky-actions">
        <button class="primary-button" data-save-edit="${asset.id}">Save Changes</button>
        <button class="secondary-button" data-close-sheet>Cancel</button>
      </div>
    `;
  }

  function renderHistory(activity) {
    if (!activity.length) return `<p class="subtitle">No activity yet.</p>`;
    return `<div class="info-grid">${activity.map((item) => `
      <div class="info-card">
        <span class="meta-label">${esc(item.action)} - ${esc(formatDate(item.createdAt))}</span>
        <strong>${esc(item.summary)}</strong>
        <div class="meta-value">${esc(item.actorName)}${item.reason ? ` - ${esc(item.reason)}` : ""}</div>
      </div>
    `).join("")}</div>`;
  }

  function inputField(name, label, value, required) {
    return `<div class="field"><label>${esc(label)} ${required ? `<span class="required">*</span>` : ""}</label><input name="${esc(name)}" value="${esc(value)}" /></div>`;
  }

  function textareaField(name, label, value, required) {
    return `<div class="field full"><label>${esc(label)} ${required ? `<span class="required">*</span>` : ""}</label><textarea name="${esc(name)}">${esc(value)}</textarea></div>`;
  }

  function selectField(name, label, value, options, required) {
    return `<div class="field"><label>${esc(label)} ${required ? `<span class="required">*</span>` : ""}</label><select name="${esc(name)}">${options.map(([v, text]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(text)}</option>`).join("")}</select></div>`;
  }

  function renderModal() {
    if (state.modal.type === "print") return renderPrintModal(state.modal.asset);
    if (state.modal.type === "bulk") return renderBulkModal();
    return renderActionModal(state.modal.asset, state.modal.action);
  }

  function renderActionModal(asset, action) {
    const title = action === "check-out" ? "Check Out" : action === "check-in" ? "Check In" : "Create Request";
    const isRequest = action === "request";
    return `
      <div class="modal-backdrop">
        <section class="modal">
          <div class="modal-header"><div><h2>${title}</h2><p class="subtitle">${esc(asset.assetTag)}</p></div><button class="close-button" data-close-modal>&times;</button></div>
          <div class="modal-body">
            <form id="actionForm" class="form-grid">
              ${isRequest ? selectField("requestType", "Request type", "Support", [["Support", "Support"], ["Transfer", "Transfer"], ["Repair", "Repair"], ["E-waste", "E-waste"], ["Restock", "Restock"]], true) : ""}
              ${isRequest ? selectField("priority", "Priority", "Normal", [["Low", "Low"], ["Normal", "Normal"], ["High", "High"], ["Urgent", "Urgent"]], true) : ""}
              ${!isRequest ? selectField("status", "Status", action === "check-out" ? "In Use" : "Ready to Deploy", state.session.statuses.map((s) => [s, s]), true) : ""}
              ${selectField("ownerId", "Owner / Assignee", asset.ownerId || "", [["", "Unassigned"], ...state.session.members.map((m) => [m.id, m.name])], action === "check-out")}
              ${!isRequest ? selectField("locationId", "Location", asset.locationId, state.session.locations.map((l) => [l.id, l.name]), true) : ""}
              ${!isRequest ? inputField("usage", "Usage / project", asset.usage, false) : ""}
              ${inputField("nvbug", "NVBug #", "", false)}
              ${textareaField("reason", "Reason", "", true)}
              <input type="hidden" name="revision" value="${esc(asset.revision)}" />
            </form>
          </div>
          <div class="modal-actions">
            <button class="primary-button" data-submit-action="${action}" data-id="${asset.id}">${title}</button>
            <button class="secondary-button" data-close-modal>Cancel</button>
          </div>
        </section>
      </div>
    `;
  }

  function renderPrintModal(asset) {
    return `
      <div class="modal-backdrop">
        <section class="modal" style="width:min(560px,100%)">
          <div class="modal-header"><div><h2>Label Preview</h2><p class="subtitle">Print through an installed USB/network printer or save as PDF.</p></div><button class="close-button" data-close-modal>&times;</button></div>
          <div class="modal-body">
            <div class="label-preview">
              <div class="label-card">
                <div style="font-weight:760">${esc(asset.model)}</div>
                <strong>${esc(asset.assetTag)}</strong>
                ${barcodeSvg(asset.assetTag)}
                <div style="font-size:21px">${esc(asset.serial || asset.assetTag)}</div>
              </div>
            </div>
          </div>
          <div class="modal-actions">
            <button class="primary-button" data-print-now="${asset.id}">Print</button>
            <button class="secondary-button" data-save-pdf="${asset.id}">Save as PDF</button>
            <button class="secondary-button" data-close-modal>Cancel</button>
          </div>
        </section>
      </div>
    `;
  }

  function renderBulkModal() {
    const action = state.modal.action;
    const preview = state.modal.preview;
    const isPrint = action === "print-label";
    const title = isPrint ? "Print Labels" : humanAction(action);
    const selectedText = `${state.selected.size} asset${state.selected.size === 1 ? "" : "s"} selected`;
    return `
      <div class="modal-backdrop">
        <section class="modal">
          <div class="modal-header"><div><h2>${esc(title)}</h2><p class="subtitle">${esc(selectedText)}</p></div><button class="close-button" data-close-modal>&times;</button></div>
          <div class="modal-body">
            <form id="bulkForm" class="form-grid">
              ${!isPrint ? selectField("status", "Status", action === "check-out" ? "In Use" : action === "check-in" ? "Ready to Deploy" : "Idle", state.session.statuses.map((s) => [s, s]), true) : ""}
              ${!isPrint ? selectField("ownerId", "Owner / Assignee", "", [["", "Keep current"], ...state.session.members.map((m) => [m.id, m.name])], false) : ""}
              ${!isPrint ? selectField("locationId", "Location", "", [["", "Keep current"], ...state.session.locations.map((l) => [l.id, l.name])], false) : ""}
              ${!isPrint ? inputField("nvbug", "NVBug #", "", false) : ""}
              ${!isPrint ? textareaField("reason", "Reason", "", true) : ""}
            </form>
            ${preview ? `
              <div class="panel import-box" style="margin-top:16px">
                <h3>${isPrint ? "Print Preview" : "Preview"}</h3>
                <p class="subtitle">${preview.eligible.length} eligible, ${preview.ineligible.length} ineligible, ${preview.conflicts.length} conflicts.</p>
                ${preview.conflicts.concat(preview.ineligible).map((row) => `<div class="alert">${esc(row.assetTag || row.id)}: ${esc(row.reason)}</div>`).join("")}
              </div>
            ` : ""}
          </div>
          <div class="modal-actions">
            <button class="secondary-button" data-preview-bulk="${action}">${isPrint ? "Print Preview" : "Preview"}</button>
            <button class="primary-button" data-commit-bulk="${action}" ${preview && !preview.conflicts.length && !preview.ineligible.length ? "" : "disabled"}>${isPrint ? "Print" : "Apply"}</button>
            <button class="secondary-button" data-close-modal>Cancel</button>
          </div>
        </section>
      </div>
    `;
  }

  function humanAction(action) {
    const map = {
      "check-out": "Check Out",
      "check-in": "Check In",
      "status-change": "Status Change",
      "print-label": "Print Labels",
    };
    return map[action] || fieldLabel(action);
  }

  function barcodeSvg(value) {
    const text = String(value || "INV3");
    let x = 0;
    const bars = [];
    for (let i = 0; i < text.length * 5; i += 1) {
      const code = text.charCodeAt(i % text.length) + i * 17;
      const width = (code % 3) + 1;
      const gap = ((code >> 2) % 2) + 1;
      bars.push(`<rect x="${x}" y="0" width="${width}" height="62"></rect>`);
      x += width + gap;
    }
    return `<svg class="barcode" viewBox="0 0 ${x} 62" preserveAspectRatio="none" role="img" aria-label="Barcode">${bars.join("")}</svg>`;
  }

