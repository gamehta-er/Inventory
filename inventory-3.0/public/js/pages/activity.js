  function renderActivity() {
    if (!state.activityLoaded) loadActivity();
    const rows = state.activity || [];
    return `
      <section class="page-title"><span class="eyebrow">Activity</span><h1>Activity log</h1><p class="subtitle">Immutable traceability for edits, imports, requests, check-in/out, prints, backups, and exports.</p></section>
      <section class="panel command-panel">
        <div class="result-head">
          <div>
            <h2>Ledger</h2>
            <p class="subtitle">${rows.length ? `${rows.length} recent events` : "Loading recent events..."}</p>
          </div>
          <button class="secondary-button" data-export-activity>Export Activity</button>
        </div>
        <div class="activity-list">
          ${rows.length ? rows.map(renderActivityRow).join("") : `<div class="empty-state"><h2>No activity yet.</h2></div>`}
        </div>
      </section>
    `;
  }

  function renderActivityRow(item) {
    return `
      <article class="activity-row">
        <div>
          <span class="eyebrow">${esc(item.action || "event")}</span>
          <strong>${esc(item.summary || "Inventory activity")}</strong>
          <span class="meta-value">${esc(formatDate(item.createdAt))} - ${esc(item.actorName || "System")}</span>
        </div>
        <div><span class="meta-label">Reason</span><span class="meta-value">${esc(item.reason || "None")}</span></div>
        <div><span class="meta-label">NVBug</span><span class="meta-value">${renderBugLinks(item.nvbugLinks) || "None"}</span></div>
        <div><span class="meta-label">Source</span><span class="meta-value">${esc(item.source || "app")}</span></div>
      </article>
    `;
  }

