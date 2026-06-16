# Tutorial: CSV import

Migrate assets from Colossus exports or workbook spreadsheets into Inventory 3.0 with validation before commit.

**Time:** ~10 minutes  
**Role required:** **Admin User**

---

## Before you start

1. Read the [Colossus field map](../COLOSSUS-FIELD-MAP.md)
2. Use **one import profile per batch** — do not mix GPUs and locations in one file
3. Run a **preview** first — commit only when `canCommit` is true

---

## Supported import profiles

| Profile ID | Purpose | Key columns |
|------------|---------|-------------|
| `assets-gpu` | GPU assets | category, model, serial, assetTag, status, location |
| `assets-dpu` | DPU assets | + openPartNo (required) |
| `assets-server` | Servers | category-specific extras |
| `locations` | Master locations | location |
| `users-owners` | Team members | name, email |

Profile list is defined in `src/config/constants.js` → `IMPORT_PROFILES`.

---

## Step 1 — Prepare your CSV

### Minimal GPU example

```csv
category,model,serial,assetTag,status,location
GPU,RTX Pro 6000,SN-12345,INV3-GPU-001,Ready to Deploy,Building R — Lab 12
GPU,H100 SXM,SN-67890,INV3-GPU-002,Idle,Building S — Cage 3
```

### Header tips

| Header in file | Recognized as |
|----------------|---------------|
| `assetTag` | assetTag (camelCase supported) |
| `Asset Tag` | assetTag |
| `Serial No.` | serial |
| `Owner` | owner → resolved to team member |

Duplicate **assetTag** or **serial** values in the same file are blocked at preview.

---

## Step 2 — Preview

1. Go to **Import**
2. Select profile **Assets — GPU** (or matching category)
3. Upload the file or paste CSV text
4. Click **Preview import**

Review the preview panel:

| Indicator | Meaning |
|-----------|---------|
| Green / no errors | Ready to commit |
| Red issues | Fix CSV and re-preview |
| Sample rows | First 8 parsed rows |
| Mapped columns | How headers were interpreted |

---

## Step 3 — Commit

When preview shows no blocking errors:

1. Click **Commit import**
2. Wait for success toast
3. Search for imported asset tags to verify

Each imported asset gets an `import-commit` activity entry.

---

## Step 4 — Verify

```powershell
# Optional API check
curl -b cookies.txt http://127.0.0.1:3003/api/v3/search?q=INV3-GPU
```

Or use **Search** in the UI.

---

## Idempotency

- Committing the **same batch twice** is rejected (`Import was already committed`)
- Re-importing the same asset tag **skips** existing rows (no duplicate insert)

To update existing assets, use **Edit** in the UI or a future update-import profile — not a second create import.

---

## Troubleshooting imports

| Error | Cause | Fix |
|-------|-------|-----|
| `Import has validation errors` | Preview had errors | Re-preview after CSV fix |
| `Category is required` | Missing/unknown category | Use exact category name (GPU, DPU, …) |
| `Duplicate asset tag in file` | Two rows same tag | Deduplicate CSV |
| Column not mapped | Wrong header | Use [field map](../COLOSSUS-FIELD-MAP.md) |

---

## Next tutorial

→ [Admin & backups](admin-backups.md)
