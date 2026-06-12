  function renderImport() {
    return `
      <section class="page-title"><span class="eyebrow">Import</span><h1>Preview before commit.</h1><p class="subtitle">Choose a CSV profile, validate mapped fields, then commit only when the preview looks right.</p></section>
      <section class="panel import-box">
        <div class="grid-3">
          <div class="field"><label>Import profile</label><select id="importProfile">${state.session.importProfiles.map((profile) => `<option value="${profile.id}">${esc(profile.label)}</option>`).join("")}</select></div>
          <div class="field"><label>CSV file</label><input type="file" id="importFile" accept=".csv,text/csv" /></div>
          <div class="field"><label>&nbsp;</label><button class="primary-button" data-preview-import>Preview Import</button></div>
        </div>
        <details>
          <summary><strong>Paste CSV instead</strong></summary>
          <textarea id="importPaste" style="width:100%;min-height:140px;margin-top:12px" placeholder="Paste CSV content"></textarea>
        </details>
      </section>
      ${state.importPreview ? renderImportPreview() : ""}
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

