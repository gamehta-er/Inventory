import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const reportsPath = fileURLToPath(new URL('../src/reports.ts', import.meta.url));
const source = await readFile(reportsPath, 'utf8');
const filteringPath = fileURLToPath(new URL('../src/filtering.ts', import.meta.url));
const filteringSource = await readFile(filteringPath, 'utf8');

describe('reporting registry contract', () => {
  it('uses the normalized asset-field value columns from the production schema', () => {
    for (const column of ['text_value', 'number_value', 'date_value', 'boolean_value', 'json_value']) {
      assert.match(source, new RegExp(`\\b${column}\\b`));
    }
    for (const obsoleteColumn of ['value_text', 'value_number', 'value_date', 'value_boolean', 'value_json']) {
      assert.doesNotMatch(source, new RegExp(`\\b${obsoleteColumn}\\b`));
    }
  });

  it('drives report and export fields from active profile registry visibility', () => {
    assert.match(source, /appendRegistryFilters\(query, params, where, 'report'\)/);
    assert.match(filteringSource, /surface === 'filter' \? 'visible_filter' : 'visible_report'/);
    assert.match(filteringSource, /pf\.\$\{visibilityColumn\}/);
    assert.match(source, /pf\.visible_export/);
    assert.match(source, /required_pf\.required/);
    assert.match(source, /required_pf\.active/);
  });

  it('builds KPI totals and drilldowns from the same scoped filter expression', () => {
    assert.match(source, /const scopedWhere = where\.join/);
    assert.match(source, /WHERE \$\{scopedWhere\}/);
    assert.match(source, /GROUP BY \$\{expression\.key\},\$\{expression\.label\}/);
  });
});
