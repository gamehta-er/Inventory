# Inventory 3.0

Clean-sheet local inventory pilot for #imargulis-staff.

## Documentation

Full documentation (architecture, tutorials, FAQ, troubleshooting):

| Format | How to view |
|--------|-------------|
| **Markdown** | Start at [`docs/index.md`](docs/index.md) |
| **Local site** | `pip install -r requirements-docs.txt && mkdocs serve` → http://127.0.0.1:8000 |
| **GitLab Pages** | Published from CI to `/inventory-3.0/` when docs change |

### Doc sections

- [Overview](docs/index.md)
- [Architecture](docs/architecture.md)
- [Getting started](docs/getting-started.md)
- [Tutorials](docs/tutorials/first-checkout.md) — checkout, bulk, import, admin
- [FAQ](docs/faq.md)
- [Troubleshooting](docs/troubleshooting.md)
- [API overview](docs/api-overview.md)
- [Go-live checklist](docs/GO-LIVE-CHECKLIST.md)

## Run

From this directory:

```powershell
node server.js
```

Or double-click `start-local.cmd` (uses `node` from PATH, with a Codex runtime fallback).

Default URL:

```text
http://127.0.0.1:3003
```

Sign in with member + role (no password during multi-user pilot testing).

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `127.0.0.1` | HTTP bind address |
| `PORT` | `3003` | HTTP port |
| `DATA_DIR` | `./data` | Uploads, backups, logs, and default SQLite directory |
| `DB_PATH` | `{DATA_DIR}/inventory-3.db` | SQLite database file path |
| `NODE_ENV` | *(unset)* | Set `production` to disable synthetic seed |
| `SEED_MODE` | *(auto)* | Set `0` to disable synthetic seed on any environment |

Example — store data outside the repo:

```powershell
$env:DATA_DIR = "D:\inventory-pilot\data"
node server.js
```

## Tests

```powershell
node --test test/hardening.test.js test/stress.test.js
```

Stress suite runs **10 iterations** each of create, edit, checkout, bulk, import, backup, and reports.

## Operations

- SQLite runs in **WAL** mode with `busy_timeout=5000` (fine for 3–4 concurrent users; single writer).
- Logs: `data/logs/app.log` (errors, restore, blocked imports).
- Request body limit: 12 MB (`src/lib/http.js`).
- Nightly backup example (Task Scheduler): copy `data/inventory-3.db` to `data/backups/`.

## Reseed synthetic data

Dev seed runs once per empty database. To reload the synthetic roster and ~110 active assets:

```powershell
Remove-Item .\data\inventory-3.db* -ErrorAction SilentlyContinue
node server.js
```

Ensure `SEED_MODE` is not `0` and `NODE_ENV` is not `production`.

## Notes

- Uses SQLite with WAL, schema migrations, mandatory revision checks, and server-side auth.
- Seeds synthetic data in dev only (`SEED_MODE` / `NODE_ENV` gate). Production expects import-first setup.
- Uploads and SQLite data are stored under `data/` and ignored by git.
- No Bootstrap or frontend framework dependency is used.
