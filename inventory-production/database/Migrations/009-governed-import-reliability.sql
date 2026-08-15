\set ON_ERROR_STOP on

BEGIN;
SET LOCAL search_path TO invmgmt, public;

SELECT pg_advisory_xact_lock(hashtext('inventory-project-migrations'));

ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_status_check;
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_source_format_check;
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_file_size_check;
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_draft_revision_check;
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_draft_hash_check;
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_verification_status_check;
ALTER TABLE import_batches
    ADD COLUMN IF NOT EXISTS original_file bytea,
    ADD COLUMN IF NOT EXISTS source_format text,
    ADD COLUMN IF NOT EXISTS source_sheet_name text,
    ADD COLUMN IF NOT EXISTS source_encoding text,
    ADD COLUMN IF NOT EXISTS source_delimiter text,
    ADD COLUMN IF NOT EXISTS file_size_bytes bigint,
    ADD COLUMN IF NOT EXISTS source_schema_version text NOT NULL DEFAULT 'inventory-import-v2',
    ADD COLUMN IF NOT EXISTS source_options jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS available_sheets jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS draft_revision integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS draft_hash text,
    ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'NOT_RUN',
    ADD COLUMN IF NOT EXISTS verification_details jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE import_batches
SET original_file = COALESCE(original_file, original_csv),
    source_format = COALESCE(source_format, CASE WHEN original_csv IS NOT NULL THEN 'CSV' END),
    source_schema_version = CASE
        WHEN original_csv IS NOT NULL AND source_format IS NULL THEN 'inventory-import-v1'
        ELSE COALESCE(source_schema_version, 'inventory-import-v2')
    END,
    file_size_bytes = COALESCE(file_size_bytes, octet_length(original_csv)),
    draft_revision = CASE WHEN original_csv IS NOT NULL THEN GREATEST(draft_revision, 1) ELSE draft_revision END,
    draft_hash = NULL,
    verification_status = 'NOT_RUN',
    verification_details = '{}'::jsonb,
    status = CASE
        WHEN status IN ('COMPLETED','CANCELLED') THEN status
        ELSE 'NEEDS_REVALIDATION'
    END,
    updated_at = now();

