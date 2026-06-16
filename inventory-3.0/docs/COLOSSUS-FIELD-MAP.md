# Colossus → Inventory 3.0 Field Map

Use these columns when building CSV imports for migration from Colossus / workbook exports.

| Colossus / workbook column | Import field key | Notes |
|---------------------------|------------------|-------|
| Category | `category` | Must match a supported category name |
| Model / Item Name | `model` | Required for asset profiles |
| Serial No. | `serial` | Duplicate-checked on commit |
| Asset Tag | `assetTag` | Duplicate-checked on commit |
| Status | `status` | Must match a `status_labels` name |
| Owner / Assignee | `owner` or `name` | Resolved to `team_members` |
| Location | `location` | Resolved to `locations` |
| Usage | `usage` | Optional |
| NVBug # | `nvbug` | Optional |
| Borrowed/Lent | `borrowedLent` | Optional |
| Notes | `notes` | Optional |
| Open Part No. | `openPartNo` | Required for DPU profile |
| Quantity | `quantity` | Low-price consumables profile |

## Import profiles

- **Assets** — use category-specific profiles (`assets-gpu`, `assets-dpu`, etc.)
- **Locations** — `locations` profile (`location` column only)
- **Members** — `users-owners` profile (`name`, `email`)

Do not mix entity types in one import batch.
