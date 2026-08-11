# Import Workflow

Inventory Project imports are persistent, profile-driven sessions. A CSV is never committed immediately after upload.

## Modes

- **Create Assets** creates new records. Existing serial numbers and populated asset tags are blocking duplicates.
- **Update Existing** matches exactly one asset by Serial #. It records the asset revision during validation and blocks commit if that record changes before commit.

In Update Existing mode, a mapped blank optional cell clears the current value. An optional field that is not mapped is left unchanged. Blank required cells always block.

## Session stages

1. Create a session and select its category/profile and mode.
2. Download the current template when needed.
3. Upload a UTF-8 CSV. BOM, quoted commas, Windows line endings, and blank lines are supported.
4. Review and save explicit column mappings. Labels, field keys, and configured aliases can map automatically; ambiguous or unknown columns require a user decision.
5. Validate the complete batch.
6. Correct, exclude, restore, or bulk-correct staged rows without re-uploading.
7. Commit all included rows in one PostgreSQL transaction.

Sessions can be resumed. A profile or controlled-value change marks unfinished work for revalidation, and opening the session replaces obsolete validation results.

## Validation results

- **Valid**: ready to commit.
- **Warning**: allowed to commit, but the user should review it. Missing optional Location is a warning and imports without a location.
- **Blocking Error**: the row cannot commit, such as a required blank, invalid type, duplicate serial, duplicate populated asset tag, unknown required Owner, or unknown required Vendor.
- **Configuration Error**: the profile itself must be repaired, such as a controlled field without its lookup-list mapping.

Optional blank controlled fields do not produce lookup errors. Notes is optional free text and is never checked against a controlled list. NVBug, dates, whitespace, capitalization, and configured aliases are normalized during validation.

## Guided correction

Each issue identifies its CSV row and profile field. Unrecognized controlled values show the source value, closest approved values, and these actions when applicable:

- Use Approved Value
- Apply the same correction to every matching row
- Add As New Value, for authorized Super Users and Privileged Administrators and with a required reason
- Correct In Source CSV using the downloadable validation report
- Repair Profile for missing controlled-list configuration

Adding a controlled value writes activity and automatically revalidates matching rows.

## Commit guarantees

All included rows commit atomically. A database or revision conflict rolls back the entire batch. Repeating a successful commit does not create duplicate assets. The completion view links directly to every created or updated asset, and the active UI refreshes inventory-dependent pages automatically.

## API

- `POST /api/v1/imports`
- `POST /api/v1/imports/:id/file`
- `PUT /api/v1/imports/:id/mappings`
- `POST /api/v1/imports/:id/validate`
- `PATCH /api/v1/imports/:id/rows/:rowId`
- `POST /api/v1/imports/:id/corrections/bulk`
- `POST /api/v1/imports/:id/lookups`
- `POST /api/v1/imports/:id/commit`
- `GET /api/v1/imports/:id/validation.csv`
- `GET /api/v1/profiles/:id/import-template.csv`
