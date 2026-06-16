  function renderAdmin() {
    if (!state.backupsLoaded) loadBackups();
    const categories = state.session.categories || [];
    const addCategory = categories.find((category) => String(category.id) === String(state.addAssetCategoryId)) || categories[0];
    return `
      <section class="page-title"><span class="eyebrow">Admin</span><h1>Operational control.</h1><p class="subtitle">Current local pilot settings, import profiles, and data safety signals.</p></section>
      <section class="summary-grid">${kpi("Categories", state.session.categories.length, "Workbook-inspired profiles")}${kpi("Locations", state.session.locations.length, "Building R, S, E")}${kpi("Members", state.session.members.length, "#imargulis-staff roster")}${kpi("Revision", state.session.app.revision, "Current data version")}</section>
      <section class="grid-2">
        <div class="panel import-box"><h2>Import Profiles and Field Rules</h2><p class="subtitle">Expand a profile to review columns and decide which fields are mandatory for import/admin entry.</p>${categories.map(renderProfileCard).join("")}</div>
        <div class="panel import-box"><h2>Backups</h2><p class="subtitle">Create or restore a local SQLite backup. Restore requires typed confirmation.</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="primary-button" data-create-backup>Create DB Backup</button>
            <button class="secondary-button" data-nav="activity">Open Activity</button>
          </div>
          ${state.lastBackupLocation ? `<div class="success-box"><strong>DB Backup completed</strong><span>${esc(state.lastBackupLocation)}</span></div>` : ""}
          <div class="backup-list">
            ${(state.backups || []).length ? state.backups.map((backup) => `
              <div class="backup-row">
                <strong>${esc(backup.filename)}</strong>
                <span>${esc(backup.location || backup.folder || "")}</span>
                ${state.user.role === "Admin User" ? `<button class="secondary-button" data-restore-backup="${esc(backup.id)}">Restore</button>` : ""}
              </div>
            `).join("") : `<p class="subtitle">No backups created yet.</p>`}
          </div>
        </div>
        <div class="panel import-box"><h2>Master Data</h2><p class="subtitle">Add locations and members without editing seed files.</p>
          <div class="form-grid">
            <div class="field"><label>Location name</label><input id="newLocationName" placeholder="Santa Clara Building R / Lab 104" /></div>
            <div class="field"><label>Member name</label><input id="newMemberName" placeholder="Pilot User" /></div>
            <div class="field"><label>Member email</label><input id="newMemberEmail" placeholder="user@lab-pilot.example" /></div>
          </div>
          <div class="inline-actions" style="margin-top:12px">
            <button class="secondary-button" data-create-location>Add Location</button>
            <button class="secondary-button" data-create-member>Add Member</button>
          </div>
        </div>
        <div class="panel import-box full-span"><h2>Add Asset Row</h2><p class="subtitle">Add one new row inside the selected category profile. Required fields must be completed before save.</p>${addCategory ? renderAddAssetForm(addCategory) : `<p class="subtitle">No categories available.</p>`}</div>
      </section>
    `;
  }

  function renderProfileCard(category) {
    const expanded = String(state.expandedProfileId) === String(category.id);
    const editing = String(state.profileEditId) === String(category.id);
    const requiredFor = (field) => editing ? Boolean(state.profileDraftRequired[field.key]) : Boolean(field.required);
    return `
      <article class="profile-card ${expanded ? "open" : ""}">
        <button class="profile-head" data-profile-toggle="${category.id}">
          <span><strong>${esc(category.name)}</strong><small>${category.fields.length} columns</small></span>
          <span>${expanded ? "Collapse" : "Expand"}</span>
        </button>
        ${expanded ? `
          <div class="profile-body">
            <div class="profile-field-grid">
              ${category.fields.map((field) => `
                <label class="profile-field">
                  <input type="checkbox" data-profile-required="${esc(field.key)}" data-profile-id="${category.id}" ${requiredFor(field) ? "checked" : ""} ${editing ? "" : "disabled"} />
                  <span>${esc(field.label)}</span>
                  <small>${requiredFor(field) ? "Mandatory" : "Optional"}</small>
                </label>
              `).join("")}
            </div>
            <div class="profile-actions">
              ${editing ? `
                <button class="primary-button" data-profile-save="${category.id}">Save Changes</button>
                <button class="secondary-button" data-profile-cancel="${category.id}">Cancel</button>
              ` : `
                <button class="secondary-button" data-profile-modify="${category.id}">Modify</button>
              `}
            </div>
          </div>
        ` : ""}
      </article>
    `;
  }

  function renderAddAssetForm(category) {
    const extraFields = category.fields.filter((field) => !commonFilters.includes(field.key));
    return `
      <form id="addAssetForm" class="form-grid admin-add-form">
        <div class="field full">
          <label>Category <span class="required">*</span></label>
          <select name="categoryId" data-add-category>
            ${state.session.categories.map((cat) => `<option value="${cat.id}" ${String(cat.id) === String(category.id) ? "selected" : ""}>${esc(cat.name)}</option>`).join("")}
          </select>
        </div>
        ${inputField("model", "Model", "", true)}
        ${inputField("serial", "Serial No.", "", false)}
        ${inputField("assetTag", "Asset Tag", "", true)}
        ${selectField("status", "Status", "Ready to Deploy", statusOptions(), true)}
        ${selectField("ownerId", "Owner / Assignee", "", [["", "Unassigned"], ...state.session.members.map((m) => [m.id, m.name])], false)}
        ${selectField("locationId", "Location", "", state.session.locations.map((l) => [l.id, l.name]), true)}
        ${inputField("usage", "Usage", "", false)}
        ${inputField("nvbug", "NVBug #", "", false)}
        ${selectField("borrowedLent", "Borrowed/Lent", "", [["", "None"], ["Borrowed", "Borrowed"], ["Lent", "Lent"]], false)}
        ${extraFields.map((field) => field.options
          ? selectField(`extra.${field.key}`, field.label, "", [["", `Select ${field.label}`], ...field.options.map((option) => [option, option])], field.required)
          : inputField(`extra.${field.key}`, field.label, "", field.required)).join("")}
        ${textareaField("notes", "Notes", "", false)}
        ${textareaField("reason", "Reason", "", true)}
      </form>
      <div class="sticky-actions inline-actions">
        <button class="primary-button" data-create-asset-row>Save New Row</button>
        <button class="secondary-button" data-reset-add-row>Cancel</button>
      </div>
    `;
  }

