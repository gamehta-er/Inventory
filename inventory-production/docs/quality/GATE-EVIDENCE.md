# Go-Live Gate Register

Status values are `NOT RUN`, `FAILED`, `PASSED`, or `SIGNED OFF`. `PASSED` requires attached evidence; `SIGNED OFF` also requires the named accountable reviewer and date.

| Gate | Requirement | Automated Evidence | Accountable Review | Status |
|---|---|---|---|---|
| G01 | UI and direct API cannot commit in `DISABLED` | Browser screenshot, API response, control snapshot | Engineering | NOT RUN |
| G02 | Golden CSV stages the expected inventory draft | Fixture hash, redacted draft summary | QA | NOT RUN |
| G03 | Equivalent XLSX stages the same draft and worksheet selection is explicit | Fixture hash, source metadata, screenshot | QA | NOT RUN |
| G04 | PostgreSQL dates round-trip as `YYYY-MM-DD` without mismatch | Database integration result, mismatch report | Engineering | NOT RUN |
| G05 | 1,000 rows and 10 MB accepted; row 1,001 and oversized files rejected clearly | Boundary result and timing | QA | NOT RUN |
| G06 | Malformed CSV, encoding, duplicate headers/serials, null bytes, formulas, and hidden/extra worksheets are handled safely | Unit/integration report | QA | NOT RUN |
| G07 | Every draft mutation changes revision/hash and invalidates prior approvals | API/database integration report | Engineering | NOT RUN |
| G08 | Two distinct Privileged Administrators approve; importer excluded; decline reason required | Immutable review ledger evidence | Data Owner | NOT RUN |
| G09 | Stale commits and duplicate/concurrent retries cannot write twice | Integration result and reconciliation | Engineering | NOT RUN |
| G10 | Forced mid-batch failure rolls back all inventory writes | PostgreSQL rollback result | Engineering | NOT RUN |
| G11 | Corrections survive revalidation, filtering, navigation, approval, commit, readback, API, search, and export | Browser journey and reconciliation | QA | NOT RUN |
| G12 | Analysis finishes within 60 seconds and commit within 120 seconds on the test server | Stage timing evidence | QA | NOT RUN |
| G13 | Required `inventory-production` GitHub check is green on the release commit | Workflow URL and artifact | Engineering | NOT RUN |
| G14 | Disposable-server canary and rollback rehearsal pass; first-five monitoring owner assigned | Deployment snapshot and runbook evidence | Product + Engineering + QA + Data Owner | NOT RUN |

## Reopening Sign-Off

| Role | Name | Decision | Date | Evidence/Notes |
|---|---|---|---|---|
| Product | Pending | Pending | Pending | |
| Engineering | Pending | Pending | Pending | |
| QA | Pending | Pending | Pending | |
| Data Owner | Pending | Pending | Pending | |

No row may be completed by automation. The final import mode remains `DISABLED` until all four roles approve.
