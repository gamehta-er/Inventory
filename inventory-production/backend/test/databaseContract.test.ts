import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const projectFile = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const baseline = await readFile(projectFile('database/001-production-baseline.sql'), 'utf8');
const schemaMigration = await readFile(projectFile('database/Migrations/006-invmgmt-schema.sql'), 'utf8');
const lifecycleCategoryMigration = await readFile(projectFile('database/Migrations/008-separate-lifecycle-from-categories.sql'), 'utf8');
const importReliabilityMigration = await readFile(projectFile('database/Migrations/009-governed-import-reliability.sql'), 'utf8');
const databaseContract = await readFile(projectFile('database/Test-DatabaseContract.sql'), 'utf8');
const dbSource = await readFile(projectFile('backend/src/db.ts'), 'utf8');
const appSource = await readFile(projectFile('backend/src/app.ts'), 'utf8');
const versionSource = await readFile(projectFile('backend/src/version.ts'), 'utf8');
const installer = await readFile(projectFile('installer/Install-InventoryProject.ps1'), 'utf8');
const packageBuilder = await readFile(projectFile('operations/Build-Production-Package.ps1'), 'utf8');
const migrationRunner = await readFile(projectFile('operations/Apply-Migrations.ps1'), 'utf8');

const baselineTables = [...baseline.matchAll(/^CREATE TABLE ([a-z][a-z0-9_]*)/gm)].map((match) => match[1]);
const migrationTableBlock = schemaMigration.match(/application_tables constant text\[\] := ARRAY\[([\s\S]*?)\];/);
const migratedTables = migrationTableBlock
  ? [...migrationTableBlock[1].matchAll(/'([a-z][a-z0-9_]*)'/g)].map((match) => match[1])
  : [];

