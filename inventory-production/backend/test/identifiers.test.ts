import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../src/errors.js';
import { parseAssetId, parseRelationshipId } from '../src/identifiers.js';

describe('request identifiers', () => {
  it('accepts positive integer identifiers', () => {
    assert.equal(parseAssetId('42'), 42);
    assert.equal(parseRelationshipId(7), 7);
  });

  it('rejects malformed asset identifiers before a database query can run', () => {
    for (const value of ['NaN', '0', '-1', '1.5', '', undefined]) {
      assert.throws(
        () => parseAssetId(value),
        (error: unknown) => error instanceof AppError
          && error.statusCode === 400
          && error.code === 'ASSET_ID_INVALID',
      );
    }
  });
});
