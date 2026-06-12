  function renderRequests() {
    if (!state.requestsLoaded) loadRequests();
    return `
      <section class="page-title"><span class="eyebrow">Requests</span><h1>Open work.</h1><p class="subtitle">Click a request to open the asset workspace and make the needed change.</p></section>
      <div class="asset-list">
        ${state.requests.length ? state.requests.map((request) => `
          <article class="asset-card" data-request-open-asset="${request.assetId}">
            <input type="checkbox" disabled />
            <div class="asset-image">${esc(request.category.slice(0, 2).toUpperCase())}</div>
            <div class="asset-title"><span class="eyebrow">${esc(request.type)}</span><strong>${esc(request.model)}</strong><span class="meta-value">${esc(request.assetTag)}</span></div>
            <div class="asset-meta"><span class="meta-label">Priority</span><span class="meta-value">${esc(request.priority)}</span></div>
            <div class="asset-meta"><span class="meta-label">Status</span><span class="meta-value">${esc(request.status)}</span></div>
            <div class="asset-meta"><span class="meta-label">Owner</span><span class="meta-value">${esc(request.owner || "Unassigned")}</span></div>
            <div class="asset-meta"><span class="meta-label">NVBug</span><span class="meta-value">${renderBugLinks(request.nvbugLinks)}</span></div>
            <div class="card-actions"><button class="icon-button" data-request-open-asset="${request.assetId}">Open Asset</button></div>
          </article>
        `).join("") : `<div class="empty-state"><h2>No requests yet.</h2></div>`}
      </div>
    `;
  }

