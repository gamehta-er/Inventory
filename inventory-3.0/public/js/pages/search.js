  function renderSearch() {
    const summary = state.searchResult.summary || state.session.summary;
    const assets = state.searchResult.assets || [];
    const hasResults = assets.length > 0;
    const resultCategory = state.session.categories.find((category) => category.slug === resultCategorySlug());
    const hasCriteria = Boolean(state.query || state.quickCategory || Object.values(state.filters).some(Boolean) || Object.values(state.extraFilters).some(Boolean));
    return `
      <section class="page-title">
        <span class="eyebrow">Search</span>
        <h1>Find lab hardware fast.</h1>
        <p class="subtitle">Find one asset, one device family, or one exact identifier without extra noise.</p>
      </section>
      <section class="panel command-panel">
        <div class="search-row">
          <div class="field">
            <label for="searchInput">Search inventory</label>
            <input class="search-input" id="searchInput" value="${esc(state.query)}" placeholder="GPU, DPU, serial, asset tag, model, owner, location" />
          </div>
          <button class="primary-button" data-search>Search</button>
          <button class="secondary-button" data-clear-search>Clear Search</button>
        </div>
        <div class="category-card-grid">
          ${state.session.categories.map((category) => `
            <button class="category-card" data-category="${category.slug}">
              <span>${esc(category.name)}</span>
              <strong>${category.count}</strong>
            </button>
          `).join("")}
        </div>
      </section>
      <section class="summary-grid">
        ${kpi("Active", summary.active, "Tracked physical assets")}
        ${kpi("Available", summary.available, "Ready to deploy or idle")}
        ${kpi("Unavailable", summary.unavailable, "In use, lent, broken, pending")}
        ${kpi("Exceptions", summary.exceptions, "Broken, EOL, e-waste pending")}
      </section>
      ${hasResults ? `
        <section class="results-shell">
          <div class="result-head">
            <div>
              <span class="eyebrow">${state.searchResult.mode === "exact" ? "Exact Match" : "Results"}</span>
              <h2>${assets.length} ${resultCategory ? `${esc(resultCategory.name)} ` : ""}result${assets.length === 1 ? "" : "s"}</h2>
              ${renderFilterSummary()}
            </div>
              <button class="secondary-button" data-open-filters>Filters</button>
          </div>
          ${renderBulkbar()}
          <div class="asset-list">${assets.map(renderAssetCard).join("")}</div>
        </section>
      ` : `
        <section class="empty-state" style="margin-top:24px">
          ${hasCriteria ? renderNoResults() : `
            <div>
              <h2>Start with a category or exact identifier.</h2>
              <p class="subtitle">Category searches stay strict. Serial and asset tag searches open the exact asset.</p>
            </div>
          `}
        </section>
      `}
      ${state.filterDrawerOpen ? renderFilterDrawer(assets) : ""}
    `;
  }

  function activeCategorySlug() {
    return state.filters.category || "";
  }

  function resultCategorySlug() {
    return state.filters.category || state.quickCategory || state.searchResult.appliedCategory || "";
  }

  function kpi(label, value, note) {
    return `<div class="kpi"><span>${esc(label)}</span><strong>${Number(value || 0).toLocaleString()}</strong><span>${esc(note)}</span></div>`;
  }

  function renderFilterSummary() {
    const active = [];
    if (state.query) active.push(`Search: ${state.query}`);
    if (state.quickCategory && !state.filters.category) {
      const category = state.session.categories.find((c) => c.slug === state.quickCategory);
      if (category) active.push(`Category search: ${category.name}`);
    }
    for (const [key, value] of Object.entries(state.filters)) {
      if (!value) continue;
      const category = key === "category" ? state.session.categories.find((c) => c.slug === value)?.name || value : value;
      active.push(`${fieldLabel(key)}: ${category}`);
    }
    for (const [key, value] of Object.entries(state.extraFilters)) if (value) active.push(`${fieldLabel(key)}: ${value}`);
    return active.length ? `<div class="active-filter-strip">${active.map((item) => `<span>${esc(item)}</span>`).join("")}</div>` : "";
  }

  function renderNoResults() {
    return `
      <div>
        <h2>No matching assets found.</h2>
        <p class="subtitle">The search ran successfully, but nothing matched the current criteria.</p>
        ${renderCriteriaSummary()}
        <div style="display:flex;gap:10px;justify-content:center;margin-top:18px;flex-wrap:wrap">
          <button class="secondary-button" data-open-filters>Adjust Filters</button>
          <button class="secondary-button" data-clear-filters>Clear Filters</button>
          <button class="primary-button" data-clear-search>Clear Search</button>
        </div>
      </div>
    `;
  }

  function renderCriteriaSummary() {
    const active = [];
    const categorySlug = resultCategorySlug();
    const category = state.session.categories.find((c) => c.slug === categorySlug);
    if (state.query) active.push(`Search: ${state.query}`);
    if (category && state.quickCategory && !state.filters.category) active.push(`Category search: ${category.name}`);
    for (const [key, value] of Object.entries(state.filters)) {
      if (!value) continue;
      const label = key === "category" ? state.session.categories.find((c) => c.slug === value)?.name || value : value;
      active.push(`${fieldLabel(key)}: ${label}`);
    }
    for (const [key, value] of Object.entries(state.extraFilters)) if (value) active.push(`${fieldLabel(key)}: ${value}`);
    return active.length ? `<div class="active-filter-strip">${active.map((item) => `<span>${esc(item)}</span>`).join("")}</div>` : "";
  }

  function renderFilterDrawer(assets) {
    const category = state.session.categories.find((c) => c.slug === (state.draftFilters.category || resultCategorySlug()));
    const fieldList = category?.fields || [];
    const commonFields = ["category", "model", "serial", "assetTag", "status", "owner", "location", "usage", "nvbug", "borrowedLent"];
    const defaultQuickFields = commonFields
      .filter((key) => key !== "category")
      .map((key) => ({ key, label: fieldLabel(key) }));
    const quickFields = category ? fieldList.filter((field) => commonFields.includes(field.key)) : defaultQuickFields;
    const extraFields = fieldList.filter((field) => !commonFields.includes(field.key));
    return `
      <div class="drawer-backdrop" data-close-filters>
        <aside class="filter-drawer panel" role="dialog" aria-label="Search filters">
          <div class="drawer-head">
            <div><span class="eyebrow">Filters</span><h2>${category ? esc(category.name) : "All Assets"}</h2></div>
            <button class="close-button" data-close-filters>&times;</button>
          </div>
          <div class="drawer-body">
            <div class="filter-grid">
              ${filterSelect("category", "Category", state.session.categories.map((c) => [c.slug, c.name]))}
              ${quickFields.filter((field) => field.key !== "category").map((field) => renderFilterField(field, assets)).join("")}
            </div>
            ${extraFields.length ? `
              <button class="secondary-button" style="margin:14px 0" data-toggle-more-filters>
                ${state.moreFiltersOpen ? "Hide More Filters" : "More Filters"}
              </button>
              <div class="filter-grid ${state.moreFiltersOpen ? "" : "hidden"}">
                ${extraFields.map((field) => renderFilterField(field, assets, true)).join("")}
              </div>
            ` : ""}
          </div>
          <div class="drawer-actions">
          <button class="secondary-button" data-clear-filters>Clear Filters</button>
          <button class="primary-button" data-apply-filters>Apply Filters</button>
          </div>
        </aside>
      </div>
    `;
  }

  function filterSelect(key, label, options) {
    const extra = key.startsWith("extra.");
    const value = extra ? state.draftExtraFilters[key.slice(6)] || "" : state.draftFilters[key] || "";
    return `
      <div class="field" style="margin-bottom:10px">
        <label>${esc(label)}</label>
        <select data-filter="${key}">
          <option value="">All ${esc(label)}</option>
          ${options.map(([optionValue, optionLabel]) => `<option value="${esc(optionValue)}" ${String(value) === String(optionValue) ? "selected" : ""}>${esc(optionLabel)}</option>`).join("")}
        </select>
      </div>
    `;
  }

  function filterText(key, label, extra = false) {
    const value = extra ? state.draftExtraFilters[key.slice(6)] || "" : state.draftFilters[key] || "";
    return `
      <div class="field" style="margin-bottom:10px">
        <label>${esc(label)}</label>
        <input data-filter="${key}" value="${esc(value)}" placeholder="Filter ${esc(label)}" />
      </div>
    `;
  }

  function renderFilterField(field, assets) {
    const optionsByKey = {
      model: uniq(assets.map((a) => a.model)).map((v) => [v, v]),
      status: state.session.statuses.map((v) => [v, v]),
      owner: state.session.members.map((m) => [m.name, m.name]),
      location: state.session.locations.map((l) => [l.name, l.name]),
      usage: uniq(assets.map((a) => a.usage).filter(Boolean)).map((v) => [v, v]),
      borrowedLent: [["Borrowed", "Borrowed"], ["Lent", "Lent"]],
    };
    if (optionsByKey[field.key]?.length) return filterSelect(field.key, field.label, optionsByKey[field.key]);
    if (field.options) return filterSelect(`extra.${field.key}`, field.label, field.options.map((v) => [v, v]));
    if (commonFilters.includes(field.key)) return filterText(field.key, field.label);
    return filterText(`extra.${field.key}`, field.label, true);
  }

  function renderBulkbar() {
    const count = state.selected.size;
    if (!count) return "";
    return `
      <div class="bulkbar">
        <strong>${count} selected</strong>
        <div class="bulk-actions">
          <button class="secondary-button" data-bulk="check-out">Check Out</button>
          <button class="secondary-button" data-bulk="check-in">Check In</button>
          <button class="secondary-button" data-bulk="status-change">Status Change</button>
          <button class="secondary-button" data-bulk="print-label">Print Labels</button>
          <button class="secondary-button" data-export-selected>Export Selected</button>
          <button class="ghost-button" data-clear-selection>Clear</button>
        </div>
      </div>
    `;
  }

  function renderAssetCard(asset) {
    const selected = state.selected.has(asset.id);
    return `
      <article class="asset-card ${selected ? "selected" : ""}" data-asset-row="${asset.id}">
        <input type="checkbox" data-select-asset="${asset.id}" ${selected ? "checked" : ""} aria-label="Select ${esc(asset.assetTag)}" />
        ${renderAssetImage(asset)}
        <div class="asset-title">
          <span class="eyebrow">${esc(asset.category)}</span>
          <strong>${esc(asset.model)}</strong>
          <span class="meta-value">${esc(asset.assetTag)}</span>
        </div>
        <div class="asset-meta"><span class="meta-label">Serial</span><span class="meta-value">${esc(asset.serial || "Not serialized")}</span></div>
        <div class="asset-meta"><span class="meta-label">Location</span><span class="meta-value">${esc(asset.location)}</span></div>
        <div class="asset-meta"><span class="meta-label">Owner</span><span class="meta-value">${esc(asset.owner || "Unassigned")}</span></div>
        <div class="asset-meta"><span class="status-pill ${cssStatus(asset.status)}">${esc(asset.status)}</span><span class="meta-value">${esc(asset.borrowedLent || availability(asset.status))}</span></div>
        <div class="card-actions">
          <button class="icon-button" data-open-detail="${asset.id}">Details</button>
          ${state.user.role === "Admin User" ? `<button class="icon-button" data-open-edit="${asset.id}">Edit</button>` : ""}
          <button class="icon-button" data-action="check-out" data-id="${asset.id}">Check Out</button>
          <button class="icon-button" data-action="check-in" data-id="${asset.id}">Check In</button>
          <button class="icon-button" data-action="print-label" data-id="${asset.id}">Print</button>
          <button class="icon-button" data-action="request" data-id="${asset.id}">Request</button>
        </div>
      </article>
    `;
  }

  function renderAssetImage(asset) {
    if (asset.modelImagePath) return `<div class="asset-image"><img src="${esc(asset.modelImagePath)}" alt="${esc(asset.model)}" /></div>`;
    return `<div class="asset-image">${esc((asset.categoryPrefix || asset.category || "A").slice(0, 2).toUpperCase())}</div>`;
  }

  function availability(status) {
    if (["Ready to Deploy", "Idle", "Borrowed"].includes(status)) return "Available";
    if (["Archived", "E-Wasted"].includes(status)) return "History only";
    return "Unavailable";
  }

