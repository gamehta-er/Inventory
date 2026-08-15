import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { canonicalDateText } from '../../src/databaseValues.js';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (integrationDatabaseUrl) {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = integrationDatabaseUrl;
  process.env.COOKIE_SECRET = 'inventory-integration-cookie-secret-32-characters';
  process.env.COOKIE_SECURE = 'false';
  process.env.UPLOAD_ROOT = './.integration-uploads';
}

let database: typeof import('../../src/db.js');

describe('governed import PostgreSQL 18 boundary', { skip: integrationDatabaseUrl ? false : 'INTEGRATION_DATABASE_URL is not configured' }, () => {
  before(async () => {
    database = await import('../../src/db.js');
    assert.equal(await database.ready(), true, 'The migrated runtime contract must be ready before integration tests run.');
  });

  after(async () => {
    await database.pool.end();
  });

  it('loads the complete migration ledger and keeps commits disabled by default', async () => {
    const migrations = await database.pool.query<{ migration_key: string }>(
      'SELECT migration_key FROM schema_migrations ORDER BY migration_key',
    );
    assert.deepEqual(migrations.rows.map((row) => row.migration_key), [
      '001-production-baseline',
      '002-import-lookup-resolution',
      '003-import-remediation',
      '004-import-controlled-list-mappings',
      '005-complete-import-workflow',
      '006-invmgmt-schema',
      '007-gpu-model-reference-data',
      '008-separate-lifecycle-from-categories',
      '009-governed-import-reliability',
    ]);
    const control = await database.pool.query<{ mode: string }>(
      "SELECT mode FROM import_runtime_control WHERE control_key='GLOBAL'",
    );
    assert.equal(control.rows[0]?.mode, 'DISABLED');
  });

  it('returns PostgreSQL DATE values as the same canonical day used by imports', async () => {
    const result = await database.pool.query<{ date_received: string }>(
      "SELECT DATE '2026-08-13' AS date_received",
    );
    assert.equal(result.rows[0]?.date_received, '2026-08-13');
    assert.equal(canonicalDateText(result.rows[0]?.date_received), '2026-08-13');
    assert.equal(canonicalDateText(new Date(2026, 7, 13)), '2026-08-13');
  });

  it('enforces exact-revision, independent, immutable administrator reviews in PostgreSQL', async () => {
    const client = await database.pool.connect();
    const draftHash = 'a'.repeat(64);
    const contractHash = 'b'.repeat(64);
    const idempotencyKey = '22222222-2222-4222-8222-222222222222';
    try {
      await client.query('BEGIN');
      const created = await client.query<{ id: string; importer_id: string }>(`
        INSERT INTO import_batches(
          import_profile_id,mode,profile_version,contract_fingerprint,status,
          created_by_user_id,draft_revision,draft_hash,idempotency_key
        )
        SELECT import_profile.id,'CREATE',profile.version,$1,'AWAITING_APPROVAL',
               importer.id,1,$2,$3::uuid
        FROM import_profiles import_profile
        JOIN asset_profiles profile ON profile.id=import_profile.profile_id
        JOIN categories category ON category.id=profile.category_id
        CROSS JOIN application_users importer
        WHERE category.category_key='GPU' AND importer.display_name='Gaurav Mehta'
        RETURNING id,created_by_user_id::text AS importer_id
      `, [contractHash, draftHash, idempotencyKey]);
      const batchId = created.rows[0]?.id;
      const importerId = created.rows[0]?.importer_id;
      assert.ok(batchId);
      assert.ok(importerId);

      const reviewers = await client.query<{ id: string; display_name: string }>(`
        SELECT id::text,display_name
        FROM application_users
        WHERE display_name IN ('Igor Margulis','Monica Martin')
        ORDER BY display_name
      `);
      assert.deepEqual(reviewers.rows.map((row) => row.display_name), ['Igor Margulis', 'Monica Martin']);

      await client.query('SAVEPOINT importer_review');
      await assert.rejects(
        client.query(
          'INSERT INTO import_reviews(batch_id,draft_revision,draft_hash,reviewer_user_id,decision) VALUES($1,1,$2,$3,$4)',
          [batchId, draftHash, importerId, 'ACCEPT'],
        ),
        (error: unknown) => error instanceof Error && /importer cannot review/i.test(error.message),
      );
      await client.query('ROLLBACK TO SAVEPOINT importer_review');

      await client.query('SAVEPOINT stale_review');
      await assert.rejects(
        client.query(
          'INSERT INTO import_reviews(batch_id,draft_revision,draft_hash,reviewer_user_id,decision) VALUES($1,1,$2,$3,$4)',
          [batchId, 'c'.repeat(64), reviewers.rows[0]!.id, 'ACCEPT'],
        ),
        (error: unknown) => error instanceof Error && /revision and hash must match/i.test(error.message),
      );
      await client.query('ROLLBACK TO SAVEPOINT stale_review');

      await client.query('SAVEPOINT decline_without_reason');
      await assert.rejects(
        client.query(
          "INSERT INTO import_reviews(batch_id,draft_revision,draft_hash,reviewer_user_id,decision,reason) VALUES($1,1,$2,$3,'DECLINE','')",
          [batchId, draftHash, reviewers.rows[0]!.id],
        ),
        (error: unknown) => error instanceof Error && /import_reviews_check/i.test(error.message),
      );
      await client.query('ROLLBACK TO SAVEPOINT decline_without_reason');

      for (const reviewer of reviewers.rows) {
        await client.query(
          'INSERT INTO import_reviews(batch_id,draft_revision,draft_hash,reviewer_user_id,decision) VALUES($1,1,$2,$3,$4)',
          [batchId, draftHash, reviewer.id, 'ACCEPT'],
        );
      }
      const decisions = await client.query<{ reviewer: string; decision: string }>(`
        SELECT application_user.display_name AS reviewer,review.decision
        FROM import_reviews review
        JOIN application_users application_user ON application_user.id=review.reviewer_user_id
        WHERE review.batch_id=$1
        ORDER BY application_user.display_name
      `, [batchId]);
      assert.deepEqual(decisions.rows, [
        { reviewer: 'Igor Margulis', decision: 'ACCEPT' },
        { reviewer: 'Monica Martin', decision: 'ACCEPT' },
      ]);

      await client.query('SAVEPOINT duplicate_review');
      await assert.rejects(
        client.query(
          'INSERT INTO import_reviews(batch_id,draft_revision,draft_hash,reviewer_user_id,decision) VALUES($1,1,$2,$3,$4)',
          [batchId, draftHash, reviewers.rows[0]!.id, 'ACCEPT'],
        ),
        (error: unknown) => error instanceof Error && /duplicate key/i.test(error.message),
      );
      await client.query('ROLLBACK TO SAVEPOINT duplicate_review');

      await client.query('SAVEPOINT mutate_review');
      await assert.rejects(
        client.query('UPDATE import_reviews SET reason=$2 WHERE batch_id=$1', [batchId, 'Changed after review']),
        (error: unknown) => error instanceof Error && /append-only/i.test(error.message),
      );
      await client.query('ROLLBACK TO SAVEPOINT mutate_review');

      await client.query(
        "UPDATE import_batches SET draft_revision=2,draft_hash=$2,status='AWAITING_APPROVAL' WHERE id=$1",
        [batchId, 'd'.repeat(64)],
      );
      const currentApprovals = await client.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM import_reviews review
        JOIN import_batches batch ON batch.id=review.batch_id
        WHERE review.batch_id=$1
          AND review.draft_revision=batch.draft_revision
          AND review.draft_hash=batch.draft_hash
      `, [batchId]);
      assert.equal(currentApprovals.rows[0]?.count, '0');

      await client.query('SAVEPOINT duplicate_commit_key');
      await assert.rejects(
        client.query(`
          INSERT INTO import_batches(
            import_profile_id,mode,profile_version,contract_fingerprint,status,
            created_by_user_id,draft_revision,draft_hash,idempotency_key
          )
          SELECT import_profile_id,mode,profile_version,contract_fingerprint,'DRAFT',
                 created_by_user_id,0,NULL,idempotency_key
          FROM import_batches WHERE id=$1
        `, [batchId]),
        (error: unknown) => error instanceof Error && /duplicate key/i.test(error.message),
      );
      await client.query('ROLLBACK TO SAVEPOINT duplicate_commit_key');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('rolls back forced mid-batch failures without retaining partial evidence', async () => {
    await assert.rejects(
      database.withTransaction(async (client) => {
        await client.query(`
          INSERT INTO import_stage_events(stage,event_key,metadata)
          VALUES('COMMIT','CI_FORCED_ROLLBACK','{"synthetic":true}'::jsonb)
        `);
        throw new Error('Synthetic mid-batch failure');
      }),
      /Synthetic mid-batch failure/,
    );
    const retained = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM import_stage_events WHERE event_key='CI_FORCED_ROLLBACK'",
    );
    assert.equal(retained.rows[0]?.count, '0');
  });
});
