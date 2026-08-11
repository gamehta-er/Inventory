import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FieldDefinition } from '../src/types.js';

process.env.DATABASE_URL = 'postgresql://inventory_test:inventory_test@127.0.0.1:5432/inventory_test';
process.env.COOKIE_SECRET = 'inventory-import-workflow-test-secret-32-characters';
process.env.NODE_ENV = 'test';

const { importInternals } = await import('../src/imports.js');

function field(
  id: number,
  fieldKey: string,
  label: string,
  required: boolean,
  aliases: string[] = [],
  overrides: Partial<FieldDefinition> = {},
): FieldDefinition {
  return {
    id,
    fieldKey,
    label,
    definition: `${label} definition`,
    helpText: '',
    dataType: 'text',
    storageTarget: fieldKey,
    aliases,
    validationRules: {},
    uniqueWhenPopulated: false,
    required,
    displayOrder: id,
    surfaces: { import: true },
    options: [],
    ...overrides,
  };
}

function queryClient(handler?: (text: string) => { rows: unknown[]; rowCount?: number }) {
  return {
    query: async (text: string) => {
      const result = handler?.(text) ?? { rows: [] };
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    },
  } as Parameters<typeof importInternals.normalizeField>[0];
}

const standardFields = [
  field(1, 'nvbugs', 'NVBugs #', true, ['NVBug', 'NVBug #']),
  field(2, 'serial_number', 'Serial #', true, ['Serial Number']),
  field(3, 'notes', 'Notes', false),
];

