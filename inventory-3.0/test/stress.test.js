const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const root = path.join(__dirname, "..");
const REPEAT = 10;
let tempDir;
let serverProc;
let port = 3101;
let cookie = "";
let session = null;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const http = require("node:http");
    const headers = { ...(options.headers || {}) };
    if (cookie && !headers.cookie) headers.cookie = cookie;
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: options.method || "GET",
      headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let json = body;
        try { json = JSON.parse(body); } catch { /* text */ }
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw: body });
      });
    });
    req.on("error", reject);
    if (options.body) {
      if (typeof options.body === "string") {
        if (!headers["content-type"]) headers["content-type"] = "application/json";
        if (!headers["content-length"]) headers["content-length"] = Buffer.byteLength(options.body);
        req.write(options.body);
      } else {
        req.write(options.body);
      }
    }
    req.end();
  });
}

async function jsonPost(pathname, payload) {
  const body = JSON.stringify(payload);
  return request(pathname, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    },
    body,
  });
}

async function jsonPatch(pathname, payload) {
  const body = JSON.stringify(payload);
  return request(pathname, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    },
    body,
  });
}

function failOn(res, label) {
  if (res.status >= 400) {
    const detail = typeof res.body === "object" ? JSON.stringify(res.body) : res.raw;
    throw new Error(`${label}: HTTP ${res.status} — ${detail}`);
  }
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "inv3-stress-"));
  serverProc = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: tempDir,
      SEED_MODE: "1",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server start timeout")), 15000);
    serverProc.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Inventory 3.0 running")) {
        clearTimeout(timer);
        resolve();
      }
    });
    serverProc.stderr.on("data", (chunk) => process.stderr.write(chunk));
    serverProc.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });

  const login = await jsonPost("/api/v3/login", { memberId: "guest", role: "Admin User" });
  failOn(login, "login");
  cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] || "";
  session = await request("/api/v3/session");
  failOn(session, "session");
});

after(() => {
  if (serverProc) {
    serverProc.kill("SIGTERM");
    try { serverProc.kill("SIGKILL"); } catch { /* ignore */ }
  }
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* WAL lock on Windows */ }
  }
});

test(`create asset x${REPEAT}`, async () => {
  const locationId = session.body.locations[0].id;
  const categoryId = session.body.categories.find((c) => c.slug === "gpu")?.id || session.body.categories[0].id;
  const created = [];
  for (let i = 0; i < REPEAT; i += 1) {
    const res = await jsonPost("/api/v3/assets", {
      categoryId,
      model: `Stress GPU ${i}`,
      serial: `STRESS-SN-${Date.now()}-${i}`,
      assetTag: `STRESS-TAG-${Date.now()}-${i}`,
      status: "Ready to Deploy",
      locationId,
      reason: `Stress create ${i}`,
    });
    failOn(res, `create asset ${i}`);
    assert.ok(res.body.detail?.asset?.id, `missing asset id on create ${i}`);
    assert.equal(res.body.detail.asset.extra_json ?? res.body.detail.asset.extra ?? {}, res.body.detail.asset.extra ?? {});
    created.push(res.body.detail.asset);
  }
  assert.equal(created.length, REPEAT);
});

test(`search and detail x${REPEAT}`, async () => {
  for (let i = 0; i < REPEAT; i += 1) {
    const search = await request("/api/v3/search?q=STRESS-TAG");
    failOn(search, `search ${i}`);
    assert.ok(search.body.assets.length >= 1, `search ${i} expected assets`);
    const id = search.body.assets[0].id;
    const detail = await request(`/api/v3/assets/${id}`);
    failOn(detail, `detail ${i}`);
    assert.equal(detail.body.asset.id, id);
  }
});

test(`edit asset x${REPEAT}`, async () => {
  const search = await request("/api/v3/search?q=STRESS-TAG");
  failOn(search, "search for edit");
  const asset = search.body.assets[0];
  for (let i = 0; i < REPEAT; i += 1) {
    const res = await jsonPatch(`/api/v3/assets/${asset.id}`, {
      revision: asset.revision,
      notes: `Edited ${i}`,
      reason: `Stress edit ${i}`,
    });
    failOn(res, `edit ${i}`);
    asset.revision = res.body.detail.asset.revision;
  }
});

