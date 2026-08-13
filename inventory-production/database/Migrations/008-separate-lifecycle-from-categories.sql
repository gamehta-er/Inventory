\set ON_ERROR_STOP on

BEGIN;
SET LOCAL search_path TO invmgmt, public;

SELECT pg_advisory_xact_lock(hashtext('inventory-project-migrations'));

DO $$
DECLARE
    affected_asset_count integer;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE migration_key = '008-separate-lifecycle-from-categories'
    ) THEN
        SELECT count(*)
        INTO affected_asset_count
        FROM assets asset
        JOIN asset_models model ON model.id=asset.asset_model_id
        JOIN categories category ON category.id=model.category_id
        WHERE upper(regexp_replace(category.category_key,'[^A-Za-z0-9]+','_','g'))
                =ANY(ARRAY['IN_USE','REWORK','E_WASTE','ARCHIVE','GPU_READY','AVAILABLE'])
           OR upper(regexp_replace(category.category_name,'[^A-Za-z0-9]+','_','g'))
                =ANY(ARRAY['IN_USE','REWORK','E_WASTE','ARCHIVE','GPU_READY','AVAILABLE']);

        IF affected_asset_count<>0 THEN
            RAISE EXCEPTION
                'Lifecycle/category correction stopped because % asset(s) use a reserved lifecycle category.',
                affected_asset_count;
        END IF;

        UPDATE import_profiles import_profile
        SET active=false,updated_at=now()
        FROM asset_profiles profile
        JOIN categories category ON category.id=profile.category_id
        WHERE import_profile.profile_id=profile.id
          AND import_profile.active
          AND (
              upper(regexp_replace(category.category_key,'[^A-Za-z0-9]+','_','g'))
                  =ANY(ARRAY['IN_USE','REWORK','E_WASTE','ARCHIVE','GPU_READY','AVAILABLE'])
              OR upper(regexp_replace(category.category_name,'[^A-Za-z0-9]+','_','g'))
                   =ANY(ARRAY['IN_USE','REWORK','E_WASTE','ARCHIVE','GPU_READY','AVAILABLE'])
          );

        UPDATE asset_profiles profile
        SET active=false,updated_at=now()
        FROM categories category
        WHERE profile.category_id=category.id
          AND profile.active
          AND (
              upper(regexp_replace(category.category_key,'[^A-Za-z0-9]+','_','g'))
                  =ANY(ARRAY['IN_USE','REWORK','E_WASTE','ARCHIVE','GPU_READY','AVAILABLE'])
              OR upper(regexp_replace(category.category_name,'[^A-Za-z0-9]+','_','g'))
                   =ANY(ARRAY['IN_USE','REWORK','E_WASTE','ARCHIVE','GPU_READY','AVAILABLE'])
          );

        UPDATE categories
        SET active=false,updated_at=now()
        WHERE active
          AND (
              upper(regexp_replace(category_key,'[^A-Za-z0-9]+','_','g'))
                  =ANY(ARRAY['IN_USE','REWORK','E_WASTE','ARCHIVE','GPU_READY','AVAILABLE'])
              OR upper(regexp_replace(category_name,'[^A-Za-z0-9]+','_','g'))
                   =ANY(ARRAY['IN_USE','REWORK','E_WASTE','ARCHIVE','GPU_READY','AVAILABLE'])
          );

        ALTER TABLE categories
            DROP CONSTRAINT IF EXISTS categories_asset_family_key_check;
        ALTER TABLE categories
            ADD CONSTRAINT categories_asset_family_key_check CHECK (
                NOT active OR (
                    upper(regexp_replace(category_key,'[^A-Za-z0-9]+','_','g'))
                        <> ALL (ARRAY['IN_USE','REWORK','E_WASTE','ARCHIVE','GPU_READY','AVAILABLE']::text[])
                    AND upper(regexp_replace(category_name,'[^A-Za-z0-9]+','_','g'))
                        <> ALL (ARRAY['IN_USE','REWORK','E_WASTE','ARCHIVE','GPU_READY','AVAILABLE']::text[])
                )
            );

        INSERT INTO schema_migrations(migration_key,description)
        VALUES (
            '008-separate-lifecycle-from-categories',
            'Deactivates lifecycle pseudo-categories and reserves lifecycle values for asset status only.'
        );
    END IF;
END;
$$;

DO $$
DECLARE
    active_reserved_count integer;
    constraint_count integer;
BEGIN
    SELECT count(*)
    INTO active_reserved_count
    FROM categories
    WHERE active
      AND (
          upper(regexp_replace(category_key,'[^A-Za-z0-9]+','_','g'))
              =ANY(ARRAY['IN_USE','REWORK','E_WASTE','ARCHIVE','GPU_READY','AVAILABLE'])
          OR upper(regexp_replace(category_name,'[^A-Za-z0-9]+','_','g'))
               =ANY(ARRAY['IN_USE','REWORK','E_WASTE','ARCHIVE','GPU_READY','AVAILABLE'])
      );

    SELECT count(*)
    INTO constraint_count
    FROM pg_constraint
    WHERE conrelid='categories'::regclass
      AND conname='categories_asset_family_key_check';

    IF active_reserved_count<>0 OR constraint_count<>1 THEN
        RAISE EXCEPTION
            'Lifecycle/category verification failed: active reserved categories %, constraints %.',
            active_reserved_count,
            constraint_count;
    END IF;
END;
$$;

COMMIT;
