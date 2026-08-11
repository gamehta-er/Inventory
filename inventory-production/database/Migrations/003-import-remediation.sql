\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM schema_migrations WHERE migration_key = '003-import-remediation'
    ) THEN
        UPDATE asset_profiles ap
        SET version = version + 1,
            updated_at = now()
        WHERE EXISTS (
            SELECT 1
            FROM profile_fields pf
            JOIN field_definitions fd ON fd.id = pf.field_definition_id
            WHERE pf.profile_id = ap.id
              AND fd.field_key = 'notes'
              AND pf.required
        );

        UPDATE profile_fields pf
        SET required = false,
            updated_at = now()
        FROM field_definitions fd
        WHERE fd.id = pf.field_definition_id
          AND fd.field_key = 'notes'
          AND pf.required;

        DELETE FROM import_validation_issues issue
        USING import_batch_rows row_data, import_batches batch
        WHERE issue.import_row_id = row_data.id
          AND row_data.batch_id = batch.id
          AND batch.status NOT IN ('COMMITTED', 'CANCELLED')
          AND issue.field_key = 'notes'
          AND issue.issue_code = 'REQUIRED';

        UPDATE import_batch_rows row_data
        SET status = CASE
            WHEN EXISTS (
                SELECT 1 FROM import_validation_issues issue
                WHERE issue.import_row_id = row_data.id AND issue.severity = 'ERROR'
            ) THEN 'INVALID'
            WHEN EXISTS (
                SELECT 1 FROM import_validation_issues issue
                WHERE issue.import_row_id = row_data.id AND issue.severity = 'WARNING'
            ) THEN 'WARNING'
            ELSE 'VALID'
        END
        FROM import_batches batch
        WHERE batch.id = row_data.batch_id
          AND batch.status NOT IN ('COMMITTED', 'CANCELLED');

        UPDATE import_batches batch
        SET status = 'VALIDATED',
            valid_rows = counts.valid_rows,
            warning_rows = counts.warning_rows,
            invalid_rows = counts.invalid_rows
        FROM (
            SELECT row_data.batch_id,
                   count(*) FILTER (WHERE row_data.status = 'VALID')::integer AS valid_rows,
                   count(*) FILTER (WHERE row_data.status = 'WARNING')::integer AS warning_rows,
                   count(*) FILTER (WHERE row_data.status = 'INVALID')::integer AS invalid_rows
            FROM import_batch_rows row_data
            GROUP BY row_data.batch_id
        ) counts
        WHERE batch.id = counts.batch_id
          AND batch.status NOT IN ('COMMITTED', 'CANCELLED');

        INSERT INTO schema_migrations(migration_key, description)
        VALUES (
            '003-import-remediation',
            'Enforces optional Notes and removes stale Notes-required blockers from active import batches.'
        );
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM profile_fields pf
        JOIN field_definitions fd ON fd.id = pf.field_definition_id
        WHERE fd.field_key = 'notes' AND pf.required
    ) THEN
        RAISE EXCEPTION 'Notes remains required in an active profile.';
    END IF;
END $$;

COMMIT;
