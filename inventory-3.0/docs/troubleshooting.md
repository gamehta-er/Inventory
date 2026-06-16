# Troubleshooting

Symptoms, causes, and fixes for common Inventory 3.0 issues.

---

## Quick diagnostics

Run these first:

```powershell
# Server running?
curl http://127.0.0.1:3003/api/v3/health

# Database ready?
curl http://127.0.0.1:3003/api/v3/ready

# Logs
type data\logs\app.log
```

| Check | Good | Bad |
|-------|------|-----|
| `/health` | `{"ok":true}` | Connection refused → server not started |
| `/ready` | `schemaVersion` present | 503 → DB corrupt or migration failed |
| `app.log` | Few entries | Repeated errors → see sections below |

---

## Server won't start

### `node` is not recognized

**Cause:** Node.js not on PATH.

**Fix:**

1. Install [Node.js LTS](https://nodejs.org/) 22+, or
2. Use `start-local.cmd` (Codex runtime fallback), or
3. Call node with full path:

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
```

### Port already in use

**Symptom:** `EADDRINUSE` on port 3003.

**Fix:**

```powershell
$env:PORT = "3004"
node server.js
```

Or stop the other process using port 3003.

### Experimental SQLite warning

**Symptom:** `(node) ExperimentalWarning: SQLite is an experimental feature`

**Impact:** Informational on Node 22+. Tests and app still run. Safe to ignore for pilot.

---

## Authentication

### 401 Authentication required

**Cause:** Session cookie missing or expired.

**Fix:**

1. Sign in again at `/`
2. Ensure cookies enabled for `127.0.0.1`
3. If server restarted, all sessions are invalidated — re-login

### 403 Admin access required

**Cause:** Regular User attempted admin action (import, backup, add asset).

**Fix:** Sign out → sign in as **Admin User** (honor system — pick admin role responsibly).

---

## Asset writes

### Revision conflict (409)

**Symptom:** Toast or API error: revision required / stale / conflict.

**Cause:** Asset changed after you opened the form (another user, another tab, or bulk action).

**Fix:**

1. Close detail sheet or bulk modal
2. Click **Refresh** or re-run search
3. Re-open asset and retry with fresh revision

Bulk actions: use **Refresh preview** or clear selection and re-select.

### FOREIGN KEY constraint failed

**Symptom:** HTTP 500 or 400 on edit/checkout with FK message.

**Common cause:** Empty owner field sent as `""` instead of null.

**Fix:** Applied in current code — clear owner using "Unassigned" / empty dropdown. **Update to latest code** if you see this on old builds.

### Asset status is not deployable

**Symptom:** Checkout blocked.

**Cause:** Asset is Broken, Archived, E-Wasted, or otherwise non-deployable.

**Fix:** Change status via **Status Change** (with reason) to Ready to Deploy or Idle first, or pick a different asset.

### Missing required fields

**Symptom:** HTTP 400 with `errors` object.

**Fix:** Read the field keys in the error JSON. Common: `reason`, `locationId`, `ownerId` (checkout), `model`, `assetTag` (create).

---

## Import issues

### Import has validation errors

**Cause:** Preview recorded blocking issues; commit rejected.

**Fix:**

1. Re-read issue list in preview panel
2. Fix CSV (duplicates, missing category, invalid status)
3. Preview again → commit only when clean

### Column not recognized (assetTag → empty)

**Cause:** Old builds didn't split camelCase headers.

**Fix:** Update to latest code, or rename header to `Asset Tag` or `asset tag`.

### 16 values for 17 columns (HTTP 500 on import commit)

**Cause:** SQL INSERT bug in older builds (missing `extra_json` placeholder).

**Fix:** Update `src/domain/imports.js` and `src/domain/assets.js` to latest.

---

## Bulk actions

### No eligible assets selected

**Cause:** All selected assets are archived, not found, or have revision conflicts.

**Fix:** Check preview **Ineligible** and **Conflicts** sections.

### Bulk checkout — owner required

**Cause:** Checkout bulk requires assignee.

**Fix:** Select owner in bulk form before commit.

---

## Print labels

### Print dialog shows full page chrome

**Fix:** Use browser print preview. `print.css` hides navigation — ensure **Background graphics** enabled if labels look wrong.

### Labels blank

**Cause:** Asset missing model or tag data.

**Fix:** Verify asset has `assetTag` and model name in detail sheet.

---

## Backup issues

### Backup button does nothing / 403

**Cause:** Not signed in as Admin.

**Fix:** Admin login required.

### Restore failed — confirmation

**Symptom:** `Type RESTORE <filename> to confirm`

**Fix:** Enter exact phrase including backup id/filename shown in prompt.

### Restore failed — file not found

**Cause:** Backup moved or `DATA_DIR` changed.

**Fix:** Verify `{DATA_DIR}/backups/` contains the file. Use same `DATA_DIR` as when backup was created.

See [ROLLBACK.md](ROLLBACK.md) for full restore procedure.

---

## Performance

### SQLITE_BUSY / slow writes

**Cause:** Multiple simultaneous writes on SQLite.

**Fix:**

- Serialize bulk commits
- Keep concurrent users to pilot limit (~4)
- Ensure WAL mode (default on startup)

### Search slow with large dataset

**Fix:** Use specific filters (category, asset tag) instead of blank search. Indexing improvements are post-pilot.

---

## UI issues

### Stale data banner

**Symptom:** "Data updated" banner after idle.

**Cause:** Another user changed data; `GET /api/v3/revision` detected drift.

**Fix:** Click **Refresh**.

### Add Asset button missing

**Cause:** Signed in as Regular User.

**Fix:** Admin role required.

### JavaScript errors in console

**Fix:**

1. Hard refresh (Ctrl+Shift+R)
2. Confirm server serving latest `public/js/*`
3. Check network tab for failed API calls → fix auth or 500 root cause

---

## Test failures

### Server start timeout in tests

**Cause:** Port 3101 in use or slow disk on Windows temp cleanup.

**Fix:**

```powershell
# Kill stray test servers
Get-Process node -ErrorAction SilentlyContinue

node --test test/hardening.test.js test/stress.test.js
```

### Windows temp dir cleanup warning

**Impact:** Harmless — WAL lock on temp DB after tests. Does not affect app data.

---

## Escalation checklist

When reporting a bug, include:

1. Steps to reproduce
2. Role (Regular / Admin)
3. API response body (Network tab)
4. Relevant lines from `data/logs/app.log`
5. Output of `/api/v3/ready`
6. `node --version`

---

## Related

- [FAQ](faq.md)
- [Go-live checklist](GO-LIVE-CHECKLIST.md)
- [Rollback](ROLLBACK.md)
