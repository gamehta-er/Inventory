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

  async function loadImportSample(profileId, renderAfter = true) {
    const id = profileId
      || document.getElementById("importProfile")?.value
      || state.session?.importProfiles?.[0]?.id
      || "assets-gpu";
    if (state.importSampleProfileId === id && state.importSample) {
      if (renderAfter) render();
      return;
    }
    state.importSample = await api(`/api/v3/import/sample?profile=${encodeURIComponent(id)}`);
    state.importSampleProfileId = id;
    if (renderAfter) render();
  }

  async function refreshSelectedRevisions() {
    const ids = [...state.selected.keys()];
    await Promise.all(ids.map(async (id) => {
      const detail = await api(`/api/v3/assets/${id}`);
      const existing = state.selected.get(id) || {};
      state.selected.set(id, { ...existing, ...detail.asset });
    }));
  }

  async function openBulkAction(action) {
    if (!state.selected.size) return setToast("Select at least one asset.");
    if (action === "print-label" && state.selected.size === 1) {
      state.modal = { type: "print", asset: [...state.selected.values()][0] };
      render();
      return;
    }
    await refreshSelectedRevisions();
    state.modal = { type: "bulk", action, preview: null };
    try {
      const payload = bulkPayload(action);
      state.modal.preview = await api("/api/v3/assets/bulk-preview", { method: "POST", body: payload });
    } catch (error) {
      state.modal = null;
      throw error;
    }
    render();
  }
