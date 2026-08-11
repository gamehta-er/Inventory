import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  options: '-c search_path=invmgmt,public',
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'inventory-project-api',
});

export type DbClient = pg.PoolClient;

export async function withTransaction<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
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
        to_regclass('invmgmt.schema_migrations') AS migrations
    `);
    return Boolean(result.rows[0]?.assets && result.rows[0]?.fields && result.rows[0]?.migrations);
  } catch {
    return false;
  }
}
