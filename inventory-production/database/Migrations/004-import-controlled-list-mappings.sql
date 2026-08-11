\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM schema_migrations WHERE migration_key = '004-import-controlled-list-mappings'
    ) THEN
        UPDATE lookup_lists
        SET active = true,
            updated_at = now()
        WHERE lookup_key IN ('ASSET_STATUS', 'BOARD_ARCHITECTURE', 'POOL_TEAM');

        UPDATE field_definitions field
        SET data_type = 'lookup',
            lookup_list_id = list.id,
            updated_at = now()
        FROM lookup_lists list
        WHERE (field.field_key, list.lookup_key) IN (
            ('asset_status', 'ASSET_STATUS'),
            ('board_architecture', 'BOARD_ARCHITECTURE'),
            ('pool_team', 'POOL_TEAM')
        )
          AND (
              field.data_type IS DISTINCT FROM 'lookup'
              OR field.lookup_list_id IS DISTINCT FROM list.id
          );

        INSERT INTO schema_migrations(migration_key, description)
        VALUES (
            '004-import-controlled-list-mappings',
            'Enforces controlled-list mappings for Status, Board Architecture, and Pool/Team imports.'
        );
    END IF;
END $$;

DO $$
DECLARE
    missing_mappings text;
BEGIN
    SELECT string_agg(expected.field_key, ', ' ORDER BY expected.field_key)
    INTO missing_mappings
    FROM (VALUES
        ('asset_status', 'ASSET_STATUS'),
        ('board_architecture', 'BOARD_ARCHITECTURE'),
        ('pool_team', 'POOL_TEAM')
    ) AS expected(field_key, lookup_key)
    LEFT JOIN field_definitions field ON field.field_key = expected.field_key
    LEFT JOIN lookup_lists list ON list.id = field.lookup_list_id
    WHERE field.id IS NULL
       OR field.data_type <> 'lookup'
       OR list.lookup_key IS DISTINCT FROM expected.lookup_key
       OR NOT list.active;

    IF missing_mappings IS NOT NULL THEN
        RAISE EXCEPTION 'Controlled-list mappings remain invalid for: %', missing_mappings;
    END IF;
END $$;

COMMIT;
