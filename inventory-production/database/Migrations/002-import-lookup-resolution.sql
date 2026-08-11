\set ON_ERROR_STOP on
BEGIN;

INSERT INTO permissions(permission_key, permission_name, description)
VALUES (
    'import.lookup.resolve',
    'Resolve import dropdowns',
    'Approve controlled dropdown values while resolving staged import errors.'
)
ON CONFLICT (permission_key) DO UPDATE SET
    permission_name = EXCLUDED.permission_name,
    description = EXCLUDED.description;

INSERT INTO role_permissions(role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
CROSS JOIN permissions
WHERE roles.role_key IN ('super_user', 'privileged_administrator')
  AND permissions.permission_key = 'import.lookup.resolve'
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(migration_key, description)
VALUES (
    '002-import-lookup-resolution',
    'Adds controlled dropdown resolution for staged imports without requiring CSV re-upload.'
)
ON CONFLICT (migration_key) DO NOTHING;

COMMIT;
