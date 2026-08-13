import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://inventory_test:inventory_test@127.0.0.1:5432/inventory_test';
process.env.COOKIE_SECRET = 'inventory-test-cookie-secret-32-characters';

const { readMaintenanceState, writeMaintenanceState } = await import('../src/maintenance.js');

let root = '';

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

describe('maintenance state', () => {
  it('persists the operator, reason, time, and source as one state contract', async () => {
    root = await mkdtemp(join(tmpdir(), 'inventory-maintenance-'));
    const path = join(root, 'maintenance.flag');
    const expected = {
      enabled: true,
      enabledAt: '2026-08-11T12:00:00.000Z',
      enabledBy: 'Gaurav Mehta',
      reason: 'Planned service work',
      source: 'application' as const,
    };
    await writeMaintenanceState(expected, path);
    assert.deepEqual(await readMaintenanceState(path), expected);
  });

  it('accepts an existing empty operations flag and removes it when service resumes', async () => {
    root = await mkdtemp(join(tmpdir(), 'inventory-maintenance-'));
    const path = join(root, 'maintenance.flag');
    await writeFile(path, '');
    const legacy = await readMaintenanceState(path);
    assert.equal(legacy.enabled, true);
    assert.equal(legacy.source, 'operations');

    await writeMaintenanceState({ enabled: false, enabledAt: null, enabledBy: null, reason: null, source: null }, path);
    assert.equal((await readMaintenanceState(path)).enabled, false);
  });
});
