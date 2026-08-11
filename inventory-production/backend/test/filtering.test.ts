import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appendRegistryFilters } from '../src/filtering.js';

describe('profile-driven filters', () => {
  it('ignores unrecognized and unsafe field keys', () => {
    const params: unknown[] = [];
    const where: string[] = [];
    appendRegistryFilters(
      {
        category: 'GPU',
        field_: 'empty-key',
        'field_serial-number': 'unsafe-key',
        'field_serial_number;drop table assets': 'unsafe-sql',
      },
      params,
      where,
      'filter',
    );
    assert.deepEqual(params, []);
    assert.deepEqual(where, []);
  });

  it('uses filter visibility for a core profile field', () => {
    const params: unknown[] = [];
    const where: string[] = [];
    appendRegistryFilters({ field_serial_number: ' SYN-001 ' }, params, where, 'filter');
    assert.deepEqual(params, ['serial_number', 'SYN-001']);
    assert.equal(where.length, 1);
    assert.match(where[0], /registry_pf\.visible_filter/);
    assert.match(where[0], /a\.serial_number ILIKE/);
  });

  it('uses report visibility for dynamic profile fields', () => {
    const params: unknown[] = [];
    const where: string[] = [];
    appendRegistryFilters({ field_firmware_version: '1.2.3' }, params, where, 'report');
    assert.deepEqual(params, ['firmware_version', '1.2.3']);
    assert.equal(where.length, 1);
    assert.match(where[0], /pf\.visible_report/);
    assert.match(where[0], /asset_field_values/);
  });
});
