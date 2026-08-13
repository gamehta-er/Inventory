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

  it('uses an unambiguous trend alias and chronological expression', () => {
    assert.match(source, /AS report_month/);
    assert.match(source, /ORDER BY date_trunc\('month',a\.date_received\)/);
    assert.doesNotMatch(source, /\) month,count/);
    assert.match(source, /month: row\.report_month/);
    assert.match(source, /query\.receivedMonth/);
    assert.match(source, /date_trunc\('month',a\.date_received\)=\?::date/);
  });

  it('exposes real lifecycle, quality, and field-level drilldown data', () => {
    for (const lifecycleKpi of ['available_now', 'gpu_ready', 'in_use', 'rework', 'e_waste', 'archive']) {
      assert.match(source, new RegExp(`\\b${lifecycleKpi}\\b`));
    }
    assert.match(source, /query\.missingField/);
    assert.match(source, /quality_fd\.field_key/);
    assert.match(source, /issues: qualityIssues\.rows/);
    assert.match(source, /complete: Math\.max/);
  });

  it('keeps missing owners and vendors visible in reporting and drilldowns', () => {
    assert.match(source, /LEFT JOIN application_users/);
    assert.match(source, /LEFT JOIN vendors/);
    assert.match(source, /query\.vendorId === '__UNASSIGNED__'/);
  });

  it('builds the management command center from one consistent database snapshot', () => {
    assert.match(source, /\/api\/v1\/reports\/command-center/);
    assert.match(source, /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.match(source, /buildReportResult\(client, 'inventory'/);
    assert.match(source, /importsNeedingAttention/);
    assert.match(source, /recentActivity/);
    assert.match(source, /user\.permissions\.includes\('import\.execute'\)/);
    assert.match(source, /user\.permissions\.includes\('activity\.view'\)/);
  });
});
