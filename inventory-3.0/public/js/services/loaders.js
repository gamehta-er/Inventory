  async function runSearch(renderAfter = true) {
    const params = new URLSearchParams();
    if (state.query) params.set("q", state.query);
    if (!state.query && state.quickCategory && !state.filters.category) params.set("category", state.quickCategory);
    for (const [key, value] of Object.entries(state.filters)) if (value) params.set(key, value);
    for (const [key, value] of Object.entries(state.extraFilters)) if (value) params.set(`extra.${key}`, value);
    state.searchResult = await api(`/api/v3/search?${params.toString()}`);
    state.selected.clear();
    if (renderAfter) render();
  }

  async function loadAssetDetail(id, tab = "Overview") {
    state.detail = await api(`/api/v3/assets/${id}`);
    state.detailTab = tab;
    render();
  }

  async function loadReports(renderAfter = true) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(state.reportFilters)) if (value) params.set(key, value);
    for (const [key, value] of Object.entries(state.reportExtraFilters)) if (value) params.set(`extra.${key}`, value);
    state.reports = await api(`/api/v3/reports/assets?${params.toString()}`);
    if (renderAfter) render();
  }

  async function loadRequests(renderAfter = true) {
    const result = await api("/api/v3/requests");
    state.requests = result.requests;
    state.requestsLoaded = true;
    if (renderAfter) render();
  }

  async function loadActivity(renderAfter = true) {
    const result = await api("/api/v3/activity");
    state.activity = result.activity || [];
    state.activityLoaded = true;
    if (renderAfter) render();
  }

  async function loadBackups(renderAfter = true) {
    const result = await api("/api/v3/backups");
    state.backups = result.backups || [];
    state.backupsLoaded = true;
    if (renderAfter) render();
  }
