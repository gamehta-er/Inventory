  function formToObject(form) {
    const values = {};
    new FormData(form).forEach((value, key) => {
      if (key.startsWith("extra.")) {
        values.extra = values.extra || {};
        values.extra[key.slice(6)] = value;
      } else {
        values[key] = value;
      }
    });
    values.actorName = state.user.name;
    return values;
  }

  function renderBugLinks(links) {
    return (links || []).map((link) => link.url ? `<a href="${esc(link.url)}" target="_blank" rel="noreferrer">${esc(link.value)}</a>` : esc(link.value)).join(", ");
  }

  function renderActivityChanges(item) {
    if (!item.before || !item.after) return "";
    const fields = [
      ["status", "Status"],
      ["owner", "Owner"],
      ["location", "Location"],
    ];
    const parts = fields
      .filter(([key]) => String(item.before[key] || "") !== String(item.after[key] || ""))
      .map(([key, label]) => `${label}: ${item.before[key] || "—"} → ${item.after[key] || "—"}`);
    if (!parts.length) return "";
    return `<div class="activity-changes">${parts.map((part) => `<span>${esc(part)}</span>`).join("")}</div>`;
  }

  function formatDate(value) {
    try {
      return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch {
      return value || "";
    }
  }

  function uniq(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  }

  function addAssetCategoryFromSearch() {
    const slug = state.filters.category || state.quickCategory || state.searchResult.appliedCategory || "";
    const fromSlug = state.session?.categories?.find((c) => c.slug === slug);
    if (fromSlug) return fromSlug;
    if (state.addAssetCategoryId) {
      return state.session.categories.find((c) => String(c.id) === String(state.addAssetCategoryId)) || state.session.categories[0];
    }
    return state.session.categories[0];
  }

  function addAssetDefaultsFromSearch() {
    const defaults = { model: "", serial: "", assetTag: "" };
    if (state.filters.model) defaults.model = state.filters.model;
    if (state.filters.serial) defaults.serial = state.filters.serial;
    if (state.filters.assetTag) defaults.assetTag = state.filters.assetTag;
    const q = String(state.query || "").trim();
    if (!defaults.serial && !defaults.assetTag && q) {
      if (/^(INV3-|PILOT-)/i.test(q) || /\s/.test(q) === false && q.includes("-")) defaults.assetTag = q;
      else defaults.serial = q;
    }
    return defaults;
  }

  function renderAddAssetForm(category, defaults = {}) {
    const extraFields = category.fields.filter((field) => !commonFilters.includes(field.key));
    const defaultLocationId = defaults.locationId || state.session.locations[0]?.id || "";
    return `
      <form id="addAssetForm" class="form-grid admin-add-form">
        <div class="field full">
          <label>Category <span class="required">*</span></label>
          <select name="categoryId" data-add-category>
            ${state.session.categories.map((cat) => `<option value="${cat.id}" ${String(cat.id) === String(category.id) ? "selected" : ""}>${esc(cat.name)}</option>`).join("")}
          </select>
        </div>
        ${inputField("model", "Model", defaults.model || "", true)}
        ${inputField("serial", "Serial No.", defaults.serial || "", false)}
        ${inputField("assetTag", "Asset Tag", defaults.assetTag || "", true)}
        ${selectField("status", "Status", "Ready to Deploy", statusOptions(), true)}
        ${selectField("ownerId", "Owner / Assignee", "", [["", "Unassigned"], ...state.session.members.map((m) => [m.id, m.name])], false)}
        ${selectField("locationId", "Location", defaultLocationId, state.session.locations.map((l) => [l.id, l.name]), true)}
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