test(`checkout and checkin x${REPEAT}`, async () => {
  const search = await request("/api/v3/search?q=STRESS-TAG");
  const asset = search.body.assets[0];
  const locationId = session.body.locations[0].id;
  const ownerId = session.body.members[0]?.id;
  assert.ok(ownerId, "need seeded member for checkout");
  for (let i = 0; i < REPEAT; i += 1) {
    const fresh = await request(`/api/v3/assets/${asset.id}`);
    const rev = fresh.body.asset.revision;
    const out = await jsonPost(`/api/v3/assets/${asset.id}/actions`, {
      action: "check-out",
      revision: rev,
      status: "In Use",
      ownerId,
      locationId,
      reason: `Stress checkout ${i}`,
    });
    failOn(out, `checkout ${i}`);
    const rev2 = out.body.detail.asset.revision;
    const inn = await jsonPost(`/api/v3/assets/${asset.id}/actions`, {
      action: "check-in",
      revision: rev2,
      status: "Ready to Deploy",
      locationId,
      reason: `Stress checkin ${i}`,
    });
    failOn(inn, `checkin ${i}`);
  }
});

test(`print label x${REPEAT}`, async () => {
  const search = await request("/api/v3/search?q=STRESS-TAG");
  const asset = search.body.assets[0];
  for (let i = 0; i < REPEAT; i += 1) {
    const res = await jsonPost(`/api/v3/assets/${asset.id}/actions`, {
      action: "print-label",
      reason: `Stress print ${i}`,
    });
    failOn(res, `print ${i}`);
  }
});

test(`bulk print preview and commit x${REPEAT}`, async () => {
  const search = await request("/api/v3/search?q=STRESS-TAG");
  const assets = search.body.assets.slice(0, 3);
  assert.ok(assets.length >= 1);
  const expectedRevisions = Object.fromEntries(assets.map((a) => [a.id, a.revision]));
  for (let i = 0; i < REPEAT; i += 1) {
    const preview = await jsonPost("/api/v3/assets/bulk-preview", {
      action: "print-label",
      assetIds: assets.map((a) => a.id),
      expectedRevisions,
    });
    failOn(preview, `bulk preview ${i}`);
    const commit = await jsonPost("/api/v3/assets/bulk-commit", {
      action: "print-label",
      assetIds: assets.map((a) => a.id),
      expectedRevisions,
      reason: `Bulk print ${i}`,
    });
    failOn(commit, `bulk commit ${i}`);
  }
});

test(`edit clears empty ownerId x${REPEAT}`, async () => {
  const search = await request("/api/v3/search?q=STRESS-TAG");
  const asset = search.body.assets[0];
  for (let i = 0; i < REPEAT; i += 1) {
    const fresh = await request(`/api/v3/assets/${asset.id}`);
    const res = await jsonPatch(`/api/v3/assets/${fresh.body.asset.id}`, {
      revision: fresh.body.asset.revision,
      ownerId: "",
      reason: `Clear owner ${i}`,
    });
    failOn(res, `clear owner ${i}`);
  }
});

test(`bulk checkout and checkin x${REPEAT}`, async () => {
  const search = await request("/api/v3/search?q=STRESS-TAG");
  const assets = search.body.assets.slice(0, 3);
  assert.ok(assets.length >= 1);
  const locationId = session.body.locations[0].id;
  const ownerId = session.body.members[0]?.id;
  for (let i = 0; i < REPEAT; i += 1) {
    const fresh = await Promise.all(assets.map((a) => request(`/api/v3/assets/${a.id}`)));
    const expectedRevisions = Object.fromEntries(fresh.map((r) => [r.body.asset.id, r.body.asset.revision]));
    const outPreview = await jsonPost("/api/v3/assets/bulk-preview", {
      action: "check-out",
      assetIds: assets.map((a) => a.id),
      expectedRevisions,
      status: "In Use",
      ownerId,
      locationId,
      reason: `Bulk checkout ${i}`,
    });
    failOn(outPreview, `bulk checkout preview ${i}`);
    const outCommit = await jsonPost("/api/v3/assets/bulk-commit", {
      action: "check-out",
      assetIds: assets.map((a) => a.id),
      expectedRevisions,
      status: "In Use",
      ownerId,
      locationId,
      reason: `Bulk checkout ${i}`,
    });
    failOn(outCommit, `bulk checkout commit ${i}`);

    const afterOut = await Promise.all(assets.map((a) => request(`/api/v3/assets/${a.id}`)));
    const revIn = Object.fromEntries(afterOut.map((r) => [r.body.asset.id, r.body.asset.revision]));
    const inPreview = await jsonPost("/api/v3/assets/bulk-preview", {
      action: "check-in",
      assetIds: assets.map((a) => a.id),
      expectedRevisions: revIn,
      status: "Ready to Deploy",
      locationId,
      reason: `Bulk checkin ${i}`,
    });
    failOn(inPreview, `bulk checkin preview ${i}`);
    const inCommit = await jsonPost("/api/v3/assets/bulk-commit", {
      action: "check-in",
      assetIds: assets.map((a) => a.id),
      expectedRevisions: revIn,
      status: "Ready to Deploy",
      locationId,
      reason: `Bulk checkin ${i}`,
    });
    failOn(inCommit, `bulk checkin commit ${i}`);
  }
});

