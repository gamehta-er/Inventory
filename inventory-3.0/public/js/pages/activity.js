  function renderActivity() {
    if (!state.activityLoaded) loadActivity();
    const rows = state.activity || [];
    return `
      <section class="page-title"><span class="eyebrow">Activity</span><h1>Activity log</h1><p class="subtitle">Immutable traceability for edits, imports, requests, check-in/out, prints, backups, and exports. Click an asset tag or row to open the asset history.</p></section>
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

  function activityAssetIds(item) {
    const meta = item.metadata || {};
    if (Array.isArray(meta.assetIds) && meta.assetIds.length) return meta.assetIds.map(Number).filter(Boolean);
    if (item.assetId) return [Number(item.assetId)];
    return [];
  }

  function renderActivityAssetLinks(item) {
    const meta = item.metadata || {};
    const ids = activityAssetIds(item);
    const tags = Array.isArray(meta.assetTags) && meta.assetTags.length
      ? meta.assetTags
      : (item.assetId && item.summary ? [item.summary.replace(/^.*for\s+/i, "").trim()] : []);
    if (!ids.length && !tags.length) return "";
    const links = (tags.length ? tags : ids.map((id) => `Asset #${id}`)).map((tag, index) => {
      const assetId = ids[index] || ids[0] || item.assetId;
      if (!assetId) return esc(tag);
      return `<button type="button" class="link-button" data-open-activity-asset="${assetId}" data-activity-id="${item.id}">${esc(tag)}</button>`;
    });
    return `<div><span class="meta-label">Assets</span><span class="meta-value activity-asset-links">${links.join(", ")}</span></div>`;
  }

  function renderActivityRow(item) {
    const meta = item.metadata || {};
    const ids = activityAssetIds(item);
    const singleAssetId = ids.length === 1 ? ids[0] : null;
    const rowAttrs = singleAssetId
      ? `class="activity-row activity-row-clickable" data-open-activity-asset="${singleAssetId}" data-activity-id="${item.id}"`
      : `class="activity-row"`;
    return `
      <article ${rowAttrs}>
        <div>
          <span class="eyebrow">${esc(item.action || "event")}</span>
          <strong>${esc(item.summary || "Inventory activity")}</strong>
          <span class="meta-value">${esc(formatDate(item.createdAt))} - ${esc(item.actorName || "System")}</span>
          ${renderActivityChanges(item)}
        </div>
        ${ids.length > 1 || (Array.isArray(meta.assetTags) && meta.assetTags.length) ? renderActivityAssetLinks(item) : ""}
        <div><span class="meta-label">Reason</span><span class="meta-value">${esc(item.reason || "None")}</span></div>
        <div><span class="meta-label">NVBug</span><span class="meta-value">${renderBugLinks(item.nvbugLinks) || "None"}</span></div>
        <div><span class="meta-label">Source</span><span class="meta-value">${esc(item.source || "app")}</span></div>
      </article>
    `;
  }
