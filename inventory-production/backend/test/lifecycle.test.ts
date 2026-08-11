import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertOperationStatus,
  lifecycleGroups,
  lifecycleOperations,
} from '../src/lifecycle.js';

describe('authoritative lifecycle contract', () => {
  it('keeps management availability totals mutually understandable', () => {
    assert.deepEqual([...lifecycleGroups.available], ['AVAILABLE', 'GPU_READY']);
    assert.deepEqual([...lifecycleGroups.unavailable], ['IN_USE', 'REWORK', 'E_WASTE']);
    assert.deepEqual([...lifecycleGroups.exceptions], ['REWORK', 'E_WASTE']);
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
