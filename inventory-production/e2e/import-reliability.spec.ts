import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = resolve(projectRoot, 'test', 'fixtures');
const generatedFixtureRoot = resolve(fixtureRoot, 'generated');
const evidenceRoot = resolve(projectRoot, 'quality-artifacts');
const screenshotRoot = resolve(evidenceRoot, 'screenshots');
const adminDatabaseUrl = process.env.DATABASE_ADMIN_URL;
const { Client } = pg;

async function administratorQuery<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  if (!adminDatabaseUrl) throw new Error('DATABASE_ADMIN_URL is required for governed import browser tests.');
  const client = new Client({ connectionString: adminDatabaseUrl });
  await client.connect();
  try {
    const result = await client.query<T>(text, values);
    return result.rows;
  } finally {
    await client.end();
  }
}

async function setImportMode(mode: 'DISABLED' | 'ENABLED', reason: string): Promise<void> {
  await administratorQuery(`
    UPDATE invmgmt.import_runtime_control
    SET mode=$1,reason=$2,changed_by_user_id=(
      SELECT id FROM invmgmt.application_users WHERE display_name='Gaurav Mehta'
    ),change_source='playwright',changed_at=now()
    WHERE control_key='GLOBAL'
  `, [mode, reason]);
}

async function signedInPage(browser: Browser, displayName: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel(/Team member/).selectOption({ label: displayName });
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await expect(page.locator('.identity').getByText(displayName, { exact: true })).toBeVisible();
  return { context, page };
}

function sessionIdFrom(page: Page): string {
  const sessionId = new URL(page.url()).searchParams.get('session');
  if (!sessionId) throw new Error(`Import session was not added to the browser URL: ${page.url()}`);
  return sessionId;
}

interface CommitContract {
  draftRevision: number;
  draftHash: string;
  idempotencyKey: string;
}

