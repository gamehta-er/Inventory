# Inventory Project Support

## First response

1. Run `Operations\Status-Inventory.ps1` as Administrator.
2. If readiness fails, run `Operations\Show-InventoryLogs.ps1`.
3. A Privileged Administrator enables maintenance from **Admin > Health > Enable maintenance** before disruptive repair. A reason and confirmation are required.
4. Restart only with `Operations\Restart-Inventory.ps1`; it stops IIS traffic before gracefully stopping the API.

## Service order

PostgreSQL must be running before the Inventory Project API. IIS is started last. The API Windows service declares its PostgreSQL service dependency and automatically restarts after transient failures.

## Health endpoints

- `/api/v1/health/live`: API process is running.
- `/api/v1/health/ready`: API can use the required PostgreSQL schema.

## Maintenance mode

- **Normal control:** Privileged Administrators use **Admin > Health** to enable maintenance or resume service. The change is recorded in Activity with the operator, reason, time, and before/after state.
- **Recovery access:** The maintenance page links to **Privileged Administrator access**, so an administrator can sign in and resume service without using the server console.
- **Emergency console control:** `Operations\Maintenance-On.ps1 -Reason "..."` and `Operations\Maintenance-Off.ps1 -Reason "..."` use the same state file and record the operation in `operations.jsonl`.
- **Updates:** The delta updater may enable maintenance only while switching affected components. It restores the exact state that existed before the update; it cannot silently disable administrator-requested maintenance.
- **Visibility:** `Operations\Status-Inventory.ps1` reports whether maintenance is active, who enabled it, and the recorded reason.

## Logs

- `Logs\Service`: Windows service output and errors.
- `Logs\Operations\operations.jsonl`: support actions with operator and timestamp.
- `Logs\Releases\release-ledger.jsonl`: compact release result, operator, package hash, components, migrations, and health checks.

The Activity page is the business audit ledger. Service logs are for operational diagnostics and do not replace activity records.

## Import support

1. Confirm the Import Control in Admin. Set it to `DISABLED` only during an active investigation or repair.
2. Open the saved import session; unfinished legacy sessions are marked `NEEDS_REVALIDATION` against the current profile and controlled values.
3. Confirm the CSV delimiter/encoding or XLSX worksheet when the source requires a choice.
4. Review column decisions before row validation. Duplicate headers, duplicate field mappings, and unmapped required fields must be resolved there.
5. The first blocked row opens automatically. Correct the highlighted field, select an approved value, bulk-correct matching rows, or add an authorized controlled value with a reason. Rows cannot be skipped.
6. Configuration errors link to the affected Admin profile field. Fix the mapping, then return to the session and revalidate.
7. Download the validation report when issues need to be corrected in the source file.
8. Use **Validate Changes** and **Import** from the bottom action area. No administrator approval is required.
9. A retry of the same successful import is idempotent. After `VERIFICATION_FAILED`, preserve the evidence and upload the required data into a fresh session; do not reuse the failed draft.

Completed sessions contain direct links to created or updated assets. Import commits also refresh Search, Inventory, Reports, Activity, history, and category totals in the active browser session.

## Routine updates

Routine releases are delta packages. Run only `Operations\Invoke-InventoryUpdate.ps1`; do not use the full baseline installer. The updater validates the installed version and all affected files before switching components. A frontend-only update does not restart the API or PostgreSQL.

The previous component is retained only inside the active update workspace while health checks run. It is restored automatically on failure and deleted immediately after success. No persistent application or database backup is created.

Use `Operations\Remove-InventoryUpdateCache.ps1` to remove extracted Inventory packages, successfully applied update ZIPs, and abandoned update workspaces. The cleanup command cannot target the live application, PostgreSQL data, uploads, configuration, activity data, IIS, or Windows services.
