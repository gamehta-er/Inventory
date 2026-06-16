# Getting Started

This guide takes you from zero to a working local Inventory 3.0 instance in about five minutes.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js 22+** | Uses built-in `node:sqlite` (experimental) |
| **Windows or Linux** | Pilot tested on Windows 10/11 |
| **Browser** | Chrome or Edge recommended for print labels |

If `node` is not on your PATH, use `start-local.cmd` which falls back to the Codex bundled runtime.

Verify Node:

```powershell
node --version
```

---

## Step 1 — Start the server

From the `inventory-3.0` directory:

```powershell
node server.js
```

Expected console output:

```text
Inventory 3.0 running at http://127.0.0.1:3003
```

Or double-click **`start-local.cmd`**.

---

## Step 2 — Open the app

Navigate to:

```text
http://127.0.0.1:3003
```

You should see the **login screen** with a member dropdown and role selector.

---

## Step 3 — Sign in

1. Select your name from the roster (or **Guest / not listed** for quick testing)
2. Choose **Regular User** for day-to-day work, or **Admin User** for imports and master data
3. Click **Sign in**

Your role appears in the top bar. Only admins see **Admin** navigation and **Add Asset**.

---

## Step 4 — Explore the UI

| Page | Nav label | What it does |
|------|-----------|--------------|
| **Search** | Search | Find assets, KPI cards, bulk actions |
| **Reports** | Reports | Filtered lists and CSV export |
| **Requests** | Requests | Open asset support requests |
| **Activity** | Activity | Global audit log |
| **Import** | Import | CSV preview and commit (admin) |
| **Admin** | Admin | Backups, master data, field settings (admin) |

### Search page basics

1. Type a serial, asset tag, or keyword in the search box → **Search**
2. Click a **category card** (GPU, DPU, Server, …) to filter
3. Click an asset row to open the **detail sheet**
4. Select checkboxes to enable **bulk actions** in the toolbar

---

## Step 5 — Your first write (checkout)

Follow the detailed walkthrough: **[First checkout tutorial](tutorials/first-checkout.md)**.

Short version:

1. Open an asset in **Ready to Deploy** status
2. Click **Check Out**
3. Set status **In Use**, pick owner and location, enter a **reason**
4. Submit → asset moves to In Use with a checkout record in History

---

## Configuration

### Store data outside the repo

```powershell
$env:DATA_DIR = "D:\inventory-pilot\data"
$env:NODE_ENV = "production"
$env:SEED_MODE = "0"
node server.js
```

### Production pilot flags

| Variable | Value | Why |
|----------|-------|-----|
| `NODE_ENV` | `production` | Disables synthetic dev seed |
| `SEED_MODE` | `0` | Explicit no-seed |
| `DATA_DIR` | dedicated path | Keeps DB out of git workspace |

---

## Verify installation

### Health endpoints

```powershell
curl http://127.0.0.1:3003/api/v3/health
curl http://127.0.0.1:3003/api/v3/ready
```

Healthy response includes `"ok": true` and a `schemaVersion`.

### Automated tests

```powershell
node --test test/hardening.test.js test/stress.test.js
```

All tests should pass before go-live.

---

## Next steps

| Goal | Tutorial |
|------|----------|
| Check out and return equipment | [First checkout](tutorials/first-checkout.md) |
| Update many assets at once | [Bulk operations](tutorials/bulk-operations.md) |
| Migrate from Colossus / workbook | [CSV import](tutorials/csv-import.md) |
| Backups and master data | [Admin & backups](tutorials/admin-backups.md) |

Questions → [FAQ](faq.md)  
Problems → [Troubleshooting](troubleshooting.md)
