# DCR-2026-007 Simple Import Workflow

## Request control

| Item | Value |
|---|---|
| Request ID | DCR-2026-007 |
| Requestor | Gaurav Mehta |
| Date | 2026-08-17 |
| Product baseline | Implementation candidate 1.4.1 |
| Design System baseline | 1.1 |
| Status | APPROVED |

## Business reason

The two-administrator import workflow made a routine manual inventory task too slow and confusing.
Operators need a familiar, direct experience: upload a file, check the preview, fix highlighted rows,
import, and see the result. Reliability controls should protect the data without becoming extra work.

## Approved system change

- Keep the approved application shell, controls, spacing, colors, and responsive breakpoints.
- Present three visible stages: Upload, Preview & fix, and Results.
- Automatically match known CSV and XLSX columns and ask only for unresolved source or column choices.
- Allow the importer to correct, exclude, restore, or bulk-correct rows in the preview.
- Remove administrator approval, review-ledger, revision, and fingerprint controls from the user journey.
- Enable the Import action when the preview has included rows and no blocking errors.
- Show a concise success result with links to imported assets and an Import another file action.
- Keep the emergency import switch visible only when imports are unavailable or limited.

## Reliability retained behind the interface

- The API still checks the authenticated importer, permission, current draft revision and hash,
  idempotency key, and emergency import mode under a PostgreSQL lock.
- Every included row saves in one transaction. Any database error rolls back the entire import.
- Every stored field is read back and compared using field-aware canonical values, including dates.
- A persistence mismatch rolls back, records redacted evidence, and automatically disables imports.

## Release impact

| Area | Impact |
|---|---|
| Database | Migration 010 enables direct imports and converts clean reviewed drafts to Ready |
| API | Clean validation ends in Ready; commit no longer queries or requires reviews |
| Permissions | Removes active role assignment for the legacy `import.review` permission |
| UI | Replaces approval controls with Upload, Preview & fix, Results |
| Deployment | API, web, database, and operations delta from 1.4.0 to 1.4.1 |
| Rollback | Restore 1.4.0 components; set the emergency import mode to Disabled |

## Decision

| Item | Value |
|---|---|
| Decision | APPROVED |
| Approved by | Gaurav Mehta |
| Decision date | 2026-08-17 |
| Conditions | Preserve atomic storage verification, rollback, idempotency, and the emergency import switch. |
