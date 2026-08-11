import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchLookupOption, normalizeLookupInput } from '../src/lookupMatching.js';

const options = [
  { id: 1, value: 'MAXWELL', label: 'Maxwell', aliases: ['Maxwell Architecture'] },
  { id: 2, value: 'COLOSSUS', label: 'Colossus', aliases: ['Colossus GPU Platform Team'] },
];

describe('controlled-value matching', () => {
  it('accepts capitalization differences and returns the canonical option', () => {
    assert.equal(matchLookupOption(options, 'MAXWELL')?.label, 'Maxwell');
    assert.equal(matchLookupOption(options, '  maxwell  ')?.value, 'MAXWELL');
  });

  it('accepts configured aliases and normalizes repeated whitespace', () => {
    assert.equal(matchLookupOption(options, 'Colossus   GPU Platform Team')?.value, 'COLOSSUS');
  });

  it('leaves genuinely new values unresolved for the add-or-correct workflow', () => {
    assert.equal(matchLookupOption(options, 'New GPU Architecture'), undefined);
  });

  it('normalizes Unicode, whitespace, and case consistently', () => {
    assert.equal(normalizeLookupInput('  MAXWELL\tArchitecture  '), 'maxwell architecture');
  });
});
