# DCR-2026-008 Guided Import Corrections

## Request control

| Item | Value |
|---|---|
| Request ID | DCR-2026-008 |
| Requestor | Gaurav Mehta |
| Date | 2026-08-17 |
| Product baseline | Implementation candidate 1.4.2 |
| Design System baseline | 1.1 |
| Status | APPROVED |

## Business reason

Row exclusion makes a manual inventory import harder to understand and can hide incomplete source data.
Operators should be directed to the exact correction without searching the page, and validation and
submission controls should appear together at the end of the workflow.

## Approved system change

- Preserve the three visible stages: Upload, Preview & fix, and Results.
- Remove Excluded counts, filters, Exclude Row, and Restore Row from the active interface.
- Require every source row to be corrected before import; the API rejects row-exclusion requests.
- Restore skipped rows in unfinished drafts and require a complete revalidation.
- Automatically select Needs action and open the first blocking row after validation.
- Scroll to and focus the exact issue. When editing, mark its field invalid, display the error inline,
  and focus the input.
- After each correction, move to the next blocking issue until the preview is clean.
- Group Validate Changes, Validation Report, Cancel Session, and Import in one bottom action area.
- This request supersedes the exclude/restore allowance in DCR-2026-007 and IMPORT-013.

## Reliability retained

- The authenticated owner, preview revision/hash, idempotency key, and emergency import mode remain
  server-enforced under a PostgreSQL lock.
- All rows save in one transaction and are read back using field-aware canonical values.
- Any database, conflict, or persistence mismatch rolls back the complete import.

## Release impact

| Area | Impact |
|---|---|
| Database | Migration 011 restores skipped rows in open drafts and marks them for revalidation |
| API | Row update rejects exclusion and records corrections only |
| UI | Guided first-error focus, no exclusion controls, one bottom action area |
| Deployment | API, web, database, and operations delta from 1.4.1 to 1.4.2 |
| Rollback | Restore 1.4.1 components; migration 011 remains forward-only |

## Decision

| Item | Value |
|---|---|
| Decision | APPROVED |
| Approved by | Gaurav Mehta |
| Decision date | 2026-08-17 |
| Conditions | Preserve atomic storage, typed readback, rollback, idempotency, and the emergency import switch. |
