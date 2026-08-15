# DCR-2026-006 Governed Import Reliability

## Request control

| Item | Value |
|---|---|
| Request ID | DCR-2026-006 |
| Requestor | Gaurav Mehta |
| Date | 2026-08-14 |
| Product baseline | Implementation candidate 1.4.0 |
| Design System baseline | 1.1 |
| Status | APPROVED |

## Business reason

Regional inventory imports currently provide no dependable distinction between source preparation,
administrator review, and a permanent inventory write. Users need a compact workflow that accepts
CSV and Excel, asks only for unresolved source choices, shows a concise before/after review, and
prevents a single person or stale draft from entering incorrect inventory data.

## Approved system change

- Keep the approved application shell, typography, spacing, status language, controls, surfaces,
  tokens, and breakpoints from Design System 1.1.
- Add a persistent Import Commit Control banner that clearly identifies `DISABLED`, `CANARY`, or
  `ENABLED` without hiding source-preparation actions.
- Replace CSV-only source language with one file picker for CSV and XLSX, a 1,000-row/10-MB limit,
  and a source-choice panel for ambiguous CSV settings or multi-sheet Excel workbooks.
- Show source format, worksheet, size, draft revision, and protected fingerprint in the active session.
- Present the review summary, warnings, excluded rows, create/update counts, changed fields, and an
  append-only administrator decision ledger in one bounded approval section.
- Allow a non-importing Privileged Administrator to accept or decline the exact revision. Require a
  decline reason and keep draft editing read-only for reviewers.
- Keep the importer commit action visible but disabled until two approvals and the server safety mode
  permit it; explain the missing condition beside the action.
- Add a compact Admin control using the existing segmented-control, required-reason, confirmation,
  and status patterns for changing the server import mode.

## Responsive and accessibility impact

- The file picker remains a native labeled input with keyboard and assistive-technology support.
- Administrator decisions use explicit text and icon commands; unfamiliar states include plain labels.
- Review metadata and actions stack at existing 900px and 680px breakpoints without adding a new
  breakpoint or allowing text/control overlap.
- Existing focus, reduced-motion, overlay, button, status, error, and responsive contracts remain
  authoritative.

## Framework impact

React presents source decisions, protected draft metadata, review progress, and import-control state.
Fastify and PostgreSQL remain authoritative for source parsing, validation, permissions, revision/hash
integrity, immutable reviews, safety mode, commit locking, verification, and telemetry. IIS remains the
host. No additional stylesheet, shell, token, breakpoint, or hosting system is introduced.

## Release impact

| Area | Impact |
|---|---|
| Database | Migration 009 adds import control, source metadata, draft integrity, reviews, and events |
| API | Adds source-options, review, reopen, control, and governed commit contracts |
| Permissions | Adds `import.review` only to Privileged Administrator |
| UI | Adds CSV/XLSX source choice, review ledger, commit lock, and Admin import mode control |
| Deployment | API, web, database, and operations delta; test server starts `DISABLED` |
| Rollback | Restore components and database snapshot; import mode remains `DISABLED` |

## Evidence

- Backend and frontend TypeScript checks pass.
- Backend unit tests cover canonical CSV/XLSX parsing, formula rejection, row boundaries, typed date
  comparison, transaction rollback, and database contract changes.
- Frontend tests cover disabled commits, exact revision/hash submission, and independent review.
- Release remains conditional on PostgreSQL 18 integration, Playwright CSV/XLSX journeys, design lock,
  conformance, test-server canary, and Product/Engineering/QA/Data Owner sign-offs.

## Decision

| Item | Value |
|---|---|
| Decision | APPROVED |
| Approved by | Gaurav Mehta |
| Decision date | 2026-08-14 |
| Conditions | Preserve Design System 1.1; import commits remain disabled until the reliability gate and organizational sign-offs complete. |
