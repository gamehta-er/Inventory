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
http://localhost:3003
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `127.0.0.1` | HTTP bind address |
| `PORT` | `3003` | HTTP port |
| `DATA_DIR` | `./data` | Uploads, backups, and default SQLite directory |
| `DB_PATH` | `{DATA_DIR}/inventory-3.db` | SQLite database file path |
| `NODE_ENV` | *(unset)* | Standard Node environment label (e.g. `production`) |

Example — store data outside the repo:

```powershell
$env:DATA_DIR = "D:\inventory-pilot\data"
node server.js
```

## Notes

- Uses SQLite with WAL, busy timeout, transactions, and asset revision checks.
- Seeds synthetic data only. It does not copy real workbook names, locations, or serial numbers.
- Uploads and SQLite data are stored under `data/` and ignored by git.
- No Bootstrap or frontend framework dependency is used.
