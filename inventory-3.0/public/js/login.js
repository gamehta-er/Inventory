  function renderLogin() {
    const members = state.bootstrap?.members || state.session?.members || [];
    app.innerHTML = `
      <main class="login-screen">
        <section class="login-card">
          <div class="brand">
            <span class="brand-mark">o</span>
            <div>NVIDIA <small>Inventory 3.0</small></div>
          </div>
          <h1 style="font-size:34px;line-height:1.08">Inventory Sign In</h1>
          <p class="subtitle">Select your name and role for this pilot.</p>
          <div class="field" style="margin-top:20px">
            <label for="loginMember">Member</label>
            <select id="loginMember">
              <option value="">Select member...</option>
              ${members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}
              <option value="guest">Guest / not listed</option>
            </select>
          </div>
          <div class="field" style="margin-top:12px">
            <label for="loginEmail">Email</label>
            <input id="loginEmail" placeholder="Select a member first" />
          </div>
          <div class="field" style="margin-top:12px">
            <label for="loginRole">Login mode</label>
            <select id="loginRole">
              <option value="Regular User">Regular User</option>
              <option value="Admin User">Admin User</option>
            </select>
          </div>
          <button class="primary-button" id="loginContinue" style="width:100%;margin-top:20px">Continue</button>
        </section>
      </main>
    `;
    document.getElementById("loginMember").addEventListener("change", (event) => {
      const value = event.target.value;
      const email = document.getElementById("loginEmail");
      if (value === "guest") {
        email.value = "";
        email.placeholder = "guest@lab-inventory.example";
        return;
      }
      const member = members.find((m) => String(m.id) === value);
      email.value = member?.email || "";
    });
    document.getElementById("loginContinue").addEventListener("click", async () => {
      const value = document.getElementById("loginMember").value;
      if (!value) return setToast("Select a member first.");
      try {
        const result = await api("/api/v3/login", {
          method: "POST",
          body: {
            memberId: value,
            role: document.getElementById("loginRole").value,
          },
        });
        state.user = result.user;
        localStorage.setItem("inventory3.user", JSON.stringify(state.user));
        await loadSession();
        await runSearch(false);
        render();
      } catch (error) {
        state.user = null;
        localStorage.removeItem("inventory3.user");
        setToast(error.data?.error || error.message || "Sign in failed. Try again.");
      }
    });
  }

  function resetPageState(nextPage) {
    state.page = nextPage;
    state.detail = null;
    state.detailTab = "Overview";
    state.modal = null;
    state.filterDrawerOpen = false;
    state.moreFiltersOpen = false;
    state.selected.clear();
    if (nextPage !== "search") {
      state.query = "";
      state.quickCategory = "";
      state.selectedCategory = "";
      state.filters = {};
      state.extraFilters = {};
      state.draftFilters = {};
      state.draftExtraFilters = {};
      state.searchResult = { assets: [], summary: null, mode: "empty", appliedCategory: "" };
    }
    if (nextPage !== "import") state.importPreview = null;
    if (nextPage !== "reports") {
      state.reports = null;
      state.reportFilters = {};
      state.reportExtraFilters = {};
      state.reportDraftFilters = {};
      state.reportDraftExtraFilters = {};
      state.reportMoreFiltersOpen = false;
    }
    if (nextPage !== "requests") state.requestsLoaded = false;
    if (nextPage !== "activity") {
      state.activity = [];
      state.activityLoaded = false;
    }
    if (nextPage !== "admin") {
      state.backups = [];
      state.backupsLoaded = false;
      state.expandedProfileId = "";
      state.profileEditId = "";
      state.profileDraftRequired = {};
    }
  }

