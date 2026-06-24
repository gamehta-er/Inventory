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

  function statusOptions() {
    const list = state.session?.statusNames
      || (state.session?.statuses || []).map((s) => (typeof s === "string" ? s : s.name));
    return list.map((v) => [v, v]);
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

  function renderBrandMarkup({ homeButton = false } = {}) {
    const inner = `
      <span class="brand-logo-wrap">
        <img
          src="/assets/nvidia-logo-horiz-blk-16x9.png"
          alt="NVIDIA"
          class="brand-logo"
          width="640"
          height="360"
          decoding="async"
        />
      </span>
      <small class="brand-tagline">Inventory 3.0</small>
    `;
    if (homeButton) {
      return `<button type="button" class="brand-link" data-nav-home aria-label="Go to home">${inner}</button>`;
    }
    return `<a href="/" class="brand-link" aria-label="NVIDIA Inventory 3.0 home">${inner}</a>`;
  }

  const LABEL_WIDTH_IN = 2.125;
  const LABEL_HEIGHT_IN = 1;

  function labelPrintStyles(widthIn, heightIn) {
    const widthMm = (widthIn * 25.4).toFixed(3);
    const heightMm = (heightIn * 25.4).toFixed(3);
    return `
      @page {
        size: ${widthIn}in ${heightIn}in;
        size: ${widthMm}mm ${heightMm}mm;
        margin: 0;
      }
      * { box-sizing: border-box; }
      html, body {
        width: ${widthIn}in;
        height: ${heightIn}in;
        margin: 0;
        padding: 0;
        background: #fff;
        color: #000;
        font-family: Arial, Helvetica, sans-serif;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      body { height: auto; }
      .label-sheet {
        width: ${widthIn}in;
        margin: 0;
        padding: 0;
      }
      .label-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: ${widthIn}in;
        height: ${heightIn}in;
        margin: 0;
        padding: 0.08in;
        border: 0;
        border-radius: 0;
        box-shadow: none;
        page-break-after: always;
        break-after: page;
        overflow: hidden;
        text-align: center;
        background: #fff;
      }
      .label-card:last-child {
        page-break-after: auto;
        break-after: auto;
      }
      .label-line-model,
      .label-card > div:first-child {
        max-width: 100%;
        font-size: 7pt;
        font-weight: 700;
        line-height: 1.05;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .label-card strong {
        display: block;
        max-width: 100%;
        font-size: 11pt;
        line-height: 1.05;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .label-line-serial,
      .label-card > div:last-child {
        max-width: 100%;
        font-size: 8pt;
        line-height: 1.05;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .barcode-wrap {
        display: flex;
        justify-content: center;
        width: 100%;
        padding: 0.02in 0.06in;
        background: #fff;
      }
      .barcode,
      svg.barcode {
        display: block;
        width: 1.65in;
        height: 0.34in;
      }
      @media screen {
        html, body {
          width: auto;
          height: auto;
          background: #eceff2;
        }
        body { padding: 12px; }
        .label-card {
          border: 1px dashed #98a2ad;
          margin-bottom: 8px;
        }
      }
    `;
  }

  function printLabelHtml(labelHtml, options = {}) {
    const widthIn = Number(options.widthIn) || LABEL_WIDTH_IN;
    const heightIn = Number(options.heightIn) || LABEL_HEIGHT_IN;
    const frame = document.createElement("iframe");
    frame.setAttribute("title", "Label print");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    document.body.appendChild(frame);

    const doc = frame.contentDocument || frame.contentWindow.document;
    doc.open();
    doc.write(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Inventory Label</title>
  <style>${labelPrintStyles(widthIn, heightIn)}</style>
</head>
<body>
  <div class="label-sheet">${labelHtml}</div>
</body>
</html>`);
    doc.close();

    const win = frame.contentWindow;
    const cleanup = () => {
      frame.remove();
      win.removeEventListener("afterprint", cleanup);
    };
    win.addEventListener("afterprint", cleanup);
    window.setTimeout(() => {
      win.focus();
      win.print();
    }, 200);
  }

  function renderAssetLabelCard(asset) {
    const model = String(asset?.model || "").trim();
    const assetTag = String(asset?.assetTag || "").trim();
    const serial = String(asset?.serial || assetTag).trim();
    const barcodeValue = assetTag || serial || "INV3";
    return `
      <div class="label-card">
        <div class="label-line-model">${esc(model)}</div>
        <strong class="label-line-tag">${esc(assetTag)}</strong>
        <div class="barcode-wrap">${code128Svg(barcodeValue, { height: 64, moduleWidth: 2, quiet: 14 })}</div>
        <div class="label-line-serial">${esc(serial)}</div>
      </div>
    `;
  }

  async function waitForPrintJob(jobId, timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const status = await api(`/api/v3/labels/jobs/${encodeURIComponent(jobId)}`);
      const job = status.job || {};
      if (job.status === "done" || job.status === "failed") return job;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return { id: jobId, status: "queued", message: "Print is still queued on the server." };
  }

  function openLabelPdf(assetIds, { download = false } = {}) {
    const ids = (Array.isArray(assetIds) ? assetIds : [assetIds]).filter(Boolean);
    if (!ids.length) return;
    const query = ids.map((id) => `assetId=${encodeURIComponent(id)}`).join("&");
    const url = `/api/v3/labels/pdf?${query}`;
    if (download) {
      const anchor = document.createElement("a");
      anchor.href = `${url}&download=1`;
      anchor.target = "_blank";
      anchor.rel = "noopener";
      anchor.click();
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  async function queueLabelPrint(assetIds, reason = "Label print") {
    const ids = (Array.isArray(assetIds) ? assetIds : [assetIds]).map(Number).filter(Boolean);
    if (!ids.length) return { mode: "none", count: 0 };

    const endpoint = ids.length === 1 ? "/api/v3/labels/print" : "/api/v3/labels/print-bulk";
    const body = ids.length === 1
      ? { assetId: ids[0], reason }
      : { assetIds: ids, reason };
    const queued = await api(endpoint, { method: "POST", body });
    const initialJob = queued.job || {};
    if (!initialJob.id) {
      return { mode: "queued", count: ids.length, status: "queued", printerName: "", message: "Print request accepted." };
    }
    const finalJob = await waitForPrintJob(initialJob.id);
    return {
      mode: "queue",
      count: ids.length,
      status: finalJob.status || "queued",
      printerName: finalJob.printerName || "",
      message: finalJob.error || finalJob.message || "",
      jobId: finalJob.id || initialJob.id,
    };
  }

  async function printAssetLabels(assets, options = {}) {
    const list = (Array.isArray(assets) ? assets : [assets]).filter(Boolean);
    if (!list.length) return { mode: "none", count: 0 };
    try {
      const ids = list.map((asset) => Number(asset.id)).filter(Boolean);
      return await queueLabelPrint(ids, options.reason || "Label print");
    } catch (error) {
      // Keep local HTML print as fallback to avoid workflow hard-stop.
      const fallbackHtml = list.map((asset) => renderAssetLabelCard(asset)).join("");
      printLabelHtml(fallbackHtml);
      return { mode: "browser", count: list.length, error: error.message || String(error) };
    }
  }
