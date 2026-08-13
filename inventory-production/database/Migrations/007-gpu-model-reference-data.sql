\set ON_ERROR_STOP on

BEGIN;
SET LOCAL search_path TO invmgmt, public;

SELECT pg_advisory_xact_lock(hashtext('inventory-project-migrations'));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM schema_migrations
        WHERE migration_key = '007-gpu-model-reference-data'
    ) THEN
        ALTER TABLE asset_models ADD COLUMN IF NOT EXISTS gpu_class text;
        ALTER TABLE asset_models ADD COLUMN IF NOT EXISTS gpu_chip text;
        ALTER TABLE asset_models ADD COLUMN IF NOT EXISTS gpu_name_vrl text;
        ALTER TABLE asset_models ADD COLUMN IF NOT EXISTS gpu_name_market text;

        INSERT INTO lookup_lists(lookup_key,lookup_name,description,active)
        VALUES ('GPU_CLASS','GPU Class','Approved GPU product classes.',true)
        ON CONFLICT (lookup_key) DO UPDATE
        SET lookup_name=EXCLUDED.lookup_name,
            description=EXCLUDED.description,
            active=true,
            updated_at=now();

        INSERT INTO lookup_values(lookup_list_id,value_key,display_value,description,display_order,active)
        SELECT list.id,value.value_key,value.display_value,'Approved Board Architecture value.',value.display_order,true
        FROM lookup_lists list
        CROSS JOIN (VALUES
            ('ADA','ADA',10),('AMPERE','AMPERE',20),('BLACKWELL','BLACKWELL',30),
            ('CONCORD','Concord',40),('DGX_SPARK','DGX-Spark',50),('FERRIX','Ferrix',60),
            ('FIRESPRAY','Firespray',70),('HOPPER','HOPPER',80),('JEDHA','Jedha',90),
            ('NA','NA',100),('ORIN','Orin',110),('OSG','OSG',120),('RUBIN','RUBIN',130),
            ('SDEV','SDEV',140),('TH500','TH500',150),('TURING','TURING',160),
            ('VOLTA','VOLTA',170),('XAVIER','Xavier',180),('PASCAL','PASCAL',190),
            ('MAXWELL','MAXWELL',200),('KEPLER','KEPLER',210),('N1X','N1X',220),('N1C','N1C',230)
        ) value(value_key,display_value,display_order)
        WHERE list.lookup_key='BOARD_ARCHITECTURE'
        ON CONFLICT (lookup_list_id,value_key) DO UPDATE
        SET display_value=EXCLUDED.display_value,
            description=EXCLUDED.description,
            display_order=EXCLUDED.display_order,
            active=true,
            updated_at=now();

        INSERT INTO lookup_values(lookup_list_id,value_key,display_value,description,display_order,active)
        SELECT list.id,value.value_key,value.display_value,'Approved GPU Class value.',value.display_order,true
        FROM lookup_lists list
        CROSS JOIN (VALUES
            ('TESLA','Tesla',10),('GEFORCE','GeForce',20),('QUADRO','Quadro',30),
            ('TITAN','Titan',40),('NONE','None',50)
        ) value(value_key,display_value,display_order)
        WHERE list.lookup_key='GPU_CLASS'
        ON CONFLICT (lookup_list_id,value_key) DO UPDATE
        SET display_value=EXCLUDED.display_value,
            description=EXCLUDED.description,
            display_order=EXCLUDED.display_order,
            active=true,
            updated_at=now();

        UPDATE lookup_lists
        SET version=version+1,updated_at=now()
        WHERE lookup_key IN ('BOARD_ARCHITECTURE','GPU_CLASS');

        INSERT INTO field_definitions(
            field_key,field_label,definition,help_text,data_type,lookup_list_id,
            storage_target,import_aliases,validation_rules,unique_when_populated,active
        ) VALUES
        ('gpu_class','GPU Class','Product class used to position a GPU offering.',
         'Optional shared model-level class such as Tesla, GeForce, Quadro, or Titan.',
         'lookup',(SELECT id FROM lookup_lists WHERE lookup_key='GPU_CLASS'),
         'asset_models.gpu_class',ARRAY['GPU Class','Class'],'{}'::jsonb,false,true),
        ('gpu_chip','GPU Chip','Internal GPU chip identifier.',
         'Optional shared model-level chip value such as GB200 or TH500.',
         'text',NULL,'asset_models.gpu_chip',ARRAY['GPU Chip','Chip'],'{}'::jsonb,false,true),
        ('gpu_name_vrl','GPU Name - VRL','Internal VRL GPU name.',
         'Optional internal GPU name used by VRL and engineering references.',
         'text',NULL,'asset_models.gpu_name_vrl',ARRAY['GPU Name - VRL','GPU Name VRL','VRL GPU Name'],'{}'::jsonb,false,true),
        ('gpu_name_market','GPU Name - Market','External or market-facing GPU name.',
         'Optional shared market name for the GPU model.',
         'text',NULL,'asset_models.gpu_name_market',ARRAY['GPU Name - Market','GPU Name Market','Market GPU Name'],'{}'::jsonb,false,true)
        ON CONFLICT (field_key) DO UPDATE
        SET field_label=EXCLUDED.field_label,
            definition=EXCLUDED.definition,
            help_text=EXCLUDED.help_text,
            data_type=EXCLUDED.data_type,
            lookup_list_id=EXCLUDED.lookup_list_id,
            storage_target=EXCLUDED.storage_target,
            import_aliases=EXCLUDED.import_aliases,
            validation_rules=EXCLUDED.validation_rules,
            active=true,
            deprecated_at=NULL,
            updated_at=now();

        WITH gpu_profile AS (
            SELECT profile.id
            FROM asset_profiles profile
            JOIN categories category ON category.id=profile.category_id
            WHERE profile.active AND category.category_key='GPU'
        ), ordered_fields AS (
            SELECT definition.id,
                   row_number() OVER (ORDER BY array_position(
                       ARRAY['gpu_class','gpu_chip','gpu_name_vrl','gpu_name_market'],definition.field_key
                   ))::integer AS offset
            FROM field_definitions definition
            WHERE definition.field_key=ANY(ARRAY['gpu_class','gpu_chip','gpu_name_vrl','gpu_name_market'])
        ), current_order AS (
            SELECT gpu_profile.id profile_id,COALESCE(max(profile_field.display_order),0) max_order
            FROM gpu_profile
            LEFT JOIN profile_fields profile_field ON profile_field.profile_id=gpu_profile.id
            GROUP BY gpu_profile.id
        )
        INSERT INTO profile_fields(
            profile_id,field_definition_id,required,display_order,
            visible_add,visible_update,visible_filter,visible_detail,
            visible_import,visible_report,visible_export,active
        )
        SELECT current_order.profile_id,ordered_fields.id,false,
               current_order.max_order+ordered_fields.offset,
               true,true,true,true,true,true,true,true
        FROM current_order CROSS JOIN ordered_fields
        ON CONFLICT (profile_id,field_definition_id) DO UPDATE
        SET required=false,
            visible_add=true,visible_update=true,visible_filter=true,visible_detail=true,
            visible_import=true,visible_report=true,visible_export=true,
            active=true,updated_at=now();

        UPDATE asset_profiles profile
        SET version=version+1,updated_at=now()
        FROM categories category
        WHERE category.id=profile.category_id
          AND category.category_key='GPU'
          AND profile.active;

        INSERT INTO schema_migrations(migration_key,description)
        VALUES (
            '007-gpu-model-reference-data',
            'Seeds Board Architecture values and adds optional GPU Class, Chip, VRL name, and Market name model fields.'
        );
    END IF;
