# Test Server Pre-Deployment Evidence

This checkpoint records the read-only state of the disposable test server before release 1.4.0. Sensitive database, source-row, API-response, and configuration evidence is retained only in the ignored local artifact bundle; it is not stored in Git.

## Server State

| Item | Recorded value |
|---|---|
| Server | `2u1g-x570-0413` (`10.176.177.149`) |
| Captured | 2026-08-14 22:01 PDT |
| Installed release | `1.3.16` |
| Database schema | `008-separate-lifecycle-from-categories` |
| Import contract | `005-complete-import-workflow` |
| Readiness | API ready; PostgreSQL reachable |
| Import safety endpoint | Not present in 1.3.16 (`404`) |

## Failed Import

| Item | Recorded value |
|---|---|
| Import session | `dd80a21c-7851-4b17-94c0-3746fd39af33` |
| Source file | `gpu_asset-v5-import.csv` |
| Source SHA-256 | `b49f77b6b4d414db2ef53065ed0ceb811a973b9971e263b68d76be1aafc1deee` |
| Session state | `NEEDS_REVALIDATION` |
| Rows | 2 total; 2 valid; 0 warnings; 0 invalid |
| Commit results | 0 |
| Preserved failure | Row 2 did not match staged values after storage; the complete import was rolled back. |

The old release did not retain the exact mismatch field keys or value types. That limitation is part of the defect evidence; release 1.4.0 adds redacted, field-level mismatch telemetry.

## Private Evidence Bundle

- Local ignored artifact: `inventory-production/artifacts/test-server-evidence/pre-1.4.0-20260815T045926Z.zip`
- Bundle SHA-256: `f5aae18c453a0b6cc32d5b4bb0301b5771783a644d0a981080722db27a985663`
- PostgreSQL dump SHA-256: `417abd96397688fcf9dc2b4e3f5ef78c64868b96fd69120edc99e9f1317857e6`
- Failed-session API response SHA-256: `8b3715b0d77329d292331966d12e0d47d4be8aea66865b31bb704fec11ce45cb`
- Manifest verification: 66 evidence files; 0 missing, size, or hash failures.

The bundle contains a PostgreSQL custom-format dump, deployment metadata, private runtime configuration, release and service logs, full failed-session database evidence, a redacted session summary, and the authenticated read-only API response.

## Disposition

Release 1.4.0 may be deployed only with import commits `DISABLED`. This checkpoint does not satisfy the test-server timing gate, canary and rollback rehearsal, first-five monitoring assignment, or Product, Engineering, QA, and Data Owner sign-off.
