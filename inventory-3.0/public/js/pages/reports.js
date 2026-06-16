  function renderReports() {
    if (!state.reports) loadReports();
    const reports = state.reports;
    if (!Object.keys(state.reportDraftFilters).length && !Object.keys(state.reportDraftExtraFilters).length) {
      state.reportDraftFilters = { ...state.reportFilters };
      state.reportDraftExtraFilters = { ...state.reportExtraFilters };
    }
    const category = state.session.categories.find((c) => c.slug === (state.reportDraftFilters.category || state.reportFilters.category));
    const fields = category?.fields || [];
    const commonReportFields = ["category", "model", "serial", "assetTag", "status", "owner", "location", "usage", "nvbug", "borrowedLent"];
    const visibleCommon = commonReportFields.map((key) => ({ key, label: fieldLabel(key) }));
    const categoryFields = fields.filter((field) => !commonReportFields.includes(field.key));
    return `
      <section class="page-title"><span class="eyebrow">Reports</span><h1>Reports</h1><p class="subtitle">Filter, drill down, and export active inventory views.</p></section>
      <section class="panel command-panel">
        <div class="grid-4">
          ${visibleCommon.map((field) => renderReportFilterField(field, reports?.assets || [])).join("")}
        </div>
        ${categoryFields.length ? `
          <button class="secondary-button" style="margin-top:14px" data-toggle-report-more>${state.reportMoreFiltersOpen ? "Hide Category Fields" : `Show ${esc(category.name)} Fields`}</button>
          <div class="grid-4 ${state.reportMoreFiltersOpen ? "" : "hidden"}" style="margin-top:14px">
            ${categoryFields.map((field) => renderReportFilterField(field, reports?.assets || [], true)).join("")}
          </div>
        ` : ""}
        <div class="report-actions">
          <button class="secondary-button" data-clear-report>Clear Filters</button>
          <button class="secondary-button" data-apply-report>Apply Filters</button>
          <button class="primary-button" data-export-report>Export Report</button>
        </div>
      </section>
      ${reports ? `
        <section class="summary-grid">${kpi("Active", reports.summary.active, "Filtered active assets")}${kpi("Available", reports.summary.available, "Ready or idle")}${kpi("Unavailable", reports.summary.unavailable, "Assigned or blocked")}${kpi("Exceptions", reports.summary.exceptions, "Broken, EOL, pending")}</section>
        <section style="margin-top:20px"><h2>${reports.assets.length} matching assets</h2><div class="asset-list">${reports.assets.slice(0, 120).map(renderAssetCard).join("")}</div></section>
      ` : `<div class="empty-state">Loading reports...</div>`}
    `;
  }

  function filterSelectForReports(key, label, options) {
    const extra = key.startsWith("extra.");
    const value = extra ? state.reportDraftExtraFilters[key.slice(6)] || "" : state.reportDraftFilters[key] || "";
    return `<div class="field"><label>${esc(label)}</label><select data-report-filter="${key}"><option value="">All ${esc(label)}</option>${options.map(([v, text]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(text)}</option>`).join("")}</select></div>`;
  }

  function reportTextFilter(key, label, extra = false) {
    const value = extra ? state.reportDraftExtraFilters[key.slice(6)] || "" : state.reportDraftFilters[key] || "";
    return `<div class="field"><label>${esc(label)}</label><input data-report-filter="${key}" value="${esc(value)}" placeholder="Filter ${esc(label)}" /></div>`;
  }

  function renderReportFilterField(field, assets, forceExtra = false) {
    const optionsByKey = {
      category: state.session.categories.map((c) => [c.slug, c.name]),
      model: uniq(assets.map((a) => a.model)).map((v) => [v, v]),
      status: statusOptions(),
      owner: state.session.members.map((m) => [m.name, m.name]),
      location: state.session.locations.map((l) => [l.name, l.name]),
      usage: uniq(assets.map((a) => a.usage).filter(Boolean)).map((v) => [v, v]),
      borrowedLent: [["Borrowed", "Borrowed"], ["Lent", "Lent"]],
    };
    if (!forceExtra && optionsByKey[field.key]?.length) return filterSelectForReports(field.key, field.label, optionsByKey[field.key]);
    if (forceExtra && field.options) return filterSelectForReports(`extra.${field.key}`, field.label, field.options.map((v) => [v, v]));
    if (!forceExtra) return reportTextFilter(field.key, field.label);
    return reportTextFilter(`extra.${field.key}`, field.label, true);
  }

