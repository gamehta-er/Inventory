  function render() {
    if (!state.user) return renderLogin();
    app.innerHTML = `
      <div class="app-shell">
        ${renderTopbar()}
        <main class="main">
          ${state.stale ? `<div class="alert" style="margin-bottom:16px">Inventory changed in another session. Current page data has been refreshed where possible.</div>` : ""}
          ${renderPage()}
        </main>
        ${state.detail ? renderSheet() : ""}
        ${state.modal ? renderModal() : ""}
        ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ""}
      </div>
    `;
  }

  function renderTopbar() {
    return `
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">o</span>
          <div>NVIDIA <small>Inventory 3.0</small></div>
        </div>
        <nav class="nav">
          ${pages.map((page) => `<button data-nav="${page.toLowerCase()}" class="${state.page === page.toLowerCase() ? "active" : ""}">${page}</button>`).join("")}
        </nav>
        <div class="userbar">
          <span class="revision-pill">Updated ${formatDate(state.session.app.updatedAt)}</span>
          <button class="secondary-button" data-refresh>Refresh</button>
          <div class="user-chip">
            <span class="avatar">${esc(initials(state.user.name))}</span>
            <div><strong>${esc(state.user.name)}</strong><small style="display:block;color:var(--muted)">${esc(state.user.role)}</small></div>
          </div>
          <button class="secondary-button" data-signout>Sign out</button>
        </div>
      </header>
    `;
  }

  function renderPage() {
    if (state.page === "import") return renderImport();
    if (state.page === "requests") return renderRequests();
    if (state.page === "reports") return renderReports();
    if (state.page === "activity") return renderActivity();
    if (state.page === "admin") return renderAdmin();
    return renderSearch();
  }

