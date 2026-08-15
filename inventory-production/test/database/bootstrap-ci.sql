\set ON_ERROR_STOP on

DO $$
BEGIN
    IF current_database() <> 'inventory_project' THEN
        RAISE EXCEPTION 'CI database must be inventory_project, not %', current_database();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='inventory_app') THEN
        CREATE ROLE inventory_app LOGIN PASSWORD 'inventory_app_ci_password' NOINHERIT;
    END IF;
END;
$$;