ALTER TABLE import_batches
    ADD CONSTRAINT import_batches_status_check CHECK (status IN (
        'DRAFT','SOURCE_SELECTION','MAPPING','VALIDATING','NEEDS_ATTENTION',
        'AWAITING_APPROVAL','DECLINED','APPROVED','READY','COMMITTING',
        'COMPLETED','FAILED','VERIFICATION_FAILED','CANCELLED','NEEDS_REVALIDATION'
    )),
    ADD CONSTRAINT import_batches_source_format_check CHECK (source_format IS NULL OR source_format IN ('CSV','XLSX')),
    ADD CONSTRAINT import_batches_file_size_check CHECK (
        file_size_bytes IS NULL OR (
            file_size_bytes >= 0
            AND (source_schema_version = 'inventory-import-v1' OR file_size_bytes <= 10485760)
        )
    ),
    ADD CONSTRAINT import_batches_draft_revision_check CHECK (draft_revision >= 0),
    ADD CONSTRAINT import_batches_draft_hash_check CHECK (draft_hash IS NULL OR draft_hash ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT import_batches_verification_status_check CHECK (verification_status IN ('NOT_RUN','PENDING','PASSED','FAILED'));

CREATE TABLE IF NOT EXISTS import_runtime_control (
    control_key text PRIMARY KEY CHECK (control_key = 'GLOBAL'),
    mode text NOT NULL CHECK (mode IN ('DISABLED','CANARY','ENABLED')),
    reason text NOT NULL CHECK (length(btrim(reason)) > 0),
    changed_by_user_id bigint REFERENCES application_users(id) ON DELETE RESTRICT,
    change_source text NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO import_runtime_control(control_key,mode,reason,change_source)
VALUES ('GLOBAL','DISABLED','Reliability release requires verified gates and named sign-offs.','migration-009')
ON CONFLICT (control_key) DO UPDATE
SET mode='DISABLED',
    reason='Reliability release requires verified gates and named sign-offs.',
    changed_by_user_id=NULL,
    change_source='migration-009',
    changed_at=now();

CREATE TABLE IF NOT EXISTS import_reviews (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE RESTRICT,
    draft_revision integer NOT NULL CHECK (draft_revision > 0),
    draft_hash text NOT NULL CHECK (draft_hash ~ '^[0-9a-f]{64}$'),
    reviewer_user_id bigint NOT NULL REFERENCES application_users(id) ON DELETE RESTRICT,
    decision text NOT NULL CHECK (decision IN ('ACCEPT','DECLINE')),
    reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (batch_id,draft_revision,reviewer_user_id),
    CHECK (decision <> 'DECLINE' OR length(btrim(COALESCE(reason,''))) > 0)
);

CREATE TABLE IF NOT EXISTS import_stage_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id uuid REFERENCES import_batches(id) ON DELETE RESTRICT,
    stage text NOT NULL,
    event_key text NOT NULL,
    draft_revision integer,
    row_number integer,
    duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
    row_count integer CHECK (row_count IS NULL OR row_count >= 0),
    mismatch_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (draft_revision IS NULL OR draft_revision >= 0),
    CHECK (row_number IS NULL OR row_number > 0),
    CHECK (jsonb_typeof(mismatch_fields) = 'array'),
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE OR REPLACE FUNCTION validate_import_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = invmgmt, public
AS $$
DECLARE
    current_batch import_batches%ROWTYPE;
BEGIN
    SELECT * INTO current_batch FROM import_batches WHERE id=NEW.batch_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Import session does not exist';
    END IF;
    IF current_batch.created_by_user_id=NEW.reviewer_user_id THEN
        RAISE EXCEPTION 'The importer cannot review their own import';
    END IF;
    IF current_batch.draft_hash IS NULL
       OR current_batch.draft_revision<>NEW.draft_revision
       OR current_batch.draft_hash<>NEW.draft_hash THEN
        RAISE EXCEPTION 'Review revision and hash must match the current import draft';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM application_user_roles user_role
        JOIN application_users reviewer ON reviewer.id=user_role.user_id AND reviewer.active
        JOIN roles role ON role.id=user_role.role_id
        JOIN role_permissions role_permission ON role_permission.role_id=role.id
        JOIN permissions permission ON permission.id=role_permission.permission_id
        WHERE user_role.user_id=NEW.reviewer_user_id
          AND role.role_key='privileged_administrator'
          AND role.active
          AND permission.permission_key='import.review'
    ) THEN
        RAISE EXCEPTION 'Reviewer must be a Privileged Administrator with import.review permission';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION reject_import_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Import review and stage evidence is append-only';
END;
$$;

DROP TRIGGER IF EXISTS import_reviews_validate ON import_reviews;
CREATE TRIGGER import_reviews_validate
BEFORE INSERT ON import_reviews
FOR EACH ROW EXECUTE FUNCTION validate_import_review();

DROP TRIGGER IF EXISTS import_reviews_immutable ON import_reviews;
CREATE TRIGGER import_reviews_immutable
BEFORE UPDATE OR DELETE ON import_reviews
FOR EACH ROW EXECUTE FUNCTION reject_import_evidence_mutation();

DROP TRIGGER IF EXISTS import_stage_events_immutable ON import_stage_events;
CREATE TRIGGER import_stage_events_immutable
BEFORE UPDATE OR DELETE ON import_stage_events
FOR EACH ROW EXECUTE FUNCTION reject_import_evidence_mutation();

CREATE INDEX IF NOT EXISTS import_reviews_current_idx
    ON import_reviews(batch_id,draft_revision,created_at);
CREATE INDEX IF NOT EXISTS import_stage_events_batch_idx
    ON import_stage_events(batch_id,created_at);

INSERT INTO permissions(permission_key,permission_name,description)
VALUES ('import.review','Review imports','Accept or decline a governed import draft before commit.')
ON CONFLICT (permission_key) DO UPDATE
SET permission_name=EXCLUDED.permission_name,
    description=EXCLUDED.description;

INSERT INTO role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM roles role
JOIN permissions permission ON permission.permission_key='import.review'
WHERE role.role_key='privileged_administrator'
ON CONFLICT DO NOTHING;

ALTER TABLE import_runtime_control OWNER TO inventory_owner;
ALTER TABLE import_reviews OWNER TO inventory_owner;
ALTER TABLE import_stage_events OWNER TO inventory_owner;
ALTER FUNCTION validate_import_review() OWNER TO inventory_owner;
ALTER FUNCTION reject_import_evidence_mutation() OWNER TO inventory_owner;

REVOKE ALL ON import_runtime_control,import_reviews,import_stage_events FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON import_runtime_control TO inventory_app;
GRANT SELECT,INSERT ON import_reviews,import_stage_events TO inventory_app;
GRANT USAGE,SELECT,UPDATE ON SEQUENCE import_reviews_id_seq,import_stage_events_id_seq TO inventory_app;

INSERT INTO schema_migrations(migration_key,description)
VALUES (
    '009-governed-import-reliability',
    'Locks imports by runtime mode; adds canonical source metadata, draft integrity, two-administrator reviews, and append-only reliability evidence.'
)
ON CONFLICT (migration_key) DO NOTHING;

COMMIT;
