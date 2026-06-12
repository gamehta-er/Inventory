  function formToObject(form) {
    const values = {};
    new FormData(form).forEach((value, key) => {
      if (key.startsWith("extra.")) {
        values.extra = values.extra || {};
        values.extra[key.slice(6)] = value;
      } else {
        values[key] = value;
      }
    });
    values.actorName = state.user.name;
    return values;
  }

  function renderBugLinks(links) {
    return (links || []).map((link) => link.url ? `<a href="${esc(link.url)}" target="_blank" rel="noreferrer">${esc(link.value)}</a>` : esc(link.value)).join(", ");
  }

  function formatDate(value) {
    try {
      return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch {
      return value || "";
    }
  }

  function uniq(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  }
