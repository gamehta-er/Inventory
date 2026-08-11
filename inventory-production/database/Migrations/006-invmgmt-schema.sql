\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('inventory-project:006-invmgmt-schema'));

DO $$
BEGIN
    IF current_database() <> 'inventory_project' THEN
        RAISE EXCEPTION 'Migration 006 must run in inventory_project, not %', current_database();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'inventory_app') THEN
        RAISE EXCEPTION 'Required application role inventory_app does not exist';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'inventory_owner') THEN
        CREATE ROLE inventory_owner NOLOGIN NOINHERIT;
    END IF;

    IF to_regclass('public.schema_migrations') IS NULL
       AND to_regclass('invmgmt.schema_migrations') IS NULL THEN
        RAISE EXCEPTION 'Inventory migration ledger was not found';
    END IF;

    IF to_regclass('public.schema_migrations') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM public.schema_migrations
           WHERE migration_key = '005-complete-import-workflow'
       ) THEN
        RAISE EXCEPTION 'Migration 005-complete-import-workflow must be applied first';
    END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS invmgmt AUTHORIZATION inventory_owner;
ALTER SCHEMA invmgmt OWNER TO inventory_owner;

DO $$
DECLARE
    table_name text;
    application_tables constant text[] := ARRAY[
        'schema_migrations',
        'roles',
        'permissions',
        'role_permissions',
        'application_users',
        'application_user_roles',
        'application_sessions',
        'lookup_lists',
        'lookup_values',
        'categories',
        'asset_profiles',
        'field_definitions',
        'profile_fields',
        'profile_versions',
        'manufacturers',
        'vendors',
        'asset_models',
        'location_types',
        'locations',
        'assets',
        'asset_field_values',
        'external_reference_types',
        'asset_external_references',
        'asset_assignments',
        'asset_status_events',
        'asset_transfers',
        'asset_relationships',
        'import_profiles',
        'import_batches',
        'import_column_mappings',
        'import_batch_rows',
        'import_validation_issues',
        'import_commit_results',
        'saved_reports',
        'export_definitions',
        'activity_events',
        'activity_field_changes'
    ];
BEGIN
    FOREACH table_name IN ARRAY application_tables LOOP
        IF to_regclass(format('invmgmt.%I', table_name)) IS NOT NULL THEN
            IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
                RAISE EXCEPTION 'Inventory table % exists in both public and invmgmt', table_name;
            END IF;
        ELSIF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.%I SET SCHEMA invmgmt', table_name);
        ELSE
            RAISE EXCEPTION 'Required Inventory table % was not found', table_name;
        END IF;

        EXECUTE format('ALTER TABLE invmgmt.%I OWNER TO inventory_owner', table_name);
    END LOOP;
END;
$$;

DO $$
BEGIN
    IF to_regprocedure('public.reject_activity_mutation()') IS NOT NULL THEN
        ALTER FUNCTION public.reject_activity_mutation() SET SCHEMA invmgmt;
    END IF;

    IF to_regprocedure('invmgmt.reject_activity_mutation()') IS NULL THEN
        RAISE EXCEPTION 'Inventory activity immutability function was not found';
    END IF;

    ALTER FUNCTION invmgmt.reject_activity_mutation() OWNER TO inventory_owner;
END;
$$;

ALTER DATABASE inventory_project OWNER TO inventory_owner;
ALTER DATABASE inventory_project
    SET search_path = invmgmt, public;
ALTER ROLE inventory_app IN DATABASE inventory_project
    SET search_path = invmgmt, public;
ALTER ROLE inventory_owner IN DATABASE inventory_project
    SET search_path = invmgmt, public;

REVOKE ALL ON DATABASE inventory_project FROM PUBLIC;
GRANT CONNECT ON DATABASE inventory_project TO inventory_app;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM inventory_app;
REVOKE ALL ON SCHEMA invmgmt FROM PUBLIC;
REVOKE CREATE ON SCHEMA invmgmt FROM inventory_app;
GRANT USAGE ON SCHEMA invmgmt TO inventory_app;

REVOKE ALL ON ALL TABLES IN SCHEMA invmgmt FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA invmgmt FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA invmgmt FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA invmgmt TO inventory_app;
GRANT USAGE, SELECT, UPDATE
    ON ALL SEQUENCES IN SCHEMA invmgmt TO inventory_app;
GRANT EXECUTE
    ON ALL FUNCTIONS IN SCHEMA invmgmt TO inventory_app;

ALTER DEFAULT PRIVILEGES FOR ROLE inventory_owner IN SCHEMA invmgmt
    REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE inventory_owner IN SCHEMA invmgmt
    REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE inventory_owner
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE inventory_owner IN SCHEMA invmgmt
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO inventory_app;
ALTER DEFAULT PRIVILEGES FOR ROLE inventory_owner IN SCHEMA invmgmt
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO inventory_app;
ALTER DEFAULT PRIVILEGES FOR ROLE inventory_owner IN SCHEMA invmgmt
    GRANT EXECUTE ON FUNCTIONS TO inventory_app;

INSERT INTO invmgmt.schema_migrations(migration_key, description)
VALUES (
    '006-invmgmt-schema',
    'Moves Inventory objects from public to invmgmt and enforces owner/application role separation.'
)
ON CONFLICT (migration_key) DO NOTHING;

DO $$
DECLARE
    table_count integer;
    wrong_owner_count integer;
    public_inventory_count integer;
BEGIN
    SELECT count(*)
    INTO table_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'invmgmt'
      AND c.relkind IN ('r', 'p');

    SELECT count(*)
    INTO wrong_owner_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE n.nspname = 'invmgmt'
      AND c.relkind IN ('r', 'p')
      AND r.rolname <> 'inventory_owner';

    SELECT count(*)
    INTO public_inventory_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname = ANY (ARRAY[
          'schema_migrations', 'roles', 'permissions', 'role_permissions',
          'application_users', 'application_user_roles', 'application_sessions',
          'lookup_lists', 'lookup_values', 'categories', 'asset_profiles',
          'field_definitions', 'profile_fields', 'profile_versions',
          'manufacturers', 'vendors', 'asset_models', 'location_types',
          'locations', 'assets', 'asset_field_values', 'external_reference_types',
          'asset_external_references', 'asset_assignments', 'asset_status_events',
          'asset_transfers', 'asset_relationships', 'import_profiles',
          'import_batches', 'import_column_mappings', 'import_batch_rows',
          'import_validation_issues', 'import_commit_results', 'saved_reports',
          'export_definitions', 'activity_events', 'activity_field_changes'
      ]);

    IF table_count <> 37 OR wrong_owner_count <> 0 OR public_inventory_count <> 0 THEN
        RAISE EXCEPTION
            'Schema migration verification failed: tables %, wrong owners %, public Inventory tables %',
            table_count,
            wrong_owner_count,
            public_inventory_count;
    END IF;
END;
$$;

COMMIT;
