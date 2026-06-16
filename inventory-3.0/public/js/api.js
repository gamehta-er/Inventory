  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "include",
      headers: options.body instanceof FormData ? undefined : { "content-type": "application/json" },
      ...options,
      body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
    });
    const type = response.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const error = new Error(data.error || data || "Request failed.");
      error.data = data;
      error.status = response.status;
      if (response.status === 401 && !path.includes("/login") && !path.includes("/bootstrap")) {
        state.user = null;
        localStorage.removeItem("inventory3.user");
      }
      if (response.status === 409) {
        state.stale = true;
        try { await loadSession(); } catch { /* session may be invalid */ }
        if (state.page === "search") await runSearch(false);
      }
      throw error;
    }
    return data;
  }

  function setToast(message) {
    state.toast = message;
    render();
    setTimeout(() => {
      if (state.toast === message) {
        state.toast = "";
        render();
      }
    }, 3500);
  }

  async function loadBootstrap() {
    state.bootstrap = await api("/api/v3/bootstrap");
  }

  async function loadSession() {
    state.session = await api("/api/v3/session");
    if (state.session.user) {
      state.user = state.session.user;
      localStorage.setItem("inventory3.user", JSON.stringify(state.user));
    }
  }
