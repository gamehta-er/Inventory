# Go-Live Gate Register

Status values are `NOT RUN`, `FAILED`, `PASSED`, or `SIGNED OFF`. Automation may set `PASSED` only when reviewable evidence exists. Only the named accountable reviewer can set `SIGNED OFF` and must add their name and date.

## Automated Evidence Baseline

- Release candidate: `61fcecbc424ca36f59a74c84d9b36173f5873b9d`
- Required workflow: [inventory-production run 22](https://github.com/gamehta-er/Inventory/actions/runs/31869232185)
- Evidence bundle: [inventory-import-reliability-22](https://github.com/gamehta-er/Inventory/actions/runs/31869232185/artifacts/9242957657)
- Artifact digest: `sha256:7819d67ee60f6c4062fc74e751dc96bac26fa2d8f63d6120055f69b5b4610fe1`
- Automated results: 108 backend tests, 47 frontend tests, 4 PostgreSQL 18 integration tests, and 3 Chromium journeys passed.
- Browser duration: 21.3 seconds for the governed CSV, XLSX, and 1,000/1,001-row journeys together.
- The artifact expires on 2026-09-14. Preserve it with the test-server evidence package before that date.

| Gate | Requirement | Automated Evidence | Accountable Review | Status |
|---|---|---|---|---|
| G01 | UI and direct API cannot commit in `DISABLED` | Disabled UI screenshot and direct `423 IMPORT_COMMITS_DISABLED` response in run 22 | Engineering | PASSED |
| G02 | Golden CSV stages the expected inventory draft | Fixture hash and redacted one-row draft in artifact 22 | QA | PASSED |
| G03 | Equivalent XLSX stages the same draft and worksheet selection is explicit | Canonical equality test, source metadata, and worksheet screenshot | QA | PASSED |
| G04 | PostgreSQL dates round-trip as `YYYY-MM-DD` without mismatch | PostgreSQL 18 date test, commit readback, and mismatch report | Engineering | PASSED |
| G05 | 1,000 rows and 10 MB accepted; row 1,001 and oversized files rejected clearly | Source boundaries plus 1,000/1,001 browser evidence | QA | PASSED |
| G06 | Malformed CSV, encoding, duplicate headers/serials, null bytes, formulas, and hidden/extra worksheets are handled safely | 108-test backend report with inventory-shaped hazard cases | QA | PASSED |
| G07 | Every draft mutation changes revision/hash and invalidates prior approvals | PostgreSQL contract plus browser correction resetting approval progress from 1 to 0 | Engineering | PASSED |
| G08 | Two distinct Privileged Administrators approve; importer excluded; decline reason required | Immutable three-decision ledger with two current acceptances; database rejection cases | Data Owner | PASSED |
| G09 | Stale commits and duplicate/concurrent retries cannot write twice | Exact-revision checks, concurrent same-key requests, idempotent replays, and one result row | Engineering | PASSED |
| G10 | Forced mid-batch failure rolls back all inventory writes | PostgreSQL creates a real synthetic asset/model, forces failure, and reads back zero retained rows | Engineering | PASSED |
| G11 | Corrections survive revalidation, filtering, navigation, approval, commit, readback, API, search, and export | Correction screenshot, redacted browser JSON, database/API/search/export reconciliation | QA | PASSED |
| G12 | Analysis finishes within 60 seconds and commit within 120 seconds on the test server | CI timing precheck passed; `10.176.177.149` timing has not run | QA | NOT RUN |
| G13 | Required `inventory-production` GitHub check is green on the release commit | Run 22 and artifact digest above | Engineering | PASSED |
| G14 | Disposable-server canary and rollback rehearsal pass; first-five monitoring owner assigned | Deployment snapshot and runbook evidence | Product + Engineering + QA + Data Owner | NOT RUN |

## Reopening Sign-Off

| Role | Name | Decision | Date | Evidence/Notes |
|---|---|---|---|---|
| Product | Pending | Pending | Pending | |
| Engineering | Pending | Pending | Pending | |
| QA | Pending | Pending | Pending | |
| Data Owner | Pending | Pending | Pending | |

No row may be marked `SIGNED OFF` by automation. The final import mode remains `DISABLED` until G12 and G14 pass and all four roles approve.
