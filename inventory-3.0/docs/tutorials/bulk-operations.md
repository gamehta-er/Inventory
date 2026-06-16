# Tutorial: Bulk operations

Apply checkout, check-in, status change, or label printing to **multiple selected assets** in one action.

**Time:** ~5 minutes  
**Role required:** Regular User or Admin User

---

## When to use bulk actions

| Action | Use case |
|--------|----------|
| **Check Out** | Hand out several GPUs for the same project |
| **Check In** | Return a batch after an event |
| **Status Change** | Mark a group Idle or Archived |
| **Print Labels** | Generate label sheets for new imports |

---

## Step-by-step

### 1. Build your selection

1. Go to **Search** (optionally filter by category or status)
2. Check the box on each asset row
3. The toolbar shows **N selected**

### 2. Choose an action

Click one of:

- **Check Out**
- **Check In**
- **Status Change**
- **Print Labels**

A **bulk modal** opens with a preview panel.

### 3. Preview eligibility

The preview lists:

| Section | Meaning |
|---------|---------|
| **Eligible** | Assets that will be updated |
| **Ineligible** | Archived assets or wrong state |
| **Conflicts** | Stale revision — refresh and retry |

Click **Refresh preview** if you edited assets in another tab.

### 4. Fill the form (non-print actions)

| Field | Checkout | Check-in | Status change |
|-------|----------|----------|---------------|
| Status | Required (In Use) | Required | Required |
| Owner | **Required** | Optional | Optional |
| Location | Required | Required | Required |
| Reason | **Required** | **Required** | **Required** |

### 5. Commit

Click **Apply to N assets**. On success:

- Modal closes
- Toast confirms bulk action
- **Activity** log shows one parent entry with all asset tags

### 6. Print labels (special case)

1. Select assets → **Print Labels**
2. Preview shows label cards in the modal
3. Click **Print** — browser print dialog opens
4. Use `@media print` layout (labels only, no chrome)

For a **single** asset, bulk print opens the single-asset print modal instead.

---

## Revision safety

Bulk commit sends `expectedRevisions` per asset. If any asset changed since selection:

- Preview shows **Conflicts**
- Commit is blocked with HTTP 409

**Fix:** Click **Clear** selection, refresh search, re-select assets.

---

## Activity log

Bulk actions create:

1. One **parent** `bulk-action` entry (summary lists all tags)
2. Per-asset child entries (check-out, check-in, etc.)

Filter **Activity** by source `bulk` to audit batch operations.

---

## Next tutorial

→ [CSV import](csv-import.md)