describe('complete import workflow contract', () => {
  it('parses UTF-8 BOM, quoted commas, Windows line endings, and blank rows', () => {
    const csv = Buffer.from('\ufeffNVBugs #,Serial #,Notes\r\n9000001,SYN-001,"Lab, validation"\r\n\r\n', 'utf8');
    const result = importInternals.parseCsv(csv);

    assert.deepEqual(result.headers, ['NVBugs #', 'Serial #', 'Notes']);
    assert.deepEqual(result.rows, [['9000001', 'SYN-001', 'Lab, validation']]);
  });

  it('automatically maps labels, field keys, configured aliases, and an administrator-added field', () => {
    const fields = [
      ...standardFields,
      field(20, 'rack_zone', 'Rack Zone', false, ['Zone']),
    ];
    const mappings = importInternals.autoMappings(
      ['nvbug #', 'SERIAL_NUMBER', 'notes', 'Zone'],
      fields,
    );

    assert.deepEqual(mappings, [
      { sourceIndex: 0, fieldKey: 'nvbugs' },
      { sourceIndex: 1, fieldKey: 'serial_number' },
      { sourceIndex: 2, fieldKey: 'notes' },
      { sourceIndex: 3, fieldKey: 'rack_zone' },
    ]);
  });

  it('blocks duplicate headers, duplicate field mappings, and an unmapped required field', () => {
    const issues = importInternals.mappingAssessment(
      ['Serial #', 'SERIAL #', 'Notes'],
      standardFields,
      [
        { sourceIndex: 0, fieldKey: 'serial_number' },
        { sourceIndex: 1, fieldKey: 'serial_number' },
        { sourceIndex: 2, fieldKey: 'notes' },
      ],
    );

    assert.ok(issues.some((issue) => issue.code === 'DUPLICATE_HEADER'));
    assert.ok(issues.some((issue) => issue.code === 'DUPLICATE_MAPPING'));
    assert.ok(issues.some((issue) => issue.code === 'REQUIRED_FIELD_UNMAPPED' && issue.fieldKey === 'nvbugs'));
  });

  it('requires an explicit decision for every unknown extra column', () => {
    const issues = importInternals.mappingAssessment(
      ['NVBugs #', 'Serial #', 'Temporary Comment'],
      standardFields,
      [
        { sourceIndex: 0, fieldKey: 'nvbugs' },
        { sourceIndex: 1, fieldKey: 'serial_number' },
      ],
    );

    assert.deepEqual(
      issues.filter((issue) => issue.code === 'COLUMN_DECISION_REQUIRED').map((issue) => issue.sourceIndex),
      [2],
    );
  });

  it('normalizes valid dates and rejects invalid dates', () => {
    assert.equal(importInternals.normalizeDate('2026-08-09'), '2026-08-09');
    assert.equal(importInternals.normalizeDate('2/29/2024'), '2024-02-29');
    assert.equal(importInternals.normalizeDate('2/29/2026'), null);
    assert.equal(importInternals.normalizeDate('2026-02-31'), null);
    assert.equal(importInternals.normalizeDate('not-a-date'), null);
  });

  it('accepts blank optional lookup, entity, location, asset tag, and notes fields without issues', async () => {
    const client = queryClient(() => {
      throw new Error('Blank optional values must not perform relationship queries.');
    });
    const optionalFields = [
      field(4, 'board_architecture', 'Board Architecture', false, [], { dataType: 'lookup', lookupKey: 'BOARD_ARCHITECTURE' }),
      field(5, 'pool_team', 'Pool/Team', false, [], { dataType: 'lookup', lookupKey: 'POOL_TEAM' }),
      field(6, 'location', 'Location', false, [], { dataType: 'entity' }),
      field(7, 'asset_tag', 'Asset Tag #', false),
      field(8, 'notes', 'Notes', false),
    ];

    for (const item of optionalFields) {
      const result = await importInternals.normalizeField(client, item, '   ');
      assert.equal(result.value, null);
      assert.deepEqual(result.issues, []);
    }
  });

  it('blocks a blank required value', async () => {
    const result = await importInternals.normalizeField(queryClient(), field(9, 'vendor', 'Vendor', true, [], { dataType: 'entity' }), '');
    assert.equal(result.value, null);
    assert.equal(result.issues[0]?.code, 'REQUIRED_VALUE_MISSING');
  });

  it('resolves controlled values and stores them according to the profile mapping', async () => {
    const architecture = field(10, 'board_architecture', 'Board Architecture', false, [], {
      dataType: 'lookup',
      lookupKey: 'BOARD_ARCHITECTURE',
      storageTarget: 'asset_models.board_architecture',
      options: [{ id: 101, value: 'AMPERE', label: 'Ampere', aliases: ['AMP'] }],
    });
    const exact = await importInternals.normalizeField(queryClient(), architecture, 'ampere');
    const alias = await importInternals.normalizeField(queryClient(), architecture, ' AMP ');

    assert.equal(exact.value, 'Ampere');
    assert.deepEqual(exact.issues, []);
    assert.equal(alias.value, 'Ampere');
    assert.deepEqual(alias.issues, []);

    const status = field(12, 'asset_status', 'Status', true, [], {
      dataType: 'lookup',
      lookupKey: 'ASSET_STATUS',
      storageTarget: 'assets.status_value_id',
      options: [{ id: 201, value: 'AVAILABLE', label: 'Available', aliases: [] }],
    });
    const relationship = await importInternals.normalizeField(queryClient(), status, 'available');

    assert.equal(relationship.value, 201);
    assert.deepEqual(relationship.issues, []);
  });

  it('warns for an unknown optional location and imports it without a location', async () => {
    const client = queryClient((text) => {
      assert.match(text, /FROM locations/);
      return { rows: [{ id: 1, label: 'Building R / Lab 104 / Rack 01 / U12 / Cabinet 01' }] };
    });
    const result = await importInternals.normalizeField(
      client,
      field(11, 'location', 'Location', false, [], { dataType: 'entity' }),
      'Cabinet 5/LnC',
    );

    assert.equal(result.value, null);
    assert.equal(result.issues[0]?.severity, 'WARNING');
    assert.equal(result.issues[0]?.code, 'LOCATION_NOT_RECOGNIZED');
  });

  it('enforces administrator-added field validation rules', async () => {
    const rackZone = field(20, 'rack_zone', 'Rack Zone', false, [], {
      validationRules: { minLength: 3, maxLength: 8, pattern: '^ZONE-[0-9]+$' },
    });
    const result = await importInternals.normalizeField(queryClient(), rackZone, 'bad');

    assert.ok(result.issues.some((issue) => issue.code === 'VALUE_FORMAT_INVALID'));
  });

  it('reports a profile configuration error for an invalid administrator regex', async () => {
    const badProfileField = field(21, 'custom_code', 'Custom Code', false, [], {
      validationRules: { pattern: '[' },
    });
    const result = await importInternals.normalizeField(queryClient(), badProfileField, 'VALUE');

    assert.equal(result.issues[0]?.severity, 'CONFIGURATION');
    assert.equal(result.issues[0]?.code, 'PROFILE_VALIDATION_PATTERN_INVALID');
  });
});
