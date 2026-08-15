# Import Workflow

Inventory Project imports are persistent, profile-driven sessions. CSV and XLSX files are never committed immediately after upload.

## Safety mode

The API owns one global mode:

- **DISABLED** permits upload, source selection, mapping, correction, exclusion, preview, and review, but rejects every commit.
- **CANARY** permits a fully approved Privileged Administrator canary only.
- **ENABLED** permits the importer to commit a fully approved draft.

The server enforces this mode for direct API requests as well as the user interface. A persistence/readback mismatch rolls back the transaction and automatically returns the mode to `DISABLED`.

## Modes

- **Create Assets** creates new records. Existing serial numbers and populated asset tags are blocking duplicates.
- **Update Existing** matches exactly one asset by Serial #. It records the asset revision during validation and blocks commit if that record changes before commit.

In Update Existing mode, a mapped blank optional cell clears the current value. An optional field that is not mapped is left unchanged. Blank required cells always block.

## Session stages

1. Create a session and select its category/profile and mode.
2. Download the current template when needed.
3. Upload a CSV or XLSX file up to 1,000 inventory rows and 10 MB.
4. For CSV, confirm the detected delimiter/encoding only when ambiguous. For XLSX, choose one visible worksheet when the workbook has several. Formula cells are rejected; convert them to literal values first.
5. Review explicit column decisions only when needed. Labels, field keys, and configured aliases map automatically; ambiguous or unknown columns require a user decision.
6. Validate the complete batch.
7. Correct, exclude, restore, or bulk-correct staged rows without re-uploading. The row editor submits only fields changed during that edit, so a stale editor cannot erase corrections made elsewhere in the session.
8. Two distinct Privileged Administrators, excluding the importer, accept the exact revision and draft fingerprint. A decline requires a reason.
9. The importer manually commits all included rows in one PostgreSQL transaction when the safety mode permits it.

Sessions can be resumed. Upload, mapping, correction, inclusion, profile, and controlled-value changes increment the draft revision and invalidate all prior approvals. A profile or controlled-value change marks unfinished work for revalidation, and opening the session replaces obsolete validation results.

## Validation results

- **Valid**: ready to commit.
- **Warning**: allowed to commit, but the user should review it. Missing optional Location is a warning and imports without a location.
- **Blocking Error**: the row cannot commit, such as a required blank, invalid type, duplicate serial, duplicate populated asset tag, unknown required Owner, or unknown required Vendor.
- **Configuration Error**: the profile itself must be repaired, such as a controlled field without its lookup-list mapping.

Optional blank controlled fields do not produce lookup errors. Notes is optional free text and is never checked against a controlled list. NVBug, dates, whitespace, capitalization, and configured aliases are normalized during validation.

The approved eight required fields are NVBug, Date Received, Model #, Serial #, Product Name, Status, Owner, and Vendor. These fields remain required on every profile and cannot be made optional through profile administration.

Model-level values are shared by every asset using the same Model #. Validation fills a blank shared value from another row in the batch or from the existing model. Conflicting shared values block the affected rows and explain which value must be corrected before commit.

## Guided correction

Each issue identifies its source row and profile field. Unrecognized controlled values show the source value, closest approved values, and these actions when applicable:

- Use Approved Value
- Apply the same correction to every matching row
- Add As New Value, for authorized Super Users and Privileged Administrators and with a required reason
- Correct in the source file using the downloadable validation report
- Repair Profile for missing controlled-list configuration

Adding a controlled value writes activity and automatically revalidates matching rows.

## Commit guarantees

All included rows commit atomically. Under a database lock, the server rechecks the safety mode, importer, permissions, draft revision/hash, two exact approvals, and idempotency key. A database or revision conflict rolls back the entire batch. Before reporting success, the server compares every staged field with the stored asset using field-aware canonical values; any mismatch rolls back the entire batch, records redacted mismatch keys/types, and disables imports. Repeating a successful commit does not create duplicate assets. The completion view links directly to every created or updated asset, and the active UI refreshes inventory-dependent pages automatically.

## API

- `POST /api/v1/imports`
- `POST /api/v1/imports/:id/file`
- `PUT /api/v1/imports/:id/source-options`
- `PUT /api/v1/imports/:id/mappings`
- `POST /api/v1/imports/:id/validate`
- `PATCH /api/v1/imports/:id/rows/:rowId`
- `POST /api/v1/imports/:id/corrections/bulk`
- `POST /api/v1/imports/:id/lookups`
- `POST /api/v1/imports/:id/reviews`
- `POST /api/v1/imports/:id/reopen`
- `POST /api/v1/imports/:id/commit`
- `GET /api/v1/imports/control`
- `GET /api/v1/imports/:id/validation.csv`
- `GET /api/v1/profiles/:id/import-template.csv`
- `GET /api/v1/profiles/:id/import-template.xlsx`
