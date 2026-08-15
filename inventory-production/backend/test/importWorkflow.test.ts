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
  it('generates the template from every enabled profile field, including administrator-added fields', () => {
    const template = importInternals.buildImportTemplate([
      ...standardFields,
      field(20, 'rack_zone', 'Rack Zone', false),
    ]);

    assert.equal(template, '\uFEFFNVBugs #,Serial #,Notes,Rack Zone\r\n');
  });

  it('allows an owner or administrator to resume a session and rejects other users', () => {
    const owner = { id: 7, permissions: [] } as never;
    const administrator = { id: 8, permissions: ['admin.profile'] } as never;
    const otherUser = { id: 9, permissions: [] } as never;
    const batch = { created_by_user_id: '7' };

    assert.doesNotThrow(() => importInternals.requireSessionAccess(owner, batch));
    assert.doesNotThrow(() => importInternals.requireSessionAccess(administrator, batch));
    assert.throws(
      () => importInternals.requireSessionAccess(otherUser, batch),
      (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 403),
    );
  });

  it('allows an independent import reviewer to open another importer session', () => {
    assert.doesNotThrow(() => importInternals.requireSessionAccess(
      { id: 2, displayName: 'Reviewer', initials: 'RV', roles: ['privileged_administrator'], permissions: ['import.review'] },
      { created_by_user_id: 1 },
    ));
    assert.throws(() => importInternals.requireSessionAccess(
      { id: 3, displayName: 'Operator', initials: 'OP', roles: ['user'], permissions: ['import.execute'] },
      { created_by_user_id: 1 },
    ), /cannot access another user's import session/i);
  });

  it('parses UTF-8 BOM, quoted commas, Windows line endings, and blank rows', () => {
    const csv = Buffer.from('\ufeffNVBugs #,Serial #,Notes\r\n9000001,SYN-001,"Lab, validation"\r\n\r\n', 'utf8');
    const result = importInternals.parseCsv(csv);

    assert.deepEqual(result.headers, ['NVBugs #', 'Serial #', 'Notes']);
    assert.deepEqual(result.rows, [['9000001', 'SYN-001', 'Lab, validation']]);
  });

  it('serializes all 19 CSV headers as JSON before writing the import session', () => {
    const headers = [
      'MRS order #',
      'NVBugs #',
      'Capacity Request #',
      'Date Received',
      'Board SKU',
      'GPU SKU',
      'Model #',
      'Serial #',
      'Milestone',
      'Product Name',
      'Location',
      'Status',
      'Board Architecture',
      'Pool/Team',
      'Project',
      'Asset Tag #',
      'Owner / Assignee',
      'Notes',
      'Vendor',
    ];

    const serialized = importInternals.serializeImportHeaders(headers);

    assert.equal(serialized.startsWith('['), true);
    assert.deepEqual(JSON.parse(serialized), headers);
  });

  it('serializes controlled-value suggestions as JSON for PostgreSQL jsonb', () => {
    const serialized = importInternals.serializeImportIssueSuggestions(['AMPERE', 'HOPPER']);

    assert.equal(serialized, '["AMPERE","HOPPER"]');
    assert.deepEqual(JSON.parse(serialized), ['AMPERE', 'HOPPER']);
    assert.equal(importInternals.serializeImportIssueSuggestions(undefined), '[]');
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

  it('skips mapping review only when every CSV column has one safe automatic match', () => {
    const completeMappings = importInternals.autoMappings(
      ['NVBugs #', 'Serial #', 'Notes'],
      standardFields,
    );
    const uncertainMappings = importInternals.autoMappings(
      ['NVBugs #', 'Serial #', 'Temporary Comment'],
      standardFields,
    );

    assert.equal(importInternals.canAutoValidateMappings(['NVBugs #', 'Serial #', 'Notes'], standardFields, completeMappings), true);
    assert.equal(importInternals.canAutoValidateMappings(['NVBugs #', 'Serial #', 'Temporary Comment'], standardFields, uncertainMappings), false);
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

  it('accepts PostgreSQL bigint text values for a revalidated update target', () => {
    assert.deepEqual(importInternals.parseValidatedTarget('42', '7'), { assetId: 42, revision: 7 });
    assert.deepEqual(importInternals.parseValidatedTarget(42, 7), { assetId: 42, revision: 7 });
  });

  it('rejects missing, invalid, zero, and unsafe update targets', () => {
    assert.equal(importInternals.parseValidatedTarget(null, '7'), null);
    assert.equal(importInternals.parseValidatedTarget('42', null), null);
    assert.equal(importInternals.parseValidatedTarget('0', '7'), null);
    assert.equal(importInternals.parseValidatedTarget('42', '0'), null);
    assert.equal(importInternals.parseValidatedTarget('not-an-id', '7'), null);
    assert.equal(importInternals.parseValidatedTarget(String(Number.MAX_SAFE_INTEGER + 1), '7'), null);
  });

  it('classifies valid, warning, blocking, and configuration rows consistently', () => {
    assert.equal(importInternals.classifyImportRow([]), 'VALID');
    assert.equal(importInternals.classifyImportRow([{ severity: 'WARNING', code: 'LOCATION_NOT_RECOGNIZED', message: 'Location warning.' }]), 'WARNING');
    assert.equal(importInternals.classifyImportRow([{ severity: 'ERROR', code: 'REQUIRED_VALUE_MISSING', message: 'Required value missing.' }]), 'BLOCKED');
    assert.equal(importInternals.classifyImportRow([
      { severity: 'WARNING', code: 'LOCATION_NOT_RECOGNIZED', message: 'Location warning.' },
      { severity: 'CONFIGURATION', code: 'PROFILE_LOOKUP_MISSING', message: 'Profile mapping missing.' },
    ]), 'CONFIGURATION_ERROR');
  });

  it('provides exact row and field navigation in the browser and validation export', () => {
    assert.equal(
      importInternals.importIssueRoute('batch 12', 'row/7', 'pool_team'),
      '/import?session=batch+12&row=row%2F7&field=pool_team',
    );
  });

  it('declares every view that must refresh after an atomic commit', () => {
    assert.deepEqual(importInternals.importRefreshTargets, ['search', 'inventory', 'reports', 'activity', 'imports', 'categories']);
  });

  it('reconciles shared model fields across rows before commit', () => {
    const fields = [
      field(30, 'model_number', 'Model #', true, [], { storageTarget: 'asset_models.model_number' }),
      field(31, 'product_name', 'Product Name', true, [], { storageTarget: 'asset_models.product_name' }),
      field(32, 'board_sku', 'Board SKU', false, [], { storageTarget: 'asset_models.board_sku' }),
      field(33, 'gpu_chip', 'GPU Chip', false, [], { storageTarget: 'asset_models.gpu_chip' }),
    ];
    const rows = [
      { id: '1', rowNumber: 2, source: {}, corrected: {}, included: true, values: { model_number: '699-TEST', product_name: 'GPU Test', board_sku: '', gpu_chip: 'GR100' }, issues: [], targetAssetId: null, targetRevision: null, beforeValues: null },
      { id: '2', rowNumber: 3, source: {}, corrected: {}, included: true, values: { model_number: '699-TEST', product_name: 'GPU Test', board_sku: 'P2022', gpu_chip: '' }, issues: [], targetAssetId: null, targetRevision: null, beforeValues: null },
    ];

    importInternals.reconcileModelGroup(rows, fields, null);

    assert.deepEqual(rows.map((row) => row.values.board_sku), ['P2022', 'P2022']);
    assert.deepEqual(rows.map((row) => row.values.gpu_chip), ['GR100', 'GR100']);
    assert.deepEqual(rows.flatMap((row) => row.issues), []);
  });

  it('blocks conflicting values for one shared model', () => {
    const fields = [field(34, 'product_name', 'Product Name', true, [], { storageTarget: 'asset_models.product_name' })];
    const rows = [
      { id: '1', rowNumber: 2, source: {}, corrected: {}, included: true, values: { model_number: '699-TEST', product_name: 'GPU Alpha' }, issues: [], targetAssetId: null, targetRevision: null, beforeValues: null },
      { id: '2', rowNumber: 3, source: {}, corrected: {}, included: true, values: { model_number: '699-TEST', product_name: 'GPU Beta' }, issues: [], targetAssetId: null, targetRevision: null, beforeValues: null },
    ];

    importInternals.reconcileModelGroup(rows, fields, null);

    assert.ok(rows.every((row) => row.issues.some((issue) => issue.code === 'MODEL_VALUE_CONFLICT_IN_FILE')));
  });

  it('inherits an existing shared model value and blocks an incompatible replacement', () => {
    const fields = [
      field(35, 'board_sku', 'Board SKU', false, [], { storageTarget: 'asset_models.board_sku' }),
      field(36, 'gpu_chip', 'GPU Chip', false, [], { storageTarget: 'asset_models.gpu_chip' }),
    ];
    const rows = [
      { id: '1', rowNumber: 2, source: {}, corrected: {}, included: true, values: { model_number: '699-TEST', board_sku: '', gpu_chip: 'GB200' }, issues: [], targetAssetId: null, targetRevision: null, beforeValues: null },
    ];

    importInternals.reconcileModelGroup(rows, fields, { board_sku: 'P2022', gpu_chip: 'GR100' });

    assert.equal(rows[0]!.values.board_sku, 'P2022');
    assert.ok(rows[0]!.issues.some((issue) => issue.code === 'MODEL_VALUE_CONFLICT_EXISTING' && issue.fieldKey === 'gpu_chip'));
  });

  it('detects a stored value mismatch before reporting import success', () => {
    const fields = [
      field(37, 'serial_number', 'Serial #', true, [], { storageTarget: 'assets.serial_number' }),
      field(38, 'board_sku', 'Board SKU', false, [], { storageTarget: 'asset_models.board_sku' }),
    ];

    assert.deepEqual(importInternals.committedValueMismatches(fields, { serial_number: 'SER-1', board_sku: 'P2022' }, { serial_number: 'SER-1', board_sku: 'P2022' }), []);
    assert.deepEqual(importInternals.committedValueMismatches(fields, { serial_number: 'SER-1', board_sku: 'P2022' }, { serial_number: 'SER-1', board_sku: null }), ['board_sku']);
  });

  it('treats a PostgreSQL DATE and its canonical import string as the same day', () => {
    const dateField = field(39, 'date_received', 'Date Received', true, [], { dataType: 'date', storageTarget: 'assets.date_received' });
    assert.deepEqual(
      importInternals.committedValueMismatchDetails(
        [dateField],
        { date_received: '2026-08-13' },
        { date_received: new Date(2026, 7, 13) },
      ),
      [],
    );
    assert.deepEqual(
      importInternals.committedValueMismatchDetails(
        [dateField],
        { date_received: '2026-08-13' },
        { date_received: new Date(2026, 7, 14) },
      ),
      [{ fieldKey: 'date_received', expectedType: 'string', actualType: 'date' }],
    );
  });

  it('blocks unknown required owners and vendors while offering approved matches', async () => {
    const client = queryClient((text) => {
      if (/FROM application_users/.test(text)) return { rows: [{ id: 1, label: 'Gaurav Mehta' }] };
      if (/FROM vendors/.test(text)) return { rows: [{ id: 2, label: 'NVIDIA Lab Supply' }] };
      return { rows: [] };
    });
    const owner = await importInternals.normalizeField(client, field(22, 'owner', 'Owner / Assignee', true, [], { dataType: 'entity' }), 'Gaurav M');
    const vendor = await importInternals.normalizeField(client, field(23, 'vendor', 'Vendor', true, [], { dataType: 'entity' }), 'NVIDIA Supply');

    assert.equal(owner.issues[0]?.code, 'OWNER_NOT_RECOGNIZED');
    assert.deepEqual(owner.issues[0]?.suggestedValues, ['Gaurav Mehta']);
    assert.equal(vendor.issues[0]?.code, 'VENDOR_NOT_RECOGNIZED');
    assert.deepEqual(vendor.issues[0]?.suggestedValues, ['NVIDIA Lab Supply']);
  });
});
