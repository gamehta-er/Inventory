# Tutorial: Admin operations and backups

Admin-only tasks: add assets, master data, backups, restore, and field settings.

**Time:** ~15 minutes  
**Role required:** **Admin User**

---

## Add a single asset (UI)

1. **Search** → **Add Asset** (admin button)
2. Pick category, fill model, serial, asset tag, location
3. Enter a **reason** (required)
4. **Save New Row**

Or from Admin page if configured — Search Add Asset is the primary path.

---

## Master data

### Locations

**Admin** → Locations section → add building/room entries.

API: `POST /api/v3/locations` with `{ "name": "Building R — Lab 12" }`

### Team members

**Admin** → Members → add name and email.

Imported owners resolve against this table during CSV import.

### Asset models

Create catalog models before bulk tagging, or let import auto-create models from the `model` column.

---

## Backups

### Create a backup

1. Go to **Admin**
2. Click **Create backup**
3. Toast shows backup folder path
4. File appears in `{DATA_DIR}/backups/`

Backups are full SQLite file copies with timestamped names.

### Download

Use the download link in the backup list (admin only).

---

## Restore (destructive)

!!! danger
    Restore **replaces the entire database**. All users should stop editing before restore.

1. **Admin** → Backups
2. Click **Restore** on the target backup
3. Type exactly: `RESTORE <backup-filename>` when prompted
4. Server replaces DB and logs `restore` in activity

Full procedure: [Rollback guide](../ROLLBACK.md)

---

## Category field settings

Admins can adjust which extra fields appear per category:

1. **Admin** → Category fields
2. Toggle required flags or options
3. Changes affect Add Asset and import validation

---

## Model images

Upload a reference photo for a model (Admin):

1. Find model in admin catalog
2. Upload image → stored under `{DATA_DIR}/uploads/`
3. Image appears on asset detail when model matches

---

## Pre-go-live checklist

Before opening to the full team, complete all steps in [Go-live checklist](../GO-LIVE-CHECKLIST.md).

---

## Related

- [Architecture — file layout](../architecture.md#file-storage-layout)
- [Troubleshooting — backup failures](../troubleshooting.md#backup-issues)
