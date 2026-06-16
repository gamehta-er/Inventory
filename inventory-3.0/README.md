# Inventory 3.0

Clean-sheet local inventory pilot for #imargulis-staff.

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

Default pilot password: `pilot` (override with `PILOT_PASSWORD`).

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `127.0.0.1` | HTTP bind address |
| `PORT` | `3003` | HTTP port |
| `DATA_DIR` | `./data` | Uploads, backups, logs, and default SQLite directory |
| `DB_PATH` | `{DATA_DIR}/inventory-3.db` | SQLite database file path |
| `NODE_ENV` | *(unset)* | Set `production` to disable synthetic seed |
| `SEED_MODE` | *(auto)* | Set `0` to disable synthetic seed on any environment |
| `PILOT_PASSWORD` | `pilot` | Shared password for pilot login |

Example — store data outside the repo:

```powershell
$env:DATA_DIR = "D:\inventory-pilot\data"
$env:PILOT_PASSWORD = "change-me"
node server.js
```

## Tests

```powershell
node --test test/hardening.test.js
```

## Operations

- SQLite runs in **WAL** mode with `busy_timeout=5000` (fine for 3–4 concurrent users; single writer).
- Logs: `data/logs/app.log` (errors, restore, blocked imports).
- Request body limit: 12 MB (`src/lib/http.js`).
- Nightly backup example (Task Scheduler): copy `data/inventory-3.db` to `data/backups/`.

## Go-live docs

- `docs/HARDENING-RULES.md` — change rules
- `docs/GO-LIVE-CHECKLIST.md` — 25 manual smoke steps
- `docs/ROLLBACK.md` — backup and restore
- `docs/COLOSSUS-FIELD-MAP.md` — import column mapping

## Notes

- Uses SQLite with WAL, schema migrations, mandatory revision checks, and server-side auth.
- Seeds synthetic data in dev only (`SEED_MODE` / `NODE_ENV` gate). Production expects import-first setup.
- Uploads and SQLite data are stored under `data/` and ignored by git.
- No Bootstrap or frontend framework dependency is used.
