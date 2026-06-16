# Tutorial: First checkout and check-in

Learn the most common daily workflow — assigning an asset to someone and returning it to the pool.

**Time:** ~3 minutes  
**Role required:** Regular User or Admin User  
**Prerequisites:** [Getting started](../getting-started.md)

---

## Scenario

You need to assign GPU `STRESS-TAG-001` (or any **Ready to Deploy** asset) to a lab member for a test run.

---

## Part 1 — Check out

### 1. Find the asset

1. Go to **Search**
2. Enter the asset tag or serial in the search box
3. Click **Search** or press Enter
4. Click the asset row to open the detail sheet

### 2. Start checkout

1. In the detail sheet, click **Check Out**
2. A modal opens with the action form

### 3. Fill required fields

| Field | Value |
|-------|-------|
| **Status** | `In Use` (default for checkout) |
| **Owner / Assignee** | Select the person receiving the asset |
| **Location** | Where the asset will be used |
| **Reason** | Short note, e.g. `Perf lab run — project X` |
| **NVBug #** | Optional — link to tracking bug |

### 4. Submit

Click **Apply**. You should see:

- Toast: **Action saved**
- Asset status changes to **In Use**
- **History** tab shows a checkout activity entry

!!! tip
    Only assets in a **deployable** status (e.g. Ready to Deploy, Idle) can be checked out. Broken or Archived assets are blocked.

---

## Part 2 — Check in

When the asset returns to the lab pool:

### 1. Open the asset again

Search → click the asset (now **In Use**).

### 2. Check in

1. Click **Check In**
2. Set status to **Ready to Deploy** (or Idle)
3. Set **Location** to the storage location
4. Enter a **reason**, e.g. `Returned after test`
5. Submit

### 3. Verify History

Open the **History** tab. You should see:

- A **check-in** activity entry
- The checkout record marked closed

---

## Common mistakes

| Symptom | Fix |
|---------|-----|
| "Owner is required" | Pick an assignee on checkout |
| "Reason is required" | Fill the reason field — it is mandatory |
| "Asset status is not deployable" | Asset must be Ready to Deploy / Idle / similar — not Broken or Archived |
| "Revision conflict" | Another tab edited the asset — close sheet, refresh, try again |

See [Troubleshooting](../troubleshooting.md#revision-conflict-409) for revision errors.

---

## Next tutorial

→ [Bulk operations](bulk-operations.md) — update many assets at once
