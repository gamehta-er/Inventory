\set ON_ERROR_STOP on

\echo 'Inventory Project Framework v1.0 database contract'

DO $$
DECLARE
    application_table_count integer;
    table_without_primary_key_count integer;
    foreign_key_outside_schema_count integer;
    wrong_owner_count integer;
    public_inventory_table_count integer;
    status_values text[];
BEGIN
    IF current_database() <> 'inventory_project' THEN
        RAISE EXCEPTION 'DATA-002: expected inventory_project, found %', current_database();
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_namespace n
        JOIN pg_roles r ON r.oid = n.nspowner
        WHERE n.nspname = 'invmgmt'
          AND r.rolname = 'inventory_owner'
    ) THEN
        RAISE EXCEPTION 'DATA-001: invmgmt schema is missing or has the wrong owner';
    END IF;

    SELECT count(*)
    INTO application_table_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'invmgmt'
      AND c.relkind IN ('r', 'p');

    IF application_table_count <> 37 THEN
        RAISE EXCEPTION 'DATA-001: expected 37 application tables, found %', application_table_count;
    END IF;

    SELECT count(*)
    INTO table_without_primary_key_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'invmgmt'
      AND c.relkind IN ('r', 'p')
      AND NOT EXISTS (
          SELECT 1 FROM pg_constraint pk
          WHERE pk.conrelid = c.oid AND pk.contype = 'p'
      );

    IF table_without_primary_key_count <> 0 THEN
        RAISE EXCEPTION 'DATA-003: % application table(s) have no primary key', table_without_primary_key_count;
    END IF;

    SELECT count(*)
    INTO foreign_key_outside_schema_count
    FROM pg_constraint fk
    JOIN pg_class source_table ON source_table.oid = fk.conrelid
    JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
    JOIN pg_class target_table ON target_table.oid = fk.confrelid
    JOIN pg_namespace target_schema ON target_schema.oid = target_table.relnamespace
    WHERE fk.contype = 'f'
      AND source_schema.nspname = 'invmgmt'
      AND target_schema.nspname <> 'invmgmt';

    IF foreign_key_outside_schema_count <> 0 THEN
        RAISE EXCEPTION 'DATA-003: % foreign key(s) leave invmgmt', foreign_key_outside_schema_count;
    END IF;

    SELECT count(*)
    INTO wrong_owner_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE n.nspname = 'invmgmt'
      AND c.relkind IN ('r', 'p')
      AND r.rolname <> 'inventory_owner';

    IF wrong_owner_count <> 0 THEN
        RAISE EXCEPTION 'DATA-015: % application table(s) have the wrong owner', wrong_owner_count;
    END IF;

    SELECT count(*)
    INTO public_inventory_table_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'invmgmt');

    IF public_inventory_table_count <> 0 THEN
        RAISE EXCEPTION 'DATA-001: % Inventory table(s) remain in public', public_inventory_table_count;
    END IF;

    IF has_schema_privilege('inventory_app', 'invmgmt', 'CREATE')
       OR has_schema_privilege('PUBLIC', 'invmgmt', 'CREATE') THEN
        RAISE EXCEPTION 'DATA-015: runtime role or PUBLIC can create objects in invmgmt';
    END IF;

    IF NOT has_schema_privilege('inventory_app', 'invmgmt', 'USAGE') THEN
        RAISE EXCEPTION 'DATA-015: runtime role cannot use invmgmt';
    END IF;

    IF (SELECT count(*) FROM invmgmt.field_definitions WHERE active) <> 19 THEN
        RAISE EXCEPTION 'DATA-009: active field definition count is not 19';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM invmgmt.asset_profiles p
        LEFT JOIN invmgmt.profile_fields pf ON pf.profile_id = p.id AND pf.active
        WHERE p.active
        GROUP BY p.id
        HAVING count(pf.id) <> 19
            OR count(pf.id) FILTER (WHERE pf.required) <> 8
            OR count(pf.id) FILTER (WHERE NOT pf.required) <> 11
    ) THEN
        RAISE EXCEPTION 'DATA-009: an active profile does not have the approved 19/8/11 field contract';
    END IF;

    SELECT array_agg(lv.value_key ORDER BY lv.value_key)
    INTO status_values
    FROM invmgmt.lookup_values lv
    JOIN invmgmt.lookup_lists ll ON ll.id = lv.lookup_list_id
    WHERE ll.lookup_key = 'ASSET_STATUS'
      AND lv.active;

    IF status_values IS DISTINCT FROM ARRAY['ARCHIVE','AVAILABLE','E_WASTE','GPU_READY','IN_USE','REWORK']::text[] THEN
        RAISE EXCEPTION 'DATA-010: lifecycle status contract is invalid: %', status_values;
    END IF;

    IF to_regclass('invmgmt.assets_serial_number_key') IS NULL
       OR to_regclass('invmgmt.assets_asset_tag_unique') IS NULL THEN
        RAISE EXCEPTION 'DATA-008: serial or populated asset-tag uniqueness is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM invmgmt.schema_migrations
        WHERE migration_key = '006-invmgmt-schema'
    ) THEN
        RAISE EXCEPTION 'DATA-014: invmgmt migration is not recorded';
    END IF;
END;
$$;

BEGIN;
INSERT INTO invmgmt.vendors(vendor_name, active)
VALUES ('__FRAMEWORK_ROLLBACK_TEST__', true);
ROLLBACK;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM invmgmt.vendors
        WHERE vendor_name = '__FRAMEWORK_ROLLBACK_TEST__'
    ) THEN
        RAISE EXCEPTION 'DATA-014: transaction rollback verification failed';
    END IF;
END;
$$;

SELECT
    'PASS' AS result,
    current_database() AS database_name,
    count(*) AS application_tables
FROM information_schema.tables
WHERE table_schema = 'invmgmt';
