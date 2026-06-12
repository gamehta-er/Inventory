  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initials(name) {
    return String(name || "IM")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("");
  }

  function cssStatus(status) {
    return `status-${String(status || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  }

  function fieldLabel(key) {
    const map = {
      category: "Category",
      model: "Model",
      serial: "Serial No.",
      assetTag: "Asset Tag",
      status: "Status",
      owner: "Owner",
      ownerId: "Owner / Assignee",
      location: "Location",
      locationId: "Location",
      usage: "Usage",
      nvbug: "NVBug #",
      borrowedLent: "Borrowed/Lent",
      reason: "Reason",
    };
    return map[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  }
