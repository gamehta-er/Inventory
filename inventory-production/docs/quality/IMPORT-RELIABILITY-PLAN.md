# Import Reliability and Controlled Reopening

## Purpose

Inventory imports must never report success unless the same values can be read back from PostgreSQL, the API, search, and export. The workflow also protects regional inventory data from a single-person mistake by requiring two independent Privileged Administrators to review the exact draft before the importer commits it.

## Safety Baseline

- The server owns a global import mode: `DISABLED`, `CANARY`, or `ENABLED`.
- Upload, source selection, mapping, correction, exclusion, and preview remain available while commits are disabled.
- Every upload and draft change produces a new revision and SHA-256 draft fingerprint.
- Reviews are append-only and apply only to one revision and fingerprint.
- The importer cannot review their own draft.
- Two distinct Privileged Administrators must accept before the importer can manually commit.
- A decline requires a reason; any draft change invalidates prior decisions.
- The server rechecks mode, ownership, permissions, revision, fingerprint, approvals, and idempotency under a database lock.
- Any persistence/readback mismatch rolls back and automatically returns imports to `DISABLED`.
- Each file is limited to 1,000 inventory rows and 10 MB.

## Delivery Phases

### 1. Contain and Preserve

Start `10.176.177.149` with commits `DISABLED`. Preserve the failed source hash, import session responses, redacted mismatch evidence, database snapshot, application release, and configuration before resetting or deploying.

Exit: the UI and direct API both reject commits while disabled.

### 2. Canonical Import Engine

Use one parsed-source model for CSV and XLSX. Detect supported CSV encodings and delimiters, ask the user to select an XLSX worksheet when needed, reject formulas, and treat PostgreSQL `DATE` values as canonical `YYYY-MM-DD` strings.

Exit: equivalent golden CSV/XLSX files create identical drafts and PostgreSQL round trips without differences.

### 3. Draft Integrity and Governance

Bind review decisions to the current draft revision and fingerprint. Present a concise before/after summary, warnings, excluded rows, created records, update differences, and approval progress. Commit remains a separate importer action after two approvals.

Exit: self-review, stale review, duplicate review, mutation of evidence, and unapproved commit are rejected by the server and database.

### 4. GitHub Reliability Gate

The `inventory-production` workflow uses Node.js 24 and PostgreSQL 18. It runs all migrations, the database contract, type checks, unit tests, the production build, real-database integration tests, and Playwright CSV/XLSX journeys.

Exit: the workflow passes and retains fixture hashes, screenshots, redacted import summaries, mismatch evidence, timings, and reconciliation results.

### 5. Harden and Canary

Exercise malformed data, encoding, duplicate headers and serials, null bytes, formulas, multiple worksheets, stale revisions, concurrent reviews, retry idempotency, rollback, correction retention, 1,000/1,001 rows, and timing ceilings. Reset the disposable test server, enter maintenance, seed only synthetic data, deploy with imports disabled, then run one approved canary and rollback rehearsal.

Exit: G01-G14 have reviewable evidence and named sign-offs.

### 6. Controlled Reopening

Product, Engineering, QA, and the Data Owner approve reopening. Monitor the first five governed batches. A persistence mismatch rolls back and automatically disables imports. Re-upload required data as a new governed session; never reuse the failed draft.

## Current Position

The application controls and automated test harness are implemented in release `1.4.0`. Local unit, interaction, type, and canonical-source tests have passed. Real PostgreSQL 18, Playwright, deployment, canary, and organizational sign-offs remain evidence-driven gates and must not be inferred from implementation status.
