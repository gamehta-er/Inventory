import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.DATABASE_URL = 'postgresql://inventory_test:inventory_test@127.0.0.1:5432/inventory_test';
process.env.COOKIE_SECRET = 'inventory-transaction-test-secret-32-characters';
process.env.NODE_ENV = 'test';

const { runTransaction } = await import('../src/db.js');

function transactionClient(statements: string[]) {
  return {
    query: async (statement: string) => {
      statements.push(statement);
      return { rows: [], rowCount: 0 };
    },
  };
}

describe('database transaction boundary', () => {
  it('commits only after the complete unit of work succeeds', async () => {
    const statements: string[] = [];
    const result = await runTransaction(transactionClient(statements), async (client) => {
      await client.query('INSERT ASSET');
      await client.query('INSERT ACTIVITY');
      return 'committed';
    });

    assert.equal(result, 'committed');
    assert.deepEqual(statements, ['BEGIN', 'INSERT ASSET', 'INSERT ACTIVITY', 'COMMIT']);
  });

  it('rolls back the whole unit of work and never commits after a failure', async () => {
    const statements: string[] = [];
    const failure = new Error('row 2 failed');

    await assert.rejects(
      runTransaction(transactionClient(statements), async (client) => {
        await client.query('INSERT ROW 1');
        throw failure;
      }),
      failure,
    );

    assert.deepEqual(statements, ['BEGIN', 'INSERT ROW 1', 'ROLLBACK']);
    assert.equal(statements.includes('COMMIT'), false);
  });
});
