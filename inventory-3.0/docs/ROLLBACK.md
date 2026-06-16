# Rollback — Inventory 3.0

## Before go-live

1. Create a manual SQLite backup: Admin → **Create DB Backup**
2. Copy `data/inventory-3.db` and `data/backups/` to safe storage
3. Document current `schema_version` from server startup log

## Roll back application code

```powershell
git checkout <last-known-good-tag-or-commit>
cd inventory-3.0
node server.js
```

## Roll back database

1. Stop the server
2. Admin → select backup → **Restore**
3. Type exactly: `RESTORE inventory-3-backup-YYYYMMDD-HHMMSS.db`
4. Restart server and verify `/api/v3/ready`

A pre-restore safety copy is written to `data/backups/inventory-3-backup-prerestore-*.db`.

## Colossus fallback

If Inventory 3.0 is unavailable, continue operations in Colossus (`https://colossus-inv-mgmt.nvidia.com/`) until restore is complete. Re-import from Colossus export after rollback using `docs/COLOSSUS-FIELD-MAP.md`.
