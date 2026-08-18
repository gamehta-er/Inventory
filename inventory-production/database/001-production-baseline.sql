\set ON_ERROR_STOP on
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE schema_migrations (
    migration_key text PRIMARY KEY,
    description text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_key text NOT NULL UNIQUE,
    role_name text NOT NULL UNIQUE,
    description text NOT NULL,
    active boolean NOT NULL DEFAULT true
);

CREATE TABLE permissions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    permission_key text NOT NULL UNIQUE,
    permission_name text NOT NULL,
    description text NOT NULL
);

CREATE TABLE role_permissions (
    role_id bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id bigint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE application_users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    display_name text NOT NULL UNIQUE,
    email text UNIQUE,
    initials text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE application_user_roles (
    user_id bigint NOT NULL REFERENCES application_users(id) ON DELETE CASCADE,
    role_id bigint NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE application_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash text NOT NULL UNIQUE,
    user_id bigint NOT NULL REFERENCES application_users(id) ON DELETE CASCADE,
    csrf_token_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX application_sessions_expiry_idx ON application_sessions(expires_at);

CREATE TABLE lookup_lists (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lookup_key text NOT NULL UNIQUE,
    lookup_name text NOT NULL,
    description text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lookup_values (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lookup_list_id bigint NOT NULL REFERENCES lookup_lists(id) ON DELETE RESTRICT,
    value_key text NOT NULL,
    display_value text NOT NULL,
    description text,
    aliases text[] NOT NULL DEFAULT '{}',
    display_order integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (lookup_list_id, value_key),
    UNIQUE (lookup_list_id, display_value)
);
CREATE INDEX lookup_values_active_order_idx ON lookup_values(lookup_list_id, active, display_order);

CREATE TABLE categories (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_key text NOT NULL UNIQUE,
    category_name text NOT NULL UNIQUE,
    description text NOT NULL,
    icon_key text NOT NULL DEFAULT 'box',
    display_order integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT categories_asset_family_key_check CHECK (
        NOT active OR (
            upper(regexp_replace(category_key,'[^A-Za-z0-9]+','_','g'))
                <> ALL (ARRAY['IN_USE','REWORK','E_WASTE','ARCHIVE','GPU_READY','AVAILABLE']::text[])
            AND upper(regexp_replace(category_name,'[^A-Za-z0-9]+','_','g'))
                <> ALL (ARRAY['IN_USE','REWORK','E_WASTE','ARCHIVE','GPU_READY','AVAILABLE']::text[])
        )
    )
);

CREATE TABLE asset_profiles (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id bigint NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    profile_key text NOT NULL UNIQUE,
    profile_name text NOT NULL,
    description text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_profile_per_category_idx ON asset_profiles(category_id) WHERE active;

CREATE TABLE field_definitions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    field_key text NOT NULL UNIQUE,
    field_label text NOT NULL,
    definition text NOT NULL,
    help_text text NOT NULL,
    data_type text NOT NULL CHECK (data_type IN ('text','number','date','long_text','lookup','entity','multi_reference','boolean')),
    lookup_list_id bigint REFERENCES lookup_lists(id) ON DELETE RESTRICT,
    storage_target text NOT NULL,
    import_aliases text[] NOT NULL DEFAULT '{}',
    validation_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
    unique_when_populated boolean NOT NULL DEFAULT false,
    sensitivity text NOT NULL DEFAULT 'internal' CHECK (sensitivity IN ('public','internal','restricted')),
    active boolean NOT NULL DEFAULT true,
    deprecated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((data_type = 'lookup' AND lookup_list_id IS NOT NULL) OR data_type <> 'lookup')
);

CREATE TABLE profile_fields (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    profile_id bigint NOT NULL REFERENCES asset_profiles(id) ON DELETE CASCADE,
    field_definition_id bigint NOT NULL REFERENCES field_definitions(id) ON DELETE RESTRICT,
    required boolean NOT NULL DEFAULT false,
    display_order integer NOT NULL,
    visible_add boolean NOT NULL DEFAULT true,
    visible_update boolean NOT NULL DEFAULT true,
    visible_filter boolean NOT NULL DEFAULT true,
    visible_detail boolean NOT NULL DEFAULT true,
    visible_import boolean NOT NULL DEFAULT true,
    visible_report boolean NOT NULL DEFAULT true,
    visible_export boolean NOT NULL DEFAULT true,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (profile_id, field_definition_id),
    UNIQUE (profile_id, display_order)
);

CREATE TABLE profile_versions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    profile_id bigint NOT NULL REFERENCES asset_profiles(id) ON DELETE RESTRICT,
    version integer NOT NULL,
    snapshot jsonb NOT NULL,
    reason text NOT NULL,
    actor_user_id bigint NOT NULL REFERENCES application_users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (profile_id, version)
);

CREATE TABLE manufacturers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    manufacturer_name text NOT NULL UNIQUE,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vendors (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vendor_name text NOT NULL UNIQUE,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE asset_models (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id bigint NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    manufacturer_id bigint REFERENCES manufacturers(id) ON DELETE RESTRICT,
    model_number text NOT NULL,
    product_name text NOT NULL,
    board_sku text,
    gpu_sku text,
    board_architecture text,
    gpu_class text,
    gpu_chip text,
    gpu_name_vrl text,
    gpu_name_market text,
    image_path text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(category_id, model_number)
);

CREATE TABLE location_types (
    id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type_key text NOT NULL UNIQUE,
    type_name text NOT NULL,
    level_order smallint NOT NULL UNIQUE
);

CREATE TABLE locations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    parent_id bigint REFERENCES locations(id) ON DELETE RESTRICT,
    location_type_id smallint NOT NULL REFERENCES location_types(id) ON DELETE RESTRICT,
    location_key text NOT NULL UNIQUE,
    location_name text NOT NULL,
    full_path text NOT NULL UNIQUE,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX locations_parent_idx ON locations(parent_id, active);

CREATE TABLE assets (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_model_id bigint NOT NULL REFERENCES asset_models(id) ON DELETE RESTRICT,
    profile_id bigint NOT NULL REFERENCES asset_profiles(id) ON DELETE RESTRICT,
    serial_number text NOT NULL UNIQUE,
    asset_tag text,
    date_received date NOT NULL,
    status_value_id bigint NOT NULL REFERENCES lookup_values(id) ON DELETE RESTRICT,
    location_id bigint REFERENCES locations(id) ON DELETE RESTRICT,
    owner_user_id bigint NOT NULL REFERENCES application_users(id) ON DELETE RESTRICT,
    vendor_id bigint NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    milestone text,
    pool_team text,
    project text,
    notes text,
    archived_at timestamptz,
    revision integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX assets_asset_tag_unique_idx ON assets(asset_tag) WHERE asset_tag IS NOT NULL AND btrim(asset_tag) <> '';
CREATE INDEX assets_model_idx ON assets(asset_model_id);
CREATE INDEX assets_status_idx ON assets(status_value_id);
CREATE INDEX assets_location_idx ON assets(location_id);
CREATE INDEX assets_owner_idx ON assets(owner_user_id);
CREATE INDEX assets_received_idx ON assets(date_received);

CREATE TABLE asset_field_values (
    asset_id bigint NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    field_definition_id bigint NOT NULL REFERENCES field_definitions(id) ON DELETE RESTRICT,
    text_value text,
    number_value numeric,
    date_value date,
    boolean_value boolean,
    json_value jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id, field_definition_id),
    CHECK (num_nonnulls(text_value, number_value, date_value, boolean_value, json_value) <= 1)
);

CREATE TABLE external_reference_types (
    id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reference_type_key text NOT NULL UNIQUE,
    reference_type_name text NOT NULL,
    url_template text,
    validation_pattern text,
    multiple_allowed boolean NOT NULL DEFAULT true
);

CREATE TABLE asset_external_references (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id bigint NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    reference_type_id smallint NOT NULL REFERENCES external_reference_types(id) ON DELETE RESTRICT,
    reference_value text NOT NULL,
    normalized_value text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(asset_id, reference_type_id, normalized_value)
);
CREATE INDEX asset_external_refs_value_idx ON asset_external_references(reference_type_id, normalized_value);

CREATE TABLE asset_assignments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id bigint NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    assignee_user_id bigint NOT NULL REFERENCES application_users(id) ON DELETE RESTRICT,
    location_id bigint REFERENCES locations(id) ON DELETE RESTRICT,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    returned_at timestamptz,
    reason text NOT NULL,
    actor_user_id bigint NOT NULL REFERENCES application_users(id) ON DELETE RESTRICT,
    CHECK (returned_at IS NULL OR returned_at >= assigned_at)
);
CREATE UNIQUE INDEX one_open_assignment_per_asset_idx ON asset_assignments(asset_id) WHERE returned_at IS NULL;

CREATE TABLE asset_status_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id bigint NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    from_status_value_id bigint REFERENCES lookup_values(id) ON DELETE RESTRICT,
    to_status_value_id bigint NOT NULL REFERENCES lookup_values(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    actor_user_id bigint NOT NULL REFERENCES application_users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE asset_transfers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id bigint NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    from_owner_user_id bigint REFERENCES application_users(id) ON DELETE RESTRICT,
    to_owner_user_id bigint REFERENCES application_users(id) ON DELETE RESTRICT,
    from_location_id bigint REFERENCES locations(id) ON DELETE RESTRICT,
    to_location_id bigint REFERENCES locations(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    actor_user_id bigint NOT NULL REFERENCES application_users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE asset_relationships (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    parent_asset_id bigint NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    child_asset_id bigint NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    relationship_type text NOT NULL,
    notes text,
    created_by_user_id bigint NOT NULL REFERENCES application_users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (parent_asset_id <> child_asset_id),
    UNIQUE(parent_asset_id, child_asset_id, relationship_type)
);

CREATE TABLE import_profiles (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    profile_id bigint NOT NULL REFERENCES asset_profiles(id) ON DELETE RESTRICT,
    import_profile_key text NOT NULL UNIQUE,
    import_profile_name text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE import_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_profile_id bigint NOT NULL REFERENCES import_profiles(id) ON DELETE RESTRICT,
    mode text NOT NULL CHECK (mode IN ('CREATE','UPDATE')),
    profile_version integer NOT NULL,
    contract_fingerprint text NOT NULL,
    file_name text,
    file_sha256 text,
    original_csv bytea,
    original_file bytea,
    source_format text CHECK (source_format IS NULL OR source_format IN ('CSV','XLSX')),
    source_sheet_name text,
    source_encoding text,
    source_delimiter text,
    source_schema_version text NOT NULL DEFAULT 'inventory-import-v2',
    file_size_bytes bigint CHECK (
        file_size_bytes IS NULL OR (
            file_size_bytes >= 0
            AND (source_schema_version = 'inventory-import-v1' OR file_size_bytes <= 10485760)
        )
    ),
    source_options jsonb NOT NULL DEFAULT '{}'::jsonb,
    available_sheets jsonb NOT NULL DEFAULT '[]'::jsonb,
    original_headers jsonb NOT NULL DEFAULT '[]'::jsonb,
    mapping_revision integer NOT NULL DEFAULT 0,
    draft_revision integer NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
    draft_hash text CHECK (draft_hash IS NULL OR draft_hash ~ '^[0-9a-f]{64}$'),
    verification_status text NOT NULL DEFAULT 'NOT_RUN' CHECK (verification_status IN ('NOT_RUN','PENDING','PASSED','FAILED')),
    verification_details jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL CHECK (status IN ('DRAFT','SOURCE_SELECTION','MAPPING','VALIDATING','NEEDS_ATTENTION','AWAITING_APPROVAL','DECLINED','APPROVED','READY','COMMITTING','COMPLETED','FAILED','VERIFICATION_FAILED','CANCELLED','NEEDS_REVALIDATION')),
    total_rows integer NOT NULL DEFAULT 0,
    valid_rows integer NOT NULL DEFAULT 0,
    warning_rows integer NOT NULL DEFAULT 0,
    invalid_rows integer NOT NULL DEFAULT 0,
    created_by_user_id bigint NOT NULL REFERENCES application_users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    validated_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    committed_at timestamptz,
    completed_at timestamptz,
    failure_message text,
    idempotency_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE
);

CREATE TABLE import_column_mappings (
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
CREATE UNIQUE INDEX import_column_mappings_field_unique_idx ON import_column_mappings(batch_id, field_definition_id) WHERE field_definition_id IS NOT NULL;

CREATE TABLE import_batch_rows (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    row_number integer NOT NULL,
    source_values jsonb NOT NULL,
    corrected_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    normalized_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    included boolean NOT NULL DEFAULT true,
    operation text CHECK (operation IS NULL OR operation IN ('CREATE','UPDATE')),
    target_asset_id bigint REFERENCES assets(id) ON DELETE RESTRICT,
    target_asset_revision integer,
    before_values jsonb,
    after_values jsonb,
    status text NOT NULL CHECK (status IN ('PENDING','VALID','WARNING','BLOCKED','CONFIGURATION_ERROR','EXCLUDED','COMMITTED')),
    committed_asset_id bigint REFERENCES assets(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(batch_id, row_number)
);

CREATE TABLE import_validation_issues (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    import_row_id bigint NOT NULL REFERENCES import_batch_rows(id) ON DELETE CASCADE,
    field_key text,
    severity text NOT NULL CHECK (severity IN ('WARNING','ERROR','CONFIGURATION')),
    issue_code text NOT NULL,
    message text NOT NULL,
    source_value text,
    suggested_values jsonb NOT NULL DEFAULT '[]'::jsonb,
    resolution jsonb,
    resolved_at timestamptz,
    resolved_by_user_id bigint REFERENCES application_users(id) ON DELETE RESTRICT
);
CREATE INDEX import_issues_row_idx ON import_validation_issues(import_row_id, severity);

CREATE TABLE import_commit_results (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    import_row_id bigint NOT NULL REFERENCES import_batch_rows(id) ON DELETE CASCADE,
    asset_id bigint NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    operation text NOT NULL CHECK (operation IN ('CREATE','UPDATE')),
    asset_revision integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (batch_id, import_row_id)
);

CREATE TABLE import_runtime_control (
    control_key text PRIMARY KEY CHECK (control_key = 'GLOBAL'),
    mode text NOT NULL CHECK (mode IN ('DISABLED','CANARY','ENABLED')),
    reason text NOT NULL CHECK (length(btrim(reason)) > 0),
    changed_by_user_id bigint REFERENCES application_users(id) ON DELETE RESTRICT,
    change_source text NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE import_reviews (
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

CREATE TABLE import_stage_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id uuid REFERENCES import_batches(id) ON DELETE RESTRICT,
    stage text NOT NULL,
    event_key text NOT NULL,
    draft_revision integer CHECK (draft_revision IS NULL OR draft_revision >= 0),
    row_number integer CHECK (row_number IS NULL OR row_number > 0),
    duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
    row_count integer CHECK (row_count IS NULL OR row_count >= 0),
    mismatch_fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(mismatch_fields) = 'array'),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX import_batches_resume_idx ON import_batches(created_by_user_id, status, updated_at DESC);
CREATE INDEX import_batch_rows_review_idx ON import_batch_rows(batch_id, included, status, row_number);
CREATE INDEX import_reviews_current_idx ON import_reviews(batch_id,draft_revision,created_at);
CREATE INDEX import_stage_events_batch_idx ON import_stage_events(batch_id,created_at);

CREATE TABLE saved_reports (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_name text NOT NULL,
    report_key text NOT NULL UNIQUE,
    description text NOT NULL,
    filters jsonb NOT NULL DEFAULT '{}'::jsonb,
    columns text[] NOT NULL DEFAULT '{}',
    chart_type text,
    owner_user_id bigint NOT NULL REFERENCES application_users(id) ON DELETE RESTRICT,
    shared boolean NOT NULL DEFAULT false,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE export_definitions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    export_key text NOT NULL UNIQUE,
    export_name text NOT NULL,
    profile_id bigint REFERENCES asset_profiles(id) ON DELETE RESTRICT,
    field_keys text[] NOT NULL,
    active boolean NOT NULL DEFAULT true
);

CREATE TABLE activity_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id bigint NOT NULL REFERENCES application_users(id) ON DELETE RESTRICT,
    effective_role_keys text[] NOT NULL,
    action_key text NOT NULL,
    source text NOT NULL,
    reason text,
    record_type text NOT NULL,
    record_id text NOT NULL,
    record_label text NOT NULL,
    route_path text NOT NULL,
    reference_value text,
    parent_event_id bigint REFERENCES activity_events(id) ON DELETE RESTRICT,
    parent_import_batch_id uuid REFERENCES import_batches(id) ON DELETE RESTRICT,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_record_idx ON activity_events(record_type, record_id, created_at DESC);
CREATE INDEX activity_actor_idx ON activity_events(actor_user_id, created_at DESC);
CREATE INDEX activity_action_idx ON activity_events(action_key, created_at DESC);

CREATE TABLE activity_field_changes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    activity_event_id bigint NOT NULL REFERENCES activity_events(id) ON DELETE CASCADE,
    field_key text NOT NULL,
    field_label text NOT NULL,
    before_value jsonb,
    after_value jsonb
);

CREATE OR REPLACE FUNCTION reject_activity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Activity records are append-only';
END;
$$;

CREATE OR REPLACE FUNCTION validate_import_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    current_batch import_batches%ROWTYPE;
BEGIN
    SELECT * INTO current_batch FROM import_batches WHERE id=NEW.batch_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Import session does not exist'; END IF;
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
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Import review and stage evidence is append-only';
END;
$$;

CREATE TRIGGER activity_events_immutable
BEFORE UPDATE OR DELETE ON activity_events
FOR EACH ROW EXECUTE FUNCTION reject_activity_mutation();

CREATE TRIGGER activity_changes_immutable
BEFORE UPDATE OR DELETE ON activity_field_changes
FOR EACH ROW EXECUTE FUNCTION reject_activity_mutation();

CREATE TRIGGER import_reviews_validate
BEFORE INSERT ON import_reviews
FOR EACH ROW EXECUTE FUNCTION validate_import_review();

CREATE TRIGGER import_reviews_immutable
BEFORE UPDATE OR DELETE ON import_reviews
FOR EACH ROW EXECUTE FUNCTION reject_import_evidence_mutation();

CREATE TRIGGER import_stage_events_immutable
BEFORE UPDATE OR DELETE ON import_stage_events
FOR EACH ROW EXECUTE FUNCTION reject_import_evidence_mutation();

INSERT INTO roles(role_key, role_name, description) VALUES
('user','User','Search, view, history, and label printing.'),
('super_user','Super User','Asset changes, operations, imports, reports, and exports.'),
('privileged_administrator','Privileged Administrator','Profile, reference data, user, role, and system administration.');

INSERT INTO permissions(permission_key, permission_name, description) VALUES
('asset.view','View assets','Search and view asset details.'),
('asset.history','View asset history','View asset-level activity.'),
('label.print','Print labels','Preview and print asset labels.'),
('asset.create','Create assets','Create inventory assets.'),
('asset.update','Update assets','Update inventory asset fields.'),
('asset.operate','Operate assets','Assign, return, transfer, change status, archive, and restore.'),
('asset.relationship','Manage relationships','Create and remove asset relationships.'),
('model.image','Manage model images','Upload, replace, and remove model images.'),
('import.execute','Run imports','Stage, validate, and commit imports.'),
('import.review','Review imports','Accept or decline a governed import draft before commit.'),
('import.lookup.resolve','Resolve import dropdowns','Approve controlled dropdown values while resolving staged import errors.'),
('report.view','View reports','View management reports and drilldowns.'),
('report.export','Export reports','Export governed report results.'),
('activity.view','View activity','View global activity ledger.'),
('admin.profile','Manage profiles','Manage categories, profiles, and fields.'),
('admin.lookup','Manage lookups','Manage dropdown lists and values.'),
('admin.location','Manage locations','Manage hierarchical locations.'),
('admin.identity','Manage users and roles','Manage local users and role assignments.'),
('admin.system','Manage system','View configuration health and system settings.');

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE (r.role_key = 'user' AND p.permission_key IN ('asset.view','asset.history','label.print'))
   OR (r.role_key = 'super_user' AND p.permission_key IN ('asset.view','asset.history','label.print','asset.create','asset.update','asset.operate','asset.relationship','model.image','import.execute','import.lookup.resolve','report.view','report.export','activity.view'))
   OR (r.role_key = 'privileged_administrator');

INSERT INTO application_users(display_name, email, initials) VALUES
('Armin Khosravi',NULL,'AK'),('Ben Siemens',NULL,'BS'),('Chris David',NULL,'CD'),
('Denny Srun',NULL,'DS'),('Gaurav Mehta',NULL,'GM'),('Gladson Barbosa',NULL,'GB'),
('Ilia Makeev',NULL,'IM'),('Igor Margulis',NULL,'IM'),('James Taylor',NULL,'JT'),
('Javier Marquez',NULL,'JM'),('Jiqing Wang',NULL,'JW'),('Karthikeyan Somasundaram',NULL,'KS'),
('Kevin Okubo',NULL,'KO'),('Leland Gee',NULL,'LG'),('Linh Morales',NULL,'LM'),
('Monica Martin',NULL,'MM'),('Vince DeMaso',NULL,'VD'),('Zachariah Zachariah',NULL,'ZZ'),
('Guest / not listed',NULL,'GU');

INSERT INTO application_user_roles(user_id, role_id)
SELECT u.id, r.id FROM application_users u CROSS JOIN roles r WHERE r.role_key = 'user';
INSERT INTO application_user_roles(user_id, role_id)
SELECT u.id, r.id FROM application_users u CROSS JOIN roles r
WHERE u.display_name IN ('Igor Margulis','Monica Martin','Gaurav Mehta')
  AND r.role_key IN ('super_user','privileged_administrator');

INSERT INTO import_runtime_control(control_key,mode,reason,change_source)
VALUES ('GLOBAL','ENABLED','Simple preview, fix, and import workflow is enabled.','baseline');

INSERT INTO lookup_lists(lookup_key, lookup_name, description) VALUES
('ASSET_STATUS','Asset Status','Controlled inventory lifecycle values.'),
('BOARD_ARCHITECTURE','Board Architecture','Approved board architecture values.'),
('GPU_CLASS','GPU Class','Approved GPU product classes.'),
('POOL_TEAM','Pool / Team','Operational ownership pools and teams.');
INSERT INTO lookup_values(lookup_list_id,value_key,display_value,description,display_order)
SELECT l.id, v.value_key, v.display_value, v.description, v.display_order
FROM lookup_lists l
CROSS JOIN (VALUES
('IN_USE','IN_USE','Assigned, deployed, installed, or actively used and not generally available.',10),
('REWORK','REWORK','Requires repair, testing, cleaning, reconfiguration, or corrective action.',20),
('E_WASTE','E_WASTE','End-of-life and designated for recycling or disposal.',30),
('ARCHIVE','ARCHIVE','Inactive and retained for history, compliance, warranty, or reference.',40),
('GPU_READY','GPU_READY','Prepared and verified for GPU-related deployment, testing, or allocation.',50),
('AVAILABLE','AVAILABLE','On hand, usable, and not assigned, blocked, archived, or pending disposition.',60)
) AS v(value_key,display_value,description,display_order)
WHERE l.lookup_key='ASSET_STATUS';

INSERT INTO lookup_values(lookup_list_id,value_key,display_value,description,display_order)
SELECT l.id, v.value_key, v.display_value, 'Approved Board Architecture value.', v.display_order
FROM lookup_lists l
CROSS JOIN (VALUES
('ADA','ADA',10),
('AMPERE','AMPERE',20),
('BLACKWELL','BLACKWELL',30),
('CONCORD','Concord',40),
('DGX_SPARK','DGX-Spark',50),
('FERRIX','Ferrix',60),
('FIRESPRAY','Firespray',70),
('HOPPER','HOPPER',80),
('JEDHA','Jedha',90),
('NA','NA',100),
('ORIN','Orin',110),
('OSG','OSG',120),
('RUBIN','RUBIN',130),
('SDEV','SDEV',140),
('TH500','TH500',150),
('TURING','TURING',160),
('VOLTA','VOLTA',170),
('XAVIER','Xavier',180),
('PASCAL','PASCAL',190),
('MAXWELL','MAXWELL',200),
('KEPLER','KEPLER',210),
('N1X','N1X',220),
('N1C','N1C',230)
) AS v(value_key,display_value,display_order)
WHERE l.lookup_key='BOARD_ARCHITECTURE';

INSERT INTO lookup_values(lookup_list_id,value_key,display_value,description,display_order)
SELECT l.id, v.value_key, v.display_value, 'Approved GPU Class value.', v.display_order
FROM lookup_lists l
CROSS JOIN (VALUES
('TESLA','Tesla',10),
('GEFORCE','GeForce',20),
('QUADRO','Quadro',30),
('TITAN','Titan',40),
('NONE','None',50)
) AS v(value_key,display_value,display_order)
WHERE l.lookup_key='GPU_CLASS';

INSERT INTO categories(category_key,category_name,description,icon_key,display_order) VALUES
('GPU','GPU','Graphics processing units and accelerator boards.','gpu',10),
('SERVER','Server','Lab servers and shared compute systems.','server',20),
('SWITCH','Switch','Network switches and fabric devices.','network',30),
('CABLE','Cable','Tracked lab cables and interconnects.','cable',40),
('NIC','NIC','Network interface cards and adapters.','network',50),
('SSD','SSD','Solid-state storage devices.','drive',60),
('M2_DRIVE','M.2 Drive','M.2 storage devices.','drive',70),
('MISCELLANEOUS','Miscellaneous','Other tracked hardware.','box',80),
('NVLINK','NVLink','NVLink bridges and interconnect hardware.','link',90),
('LOW_PRICE_CONSUMABLES','Low-price Consumables','Quantity-oriented consumable inventory.','package',130),
('RASPBERRY_PI','Raspberry Pi','Raspberry Pi systems and accessories.','cpu',140),
('NEW_HIRE_KITS','New Hire Kits','Prepared employee equipment kits.','briefcase',150);

INSERT INTO asset_profiles(category_id,profile_key,profile_name,description)
SELECT id, category_key || '_ASSET', category_name || ' Asset', description FROM categories;

INSERT INTO field_definitions(field_key,field_label,definition,help_text,data_type,lookup_list_id,storage_target,import_aliases,validation_rules,unique_when_populated) VALUES
('mrs_order','MRS order #','Material Request System order number.','Multiple MRS order numbers may be separated with commas.','multi_reference',NULL,'external_reference:MRS_ORDER',ARRAY['MRS order #','MRS Order','MRS'], '{}'::jsonb,false),
('nvbugs','NVBugs #','Internal bug-tracking numbers used to track bugs, enhancements, and tasks.','Enter one or more numeric NVBug values; pasted NVBug URLs are normalized.','multi_reference',NULL,'external_reference:NVBUG',ARRAY['NVBugs #','NVBug #','JIRA Ticket'], '{"pattern":"^[0-9, /:._-]+$"}'::jsonb,false),
('capacity_request','Capacity Request #','Internal Capacity Request Number.','Enter the internal Capacity Request number when available.','multi_reference',NULL,'external_reference:CAPACITY_REQUEST',ARRAY['Capacity Request #','Capacity Request'], '{}'::jsonb,false),
('date_received','Date Received','Date the item was physically received into inventory.','Use the original receipt date.','date',NULL,'assets.date_received',ARRAY['Date Received','Arrive Date','Setup Date'], '{}'::jsonb,false),
('board_sku','Board SKU','Board or card assembly identifier.','Shared model-level value.','text',NULL,'asset_models.board_sku',ARRAY['Board SKU','Board SKU #'], '{}'::jsonb,false),
('gpu_sku','GPU SKU','GPU or chip variant identifier.','Shared model-level value.','text',NULL,'asset_models.gpu_sku',ARRAY['GPU SKU','Chip SKU'], '{}'::jsonb,false),
('model_number','Model #','Manufacturer model number for the shared asset model.','Models group assets with the same specifications.','text',NULL,'asset_models.model_number',ARRAY['Model #','Model Number','Model'], '{}'::jsonb,false),
('serial_number','Serial #','Manufacturer serial number for one physical item.','Must be unique across active and archived inventory.','text',NULL,'assets.serial_number',ARRAY['Serial #','Serial No.','Serial Number','Serial'], '{}'::jsonb,true),
('milestone','Milestone','Engineering lifecycle checkpoint or release gate.','Use the recognized program milestone where applicable.','text',NULL,'assets.milestone',ARRAY['Milestone'], '{}'::jsonb,false),
('product_name','Product Name','User-facing or branded product name.','Shared model-level display name.','text',NULL,'asset_models.product_name',ARRAY['Product Name','Item Name'], '{}'::jsonb,false),
('location','Location','Optional physical placement in the location hierarchy.','Select the most specific known Building, Lab, Rack, RU, Cabinet, or Storage location.','entity',NULL,'assets.location_id',ARRAY['Location','Asset Location'], '{}'::jsonb,false),
('asset_status','Status','Controlled inventory lifecycle status.','Status controls availability and lifecycle reporting.','lookup',(SELECT id FROM lookup_lists WHERE lookup_key='ASSET_STATUS'),'assets.status_value_id',ARRAY['Status','Asset Status'], '{}'::jsonb,false),
('board_architecture','Board Architecture','GPU or board architecture family.','Shared model-level architecture when applicable.','lookup',(SELECT id FROM lookup_lists WHERE lookup_key='BOARD_ARCHITECTURE'),'asset_models.board_architecture',ARRAY['Board Architecture','Architecture'], '{}'::jsonb,false),
('gpu_class','GPU Class','Product class used to position a GPU offering.','Optional shared model-level class such as Tesla, GeForce, Quadro, or Titan.','lookup',(SELECT id FROM lookup_lists WHERE lookup_key='GPU_CLASS'),'asset_models.gpu_class',ARRAY['GPU Class','Class'], '{}'::jsonb,false),
('gpu_chip','GPU Chip','Internal GPU chip identifier.','Optional shared model-level chip value such as GB200 or TH500.','text',NULL,'asset_models.gpu_chip',ARRAY['GPU Chip','Chip'], '{}'::jsonb,false),
('gpu_name_vrl','GPU Name - VRL','Internal VRL GPU name.','Optional internal GPU name used by VRL and engineering references.','text',NULL,'asset_models.gpu_name_vrl',ARRAY['GPU Name - VRL','GPU Name VRL','VRL GPU Name'], '{}'::jsonb,false),
('gpu_name_market','GPU Name - Market','External or market-facing GPU name.','Optional shared market name for the GPU model.','text',NULL,'asset_models.gpu_name_market',ARRAY['GPU Name - Market','GPU Name Market','Market GPU Name'], '{}'::jsonb,false),
('pool_team','Pool/Team','Operational team or inventory pool.','Use a controlled team value when available.','lookup',(SELECT id FROM lookup_lists WHERE lookup_key='POOL_TEAM'),'assets.pool_team',ARRAY['Pool/Team','Pool','Team'], '{}'::jsonb,false),
('project','Project','Operational project or activity using the asset.','Optional free-text project reference.','text',NULL,'assets.project',ARRAY['Project'], '{}'::jsonb,false),
('asset_tag','Asset Tag #','Organization-managed identifier applied to one asset.','Must be unique when provided.','text',NULL,'assets.asset_tag',ARRAY['Asset Tag #','Asset Tag','Tag'], '{}'::jsonb,true),
('owner','Owner / Assignee','Person accountable for or assigned to the asset.','Select an active application user; choose Guest / not listed only when necessary.','entity',NULL,'assets.owner_user_id',ARRAY['Owner / Assignee','Owner','Assignee'], '{}'::jsonb,false),
('notes','Notes','Operational notes that do not belong in another structured field.','Do not store credentials or sensitive personal data.','long_text',NULL,'assets.notes',ARRAY['Notes','Comments'], '{"maxLength":2000}'::jsonb,false),
('vendor','Vendor','Supplier or source organization for the asset.','Select an active vendor.','entity',NULL,'assets.vendor_id',ARRAY['Vendor','Supplier'], '{}'::jsonb,false);

INSERT INTO profile_fields(profile_id,field_definition_id,required,display_order)
SELECT p.id, f.id,
       f.field_key IN ('nvbugs','date_received','model_number','serial_number','product_name','asset_status','owner','vendor'),
       array_position(ARRAY['mrs_order','nvbugs','capacity_request','date_received','board_sku','gpu_sku','model_number','serial_number','milestone','product_name','location','asset_status','board_architecture','pool_team','project','asset_tag','owner','notes','vendor'], f.field_key)
FROM asset_profiles p CROSS JOIN field_definitions f
WHERE f.field_key = ANY(ARRAY['mrs_order','nvbugs','capacity_request','date_received','board_sku','gpu_sku','model_number','serial_number','milestone','product_name','location','asset_status','board_architecture','pool_team','project','asset_tag','owner','notes','vendor']);

INSERT INTO profile_fields(profile_id,field_definition_id,required,display_order)
SELECT p.id, f.id, false,
       array_position(ARRAY['gpu_class','gpu_chip','gpu_name_vrl','gpu_name_market'], f.field_key) + 19
FROM asset_profiles p
JOIN categories c ON c.id=p.category_id AND c.category_key='GPU'
CROSS JOIN field_definitions f
WHERE f.field_key = ANY(ARRAY['gpu_class','gpu_chip','gpu_name_vrl','gpu_name_market']);

INSERT INTO import_profiles(profile_id,import_profile_key,import_profile_name)
SELECT id, profile_key || '_CSV', profile_name || ' CSV' FROM asset_profiles;

INSERT INTO location_types(type_key,type_name,level_order) VALUES
('BUILDING','Building',10),('LAB_ROOM','Lab / Room',20),('RACK','Rack',30),('RU','Rack Unit',40),('CABINET_STORAGE','Cabinet / Storage',50);

INSERT INTO external_reference_types(reference_type_key,reference_type_name,url_template,validation_pattern) VALUES
('NVBUG','NVBug','https://nvbugspro.nvidia.com/bug/{value}','^[0-9]+$'),
('MRS_ORDER','MRS order',NULL,NULL),
('CAPACITY_REQUEST','Capacity Request',NULL,NULL);

INSERT INTO manufacturers(manufacturer_name) VALUES ('NVIDIA'),('Dell'),('Lenovo'),('HPE'),('Other');
INSERT INTO vendors(vendor_name) VALUES ('NVIDIA Lab Supply'),('Internal Transfer'),('Approved Integration Vendor'),('Other');

INSERT INTO schema_migrations(migration_key,description)
VALUES ('001-production-baseline','Fresh normalized production baseline for Inventory Project 1.0.');

DO $$
DECLARE required_count integer; optional_count integer; standard_count integer; gpu_extension_count integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE required), count(*) FILTER (WHERE NOT required)
  INTO standard_count, required_count, optional_count
  FROM profile_fields pf
  JOIN asset_profiles ap ON ap.id=pf.profile_id
  JOIN field_definitions fd ON fd.id=pf.field_definition_id
  WHERE ap.profile_key='GPU_ASSET'
    AND fd.field_key = ANY(ARRAY['mrs_order','nvbugs','capacity_request','date_received','board_sku','gpu_sku','model_number','serial_number','milestone','product_name','location','asset_status','board_architecture','pool_team','project','asset_tag','owner','notes','vendor']);
  SELECT count(*) INTO gpu_extension_count
  FROM profile_fields pf
  JOIN asset_profiles ap ON ap.id=pf.profile_id
  JOIN field_definitions fd ON fd.id=pf.field_definition_id
  WHERE ap.profile_key='GPU_ASSET'
    AND NOT pf.required
    AND fd.field_key = ANY(ARRAY['gpu_class','gpu_chip','gpu_name_vrl','gpu_name_market']);
  IF standard_count <> 19 OR required_count <> 8 OR optional_count <> 11 OR gpu_extension_count <> 4 THEN
    RAISE EXCEPTION 'Invalid contract: standard %, required %, optional %, GPU extensions %', standard_count, required_count, optional_count, gpu_extension_count;
  END IF;
END $$;

COMMIT;
