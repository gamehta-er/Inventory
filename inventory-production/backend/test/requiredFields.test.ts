import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.DATABASE_URL = 'postgresql://inventory_test:inventory_test@127.0.0.1:5432/inventory_test';
process.env.COOKIE_SECRET = 'inventory-required-fields-test-secret-32-characters';
process.env.NODE_ENV = 'test';

const { loadProfileFields } = await import('../src/registry.js');
const { effectiveRequiredSetting, isSystemRequiredField, requiredAssetFieldKeys } = await import('../src/requiredFields.js');

describe('approved required field contract', () => {
  it('keeps the approved eight fields required even when stored profile configuration drifts', () => {
    assert.deepEqual(requiredAssetFieldKeys, [
      'nvbugs', 'date_received', 'model_number', 'serial_number',
      'product_name', 'asset_status', 'owner', 'vendor',
    ]);
    assert.equal(isSystemRequiredField('owner'), true);
    assert.equal(effectiveRequiredSetting('owner', false), true);
    assert.equal(effectiveRequiredSetting('notes', false), false);
    assert.equal(effectiveRequiredSetting('notes', true), true);
  });

  it('repairs a drifted required flag when loading a profile', async () => {
    const client = {
      query: async () => ({
        rows: [{
          id: '17', field_key: 'owner', field_label: 'Owner / Assignee', definition: 'Owner', help_text: 'Choose an owner.',
          data_type: 'entity', lookup_key: null, lookup_name: null, storage_target: 'assets.owner_user_id', import_aliases: ['Owner'],
          validation_rules: {}, unique_when_populated: false, required: false, display_order: 17,
          visible_add: true, visible_update: true, visible_filter: true, visible_detail: true,
          visible_import: true, visible_report: true, visible_export: true, options: [],
        }],
        rowCount: 1,
      }),
    } as Parameters<typeof loadProfileFields>[1];

    const fields = await loadProfileFields(1, client);

    assert.equal(fields[0]?.fieldKey, 'owner');
    assert.equal(fields[0]?.required, true);
  });
});