describe('Framework v1.0 PostgreSQL boundary', () => {
  it('DATA-001 moves every baseline application table to invmgmt', () => {
    assert.equal(baselineTables.length, 40);
    assert.deepEqual(migratedTables, baselineTables);
    assert.match(schemaMigration, /CREATE SCHEMA IF NOT EXISTS invmgmt AUTHORIZATION inventory_owner/);
    assert.match(schemaMigration, /public_inventory_count <> 0/);
  });

  it('DATA-014 keeps the schema migration transactional and uniquely journaled', () => {
    assert.match(schemaMigration, /^\\set ON_ERROR_STOP on\s+\s*BEGIN;/);
    assert.match(schemaMigration, /pg_advisory_xact_lock/);
    assert.match(schemaMigration, /'006-invmgmt-schema'/);
    assert.match(schemaMigration, /ON CONFLICT \(migration_key\) DO NOTHING/);
    assert.match(schemaMigration, /COMMIT;\s*$/);
  });

  it('DATA-010 keeps lifecycle statuses separate from active asset categories', () => {
    assert.match(lifecycleCategoryMigration, /'008-separate-lifecycle-from-categories'/);
    assert.match(lifecycleCategoryMigration, /affected_asset_count<>0/);
    assert.match(lifecycleCategoryMigration, /categories_asset_family_key_check/);
    for (const table of ['import_profiles', 'asset_profiles', 'categories']) {
      assert.match(lifecycleCategoryMigration, new RegExp(`UPDATE ${table}`));
    }
    assert.match(lifecycleCategoryMigration, /SET active=false/);
    assert.match(lifecycleCategoryMigration, /COMMIT;/);
    assert.match(versionSource, /requiredSchemaContract = '009-governed-import-reliability'/);
  });

  it('DATA-015 separates owner and runtime privileges', () => {
    assert.match(schemaMigration, /CREATE ROLE inventory_owner NOLOGIN NOINHERIT/);
    assert.match(schemaMigration, /ALTER TABLE invmgmt\.%I OWNER TO inventory_owner/);
    assert.match(schemaMigration, /REVOKE CREATE ON SCHEMA invmgmt FROM inventory_app/);
    assert.match(schemaMigration, /GRANT USAGE ON SCHEMA invmgmt TO inventory_app/);
    assert.doesNotMatch(schemaMigration, /GRANT CREATE ON SCHEMA invmgmt TO inventory_app/);
    assert.match(databaseContract, /has_schema_privilege\('inventory_app', 'invmgmt', 'CREATE'\)/);
    assert.doesNotMatch(databaseContract, /has_schema_privilege\('PUBLIC'/);
  });

  it('ARCH-005 pins API queries to invmgmt without runtime schema creation', () => {
    assert.match(dbSource, /search_path=invmgmt,public/);
    assert.match(dbSource, /to_regclass\('invmgmt\.assets'\)/);
    assert.match(dbSource, /to_regclass\('invmgmt\.import_column_mappings'\)/);
    assert.match(dbSource, /has_table_privilege/);
    assert.match(dbSource, /SELECT,INSERT,UPDATE,DELETE/);
    assert.match(appSource, /FROM invmgmt\.schema_migrations/);
    assert.doesNotMatch(dbSource, /CREATE (TABLE|SCHEMA)/i);
    assert.doesNotMatch(appSource, /CREATE (TABLE|SCHEMA)/i);
  });

  it('IMPORT-014 verifies runtime access to every persistent Import workflow table', async () => {
    const databaseContract = await readFile(projectFile('database/Test-DatabaseContract.sql'), 'utf8');
    for (const table of ['import_batches', 'import_column_mappings', 'import_batch_rows', 'import_validation_issues', 'import_commit_results', 'import_runtime_control', 'import_reviews', 'import_stage_events']) {
      assert.match(databaseContract, new RegExp(`'${table}'`));
    }
    assert.match(databaseContract, /has_table_privilege/);
    assert.match(databaseContract, /IMPORT-014/);
  });

  it('IMPORT-001 persists resumable sessions, source files, mappings, rows, issues, and idempotent results', () => {
    for (const table of ['import_batches', 'import_column_mappings', 'import_batch_rows', 'import_validation_issues', 'import_commit_results', 'import_runtime_control', 'import_reviews', 'import_stage_events']) {
      assert.match(baseline, new RegExp(`CREATE TABLE ${table}`));
    }
    assert.match(baseline, /profile_version integer NOT NULL/);
    assert.match(baseline, /original_file bytea/);
    assert.match(baseline, /draft_hash text/);
    assert.match(baseline, /'import\.review'/);
    assert.match(baseline, /idempotency_key uuid NOT NULL DEFAULT gen_random_uuid\(\) UNIQUE/);
    assert.match(baseline, /CREATE INDEX import_batches_resume_idx ON import_batches\(created_by_user_id, status, updated_at DESC\)/);
  });

  it('IMPORT-014 adds a locked, revisioned, two-administrator reliability boundary', () => {
    assert.match(importReliabilityMigration, /'DISABLED','Reliability release requires verified gates/);
    assert.match(importReliabilityMigration, /CREATE TABLE IF NOT EXISTS import_reviews/);
    assert.match(importReliabilityMigration, /reviewer_user_id/);
    assert.match(importReliabilityMigration, /reject_import_evidence_mutation/);
    assert.match(importReliabilityMigration, /'009-governed-import-reliability'/);
    assert.match(versionSource, /requiredImportContract = '009-governed-import-reliability'/);
  });

  it('OPS-003 packages and installs the complete ordered migration chain', () => {
    assert.match(packageBuilder, /database\\005-complete-import-workflow\.sql/);
    assert.match(packageBuilder, /database\\Migrations/);
    assert.match(packageBuilder, /Sort-Object Name/);
    assert.match(installer, /Get-ChildItem -LiteralPath \$MigrationDirectory -Filter '\*\.sql'/);
    assert.match(installer, /006-invmgmt-schema\.sql/);
    assert.match(installer, /Applying database migration/);
  });

  it('DATA-014 supports the public-to-invmgmt transition and owner-run future migrations', () => {
    assert.match(migrationRunner, /public\.schema_migrations/);
    assert.match(migrationRunner, /invmgmt\.schema_migrations/);
    assert.match(migrationRunner, /SET ROLE inventory_owner/);
    assert.match(migrationRunner, /MigrationId -eq '006-invmgmt-schema'/);
  });
});
