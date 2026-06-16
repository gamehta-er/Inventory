const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const root = path.join(__dirname, "..");
let tempDir;
let serverProc;
let port = 3099;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const http = require("node:http");
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: options.method || "GET",
      headers: options.headers || {},
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let json = body;
        try { json = JSON.parse(body); } catch { /* text */ }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "inv3-test-"));
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
    const timer = setTimeout(() => reject(new Error("server start timeout")), 10000);
    serverProc.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Inventory 3.0 running")) {
        clearTimeout(timer);
        resolve();
      }
    });
    serverProc.stderr.on("data", (chunk) => process.stderr.write(chunk));
    serverProc.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
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

test("health and ready endpoints", async () => {
  const health = await request("/api/v3/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  const ready = await request("/api/v3/ready");
  assert.equal(ready.status, 200);
  assert.ok(ready.body.schemaVersion >= 1);
});

test("unauthenticated session is rejected", async () => {
  const res = await request("/api/v3/session");
  assert.equal(res.status, 401);
});

test("login and session", async () => {
  const loginBody = JSON.stringify({ memberId: "guest", role: "Admin User" });
  const login = await request("/api/v3/login", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": Buffer.byteLength(loginBody) },
    body: loginBody,
  });
  assert.equal(login.status, 200);
  const cookie = login.headers["set-cookie"]?.[0] || "";
  const session = await request("/api/v3/session", { headers: { cookie } });
  assert.equal(session.status, 200);
  assert.equal(session.body.user.role, "Admin User");
});

test("csv escape blocks formula injection", () => {
  const { csvEscape, canonicalField } = require(path.join(root, "src/lib/utils"));
  assert.equal(csvEscape("=1+1"), '"=1+1"');
  assert.equal(canonicalField("assetTag"), "assetTag");
  assert.equal(canonicalField("Asset Tag"), "assetTag");
});

test("create asset via API", async () => {
  const loginBody = JSON.stringify({ memberId: "guest", role: "Admin User" });
  const login = await request("/api/v3/login", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": Buffer.byteLength(loginBody) },
    body: loginBody,
  });
  const cookie = login.headers["set-cookie"]?.[0] || "";
  const session = await request("/api/v3/session", { headers: { cookie } });
  const locationId = session.body.locations[0].id;
  const categoryId = session.body.categories[0].id;
  const body = JSON.stringify({
    categoryId,
    model: "Test GPU",
    serial: "TEST-SN-001",
    assetTag: "TEST-TAG-001",
    status: "Ready to Deploy",
    locationId,
    reason: "API test create",
  });
  const created = await request("/api/v3/assets", {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    body,
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.detail.asset.assetTag, "TEST-TAG-001");
});
