  app.addEventListener("click", async (event) => {
    const target = event.target.closest("button, [data-request-open-asset], [data-close-filters], [data-open-activity-asset], .activity-row-clickable");
    if (!target) return;
    try {
      if (target.dataset.nav) {
        resetPageState(target.dataset.nav);
        pushUrl();
        if (state.page === "reports") await loadReports(false);
        if (state.page === "requests") await loadRequests(false);
        if (state.page === "activity") await loadActivity(false);
        if (state.page === "admin") await loadBackups(false);
        render();
      } else if (target.dataset.signout !== undefined) {
        document.cookie = "inventory3_session=; Path=/; Max-Age=0";
        localStorage.removeItem("inventory3.user");
        state.user = null;
        renderLogin();
      } else if (target.dataset.refresh !== undefined) {
        await loadSession();
        if (state.page === "search") await runSearch(false);
        if (state.page === "reports") await loadReports(false);
        if (state.page === "requests") await loadRequests(false);
        if (state.page === "activity") await loadActivity(false);
        if (state.page === "admin") await loadBackups(false);
        state.stale = false;
        render();
      } else if (target.dataset.search !== undefined) {
        state.query = document.getElementById("searchInput").value.trim();
        state.quickCategory = "";
        state.selectedCategory = "";
        pushUrl();
        await runSearch();
      } else if (target.dataset.clearSearch !== undefined) {
        state.query = "";
        state.quickCategory = "";
        state.selectedCategory = "";
        pushUrl();
        await runSearch();
      } else if (target.dataset.category) {
        const searchInput = document.getElementById("searchInput");
        if (searchInput) searchInput.value = "";
        state.query = "";
        state.quickCategory = target.dataset.category;
        state.selectedCategory = "";
        state.filters = {};
        state.extraFilters = {};
        state.draftFilters = {};
        state.draftExtraFilters = {};
        state.filterDrawerOpen = false;
        state.draftFilters = { ...state.filters };
        state.draftExtraFilters = {};
        pushUrl();
        await runSearch();
      } else if (target.dataset.openFilters !== undefined) {
        state.draftFilters = { ...state.filters };
        state.draftExtraFilters = { ...state.extraFilters };
        state.filterDrawerOpen = true;
        render();
      } else if (target.dataset.closeFilters !== undefined) {
        if (target === event.target || target.tagName === "BUTTON") {
          state.filterDrawerOpen = false;
          render();
        }
      } else if (target.dataset.toggleMoreFilters !== undefined) {
        state.moreFiltersOpen = !state.moreFiltersOpen;
        render();
      } else if (target.dataset.applyFilters !== undefined) {
        collectDraftFilters("[data-filter]", state.draftFilters, state.draftExtraFilters);
        state.filters = { ...state.draftFilters };
        state.extraFilters = { ...state.draftExtraFilters };
        state.quickCategory = "";
        state.selectedCategory = "";
        state.filterDrawerOpen = false;
        pushUrl();
        await runSearch();
      } else if (target.dataset.clearFilters !== undefined) {
        state.filters = {};
        state.extraFilters = {};
        state.draftFilters = {};
        state.draftExtraFilters = {};
        state.filterDrawerOpen = false;
        pushUrl();
        await runSearch();
      } else if (target.dataset.clearSelection !== undefined) {
        state.selected.clear();
        render();
      } else if (target.dataset.openDetail) {
        await loadAssetDetail(Number(target.dataset.openDetail), "Overview");
      } else if (target.dataset.openEdit) {
        await loadAssetDetail(Number(target.dataset.openEdit), "Edit");
      } else if (target.dataset.closeSheet !== undefined) {
        state.detail = null;
        render();
      } else if (target.dataset.tab) {
        state.detailTab = target.dataset.tab;
        render();
      } else if (target.dataset.action) {
        const asset = findVisibleAsset(Number(target.dataset.id)) || state.detail?.asset;
        if (target.dataset.action === "print-label") state.modal = { type: "print", asset };
        else state.modal = { type: "action", action: target.dataset.action, asset };
        render();
      } else if (target.dataset.openAddAsset !== undefined) {
        if (state.user.role !== "Admin User") return;
        const category = addAssetCategoryFromSearch();
        state.addAssetCategoryId = category?.id || "";
        state.modal = { type: "add-asset" };
        render();
      } else if (target.dataset.closeModal !== undefined) {
        state.modal = null;
        render();
      } else if (target.dataset.submitAction) {
        const body = formToObject(document.getElementById("actionForm"));
        body.action = target.dataset.submitAction;
        await api(`/api/v3/assets/${target.dataset.id}/actions`, { method: "POST", body });
        state.modal = null;
        await afterMutation("Action saved.");
      } else if (target.dataset.saveEdit) {
        const body = formToObject(document.getElementById("editForm"));
        await api(`/api/v3/assets/${target.dataset.saveEdit}`, { method: "PATCH", body });
        await afterMutation("Asset updated.");
        await loadAssetDetail(Number(target.dataset.saveEdit), "Overview");
      } else if (target.dataset.printNow || target.dataset.savePdf) {
        const labelHtml = document.querySelector(".label-print-sheet")?.innerHTML || "";
        await api(`/api/v3/assets/${target.dataset.printNow || target.dataset.savePdf}/actions`, { method: "POST", body: { action: "print-label", actorName: state.user.name, reason: "Label preview" } });
        if (labelHtml) printLabelHtml(labelHtml);
        state.modal = null;
        await afterMutation("Label prepared.");
      } else if (target.dataset.bulk) {
        if (target.disabled) return;
        await openBulkAction(target.dataset.bulk);
      } else if (target.dataset.previewBulk) {
        await refreshSelectedRevisions();
        const payload = bulkPayload(target.dataset.previewBulk);
        state.modal.preview = await api("/api/v3/assets/bulk-preview", { method: "POST", body: payload });
        render();
      } else if (target.dataset.commitBulk) {
        const action = target.dataset.commitBulk;
        const form = document.getElementById("bulkForm");
        if (form && action !== "print-label") {
          const body = formToObject(form);
          if (!String(body.reason || "").trim()) return setToast("Reason is required.");
          if (action === "check-out" && !body.ownerId) return setToast("Owner is required for check out.");
        }
        await refreshSelectedRevisions();
        const payload = bulkPayload(action);
        if (action !== "print-label" && !payload.locationId) {
          const first = state.selected.values().next().value;
          if (first?.locationId) payload.locationId = first.locationId;
        }
        const labelHtml = action === "print-label"
          ? document.querySelector(".label-print-sheet")?.innerHTML || ""
          : "";
        const result = await api("/api/v3/assets/bulk-commit", { method: "POST", body: payload });
        const count = result.results?.length || payload.assetIds?.length || state.selected.size;
        if (action === "print-label" && labelHtml) printLabelHtml(labelHtml);
        state.modal = null;
        state.selected.clear();
        const doneLabels = {
          "check-out": "Check out complete",
          "check-in": "Check in complete",
          "status-change": "Status change complete",
          "print-label": "Labels prepared",
        };
        await afterMutation(`${doneLabels[action] || "Bulk action complete"} — ${count} asset${count === 1 ? "" : "s"} updated.`);
      } else if (target.dataset.openActivityAsset || target.classList.contains("activity-row-clickable")) {
        const assetId = Number(target.dataset.openActivityAsset);
        if (!assetId) return;
        state.highlightActivityId = target.dataset.activityId || null;
        state.page = "search";
        await loadAssetDetail(assetId, "History");
      } else if (target.dataset.exportSelected !== undefined) {
        exportRows([...state.selected.values()]);
      } else if (target.dataset.previewImport !== undefined) {
        const form = new FormData();
        form.append("importProfile", document.getElementById("importProfile").value);
        const file = document.getElementById("importFile").files[0];
        if (file) form.append("file", file);
        else form.append("csvText", document.getElementById("importPaste").value);
        state.importPreview = await api("/api/v3/import/preview", { method: "POST", body: form });
        render();
      } else if (target.dataset.commitImport) {
        await api(`/api/v3/import/${target.dataset.commitImport}/commit`, { method: "POST", body: { actorName: state.user.name } });
        state.importPreview = null;
        await afterMutation("Import committed.");
      } else if (target.dataset.exportReport !== undefined) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(state.reportFilters)) if (value) params.set(key, value);
        for (const [key, value] of Object.entries(state.reportExtraFilters)) if (value) params.set(`extra.${key}`, value);
        params.set("actorName", state.user.name);
        window.open(`/api/v3/reports/export?${params.toString()}`, "_blank");
      } else if (target.dataset.applyReport !== undefined) {
        collectDraftFilters("[data-report-filter]", state.reportDraftFilters, state.reportDraftExtraFilters);
        state.reportFilters = { ...state.reportDraftFilters };
        state.reportExtraFilters = { ...state.reportDraftExtraFilters };
        pushUrl();
        await loadReports();
      } else if (target.dataset.clearReport !== undefined) {
        state.reportFilters = {};
        state.reportExtraFilters = {};
        state.reportDraftFilters = {};
        state.reportDraftExtraFilters = {};
        state.reportMoreFiltersOpen = false;
        pushUrl();
        await loadReports();
      } else if (target.dataset.toggleReportMore !== undefined) {
        state.reportMoreFiltersOpen = !state.reportMoreFiltersOpen;
        render();
      } else if (target.dataset.exportActivity !== undefined) {
        exportActivityRows(state.activity || []);
      } else if (target.dataset.createBackup !== undefined) {
        const result = await api("/api/v3/backups", { method: "POST", body: {} });
        state.backups = result.backups || [];
        state.lastBackupLocation = result.backup?.location || result.backup?.folder || "";
        state.backupsLoaded = true;
        await loadSession();
        setToast(`DB Backup completed${state.lastBackupLocation ? `: ${state.lastBackupLocation}` : "."}`);
        render();
      } else if (target.dataset.restoreBackup) {
        const backupId = target.dataset.restoreBackup;
        const confirm = window.prompt(`Type RESTORE ${backupId} to confirm restore:`);
        if (!confirm) return;
        await api("/api/v3/backups/restore", { method: "POST", body: { backupId, confirm } });
        await loadSession();
        await loadBackups(false);
        setToast("Database restored.");
        render();
      } else if (target.dataset.createLocation !== undefined) {
        const name = document.getElementById("newLocationName")?.value?.trim();
        if (!name) return setToast("Enter a location name.");
        await api("/api/v3/locations", { method: "POST", body: { name } });
        await loadSession();
        setToast("Location added.");
        render();
      } else if (target.dataset.createMember !== undefined) {
        const name = document.getElementById("newMemberName")?.value?.trim();
        const email = document.getElementById("newMemberEmail")?.value?.trim();
        if (!name || !email) return setToast("Enter member name and email.");
        await api("/api/v3/members", { method: "POST", body: { name, email } });
        await loadSession();
        setToast("Member added.");
        render();
      } else if (target.dataset.profileToggle) {
        state.expandedProfileId = String(state.expandedProfileId) === String(target.dataset.profileToggle) ? "" : target.dataset.profileToggle;
        if (state.profileEditId && state.profileEditId !== state.expandedProfileId) {
          state.profileEditId = "";
          state.profileDraftRequired = {};
        }
        render();
      } else if (target.dataset.profileModify) {
        const category = state.session.categories.find((cat) => String(cat.id) === String(target.dataset.profileModify));
        state.expandedProfileId = String(target.dataset.profileModify);
        state.profileEditId = String(target.dataset.profileModify);
        state.profileDraftRequired = Object.fromEntries((category?.fields || []).map((field) => [field.key, Boolean(field.required)]));
        render();
      } else if (target.dataset.profileCancel) {
        state.profileEditId = "";
        state.profileDraftRequired = {};
        render();
      } else if (target.dataset.profileSave) {
        const category = state.session.categories.find((cat) => String(cat.id) === String(target.dataset.profileSave));
        const fields = (category?.fields || []).map((field) => ({ key: field.key, required: Boolean(state.profileDraftRequired[field.key]) }));
        await api(`/api/v3/categories/${target.dataset.profileSave}/fields`, { method: "PATCH", body: { actorName: state.user.name, fields } });
        await loadSession();
        state.profileEditId = "";
        state.profileDraftRequired = {};
        setToast("Profile field rules updated.");
        render();
      } else if (target.dataset.createAssetRow !== undefined) {
        const form = document.getElementById("addAssetForm");
        if (!form) return;
        const body = formToObject(form);
        if (!body.model?.trim()) return setToast("Model is required.");
        if (!body.assetTag?.trim()) return setToast("Asset Tag is required.");
        if (!body.locationId) return setToast("Location is required.");
        if (!String(body.reason || "").trim()) return setToast("Reason is required.");
        try {
          const result = await api("/api/v3/assets", { method: "POST", body });
          state.addAssetCategoryId = body.categoryId;
          state.modal = null;
          await afterMutation("New asset row added.");
          if (result.detail) {
            state.detail = result.detail;
            state.detailTab = "Overview";
            render();
          }
        } catch (error) {
          const fieldErrors = error.data?.errors;
          if (fieldErrors) setToast(Object.values(fieldErrors).join(" "));
          else setToast(error.data?.error || error.message);
        }
      } else if (target.dataset.resetAddRow !== undefined) {
        state.addAssetCategoryId = "";
        if (state.page === "search") state.modal = null;
        render();
      } else if (target.dataset.requestOpenAsset) {
        await loadAssetDetail(Number(target.dataset.requestOpenAsset), "Operations");
      } else if (target.dataset.uploadImage) {
        const input = document.getElementById("modelImageFile");
        if (!input.files[0]) return setToast("Choose an image first.");
        setToast("Uploading image...");
        const form = new FormData();
        form.append("image", input.files[0]);
        form.append("actorName", state.user.name);
        await api(`/api/v3/asset-models/${target.dataset.uploadImage}/image`, { method: "POST", body: form });
        const assetId = state.detail.asset.id;
        const tab = state.detailTab;
        await afterMutation("Model image updated.");
        await loadAssetDetail(assetId, tab);
      } else if (target.dataset.removeImage) {
        await api(`/api/v3/asset-models/${target.dataset.removeImage}/image`, { method: "DELETE", body: { actorName: state.user.name } });
        const assetId = state.detail.asset.id;
        const tab = state.detailTab;
        await afterMutation("Model image removed.");
        await loadAssetDetail(assetId, tab);
      }
    } catch (error) {
      const fieldErrors = error.data?.errors;
      const message = error.status === 409
        ? "Asset changed elsewhere. Refresh and try again."
        : (fieldErrors ? Object.values(fieldErrors).join(" ") : (error.data?.error || error.message));
      setToast(message);
    }
  });

  app.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-filter], [data-report-filter], [data-select-asset], [data-profile-required], [data-add-category]");
    if (!select) return;
    if (select.dataset.selectAsset) {
      const asset = findVisibleAsset(Number(select.dataset.selectAsset));
      if (select.checked) state.selected.set(asset.id, asset);
      else state.selected.delete(asset.id);
      render();
      return;
    }
    if (select.dataset.filter) {
      setDraftFilter(select.dataset.filter, select.value);
      return;
    }
    if (select.dataset.reportFilter) {
      setReportDraftFilter(select.dataset.reportFilter, select.value);
      if (select.dataset.reportFilter === "category") {
        state.reportMoreFiltersOpen = false;
        render();
      }
      return;
    }
    if (select.dataset.profileRequired) {
      state.profileDraftRequired[select.dataset.profileRequired] = select.checked;
      return;
    }
    if (select.dataset.addCategory !== undefined) {
      state.addAssetCategoryId = select.value;
      render();
    }
  });

  app.addEventListener("input", debounce((event) => {
    const input = event.target.closest("[data-filter], [data-report-filter]");
    if (!input) return;
    if (input.dataset.filter) {
      setDraftFilter(input.dataset.filter, input.value);
    } else if (input.dataset.reportFilter) {
      setReportDraftFilter(input.dataset.reportFilter, input.value);
    }
  }, 300));

  app.addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && event.target.id === "searchInput") {
      state.query = event.target.value.trim();
      state.quickCategory = "";
      state.selectedCategory = "";
      pushUrl();
      await runSearch();
    }
  });

  function setDraftFilter(key, value) {
    if (key.startsWith("extra.")) state.draftExtraFilters[key.slice(6)] = value;
    else state.draftFilters[key] = value;
  }

  function setReportDraftFilter(key, value) {
    if (key.startsWith("extra.")) state.reportDraftExtraFilters[key.slice(6)] = value;
    else state.reportDraftFilters[key] = value;
  }

  function collectDraftFilters(selector, normalTarget, extraTarget) {
    document.querySelectorAll(selector).forEach((control) => {
      const key = control.dataset.filter || control.dataset.reportFilter;
      if (!key) return;
      if (key.startsWith("extra.")) extraTarget[key.slice(6)] = control.value;
      else normalTarget[key] = control.value;
    });
  }

  function findVisibleAsset(id) {
    return [...(state.searchResult.assets || []), ...(state.reports?.assets || [])].find((asset) => Number(asset.id) === Number(id));
  }

  function bulkPayload(action) {
    const form = document.getElementById("bulkForm");
    const body = form ? formToObject(form) : {};
    body.action = action;
    body.assetIds = [...state.selected.keys()];
    body.expectedRevisions = Object.fromEntries([...state.selected.values()].map((asset) => [asset.id, asset.revision]));
    return body;
  }

  async function afterMutation(message) {
    await loadSession();
    if (state.page === "search") await runSearch(false);
    if (state.page === "reports") await loadReports(false);
    if (state.page === "requests") await loadRequests(false);
    if (state.page === "activity") await loadActivity(false);
    if (state.page === "admin") await loadBackups(false);
    setToast(message);
    render();
  }

  function exportRows(rows) {
    const headers = ["Category", "Model", "Serial", "Asset Tag", "Status", "Owner", "Location", "NVBug"];
    const lines = [headers.join(",")].concat(rows.map((asset) => [asset.category, asset.model, asset.serial, asset.assetTag, asset.status, asset.owner, asset.location, asset.nvbug].map((v) => `"${String(v || "").replace(/"/g, '""')}"`).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inventory-3-selected-assets.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportActivityRows(rows) {
    const headers = ["Timestamp", "Actor", "Action", "Asset ID", "Reason", "NVBug", "Source", "Summary"];
    const lines = [headers.join(",")].concat(rows.map((item) => [
      item.createdAt,
      item.actorName,
      item.action,
      item.assetId || "",
      item.reason || "",
      item.nvbug || "",
      item.source || "",
      item.summary || "",
    ].map((v) => `"${String(v || "").replace(/"/g, '""')}"`).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inventory-3-activity.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function debounce(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }
