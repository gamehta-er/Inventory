\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_status_check;
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_mode_check;
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_idempotency_key_unique;
ALTER TABLE import_batches
  ALTER COLUMN file_name DROP NOT NULL,
  ALTER COLUMN file_sha256 DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'CREATE',
  ADD COLUMN IF NOT EXISTS profile_version integer,
  ADD COLUMN IF NOT EXISTS contract_fingerprint text,
  ADD COLUMN IF NOT EXISTS original_csv bytea,
  ADD COLUMN IF NOT EXISTS original_headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS mapping_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS failure_message text,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

UPDATE import_batches b
SET profile_version = ap.version
FROM import_profiles ip
JOIN asset_profiles ap ON ap.id = ip.profile_id
WHERE b.import_profile_id = ip.id
  AND b.profile_version IS NULL;

UPDATE import_batches
SET status = CASE
  WHEN status = 'COMMITTED' THEN 'COMPLETED'
  WHEN status = 'FAILED' THEN 'FAILED'
  WHEN status = 'CANCELLED' THEN 'CANCELLED'
  ELSE 'NEEDS_REVALIDATION'
END,
completed_at = COALESCE(completed_at, committed_at),
updated_at = now();

ALTER TABLE import_batches
  ALTER COLUMN profile_version SET NOT NULL,
  ADD CONSTRAINT import_batches_mode_check CHECK (mode IN ('CREATE','UPDATE')),
  ADD CONSTRAINT import_batches_status_check CHECK (status IN (
    'DRAFT','MAPPING','VALIDATING','NEEDS_ATTENTION','READY','COMMITTING',
    'COMPLETED','FAILED','CANCELLED','NEEDS_REVALIDATION'
  )),
  ADD CONSTRAINT import_batches_idempotency_key_unique UNIQUE (idempotency_key);

CREATE TABLE IF NOT EXISTS import_column_mappings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  source_header text NOT NULL,
  source_index integer NOT NULL,
  field_definition_id bigint REFERENCES field_definitions(id) ON DELETE RESTRICT,
  ignored boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, source_index),
  CHECK ((ignored AND field_definition_id IS NULL) OR (NOT ignored AND field_definition_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS import_column_mappings_field_unique_idx
  ON import_column_mappings(batch_id, field_definition_id)
  WHERE field_definition_id IS NOT NULL;

ALTER TABLE import_batch_rows DROP CONSTRAINT IF EXISTS import_batch_rows_status_check;
ALTER TABLE import_batch_rows DROP CONSTRAINT IF EXISTS import_batch_rows_operation_check;
ALTER TABLE import_batch_rows
  ADD COLUMN IF NOT EXISTS corrected_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS included boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS operation text,
  ADD COLUMN IF NOT EXISTS target_asset_id bigint REFERENCES assets(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS target_asset_revision integer,
  ADD COLUMN IF NOT EXISTS before_values jsonb,
  ADD COLUMN IF NOT EXISTS after_values jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE import_batch_rows SET status = CASE
  WHEN status = 'INVALID' THEN 'BLOCKED'
  WHEN status = 'COMMITTED' THEN 'COMMITTED'
  ELSE 'PENDING'
END;

ALTER TABLE import_batch_rows
  ADD CONSTRAINT import_batch_rows_status_check CHECK (status IN (
    'PENDING','VALID','WARNING','BLOCKED','CONFIGURATION_ERROR','EXCLUDED','COMMITTED'
  )),
  ADD CONSTRAINT import_batch_rows_operation_check CHECK (operation IS NULL OR operation IN ('CREATE','UPDATE'));

ALTER TABLE import_validation_issues DROP CONSTRAINT IF EXISTS import_validation_issues_severity_check;
ALTER TABLE import_validation_issues
  ADD COLUMN IF NOT EXISTS source_value text,
  ADD COLUMN IF NOT EXISTS suggested_values jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS resolution jsonb,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by_user_id bigint REFERENCES application_users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT import_validation_issues_severity_check CHECK (severity IN ('WARNING','ERROR','CONFIGURATION'));

CREATE TABLE IF NOT EXISTS import_commit_results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  import_row_id bigint NOT NULL REFERENCES import_batch_rows(id) ON DELETE CASCADE,
  asset_id bigint NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('CREATE','UPDATE')),
  asset_revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, import_row_id)
);

CREATE INDEX IF NOT EXISTS import_batches_resume_idx
  ON import_batches(created_by_user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS import_batch_rows_review_idx
  ON import_batch_rows(batch_id, included, status, row_number);
CREATE INDEX IF NOT EXISTS import_validation_issues_batch_idx
  ON import_validation_issues(import_row_id, severity, field_key);

DELETE FROM import_validation_issues i
USING import_batch_rows r, import_batches b
WHERE i.import_row_id = r.id
  AND r.batch_id = b.id
  AND b.status = 'NEEDS_REVALIDATION';

INSERT INTO schema_migrations(migration_key, description)
VALUES (
  '005-complete-import-workflow',
  'Persistent profile-driven create/update import sessions with explicit mappings, staged corrections, atomic commit, and revalidation.'
)
ON CONFLICT (migration_key) DO NOTHING;

COMMIT;
