import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sourceKeyForField, sourceValueForField } from '../src/importSourceValues.js';
import type { FieldDefinition } from '../src/types.js';

const field = (fieldKey: string, label: string, aliases: string[]): FieldDefinition => ({
  id: 1,
  fieldKey,
  label,
  definition: '',
  helpText: '',
  dataType: 'lookup',
  storageTarget: '',
  aliases,
  validationRules: {},
  uniqueWhenPopulated: false,
  required: false,
  displayOrder: 1,
  surfaces: { import: true },
  options: [],
});

const fields = [
  field('board_architecture', 'Board Architecture', ['Architecture']),
  field('pool_team', 'Pool/Team', ['Pool', 'Team']),
];

describe('import source-value recovery', () => {
  it('keeps rejected values from the exact production CSV headers', () => {
    const source = {
      'Board Architecture': 'AMPERE',
      'Pool/Team': 'Colossus GPU Platform Team',
    };

    assert.equal(sourceValueForField(fields, source, 'board_architecture'), 'AMPERE');
    assert.equal(sourceValueForField(fields, source, 'pool_team'), 'Colossus GPU Platform Team');
  });

  it('maps aliases and uses a normalized value only as a fallback', () => {
    const source = { Architecture: 'MAXWELL', Pool: '' };

    assert.equal(sourceKeyForField(fields, source, 'board_architecture'), 'Architecture');
    assert.equal(sourceValueForField(fields, source, 'board_architecture', { board_architecture: 12 }), 'MAXWELL');
    assert.equal(sourceValueForField(fields, source, 'pool_team', { pool_team: 'Lab Validation' }), 'Lab Validation');
  });
});
