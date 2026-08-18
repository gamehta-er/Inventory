\set ON_ERROR_STOP on

BEGIN;
SET LOCAL search_path TO invmgmt, public;

SELECT pg_advisory_xact_lock(hashtext('inventory-project-migrations'));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM schema_migrations
        WHERE migration_key = '009-governed-import-reliability'
    ) THEN
        RAISE EXCEPTION 'Migration 009-governed-import-reliability must be installed first';
    END IF;
END;
$$;

-- Existing reviewed drafts keep their validated data, but no longer wait for
-- administrator decisions. Drafts without a usable preview must revalidate.
UPDATE import_batches
SET status = CASE
        WHEN invalid_rows = 0 AND draft_hash IS NOT NULL THEN 'READY'
        ELSE 'NEEDS_REVALIDATION'
    END,
    updated_at = now()
WHERE status IN ('AWAITING_APPROVAL','APPROVED','DECLINED');

-- The review ledger remains immutable historical evidence, but review access
-- is no longer part of the active import workflow.
DELETE FROM role_permissions role_permission
USING permissions permission
WHERE role_permission.permission_id = permission.id
  AND permission.permission_key = 'import.review';

INSERT INTO import_runtime_control(control_key,mode,reason,change_source)
VALUES ('GLOBAL','ENABLED','Simple preview, fix, and import workflow is enabled.','migration-010')
ON CONFLICT (control_key) DO UPDATE
SET mode='ENABLED',
    reason='Simple preview, fix, and import workflow is enabled.',
    changed_by_user_id=NULL,
    change_source='migration-010',
    changed_at=now();

INSERT INTO schema_migrations(migration_key,description)
VALUES (
    '010-simplified-import-workflow',
    'Replaces mandatory administrator reviews with a direct preview, fix, and atomic import workflow.'
)
ON CONFLICT (migration_key) DO NOTHING;

COMMIT;
