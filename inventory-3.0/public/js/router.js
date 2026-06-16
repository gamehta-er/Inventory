  function snapshotUrlState() {
    const params = new URLSearchParams();
    if (state.page !== "search") params.set("page", state.page);
    if (state.page === "search") {
      if (state.query) params.set("q", state.query);
      if (state.quickCategory) params.set("quickCategory", state.quickCategory);
      for (const [key, value] of Object.entries(state.filters)) if (value) params.set(`filter.${key}`, value);
      for (const [key, value] of Object.entries(state.extraFilters)) if (value) params.set(`extra.${key}`, value);
    }
    if (state.page === "reports") {
      for (const [key, value] of Object.entries(state.reportFilters)) if (value) params.set(`report.${key}`, value);
      for (const [key, value] of Object.entries(state.reportExtraFilters)) if (value) params.set(`reportExtra.${key}`, value);
    }
    const query = params.toString();
    return `${window.location.pathname}${query ? `?${query}` : ""}`;
  }

  function pushUrl(replace = false) {
    const url = snapshotUrlState();
    if (replace) window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);
  }

  function restoreFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const page = String(params.get("page") || "search").toLowerCase();
    state.page = pages.map((p) => p.toLowerCase()).includes(page) ? page : "search";
    state.query = params.get("q") || "";
    state.quickCategory = params.get("quickCategory") || params.get("category") || "";
    state.selectedCategory = "";
    state.filters = {};
    state.extraFilters = {};
    state.reportFilters = {};
    state.reportExtraFilters = {};
    for (const [key, value] of params.entries()) {
      if (!value) continue;
      if (key.startsWith("filter.")) state.filters[key.slice(7)] = value;
      if (key.startsWith("extra.")) state.extraFilters[key.slice(6)] = value;
      if (key.startsWith("report.")) state.reportFilters[key.slice(7)] = value;
      if (key.startsWith("reportExtra.")) state.reportExtraFilters[key.slice(12)] = value;
    }
  }

  async function init() {
    await loadBootstrap();
    if (localStorage.getItem("inventory3.user")) {
      try {
        await loadSession();
      } catch {
        state.user = null;
        localStorage.removeItem("inventory3.user");
      }
    }
    restoreFromUrl();
    if (!state.user) {
      renderLogin();
      return;
    }
    if (state.page === "search") await runSearch(false);
    if (state.page === "reports") await loadReports(false);
    if (state.page === "requests") await loadRequests(false);
    if (state.page === "activity") await loadActivity(false);
    if (state.page === "admin") await loadBackups(false);
    pushUrl(true);
    render();
    setInterval(checkRevision, 15000);
  }

  window.addEventListener("popstate", async () => {
    try {
      restoreFromUrl();
      state.detail = null;
      state.modal = null;
      state.selected.clear();
      if (state.page === "search") await runSearch(false);
      if (state.page === "reports") await loadReports(false);
      if (state.page === "requests") await loadRequests(false);
      if (state.page === "activity") await loadActivity(false);
      if (state.page === "admin") await loadBackups(false);
      render();
    } catch (error) {
      setToast(error.message);
    }
  });

  async function checkRevision() {
    if (!state.session) return;
    try {
      const result = await api("/api/v3/revision");
      if (result.revision !== state.session.app.revision) {
        state.stale = true;
        await loadSession();
        if (state.page === "reports") await loadReports();
        if (state.page === "requests") await loadRequests();
        render();
      }
    } catch {
      // Keep polling quiet; visible actions surface errors.
    }
  }
