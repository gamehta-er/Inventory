import { describe, expect, it } from 'vitest';
import {
  normalizeActivityResponse,
  normalizeAssetListResponse,
  normalizeCommandCenterResponse,
  normalizeImportSessionListResponse,
  normalizeImportSessionResponse,
  normalizeReportResponse,
  normalizeVersionResponse,
} from './api';

describe('normalizeAssetListResponse', () => {
  it('supplies a complete summary when an older or incomplete API response omits it', () => {
    const result = normalizeAssetListResponse({ assets: [], total: 0, page: 1, limit: 100 });

    expect(result.summary).toEqual({ total: 0, available: 0, unavailable: 0, exceptions: 0 });
  });

  it('normalizes PostgreSQL count values without changing their meaning', () => {
    const result = normalizeAssetListResponse({
      assets: [],
      total: '5',
      page: '1',
      limit: '100',
      summary: { total: '5', available: '4', unavailable: '1', exceptions: '0' },
    });

    expect(result).toMatchObject({
      total: 5,
      page: 1,
      limit: 100,
      summary: { total: 5, available: 4, unavailable: 1, exceptions: 0 },
    });
  });
});

describe('import response normalization', () => {
  it('returns an empty session list when an older API response omits sessions', () => {
    expect(normalizeImportSessionListResponse({})).toEqual([]);
  });

  it('accepts the legacy batches collection without blanking the Import page', () => {
    const result = normalizeImportSessionListResponse({
      batches: [{ id: 'batch-1', mode: 'CREATE', status: 'DRAFT', total_rows: '2' }],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'batch-1', mode: 'CREATE', status: 'DRAFT', total_rows: 2 });
  });

  it('supplies every render collection when an import session response is incomplete', () => {
    const result = normalizeImportSessionResponse({
      session: { id: 'batch-1', mode: 'CREATE', status: 'NEEDS_ATTENTION' },
    });

    expect(result.headers).toEqual([]);
    expect(result.mappingIssues).toEqual([]);
    expect(result.fields).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.results).toEqual([]);
  });

  it('normalizes nested field, row, and issue collections from PostgreSQL responses', () => {
    const result = normalizeImportSessionResponse({
      session: {
        id: 'batch-2',
        mode: 'CREATE',
        status: 'NEEDS_ATTENTION',
        fields: [{ id: 1, field_key: 'board_architecture', label: 'Board Architecture', data_type: 'lookup' }],
        rows: [{ id: 'row-1', row_number: 2, status: 'BLOCKED' }],
      },
    });

    expect(result.fields[0]?.options).toEqual([]);
    expect(result.fields[0]?.aliases).toEqual([]);
    expect(result.rows[0]?.issues).toEqual([]);
    expect(result.rows[0]?.source_values).toEqual({});
  });
});

describe('route response normalization', () => {
  it('initializes activity changes when an event is incomplete', () => {
    const result = normalizeActivityResponse({ activity: [{ id: 7, record_label: 'Asset 7' }] });

    expect(result.events[0]?.changes).toEqual([]);
    expect(result).toMatchObject({ total: 1, page: 1, limit: 40 });
  });

  it('initializes every report collection when a response is incomplete', () => {
    const result = normalizeReportResponse({ reportId: 'inventory' });

    expect(result.kpis).toEqual({});
    expect(result.dimensions).toEqual({});
    expect(result.trends).toEqual([]);
    expect(result.quality).toEqual({ complete: 0, missing: 0, issues: [] });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('initializes every command-center collection when the response is incomplete', () => {
    const result = normalizeCommandCenterResponse({ generatedAt: '2026-08-12T20:00:00Z' });

    expect(result.inventory.rows).toEqual([]);
    expect(result.inventory.dimensions).toEqual({});
    expect(result.imports.recent).toEqual([]);
    expect(result.recentActivity).toEqual([]);
    expect(result.actionQueues).toEqual({
      rework: 0, eWaste: 0, metadataGaps: 0, unassignedOwner: 0,
      unassignedLocation: 0, importsNeedingAttention: 0,
    });
  });

  it('normalizes the deployable version contract', () => {
    expect(normalizeVersionResponse({
      package_version: '1.3.2',
      web_version: '1.3.2',
      api_version: '1.3.2',
      schema_version: '005-complete-import-workflow',
      import_contract_version: '005-complete-import-workflow',
      compatible: true,
    })).toEqual({
      packageVersion: '1.3.2',
      webVersion: '1.3.2',
      apiVersion: '1.3.2',
      schemaVersion: '005-complete-import-workflow',
      importContractVersion: '005-complete-import-workflow',
      compatible: true,
    });
  });
});
