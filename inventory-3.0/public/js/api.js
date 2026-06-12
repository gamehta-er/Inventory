  async function api(path, options = {}) {
    const response = await fetch(path, {
      headers: options.body instanceof FormData ? undefined : { "content-type": "application/json" },
      ...options,
      body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
    });
    const type = response.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const error = new Error(data.error || data || "Request failed.");
      error.data = data;
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

  async function loadSession() {
    state.session = await api("/api/v3/session");
  }
