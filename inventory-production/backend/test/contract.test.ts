import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const baselinePath = fileURLToPath(new URL('../../database/001-production-baseline.sql', import.meta.url));
const sql = await readFile(baselinePath, 'utf8');
const expectedFields = [
  'mrs_order', 'nvbugs', 'capacity_request', 'date_received', 'board_sku', 'gpu_sku',
  'model_number', 'serial_number', 'milestone', 'product_name', 'location', 'asset_status',
  'board_architecture', 'pool_team', 'project', 'asset_tag', 'owner', 'notes', 'vendor',
];
const requiredFields = [
  'nvbugs', 'date_received', 'model_number', 'serial_number',
  'product_name', 'asset_status', 'owner', 'vendor',
];
const gpuExtensionFields = ['gpu_class', 'gpu_chip', 'gpu_name_vrl', 'gpu_name_market'];

describe('frozen production data contract', () => {
  it('defines exactly the approved 19 standard fields in display order', () => {
    const match = sql.match(/INSERT INTO field_definitions[\s\S]*?VALUES\s*([\s\S]*?);\s*\n\s*INSERT INTO profile_fields/);
    assert.ok(match, 'field definition seed block is present');
    const keys = [...match[1].matchAll(/^\('([a-z][a-z0-9_]*)'/gm)].map((item) => item[1]);
    assert.deepEqual(keys.filter((key) => expectedFields.includes(key)), expectedFields);
  });

  it('adds four optional GPU model fields without changing the standard contract', () => {
    const match = sql.match(/INSERT INTO field_definitions[\s\S]*?VALUES\s*([\s\S]*?);\s*\n\s*INSERT INTO profile_fields/);
    assert.ok(match, 'field definition seed block is present');
    const keys = [...match[1].matchAll(/^\('([a-z][a-z0-9_]*)'/gm)].map((item) => item[1]);
    assert.deepEqual(keys.filter((key) => gpuExtensionFields.includes(key)), gpuExtensionFields);
    assert.match(sql, /category_key='GPU'/);
    assert.match(sql, /SELECT p\.id, f\.id, false/);
  });

  it('defines eight required and eleven optional fields', () => {
    const match = sql.match(/f\.field_key IN \(([^)]+)\)/);
    assert.ok(match, 'required field expression is present');
    const keys = [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
    assert.deepEqual(keys, requiredFields);
    assert.equal(expectedFields.length - keys.length, 11);
  });

  it('keeps Location optional and documents the approved Capacity Request meaning', () => {
    assert.doesNotMatch(requiredFields.join(','), /location/);
    assert.doesNotMatch(requiredFields.join(','), /notes/);
    assert.match(sql, /'capacity_request','Capacity Request #','Internal Capacity Request Number\.'/);
  });

  it('defines the six approved lifecycle values', () => {
    for (const status of ['IN_USE', 'REWORK', 'E_WASTE', 'ARCHIVE', 'GPU_READY', 'AVAILABLE']) {
      assert.match(sql, new RegExp(`\\('${status}','${status}'`));
    }
  });

  it('keeps lifecycle statuses out of the asset-family catalogue', () => {
    const match = sql.match(/INSERT INTO categories[\s\S]*?VALUES\s*([\s\S]*?);\s*\n\s*INSERT INTO asset_profiles/);
    assert.ok(match, 'category seed block is present');
    for (const status of ['IN_USE', 'REWORK', 'E_WASTE', 'ARCHIVE', 'GPU_READY', 'AVAILABLE']) {
      assert.doesNotMatch(match[1], new RegExp(`\\('${status}'`));
    }
    assert.match(sql, /CREATE TABLE categories \([\s\S]*?CONSTRAINT categories_asset_family_key_check/);
  });

  it('enforces serial uniqueness and conditional asset-tag uniqueness', () => {
    assert.match(sql, /serial_number text NOT NULL UNIQUE/);
    assert.match(sql, /CREATE UNIQUE INDEX assets_asset_tag_unique/);
    assert.match(sql, /WHERE asset_tag IS NOT NULL/);
  });
});