async function commitThroughApi(page: Page, batchId: string, contract: CommitContract): Promise<{
  ok: boolean;
  status: number;
  code: string | undefined;
  idempotent: boolean | undefined;
}> {
  return page.evaluate(async ({ id, body }) => {
    const cookieValue = document.cookie.split('; ')
      .find((value) => value.startsWith('inventory_csrf='))
      ?.slice('inventory_csrf='.length) ?? '';
    const response = await fetch(`/api/v1/imports/${id}/commit`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': decodeURIComponent(cookieValue),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as { code?: string; idempotent?: boolean };
    return { ok: response.ok, status: response.status, code: payload.code, idempotent: payload.idempotent };
  }, { id: batchId, body: contract });
}

test.beforeAll(async () => {
  await mkdir(screenshotRoot, { recursive: true });
});

test.describe.serial('governed CSV and XLSX import journeys', () => {
  test('commits one CSV only after two independent reviews and reconciles every read surface', async ({ browser }, testInfo) => {
    await setImportMode('DISABLED', 'CI starts with import commits locked.');
    const contexts: BrowserContext[] = [];
    const timings: Record<string, number> = {};
    const serialNumber = `CI-CSV-${process.env.GITHUB_RUN_ID ?? 'LOCAL'}-${process.env.GITHUB_RUN_ATTEMPT ?? '0'}-${testInfo.retry}-${Date.now()}`;
    const correctedProductName = '1TB SATA SSD - Reviewed Import';
    const goldenCsv = await readFile(resolve(fixtureRoot, 'inventory-golden.csv'), 'utf8');
    const csvContents = Buffer.from(goldenCsv.replace('CI-CSV-000001', serialNumber), 'utf8');
    const csvPath = resolve(evidenceRoot, 'working', `inventory-golden-${testInfo.retry}.csv`);
    await mkdir(dirname(csvPath), { recursive: true });
    await writeFile(csvPath, csvContents);
    const fileSha256 = createHash('sha256').update(csvContents).digest('hex');
    let batchId = '';

    try {
      const importer = await signedInPage(browser, 'Gaurav Mehta');
      contexts.push(importer.context);
      await importer.page.goto('/import');
      await expect(importer.page.getByText('Commits locked', { exact: true })).toBeVisible();
      await importer.page.locator('input[type="file"]').setInputFiles(csvPath);
      const analysisStarted = Date.now();
      await importer.page.getByRole('button', { name: 'Analyze file' }).click();
      await expect(importer.page.getByRole('heading', { name: /1 source row, 1 included/i })).toBeVisible();
      timings.analysisMs = Date.now() - analysisStarted;
      expect(timings.analysisMs).toBeLessThan(60_000);
      batchId = sessionIdFrom(importer.page);
      const sessionUrl = importer.page.url();
      await expect(importer.page.locator('.import-session-header .status')).toHaveText('Awaiting Approval');
      const lockedCommit = importer.page.getByRole('button', { name: /Commit 1 New Assets/i });
      await expect(lockedCommit).toBeDisabled();
      await importer.page.screenshot({ path: resolve(screenshotRoot, 'csv-awaiting-approval.png'), fullPage: true });

      const firstReviewer = await signedInPage(browser, 'Igor Margulis');
      contexts.push(firstReviewer.context);
      await firstReviewer.page.goto(sessionUrl);
      await firstReviewer.page.getByRole('button', { name: 'Accept this draft' }).click();
      await expect(firstReviewer.page.getByRole('heading', { name: '1 of 2 approvals' })).toBeVisible();

      await importer.page.getByRole('button', { name: 'Review', exact: true }).click();
      await importer.page.getByRole('button', { name: 'Edit Row' }).click();
      await importer.page.getByLabel(/Product Name/).fill(correctedProductName);
      await importer.page.getByRole('button', { name: 'Save Changes And Revalidate' }).click();
      await expect(importer.page.getByRole('dialog')).toContainText(correctedProductName);
      await importer.page.keyboard.press('Escape');
      await expect(importer.page.getByRole('dialog')).toBeHidden();
      await expect(importer.page.getByRole('heading', { name: '0 of 2 approvals' })).toBeVisible();
      await importer.page.getByRole('tab', { name: /Ready/ }).click();
      await expect(importer.page.getByText(correctedProductName, { exact: true })).toBeVisible();

      await importer.page.goto('/reports');
      await expect(importer.page.getByRole('heading', { name: 'Inventory command center' })).toBeVisible();
      await importer.page.goto(sessionUrl);
      await expect(importer.page.getByText(correctedProductName, { exact: true })).toBeVisible();
      await importer.page.getByRole('button', { name: 'Review', exact: true }).click();
      await expect(importer.page.getByRole('dialog')).toContainText(correctedProductName);
      await importer.page.keyboard.press('Escape');
      await expect(importer.page.getByRole('dialog')).toBeHidden();
      await importer.page.screenshot({ path: resolve(screenshotRoot, 'csv-correction-retained.png'), fullPage: true });

      const [correctedDraft] = await administratorQuery<{
        draft_revision: number;
        draft_hash: string;
        idempotency_key: string;
        product_name: string;
      }>(`
        SELECT batch.draft_revision,batch.draft_hash,batch.idempotency_key::text,
               row.normalized_values->>'product_name' AS product_name
        FROM invmgmt.import_batches batch
        JOIN invmgmt.import_batch_rows row ON row.batch_id=batch.id
        WHERE batch.id=$1::uuid
      `, [batchId]);
      expect(Number(correctedDraft?.draft_revision)).toBeGreaterThan(1);
      expect(correctedDraft?.draft_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(correctedDraft?.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
      expect(correctedDraft?.product_name).toBe(correctedProductName);
      const commitContract: CommitContract = {
        draftRevision: Number(correctedDraft!.draft_revision),
        draftHash: correctedDraft!.draft_hash,
        idempotencyKey: correctedDraft!.idempotency_key,
      };

      await firstReviewer.page.goto(sessionUrl);
      await firstReviewer.page.getByRole('button', { name: 'Accept this draft' }).click();
      await expect(firstReviewer.page.getByRole('heading', { name: '1 of 2 approvals' })).toBeVisible();

      const secondReviewer = await signedInPage(browser, 'Monica Martin');
      contexts.push(secondReviewer.context);
      await secondReviewer.page.goto(sessionUrl);
      await secondReviewer.page.getByRole('button', { name: 'Accept this draft' }).click();
      await expect(secondReviewer.page.getByRole('heading', { name: '2 of 2 approvals' })).toBeVisible();
      await secondReviewer.page.screenshot({ path: resolve(screenshotRoot, 'csv-two-approvals.png'), fullPage: true });

      const [reviewLedger] = await administratorQuery<{
        current_acceptances: number;
        recorded_decisions: number;
      }>(`
        SELECT count(*) FILTER(
                 WHERE review.decision='ACCEPT'
                   AND review.draft_revision=batch.draft_revision
                   AND review.draft_hash=batch.draft_hash
               )::int AS current_acceptances,
               count(*)::int AS recorded_decisions
        FROM invmgmt.import_batches batch
        JOIN invmgmt.import_reviews review ON review.batch_id=batch.id
        WHERE batch.id=$1::uuid
        GROUP BY batch.id
      `, [batchId]);
      expect(reviewLedger).toEqual({ current_acceptances: 2, recorded_decisions: 3 });

      const blockedApiCommit = await commitThroughApi(importer.page, batchId, commitContract);
      expect(blockedApiCommit).toEqual(expect.objectContaining({
        ok: false,
        status: 423,
        code: 'IMPORT_COMMITS_DISABLED',
      }));

      await setImportMode('ENABLED', 'CI opens the lock only for the fully approved synthetic draft.');
      await importer.page.reload();
      await expect(importer.page.getByText('Imports enabled', { exact: true })).toBeVisible();
      const commitButton = importer.page.getByRole('button', { name: /Commit 1 New Assets/i });
      await expect(commitButton).toBeEnabled();
      const commitStarted = Date.now();
      const concurrentCommit = commitThroughApi(importer.page, batchId, commitContract);
      await commitButton.click();
      try {
        await expect(importer.page.getByRole('heading', { name: 'Import completed' })).toBeVisible();
      } catch (failure) {
        const [diagnostic] = await administratorQuery<{
          status: string;
          verification_status: string;
          verification_details: Record<string, unknown>;
          failure_message: string | null;
        }>(`
          SELECT status,verification_status,verification_details,failure_message
          FROM invmgmt.import_batches
          WHERE id=$1::uuid
        `, [batchId]);
        const alerts = await importer.page.getByRole('alert').allTextContents();
        throw new Error(`Import commit did not complete: ${JSON.stringify({ alerts, diagnostic })}`, { cause: failure });
      }
      timings.commitMs = Date.now() - commitStarted;
      expect(timings.commitMs).toBeLessThan(120_000);
      expect(await concurrentCommit).toEqual(expect.objectContaining({ ok: true, status: 200 }));
      const replayedCommits = await Promise.all([
        commitThroughApi(importer.page, batchId, commitContract),
        commitThroughApi(importer.page, batchId, commitContract),
      ]);
      expect(replayedCommits).toEqual([
        expect.objectContaining({ ok: true, status: 200, idempotent: true }),
        expect.objectContaining({ ok: true, status: 200, idempotent: true }),
      ]);
      await importer.page.screenshot({ path: resolve(screenshotRoot, 'csv-commit-complete.png'), fullPage: true });

      const readback = await administratorQuery<{
        serial_number: string;
        date_received: string;
        product_name: string;
        verification_status: string;
        result_count: number;
      }>(`
        SELECT asset.serial_number,asset.date_received::text,model.product_name,
               batch.verification_status,count(result.id)::int AS result_count
        FROM invmgmt.import_batches batch
        JOIN invmgmt.import_commit_results result ON result.batch_id=batch.id
        JOIN invmgmt.assets asset ON asset.id=result.asset_id
        JOIN invmgmt.asset_models model ON model.id=asset.asset_model_id
        WHERE batch.id=$1::uuid
        GROUP BY asset.serial_number,asset.date_received,model.product_name,batch.verification_status
      `, [batchId]);
      expect(readback).toEqual([{
        serial_number: serialNumber,
        date_received: '2026-08-13',
        product_name: correctedProductName,
        verification_status: 'PASSED',
        result_count: 1,
      }]);

      await importer.page.goto('/search');
      await importer.page.getByLabel('Search inventory').fill(serialNumber);
      await importer.page.getByRole('button', { name: 'Search inventory' }).click();
      await expect(importer.page.getByRole('heading', { name: '1 asset found' })).toBeVisible();
      await expect(importer.page.getByText(correctedProductName, { exact: true })).toBeVisible();

      const apiReadback = await importer.page.evaluate(async (serial) => {
        const response = await fetch(`/api/v1/assets?q=${encodeURIComponent(serial)}&limit=100`);
        return { ok: response.ok, payload: await response.json() };
      }, serialNumber) as { ok: boolean; payload: { assets?: Array<{ serialNumber?: string; model?: { productName?: string } }> } };
      expect(apiReadback.ok).toBe(true);
      expect(apiReadback.payload.assets).toEqual(expect.arrayContaining([
        expect.objectContaining({ serialNumber, model: expect.objectContaining({ productName: correctedProductName }) }),
      ]));

      await importer.page.getByRole('checkbox', { name: `Select ${correctedProductName}` }).check();
      const downloadPromise = importer.page.waitForEvent('download');
      await importer.page.getByRole('button', { name: 'Export CSV' }).click();
      const download = await downloadPromise;
      const downloadedPath = await download.path();
      if (!downloadedPath) throw new Error('The reconciled CSV export was not retained by the browser.');
      const exportedCsv = await readFile(downloadedPath, 'utf8');
      expect(exportedCsv).toContain(serialNumber);
      expect(exportedCsv).toContain('2026-08-13');
      expect(exportedCsv).toContain(correctedProductName);

      await writeFile(resolve(evidenceRoot, 'csv-browser-journey.json'), `${JSON.stringify({
        source: { format: 'CSV', sha256: fileSha256, rows: 1 },
        batchReference: createHash('sha256').update(batchId).digest('hex'),
        approvals: 2,
        timings,
        correctionRetention: {
          field: 'product_name',
          correctedValueSha256: createHash('sha256').update(correctedProductName).digest('hex'),
          revalidation: 'PASSED',
          filter: 'PASSED',
          navigation: 'PASSED',
          priorApprovalInvalidation: 'PASSED',
        },
        governance: { disabledApiCommit: 'PASSED', concurrentIdempotentRetries: 'PASSED' },
        reconciliation: { database: 'PASSED', api: 'PASSED', search: 'PASSED', export: 'PASSED' },
      }, null, 2)}\n`);
    } finally {
      await setImportMode('DISABLED', 'CI journey finished; import commits returned to the safe default.');
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('prompts for an XLSX worksheet and rejects formula cells before staging', async ({ browser }) => {
    await setImportMode('DISABLED', 'XLSX source-selection checks run with commits locked.');
    const { context, page } = await signedInPage(browser, 'Gaurav Mehta');
    try {
      await page.goto('/import');
      await page.locator('input[type="file"]').setInputFiles(resolve(generatedFixtureRoot, 'inventory-multi-sheet.xlsx'));
      await page.getByRole('button', { name: 'Analyze file' }).click();
      await expect(page.getByRole('heading', { name: 'Choose the worksheet to import' })).toBeVisible();
      await expect(page.getByLabel(/Worksheet/).locator('option')).toHaveCount(2);
      await page.getByLabel(/Worksheet/).selectOption('Building B');
      await page.getByRole('button', { name: 'Use this source' }).click();
      await expect(page.getByRole('heading', { name: /1 source row, 1 included/i })).toBeVisible();
      await expect(page.getByText('4TB M.2 SSD', { exact: true })).toBeVisible();
      await expect(page.getByText(/XLSX - Building B/)).toBeVisible();
      await page.screenshot({ path: resolve(screenshotRoot, 'xlsx-building-selection.png'), fullPage: true });

      await page.goto('/import');
      await page.locator('input[type="file"]').setInputFiles(resolve(generatedFixtureRoot, 'inventory-formula.xlsx'));
      await page.getByRole('button', { name: 'Analyze file' }).click();
      await expect(page.getByRole('alert')).toContainText(/Formula cell .* must be converted to a literal value/i);
      await page.screenshot({ path: resolve(screenshotRoot, 'xlsx-formula-rejected.png'), fullPage: true });
    } finally {
      await context.close();
    }
  });

  test('accepts exactly 1,000 inventory rows and rejects row 1,001 clearly', async ({ browser }) => {
    await setImportMode('DISABLED', 'Row-boundary checks run with commits locked.');
    const { context, page } = await signedInPage(browser, 'Gaurav Mehta');
    try {
      await page.goto('/import');
      await page.locator('input[type="file"]').setInputFiles(resolve(generatedFixtureRoot, 'inventory-limit-1000.csv'));
      const analysisStarted = Date.now();
      await page.getByRole('button', { name: 'Analyze file' }).click();
      await expect(page.getByRole('heading', { name: /1,000 source rows, 1,000 included/i })).toBeVisible({ timeout: 60_000 });
      const analysisMs = Date.now() - analysisStarted;
      expect(analysisMs).toBeLessThan(60_000);

      await page.goto('/import');
      await page.locator('input[type="file"]').setInputFiles(resolve(generatedFixtureRoot, 'inventory-limit-1001.csv'));
      await page.getByRole('button', { name: 'Analyze file' }).click();
      await expect(page.getByRole('alert')).toContainText(/at most 1,000 inventory rows/i);
      await writeFile(resolve(evidenceRoot, 'row-boundary.json'), `${JSON.stringify({
        acceptedRows: 1000,
        rejectedRows: 1001,
        analysisMs,
        limit: 'PASSED',
      }, null, 2)}\n`);
    } finally {
      await context.close();
    }
  });
});
