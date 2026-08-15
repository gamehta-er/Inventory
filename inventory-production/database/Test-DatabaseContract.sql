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

    IF application_table_count <> 40 THEN
        RAISE EXCEPTION 'DATA-001: expected 40 application tables, found %', application_table_count;
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

    IF has_schema_privilege('inventory_app', 'invmgmt', 'CREATE') THEN
        RAISE EXCEPTION 'DATA-015: runtime role or PUBLIC can create objects in invmgmt';
    END IF;

    IF NOT has_schema_privilege('inventory_app', 'invmgmt', 'USAGE') THEN
        RAISE EXCEPTION 'DATA-015: runtime role cannot use invmgmt';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
            'import_batches',
            'import_column_mappings',
            'import_batch_rows',
            'import_validation_issues',
            'import_commit_results',
            'import_runtime_control'
        ]) AS import_table(table_name)
        WHERE NOT has_table_privilege(
            'inventory_app',
            format('invmgmt.%I', import_table.table_name),
            'SELECT,INSERT,UPDATE,DELETE'
        )
    ) THEN
        RAISE EXCEPTION 'IMPORT-014: runtime role cannot operate every Import workflow table';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM unnest(ARRAY['import_reviews','import_stage_events']) AS evidence_table(table_name)
        WHERE NOT has_table_privilege(
            'inventory_app',
            format('invmgmt.%I', evidence_table.table_name),
            'SELECT,INSERT'
        )
    ) THEN
        RAISE EXCEPTION 'IMPORT-014: runtime role cannot append governed Import evidence';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM unnest(ARRAY['import_reviews','import_stage_events']) AS evidence_table(table_name)
        WHERE has_table_privilege(
            'inventory_app',
            format('invmgmt.%I', evidence_table.table_name),
            'UPDATE'
        )
        OR has_table_privilege(
            'inventory_app',
            format('invmgmt.%I', evidence_table.table_name),
            'DELETE'
        )
    ) THEN
        RAISE EXCEPTION 'IMPORT-014: runtime role can mutate append-only Import evidence';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM invmgmt.import_runtime_control
        WHERE control_key='GLOBAL' AND mode IN ('DISABLED','CANARY','ENABLED')
    ) THEN
        RAISE EXCEPTION 'IMPORT-014: global Import runtime control is missing';
    END IF;

    IF (SELECT count(*) FROM invmgmt.field_definitions WHERE active) <> 23
       OR (SELECT count(*) FROM invmgmt.field_definitions
           WHERE active AND field_key=ANY(ARRAY['gpu_class','gpu_chip','gpu_name_vrl','gpu_name_market'])) <> 4 THEN
        RAISE EXCEPTION 'DATA-009: active field definition contract is not 19 standard plus 4 GPU fields';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM invmgmt.asset_profiles p
        JOIN invmgmt.categories c ON c.id=p.category_id
        LEFT JOIN invmgmt.profile_fields pf ON pf.profile_id = p.id AND pf.active
        LEFT JOIN invmgmt.field_definitions fd ON fd.id=pf.field_definition_id AND fd.active
        WHERE p.active
        GROUP BY p.id,c.category_key
        HAVING count(fd.id) <> CASE WHEN c.category_key='GPU' THEN 23 ELSE 19 END
            OR count(fd.id) FILTER (WHERE pf.required) <> 8
            OR count(fd.id) FILTER (WHERE NOT pf.required) <> CASE WHEN c.category_key='GPU' THEN 15 ELSE 11 END
            OR count(fd.id) FILTER (
                WHERE fd.field_key=ANY(ARRAY['gpu_class','gpu_chip','gpu_name_vrl','gpu_name_market'])
            ) <> CASE WHEN c.category_key='GPU' THEN 4 ELSE 0 END
    ) THEN
        RAISE EXCEPTION 'DATA-009: an active profile does not have the approved 19-field standard and GPU extension contract';
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

    IF NOT EXISTS (
        SELECT 1
        FROM pg_index unique_index
        JOIN pg_class asset_table ON asset_table.oid=unique_index.indrelid
        JOIN pg_namespace asset_schema ON asset_schema.oid=asset_table.relnamespace
        WHERE asset_schema.nspname='invmgmt'
          AND asset_table.relname='assets'
          AND unique_index.indisunique
          AND unique_index.indpred IS NULL
          AND position('(serial_number)' IN pg_get_indexdef(unique_index.indexrelid))>0
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_index unique_index
        JOIN pg_class asset_table ON asset_table.oid=unique_index.indrelid
        JOIN pg_namespace asset_schema ON asset_schema.oid=asset_table.relnamespace
        WHERE asset_schema.nspname='invmgmt'
          AND asset_table.relname='assets'
          AND unique_index.indisunique
          AND unique_index.indpred IS NOT NULL
          AND position('(asset_tag)' IN pg_get_indexdef(unique_index.indexrelid))>0
          AND pg_get_expr(unique_index.indpred,unique_index.indrelid) ILIKE '%asset_tag IS NOT NULL%'
          AND pg_get_expr(unique_index.indpred,unique_index.indrelid) ILIKE '%btrim(asset_tag)%'
    ) THEN
        RAISE EXCEPTION 'DATA-008: serial or populated asset-tag uniqueness is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM invmgmt.schema_migrations
        WHERE migration_key = '009-governed-import-reliability'
    ) THEN
        RAISE EXCEPTION 'DATA-014: governed Import reliability migration is not recorded';
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
