import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeNVBugs, referenceInsertionOrder, splitReferences } from '../src/references.js';

describe('asset reference parsing', () => {
  it('accepts commas, semicolons, and newlines while preserving input order', () => {
    assert.deepEqual(splitReferences('MRS-3; MRS-2\nMRS-1, MRS-0'), [
      'MRS-3', 'MRS-2', 'MRS-1', 'MRS-0',
    ]);
  });

  it('removes case-insensitive duplicates without reordering the first value', () => {
    assert.deepEqual(splitReferences('CAP-2, cap-2, CAP-1'), ['CAP-2', 'CAP-1']);
  });

  it('normalizes NVBug numbers and removes duplicate representations', () => {
    assert.deepEqual(normalizeNVBugs('0009000002; 9000002\n0009000001'), ['9000002', '9000001']);
  });

  it('inserts same-transaction references so newest-first queries preserve entry order', () => {
    assert.deepEqual(referenceInsertionOrder(['NEWEST', 'MIDDLE', 'OLDEST']), [
      'OLDEST', 'MIDDLE', 'NEWEST',
    ]);
  });
});
