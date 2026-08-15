import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const evidenceRoot = resolve(projectRoot, 'quality-artifacts');
const fixtureRoot = resolve(projectRoot, 'test', 'fixtures');
const databaseUrl = process.env.DATABASE_ADMIN_URL;
if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL is required to write reliability evidence.');

await mkdir(evidenceRoot, { recursive: true });
const { Client } = pg;
const client = new Client({ connectionString: databaseUrl });
await client.connect();

async function jsonFile(name, value) {
  await writeFile(resolve(evidenceRoot, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function fixtureFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await fixtureFiles(path));
    else files.push(path);
  }
  return files;
}

try {
  const migrations = await client.query(`
    SELECT migration_key,description,applied_at
    FROM invmgmt.schema_migrations
    ORDER BY migration_key
  `);
  const control = await client.query(`
    SELECT mode,reason,change_source,changed_at
    FROM invmgmt.import_runtime_control
    WHERE control_key='GLOBAL'
  `);
  const batches = await client.query(`
    SELECT batch.id::text,batch.file_name,batch.file_sha256,batch.source_format,
           batch.source_sheet_name,batch.source_encoding,batch.source_delimiter,
           batch.file_size_bytes,batch.total_rows,batch.valid_rows,batch.warning_rows,
           batch.invalid_rows,batch.status,batch.draft_revision,batch.draft_hash,
           batch.verification_status,count(DISTINCT review.id)::int AS review_count
    FROM invmgmt.import_batches batch
    LEFT JOIN invmgmt.import_reviews review
      ON review.batch_id=batch.id AND review.draft_revision=batch.draft_revision
    GROUP BY batch.id
    ORDER BY batch.created_at
  `);
  const mismatchEvents = await client.query(`
    SELECT event.stage,event.event_key,event.draft_revision,event.row_number,
           event.duration_ms,event.row_count,event.mismatch_fields,event.created_at
    FROM invmgmt.import_stage_events event
    WHERE jsonb_array_length(event.mismatch_fields)>0
       OR event.event_key ILIKE '%MISMATCH%'
    ORDER BY event.created_at
  `);
  const reconciliation = await client.query(`
    SELECT batch.id::text,batch.status,batch.verification_status,batch.total_rows,
           count(DISTINCT result.id)::int AS committed_rows,
           count(DISTINCT asset.id)::int AS readable_assets
    FROM invmgmt.import_batches batch
    LEFT JOIN invmgmt.import_commit_results result ON result.batch_id=batch.id
    LEFT JOIN invmgmt.assets asset ON asset.id=result.asset_id
    GROUP BY batch.id
    ORDER BY batch.created_at
  `);

  const fixtureHashes = [];
  for (const file of await fixtureFiles(fixtureRoot)) {
    if (/\.mjs$/i.test(file)) continue;
    const contents = await readFile(file);
    fixtureHashes.push({
      file: file.slice(fixtureRoot.length + 1).replaceAll('\\', '/'),
      bytes: contents.length,
      sha256: createHash('sha256').update(contents).digest('hex'),
    });
  }

  const redactedBatches = batches.rows.map(({ id, ...batch }) => ({
    batchReference: createHash('sha256').update(id).digest('hex'),
    ...batch,
  }));
  const reconciliationRows = reconciliation.rows.map(({ id, ...row }) => ({
    batchReference: createHash('sha256').update(id).digest('hex'),
    ...row,
    reconciled: row.status !== 'COMPLETED'
      || (Number(row.total_rows) === Number(row.committed_rows)
        && Number(row.committed_rows) === Number(row.readable_assets)
        && row.verification_status === 'PASSED'),
  }));

  await jsonFile('fixture-hashes.json', fixtureHashes);
  await jsonFile('migration-evidence.json', { migrations: migrations.rows, importControl: control.rows[0] });
  await jsonFile('redacted-import-payloads.json', redactedBatches);
  await jsonFile('mismatch-report.json', {
    rawValuesRetained: false,
    mismatchCount: mismatchEvents.rowCount,
    events: mismatchEvents.rows,
  });
  await jsonFile('reconciliation-results.json', reconciliationRows);

  const completed = reconciliationRows.filter((row) => row.status === 'COMPLETED');
  const summary = [
    '# Inventory Import Reliability Evidence',
    '',
    `- Migration contracts present: ${migrations.rowCount}`,
    `- Final import mode: ${control.rows[0]?.mode ?? 'UNKNOWN'}`,
    `- Browser-created import sessions: ${batches.rowCount}`,
    `- Completed synthetic batches: ${completed.length}`,
    `- Completed batches reconciled: ${completed.every((row) => row.reconciled) ? 'Yes' : 'No'}`,
    `- Persistence mismatch events: ${mismatchEvents.rowCount}`,
    '- Raw inventory values in mismatch evidence: No',
    '',
    'This evidence is generated from synthetic CI data. It does not replace Product, Engineering, QA, or Data Owner sign-off.',
    '',
  ].join('\n');
  await writeFile(resolve(evidenceRoot, 'reliability-summary.md'), summary);
} finally {
  await client.end();
}

process.stdout.write(`Reliability evidence written to ${evidenceRoot}\n`);