test(`status change x${REPEAT}`, async () => {
  const search = await request("/api/v3/search?q=STRESS-TAG");
  const asset = search.body.assets[0];
  const locationId = session.body.locations[0].id;
  for (let i = 0; i < REPEAT; i += 1) {
    const fresh = await request(`/api/v3/assets/${asset.id}`);
    const res = await jsonPost(`/api/v3/assets/${asset.id}/actions`, {
      action: "status-change",
      revision: fresh.body.asset.revision,
      status: i % 2 ? "Idle" : "Ready to Deploy",
      locationId,
      reason: `Stress status ${i}`,
    });
    failOn(res, `status change ${i}`);
  }
});

test(`create request x${REPEAT}`, async () => {
  const search = await request("/api/v3/search?q=STRESS-TAG");
  const asset = search.body.assets[0];
  for (let i = 0; i < REPEAT; i += 1) {
    const res = await jsonPost(`/api/v3/assets/${asset.id}/actions`, {
      action: "request",
      requestType: "Support",
      priority: "Normal",
      reason: `Stress request ${i}`,
    });
    failOn(res, `request ${i}`);
  }
});

test(`import preview and commit x${REPEAT}`, async () => {
  const location = session.body.locations[0].name;
  for (let i = 0; i < REPEAT; i += 1) {
    const tag = `IMP-STRESS-${Date.now()}-${i}`;
    const csv = `category,model,serial,assetTag,status,location\nGPU,Import Model,IMP-SN-${i},${tag},Ready to Deploy,"${location.replace(/"/g, '""')}"\n`;
    const preview = await jsonPost("/api/v3/import/preview", {
      importProfile: "assets-gpu",
      csvText: csv,
      filename: "stress.csv",
    });
    failOn(preview, `import preview ${i}`);
    const batchId = preview.body.batch?.id || preview.body.id;
    assert.ok(batchId, `missing batch id ${i}`);
    const commit = await jsonPost(`/api/v3/import/${batchId}/commit`, {});
    failOn(commit, `import commit ${i}`);
  }
});

test(`admin master data x${REPEAT}`, async () => {
  for (let i = 0; i < REPEAT; i += 1) {
    const loc = await jsonPost("/api/v3/locations", { name: `Stress Loc ${Date.now()}-${i}` });
    failOn(loc, `location ${i}`);
    const mem = await jsonPost("/api/v3/members", {
      name: `Stress User ${Date.now()}-${i}`,
      email: `stress${Date.now()}${i}@example.com`,
    });
    failOn(mem, `member ${i}`);
  }
});

test(`backup create x${REPEAT}`, async () => {
  for (let i = 0; i < REPEAT; i += 1) {
    const res = await jsonPost("/api/v3/backups", {});
    failOn(res, `backup ${i}`);
    assert.ok(res.body.backup || res.body.backups, `backup payload ${i}`);
  }
});

test(`reports and activity x${REPEAT}`, async () => {
  for (let i = 0; i < REPEAT; i += 1) {
    const report = await request("/api/v3/reports/assets?category=gpu");
    failOn(report, `report ${i}`);
    const exportRes = await request("/api/v3/reports/export?category=gpu");
    assert.equal(exportRes.status, 200, `export ${i}`);
    assert.ok(String(exportRes.raw).includes("Category"), `export csv ${i}`);
    const activity = await request("/api/v3/activity");
    failOn(activity, `activity ${i}`);
    assert.ok(Array.isArray(activity.body.activity), `activity list ${i}`);
  }
});

test(`archive via status x${REPEAT}`, async () => {
  const search = await request("/api/v3/search?q=STRESS-TAG");
  const asset = search.body.assets[search.body.assets.length - 1];
  const locationId = session.body.locations[0].id;
  for (let i = 0; i < REPEAT; i += 1) {
    const fresh = await request(`/api/v3/assets/${asset.id}`);
    const res = await jsonPost(`/api/v3/assets/${asset.id}/actions`, {
      action: "status-change",
      revision: fresh.body.asset.revision,
      status: "Archived",
      locationId,
      reason: `Stress archive toggle ${i}`,
    });
    failOn(res, `archive ${i}`);
  }
});
