\set ON_ERROR_STOP on

BEGIN;
SET LOCAL search_path TO invmgmt, public;

SELECT pg_advisory_xact_lock(hashtext('inventory-project-migrations'));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM schema_migrations
        WHERE migration_key = '010-simplified-import-workflow'
    ) THEN
        RAISE EXCEPTION 'Migration 010-simplified-import-workflow must be installed first';
    END IF;
END;
$$;

-- Row skipping is no longer part of the active workflow. Restore rows in open
-- drafts and force a complete validation before they can be imported.
WITH affected_rows AS MATERIALIZED (
    SELECT row.id,row.batch_id
    FROM import_batch_rows row
    JOIN import_batches batch ON batch.id=row.batch_id
    WHERE NOT row.included
      AND batch.status NOT IN ('COMPLETED','CANCELLED')
),
cleared_issues AS (
    DELETE FROM import_validation_issues issue
    USING affected_rows affected
    WHERE issue.import_row_id=affected.id
    RETURNING issue.import_row_id
),
restored_rows AS (
    UPDATE import_batch_rows row
    SET included=true,
        status='PENDING',
        normalized_values='{}'::jsonb,
        operation=NULL,
        target_asset_id=NULL,
        target_asset_revision=NULL,
        before_values=NULL,
        after_values=NULL,
        updated_at=now()
    FROM affected_rows affected
    WHERE row.id=affected.id
    RETURNING row.batch_id
),
affected_batches AS (
    SELECT DISTINCT batch_id FROM restored_rows
)
UPDATE import_batches batch
SET status='NEEDS_REVALIDATION',
    draft_revision=draft_revision+1,
    draft_hash=NULL,
    verification_status='NOT_RUN',
    verification_details='{}'::jsonb,
    valid_rows=0,
    warning_rows=0,
    invalid_rows=0,
    validated_at=NULL,
    failure_message=NULL,
    updated_at=now()
FROM affected_batches affected
WHERE batch.id=affected.batch_id;

INSERT INTO schema_migrations(migration_key,description)
VALUES (
    '011-guided-import-corrections',
    'Removes row exclusion from active imports and restores open drafts for guided correction and validation.'
)
ON CONFLICT (migration_key) DO NOTHING;

COMMIT;