END;
$$;

DO $$
DECLARE
    architecture_count integer;
    gpu_field_count integer;
BEGIN
    SELECT count(*) INTO architecture_count
    FROM lookup_values value
    JOIN lookup_lists list ON list.id=value.lookup_list_id
    WHERE list.lookup_key='BOARD_ARCHITECTURE'
      AND value.active
      AND value.value_key=ANY(ARRAY[
          'ADA','AMPERE','BLACKWELL','CONCORD','DGX_SPARK','FERRIX','FIRESPRAY',
          'HOPPER','JEDHA','NA','ORIN','OSG','RUBIN','SDEV','TH500','TURING',
          'VOLTA','XAVIER','PASCAL','MAXWELL','KEPLER','N1X','N1C'
      ]);

    SELECT count(*) INTO gpu_field_count
    FROM profile_fields profile_field
    JOIN asset_profiles profile ON profile.id=profile_field.profile_id
    JOIN categories category ON category.id=profile.category_id
    JOIN field_definitions definition ON definition.id=profile_field.field_definition_id
    WHERE category.category_key='GPU'
      AND profile.active AND profile_field.active AND definition.active
      AND NOT profile_field.required
      AND definition.field_key=ANY(ARRAY['gpu_class','gpu_chip','gpu_name_vrl','gpu_name_market']);

    IF architecture_count<>23 OR gpu_field_count<>4 THEN
        RAISE EXCEPTION 'GPU registry verification failed: architectures %, optional fields %',architecture_count,gpu_field_count;
    END IF;
END;
$$;

COMMIT;
