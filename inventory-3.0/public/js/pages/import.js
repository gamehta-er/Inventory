  function renderImport() {
    const profileId = document.getElementById("importProfile")?.value
      || state.importSampleProfileId
      || state.session?.importProfiles?.[0]?.id
      || "assets-gpu";
    const sample = state.importSampleProfileId === profileId ? state.importSample : null;
    return `
      <section class="page-title"><span class="eyebrow">Import</span><h1>Preview before commit.</h1><p class="subtitle">Choose a CSV profile, validate mapped fields, then commit only when the preview looks right.</p></section>
      <section class="panel import-box">
        <div class="grid-3">
          <div class="field"><label>Import profile</label><select id="importProfile">${state.session.importProfiles.map((profile) => `<option value="${profile.id}" ${profile.id === profileId ? "selected" : ""}>${esc(profile.label)}</option>`).join("")}</select></div>
          <div class="field"><label>CSV file</label><input type="file" id="importFile" accept=".csv,text/csv" /></div>
          <div class="field"><label>&nbsp;</label><button class="primary-button" data-preview-import>Preview Import</button></div>
        </div>
        <details class="import-template-panel">
          <summary><strong>Sample CSV & column guide</strong> — see required columns and example rows for the selected profile</summary>
          <div class="import-template-body">
            <div class="import-template-actions">
              <button class="secondary-button" data-download-import-sample ${sample ? "" : "disabled"}>Download sample CSV</button>
              ${sample ? `<span class="meta-value">Template for <strong>${esc(sample.profileLabel)}</strong></span>` : `<span class="meta-value">Loading template...</span>`}
            </div>
            <div class="tabs import-help-tabs">
              <button class="${state.importHelpTab === "sample" ? "active" : ""}" data-import-help-tab="sample">Sample rows</button>
              <button class="${state.importHelpTab === "columns" ? "active" : ""}" data-import-help-tab="columns">Column guide</button>
            </div>
            ${sample ? renderImportTemplate(sample) : `<div class="empty-state" style="margin-top:16px"><p class="subtitle">Loading sample template for this profile...</p></div>`}
          </div>
        </details>
        <details>
          <summary><strong>Paste CSV instead</strong></summary>
          <textarea id="importPaste" style="width:100%;min-height:140px;margin-top:12px" placeholder="Paste CSV content"></textarea>
        </details>
      </section>
      ${state.importPreview ? renderImportPreview() : ""}
    `;
  }

  function renderImportTemplate(sample) {
    if (state.importHelpTab === "columns") {
      return `
        <div class="import-help-panel">
          <p class="subtitle">Each column below maps to Inventory fields during preview. Required columns must be present in every data row.</p>
          <table class="preview-table import-guide-table">
            <thead>
              <tr>
                <th>Column</th>
                <th>Required</th>
                <th>Description</th>
                <th>Example</th>
                <th>Accepted values</th>
              </tr>
            </thead>
            <tbody>
              ${sample.columns.map((col) => `
                <tr>
                  <td><strong>${esc(col.label)}</strong><div class="meta-value">${esc(col.key)}</div></td>
                  <td>${col.required ? "Yes" : "No"}</td>
                  <td>${esc(col.description)}</td>
                  <td>${esc(col.example || "—")}</td>
                  <td>${esc(col.acceptedValues || "—")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;
    }

    return `
      <div class="import-help-panel">
        <p class="subtitle">The downloadable CSV includes the header row plus the example rows below. Replace sample values with your real inventory before previewing.</p>
        ${sample.rowNotes.length ? `<ul class="import-row-notes">${sample.rowNotes.map((note) => `<li>${esc(note)}</li>`).join("")}</ul>` : ""}
        <table class="preview-table import-guide-table">
          <thead>
            <tr>
              <th>Row</th>
              <th>What this row shows</th>
              <th>Values</th>
            </tr>
          </thead>
          <tbody>
            ${sample.sampleRows.map((row) => `
              <tr>
                <td>${row.rowNumber}</td>
                <td>
                  <strong>${esc(row.title)}</strong>
                  <div class="meta-value">${esc(row.description)}</div>
                </td>
                <td><code class="import-values-preview">${esc(Object.entries(row.values).map(([key, value]) => `${key}: ${value}`).join(" · "))}</code></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderImportPreview() {
    const preview = state.importPreview;
    return `
      <section class="panel import-box" style="margin-top:18px">
        <div class="result-head">
          <div><h2>Import Batch Review</h2><p class="subtitle">${esc(preview.filename)} - ${preview.rowCount} rows - ${preview.canCommit ? "Ready to commit" : "Blocked"}</p></div>
          <button class="primary-button" data-commit-import="${preview.id}" ${preview.canCommit ? "" : "disabled"}>Commit Import</button>
        </div>
        <h3>Mapped Columns</h3>
        <div class="category-strip">${preview.mappedColumns.map((col) => `<span class="role-pill">${esc(col.source)} -> ${esc(col.field)}</span>`).join("")}</div>
        ${preview.issues.length ? `<h3 style="margin-top:18px">Validation Issues</h3>${preview.issues.map((issue) => `<div class="alert">Row ${issue.row}: ${esc(issue.field)} - ${esc(issue.message)}</div>`).join("")}` : ""}
        <h3 style="margin-top:18px">Sample Rows</h3>
        <table class="preview-table"><thead><tr><th>Row</th><th>Values</th></tr></thead><tbody>${preview.sampleRows.map((row) => `<tr><td>${row.rowNumber}</td><td>${esc(JSON.stringify(row.values))}</td></tr>`).join("")}</tbody></table>
      </section>
    `;
  }
