import pg from 'pg';
import { config } from './config.js';
import { requiredImportContract, requiredSchemaContract } from './version.js';
import { databaseDateText } from './databaseValues.js';

const { Pool } = pg;
pg.types.setTypeParser(1082, databaseDateText);

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  options: '-c search_path=invmgmt,public',
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'inventory-project-api',
});

export type DbClient = pg.PoolClient;

export async function runTransaction<T, TClient extends Pick<DbClient, 'query'>>(
  client: TClient,
  work: (transactionClient: TClient) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function withTransaction<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await runTransaction(client, work);
  } finally {
    client.release();
  }
}

export async function ready(): Promise<boolean> {
  try {
    const result = await pool.query(`
      SELECT
        to_regclass('invmgmt.assets') AS assets,
        to_regclass('invmgmt.profile_fields') AS fields,
        to_regclass('invmgmt.schema_migrations') AS migrations,
        EXISTS (
          SELECT 1
          FROM invmgmt.schema_migrations
          WHERE migration_key = $1
        ) AS schema_contract,
        EXISTS (
          SELECT 1
          FROM invmgmt.schema_migrations
          WHERE migration_key = $2
        ) AS import_contract,
        has_table_privilege(
          current_user,
          to_regclass('invmgmt.import_batches'),
          'SELECT,INSERT,UPDATE,DELETE'
        ) AS import_batches_access,
        has_table_privilege(
          current_user,
          to_regclass('invmgmt.import_column_mappings'),
          'SELECT,INSERT,UPDATE,DELETE'
        ) AS import_mappings_access,
        has_table_privilege(
          current_user,
          to_regclass('invmgmt.import_batch_rows'),
          'SELECT,INSERT,UPDATE,DELETE'
        ) AS import_rows_access,
        has_table_privilege(
          current_user,
          to_regclass('invmgmt.import_validation_issues'),
          'SELECT,INSERT,UPDATE,DELETE'
        ) AS import_issues_access,
        has_table_privilege(
          current_user,
          to_regclass('invmgmt.import_commit_results'),
          'SELECT,INSERT,UPDATE,DELETE'
        ) AS import_results_access,
        has_table_privilege(
          current_user,
          to_regclass('invmgmt.import_runtime_control'),
          'SELECT,INSERT,UPDATE,DELETE'
        ) AS import_control_access,
        has_table_privilege(
          current_user,
          to_regclass('invmgmt.import_reviews'),
          'SELECT,INSERT'
        ) AS import_reviews_access,
        has_table_privilege(
          current_user,
          to_regclass('invmgmt.import_stage_events'),
          'SELECT,INSERT'
        ) AS import_events_access
    `, [requiredSchemaContract, requiredImportContract]);
    const contract = result.rows[0];
    return Boolean(
      contract?.assets
      && contract?.fields
      && contract?.migrations
      && contract?.schema_contract
      && contract?.import_contract
      && contract?.import_batches_access
      && contract?.import_mappings_access
      && contract?.import_rows_access
      && contract?.import_issues_access
      && contract?.import_results_access
      && contract?.import_control_access
      && contract?.import_reviews_access
      && contract?.import_events_access
    );
  } catch {
    return false;
  }
}
