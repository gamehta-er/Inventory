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

test.beforeAll(async () => {
  await mkdir(screenshotRoot, { recursive: true });
});

test.describe.serial('governed CSV and XLSX import journeys', () => {
  test('commits one CSV only after two independent reviews and reconciles every read surface', async ({ browser }, testInfo) => {
    await setImportMode('DISABLED', 'CI starts with import commits locked.');
    const contexts: BrowserContext[] = [];
    const timings: Record<string, number> = {};
    const serialNumber = `CI-CSV-${process.env.GITHUB_RUN_ID ?? 'LOCAL'}-${process.env.GITHUB_RUN_ATTEMPT ?? '0'}-${testInfo.retry}-${Date.now()}`;
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
      await expect(importer.page.getByText('Awaiting approval', { exact: true })).toBeVisible();
      const lockedCommit = importer.page.getByRole('button', { name: /Commit 1 New Assets/i });
      await expect(lockedCommit).toBeDisabled();
      await importer.page.screenshot({ path: resolve(screenshotRoot, 'csv-awaiting-approval.png'), fullPage: true });

      const firstReviewer = await signedInPage(browser, 'Igor Margulis');
      contexts.push(firstReviewer.context);
      await firstReviewer.page.goto(sessionUrl);
      await firstReviewer.page.getByRole('button', { name: 'Accept this draft' }).click();
      await expect(firstReviewer.page.getByRole('heading', { name: '1 of 2 approvals' })).toBeVisible();

      const secondReviewer = await signedInPage(browser, 'Monica Martin');
      contexts.push(secondReviewer.context);
      await secondReviewer.page.goto(sessionUrl);
      await secondReviewer.page.getByRole('button', { name: 'Accept this draft' }).click();
      await expect(secondReviewer.page.getByRole('heading', { name: '2 of 2 approvals' })).toBeVisible();
      await secondReviewer.page.screenshot({ path: resolve(screenshotRoot, 'csv-two-approvals.png'), fullPage: true });

      await setImportMode('ENABLED', 'CI opens the lock only for the fully approved synthetic draft.');
      await importer.page.reload();
      await expect(importer.page.getByText('Imports enabled', { exact: true })).toBeVisible();
      const commitButton = importer.page.getByRole('button', { name: /Commit 1 New Assets/i });
      await expect(commitButton).toBeEnabled();
      const commitStarted = Date.now();
      await commitButton.click();
      await expect(importer.page.getByRole('heading', { name: 'Import completed' })).toBeVisible();
      timings.commitMs = Date.now() - commitStarted;
      expect(timings.commitMs).toBeLessThan(120_000);
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
        product_name: '1TB SATA SSD',
        verification_status: 'PASSED',
        result_count: 1,
      }]);

      await importer.page.goto('/search');
      await importer.page.getByLabel('Search inventory').fill(serialNumber);
      await importer.page.getByRole('button', { name: 'Search inventory' }).click();
      await expect(importer.page.getByRole('heading', { name: '1 asset found' })).toBeVisible();
      await expect(importer.page.getByText('1TB SATA SSD', { exact: true })).toBeVisible();
      await importer.page.getByRole('checkbox', { name: 'Select 1TB SATA SSD' }).check();
      const downloadPromise = importer.page.waitForEvent('download');
      await importer.page.getByRole('button', { name: 'Export CSV' }).click();
      const download = await downloadPromise;
      const downloadedPath = await download.path();
      if (!downloadedPath) throw new Error('The reconciled CSV export was not retained by the browser.');
      const exportedCsv = await readFile(downloadedPath, 'utf8');
      expect(exportedCsv).toContain(serialNumber);
      expect(exportedCsv).toContain('2026-08-13');

      await writeFile(resolve(evidenceRoot, 'csv-browser-journey.json'), `${JSON.stringify({
        source: { format: 'CSV', sha256: fileSha256, rows: 1 },
        batchReference: createHash('sha256').update(batchId).digest('hex'),
        approvals: 2,
        timings,
        reconciliation: { database: 'PASSED', apiAndSearch: 'PASSED', export: 'PASSED' },
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
