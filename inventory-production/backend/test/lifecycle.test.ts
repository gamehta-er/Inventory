import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  assertOperationStatus,
  isLifecycleStatusKey,
  lifecycleGroups,
  lifecycleOperations,
  lifecycleStatusKeys,
} from '../src/lifecycle.js';

const projectFile = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const sessionSource = await readFile(projectFile('backend/src/session.ts'), 'utf8');
const registrySource = await readFile(projectFile('backend/src/registry.ts'), 'utf8');
const adminSource = await readFile(projectFile('backend/src/admin.ts'), 'utf8');

describe('authoritative lifecycle contract', () => {
  it('keeps management availability totals mutually understandable', () => {
    assert.deepEqual([...lifecycleGroups.available], ['AVAILABLE', 'GPU_READY']);
    assert.deepEqual([...lifecycleGroups.unavailable], ['IN_USE', 'REWORK', 'E_WASTE']);
    assert.deepEqual([...lifecycleGroups.exceptions], ['REWORK', 'E_WASTE']);
  });

  it('reserves lifecycle values for status use instead of asset categories', () => {
    assert.deepEqual([...lifecycleStatusKeys], ['IN_USE', 'REWORK', 'E_WASTE', 'ARCHIVE', 'GPU_READY', 'AVAILABLE']);
    assert.equal(isLifecycleStatusKey('Available'), true);
    assert.equal(isLifecycleStatusKey('E-Waste'), true);
    assert.equal(isLifecycleStatusKey('GPU'), false);
  });

  it('enforces the status/category boundary in session, registry, and Admin contracts', () => {
    assert.match(sessionSource, /NOT \(upper\(regexp_replace\(c\.category_key/);
    assert.match(registrySource, /NOT \(upper\(regexp_replace\(c\.category_key/);
    assert.match(adminSource, /CATEGORY_LIFECYCLE_RESERVED/);
  });

  it('uses explicit business operations and requires an owner for assignment', () => {
    assert.equal(lifecycleOperations.ASSIGN.label, 'Assign');
    assert.equal(lifecycleOperations.ASSIGN.requiresOwner, true);
    assert.deepEqual(lifecycleOperations.ASSIGN.allowedStatuses, ['IN_USE']);
    assert.equal(lifecycleOperations.RETURN.label, 'Return');
    assert.equal(lifecycleOperations.CHANGE_STATUS.label, 'Change Status');
  });

  it('blocks a return without a selected destination status', () => {
    assert.throws(
      () => assertOperationStatus('RETURN'),
      (error: { code?: string }) => error.code === 'STATUS_REQUIRED',
    );
  });

  it('blocks status-only transitions into IN_USE', () => {
    assert.throws(
      () => assertOperationStatus('CHANGE_STATUS', 'IN_USE'),
      (error: { code?: string }) => error.code === 'STATUS_TRANSITION_INVALID',
    );
  });

  it('allows approved return and restore destinations', () => {
    assert.doesNotThrow(() => assertOperationStatus('RETURN', 'AVAILABLE'));
    assert.doesNotThrow(() => assertOperationStatus('RETURN', 'REWORK'));
    assert.doesNotThrow(() => assertOperationStatus('RESTORE', 'GPU_READY'));
  });
});
