import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { FieldDefinition, ImportIssue, ImportSession } from '../types';
import { changedImportValues, editableRowValues, formatImportCount, ImportIssueCard, ImportPage } from './ImportPage';

const mockedState = vi.hoisted(() => ({
  session: {
    user: { id: 1, displayName: 'Gaurav Mehta', initials: 'GM', roles: ['privileged_administrator'], permissions: [] },
    permissions: { 'import.lookup.resolve': true, 'import.review': false },
    categories: [{ id: 1, key: 'GPU', name: 'GPU', description: '', icon: 'gpu', profileId: 10, profileKey: 'GPU', profileName: 'GPU', version: 1, assetCount: 0 }],
    statuses: [],
    health: {},
    lifecycle: { groups: { available: [], unavailable: [], exceptions: [] }, operations: {} },
  },
  notify: vi.fn(),
  refreshSession: vi.fn(async () => undefined),
  refreshRegistry: vi.fn(async () => undefined),
  invalidateInventory: vi.fn(),
}));

const enabledImportControl = {
  mode: 'ENABLED' as const,
  reason: 'Test imports are enabled.',
  changedAt: '2026-08-11T00:00:00Z',
  changedByUserId: 1,
  changedByName: 'Gaurav Mehta',
  changeSource: 'test',
};

vi.mock('../state/AppState', () => ({
  useAppState: () => mockedState,
}));

beforeEach(() => {
  vi.spyOn(api, 'importControl').mockResolvedValue(enabledImportControl);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockedState.notify.mockClear();
  mockedState.refreshSession.mockClear();
  mockedState.refreshRegistry.mockClear();
  mockedState.invalidateInventory.mockClear();
  mockedState.session.user = { id: 1, displayName: 'Gaurav Mehta', initials: 'GM', roles: ['privileged_administrator'], permissions: [] };
  mockedState.session.permissions['import.review'] = false;
});

const approvedArchitectures = [
  { id: 1, value: 'BLACKWELL', label: 'Blackwell' },
  { id: 2, value: 'ADA', label: 'Ada' },
];

function issue(overrides: Partial<ImportIssue> = {}): ImportIssue {
  return {
    fieldKey: 'board_architecture',
    fieldLabel: 'Board Architecture',
    severity: 'ERROR',
    code: 'LOOKUP_VALUE_UNRECOGNIZED',
    message: 'Board Architecture value "AMPERE" is not approved.',
    sourceValue: 'AMPERE',
    lookupKey: 'BOARD_ARCHITECTURE',
    lookupName: 'Board Architecture',
    approvedValues: approvedArchitectures,
    suggestedValues: ['Blackwell'],
    ...overrides,
  };
}

const serialField: FieldDefinition = {
  id: 101,
  fieldKey: 'serial_number',
  label: 'Serial #',
  definition: 'Manufacturer serial number.',
  helpText: 'Required and unique.',
  dataType: 'text',
  storageTarget: 'assets.serial_number',
  aliases: ['serial', 'serial #'],
  validationRules: {},
  uniqueWhenPopulated: true,
  required: true,
  displayOrder: 1,
  surfaces: { import: true },
  options: [],
};

const ownerField: FieldDefinition = {
  ...serialField,
  id: 102,
  fieldKey: 'owner',
  label: 'Owner / Assignee',
  dataType: 'entity',
  storageTarget: 'assets.owner_user_id',
  uniqueWhenPopulated: false,
  options: [
    { id: 5, value: 'Gaurav Mehta', label: 'Gaurav Mehta' },
    { id: 16, value: 'Monica Martin', label: 'Monica Martin' },
  ],
};

function importSession(overrides: Partial<ImportSession> = {}): ImportSession {
  return {
    id: 'import-session-1',
    profileId: 10,
    profileVersion: 1,
    currentProfileVersion: 1,
    profileName: 'GPU',
    categoryName: 'GPU',
    categoryKey: 'GPU',
    mode: 'CREATE',
    fileName: null,
    fileSha256: null,
    fileSizeBytes: null,
    sourceFormat: null,
    sourceSheetName: null,
    sourceEncoding: null,
    sourceDelimiter: null,
    sourceSchemaVersion: 'inventory-import-v2',
    sourceOptions: {},
    availableSheets: [],
    draftRevision: 0,
    draftHash: null,
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    verificationStatus: 'NOT_RUN',
    verificationDetails: {},
    status: 'DRAFT',
    totalRows: 0,
    validRows: 0,
    warningRows: 0,
    invalidRows: 0,
    createdBy: 'Gaurav Mehta',
    createdByUserId: 1,
    createdAt: '2026-08-11T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
    validatedAt: null,
    completedAt: null,
    failureMessage: null,
    headers: [],
    mappingIssues: [],
    fields: [serialField],
    rows: [],
    results: [],
    reviews: [],
    approvalProgress: { accepted: 0, declined: 0, required: 2 },
    reviewSummary: { includedRows: 0, excludedRows: 0, createRows: 0, updateRows: 0, warningRows: 0, changedFields: 0 },
    stageEvents: [],
    importControl: enabledImportControl,
    ...overrides,
  };
}

describe('formatImportCount', () => {
  it('uses the requested regional number format for large batches', () => {
    expect(formatImportCount(1000, 'en-US')).toBe('1,000');
    expect(formatImportCount(1000, 'de-DE')).toBe('1.000');
  });
});

describe('ImportIssueCard', () => {
  it('shows approved values and corrects the staged row without a new upload', () => {
    let corrected = '';
    const view = render(
      <MemoryRouter>
        <ul>
          <ImportIssueCard
            canApproveLookups
            onCorrect={(value) => { corrected = value; }}
            issue={issue()}
          />
        </ul>
      </MemoryRouter>,
    );

    expect(view.getByText('Board Architecture')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: /view approved values \(2\)/i }));
    fireEvent.click(view.getByRole('button', { name: 'Blackwell' }));
    expect(corrected).toBe('Blackwell');
  });

  it('lets an authorized operator add a rejected controlled value with a reason', () => {
    let approvalReason = '';
    const view = render(
      <MemoryRouter>
        <ul>
          <ImportIssueCard
            canApproveLookups
            onApprove={(reason) => { approvalReason = reason; }}
            issue={issue({
              fieldKey: 'pool_team',
              fieldLabel: 'Pool/Team',
              message: 'Pool/Team value "Colossus GPU Platform Team" is not approved.',
              sourceValue: 'Colossus GPU Platform Team',
              lookupKey: 'POOL_TEAM',
              lookupName: 'Pool/Team',
              approvedValues: [{ id: 3, value: 'IMARGULIS_STAFF', label: '#imargulis-staff' }],
              suggestedValues: [],
            })}
          />
        </ul>
      </MemoryRouter>,
    );

    fireEvent.click(view.getByRole('button', { name: /add as new value/i }));
    fireEvent.change(view.getByLabelText(/reason/i), { target: { value: 'Approved team for GPU operations.' } });
    fireEvent.click(view.getByRole('button', { name: /add value and revalidate/i }));
    expect(approvalReason).toBe('Approved team for GPU operations.');
  });

  it('distinguishes an empty controlled list from an unmapped profile field', () => {
    const view = render(
      <MemoryRouter>
        <ul>
          <ImportIssueCard
            canApproveLookups
            issue={issue({ approvedValues: [], suggestedValues: [] })}
          />
        </ul>
      </MemoryRouter>,
    );

    expect(view.getByText('AMPERE')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: /view approved values \(0\)/i }));
    expect(view.getByText(/No approved values are configured for this field/i)).toBeTruthy();
    expect(view.getByRole('button', { name: /add as new value/i })).toBeTruthy();
    expect(view.queryByRole('button', { name: /repair profile/i })).toBeNull();
  });

  it('offers approved relationship values without allowing relationship creation in import', () => {
    let corrected = '';
    const view = render(
      <MemoryRouter>
        <ul>
          <ImportIssueCard
            canApproveLookups
            onCorrect={(value) => { corrected = value; }}
            issue={issue({
              fieldKey: 'owner',
              fieldLabel: 'Owner / Assignee',
              code: 'OWNER_NOT_RECOGNIZED',
              message: 'Owner / Assignee does not match a team member.',
              sourceValue: 'Gaurav M',
              lookupKey: undefined,
              lookupName: 'Team members',
              approvedValues: [{ id: 10, value: 'Gaurav Mehta', label: 'Gaurav Mehta' }],
              suggestedValues: ['Gaurav Mehta'],
            })}
          />
        </ul>
      </MemoryRouter>,
    );

    fireEvent.click(view.getByRole('button', { name: /Gaurav Mehta/i }));
    expect(corrected).toBe('Gaurav Mehta');
    expect(view.queryByRole('button', { name: /add as new value/i })).toBeNull();
  });

  it('tells regular users who can add a controlled value', () => {
    const view = render(
      <MemoryRouter>
        <ul>
          <ImportIssueCard canApproveLookups={false} issue={issue()} />
        </ul>
      </MemoryRouter>,
    );

    expect(view.getByText(/A Super User or Privileged Administrator can add/i)).toBeTruthy();
    expect(view.queryByRole('button', { name: /add as new value/i })).toBeNull();
  });

  it('keeps Notes as optional free text instead of a controlled-list issue', () => {
    const view = render(
      <MemoryRouter>
        <ul>
          <ImportIssueCard
            canApproveLookups
            issue={issue({
              fieldKey: 'notes',
              fieldLabel: 'Notes',
              severity: 'WARNING',
              code: 'OPTIONAL_EMPTY',
              message: 'Notes was not provided.',
              sourceValue: undefined,
              lookupKey: undefined,
              lookupName: undefined,
              approvedValues: undefined,
              suggestedValues: undefined,
            })}
          />
        </ul>
      </MemoryRouter>,
    );

    expect(view.getByText('Notes was not provided.')).toBeTruthy();
    expect(view.queryByRole('button', { name: /approved values/i })).toBeNull();
  });
});

describe('ImportPage workflow', () => {
  it('submits only fields the user changed so a stale editor cannot erase another correction', () => {
    const initial = { serial_number: 'SER-100', owner: 'Gaurav Mehta', notes: 'Validated note' };
    const current = { ...initial, owner: 'Monica Martin' };

    expect(changedImportValues(initial, current)).toEqual({ owner: 'Monica Martin' });
  });

  it('shows relationship names instead of stored IDs in an update-row editor', () => {
    const session = importSession({
      mode: 'UPDATE',
      fields: [serialField, ownerField],
      headers: [{ sourceIndex: 0, header: 'Serial #', fieldKey: 'serial_number', ignored: false }],
    });
    const row: ImportSession['rows'][number] = {
      id: 'row-1', row_number: 2, source_values: { '0': 'SER-100' }, corrected_values: {},
      normalized_values: { serial_number: 'SER-100', owner: 5 }, included: true, operation: 'UPDATE',
      target_asset_id: 10, target_asset_revision: 2, before_values: { serial_number: 'SER-100', owner: 5 },
      after_values: { serial_number: 'SER-100', owner: 5 }, status: 'VALID', committed_asset_id: null, issues: [],
    };

    expect(editableRowValues(session, row)).toEqual({ serial_number: 'SER-100', owner: 'Gaurav Mehta' });
  });

  it('resumes a persistent session from its saved URL', async () => {
    const savedSession = importSession({ id: 'saved-session-42', fileName: null, status: 'DRAFT' });
    vi.spyOn(api, 'imports').mockResolvedValue([]);
    const loadSession = vi.spyOn(api, 'importSession').mockResolvedValue(savedSession);

    const view = render(<MemoryRouter initialEntries={['/import?session=saved-session-42']}><ImportPage /></MemoryRouter>);

    expect(await view.findByText('Choose CSV or Excel data')).toBeTruthy();
    expect(view.getByText(/original file and its hash stay with this session/i)).toBeTruthy();
    expect(loadSession).toHaveBeenCalledWith('saved-session-42');
  });

  it('creates and uploads a persistent session from one smart-import action', async () => {
    const draftSession = importSession();
    const readySession = importSession({
      fileName: 'gpu-assets.csv',
      status: 'AWAITING_APPROVAL',
      draftRevision: 1,
      draftHash: 'draft-hash-1',
      totalRows: 1,
      validRows: 1,
      headers: [{ sourceIndex: 0, header: 'Serial #', fieldKey: 'serial_number', ignored: false }],
      rows: [{
        id: 'import-row-1', row_number: 2, source_values: { '0': 'SYN-GPU-000001' }, corrected_values: {},
        normalized_values: { serial_number: 'SYN-GPU-000001' }, included: true, operation: 'CREATE',
        target_asset_id: null, target_asset_revision: null, before_values: null,
        after_values: { serial_number: 'SYN-GPU-000001' }, status: 'VALID', committed_asset_id: null, issues: [],
      }],
    });
    vi.spyOn(api, 'imports').mockResolvedValue([]);
    const createSession = vi.spyOn(api, 'createImportSession').mockResolvedValue(draftSession);
    const uploadFile = vi.spyOn(api, 'uploadImportFile').mockResolvedValue(readySession);

    const view = render(<MemoryRouter initialEntries={['/import']}><ImportPage /></MemoryRouter>);
    const input = await waitFor(() => view.container.querySelector('input[type="file"]') as HTMLInputElement);
    fireEvent.change(input, { target: { files: [new File(['Serial #\r\nSYN-GPU-000001\r\n'], 'gpu-assets.csv', { type: 'text/csv' })] } });
    fireEvent.click(view.getByRole('button', { name: /analyze file/i }));

    await waitFor(() => expect(createSession).toHaveBeenCalledWith(10, 'CREATE'));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledWith('import-session-1', expect.any(File)));
    expect(await view.findByText(/1 source row, 1 included/i)).toBeTruthy();
    expect(view.queryByRole('button', { name: /save mapping and validate/i })).toBeNull();
  });

  it('runs automatic mapping, atomic commit, and every required post-commit refresh', async () => {
    const draft = importSession();
    const mapping = importSession({
      fileName: 'gpu-assets.csv',
      status: 'APPROVED',
      draftRevision: 2,
      draftHash: 'approved-draft-hash',
      approvalProgress: { accepted: 2, declined: 0, required: 2 },
      reviews: [
        { id: 1, draftRevision: 2, draftHash: 'approved-draft-hash', reviewerUserId: 2, reviewerName: 'Igor Margulis', decision: 'ACCEPT', reason: null, createdAt: '2026-08-11T00:01:10Z' },
        { id: 2, draftRevision: 2, draftHash: 'approved-draft-hash', reviewerUserId: 3, reviewerName: 'Monica Martin', decision: 'ACCEPT', reason: null, createdAt: '2026-08-11T00:01:20Z' },
      ],
      totalRows: 1,
      validRows: 1,
      headers: [{ sourceIndex: 0, header: 'Serial #', fieldKey: 'serial_number', ignored: false }],
      rows: [{
        id: 'import-row-1',
        row_number: 2,
        source_values: { '0': 'SYN-GPU-000001' },
        corrected_values: {},
        normalized_values: { serial_number: 'SYN-GPU-000001' },
        included: true,
        operation: 'CREATE',
        target_asset_id: null,
        target_asset_revision: null,
        before_values: null,
        after_values: { serial_number: 'SYN-GPU-000001' },
        status: 'VALID',
        committed_asset_id: null,
        issues: [],
      }],
      validatedAt: '2026-08-11T00:01:00Z',
    });
    const ready = mapping;
    const completed = importSession({
      ...ready,
      status: 'COMPLETED',
      completedAt: '2026-08-11T00:02:00Z',
      results: [{
        import_row_id: 'import-row-1',
        asset_id: 501,
        operation: 'CREATE',
        asset_revision: 1,
        product_name: 'GPU asset',
        serial_number: 'SYN-GPU-000001',
      }],
    });

    vi.spyOn(api, 'imports').mockResolvedValue([]);
    vi.spyOn(api, 'createImportSession').mockResolvedValue(draft);
    vi.spyOn(api, 'uploadImportFile').mockResolvedValue(mapping);
    const commitImport = vi.spyOn(api, 'commitImport').mockResolvedValue({
      session: completed,
      idempotent: false,
      refresh: ['search', 'inventory', 'reports', 'activity', 'imports', 'categories'],
    });

    const view = render(<MemoryRouter initialEntries={['/import']}><ImportPage /></MemoryRouter>);
    const fileInput = await waitFor(() => {
      const input = view.container.querySelector('input[type="file"]');
      expect(input).toBeTruthy();
      return input as HTMLInputElement;
    });
    fireEvent.change(fileInput, { target: { files: [new File(['Serial #\r\nSYN-GPU-000001\r\n'], 'gpu-assets.csv', { type: 'text/csv' })] } });
    const uploadButton = await waitFor(() => {
      const button = view.getByRole('button', { name: /analyze file/i }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      return button;
    });
    fireEvent.click(uploadButton);

    expect(await view.findByText(/1 source row, 1 included/i)).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: /commit 1 new assets/i }));

    expect(await view.findByText('Import completed')).toBeTruthy();
    await waitFor(() => expect(commitImport).toHaveBeenCalledWith('import-session-1', {
      draftRevision: 2,
      draftHash: 'approved-draft-hash',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    }));
    expect(mockedState.invalidateInventory).toHaveBeenCalledTimes(1);
    expect(mockedState.refreshSession).toHaveBeenCalledTimes(1);
    expect(mockedState.refreshRegistry).toHaveBeenCalledTimes(1);
    expect(api.imports).toHaveBeenCalled();
  });

  it('keeps an approved draft locked while the server import mode is disabled', async () => {
    const disabledControl = { ...enabledImportControl, mode: 'DISABLED' as const, reason: 'Reliability gates are still running.' };
    const approved = importSession({
      status: 'APPROVED',
      fileName: 'gpu-assets.xlsx',
      sourceFormat: 'XLSX',
      sourceSheetName: 'Assets',
      draftRevision: 4,
      draftHash: 'locked-draft-hash',
      totalRows: 1,
      validRows: 1,
      rows: [{
        id: 'row-locked', row_number: 2, source_values: { '0': 'SYN-GPU-000002' }, corrected_values: {},
        normalized_values: { serial_number: 'SYN-GPU-000002' }, included: true, operation: 'CREATE',
        target_asset_id: null, target_asset_revision: null, before_values: null,
        after_values: { serial_number: 'SYN-GPU-000002' }, status: 'VALID', committed_asset_id: null, issues: [],
      }],
      approvalProgress: { accepted: 2, declined: 0, required: 2 },
      importControl: disabledControl,
    });
    vi.mocked(api.importControl).mockResolvedValue(disabledControl);
    vi.spyOn(api, 'imports').mockResolvedValue([]);
    vi.spyOn(api, 'importSession').mockResolvedValue(approved);

    const view = render(<MemoryRouter initialEntries={['/import?session=import-session-1']}><ImportPage /></MemoryRouter>);

    expect(await view.findByText('Commits locked')).toBeTruthy();
    const commitButton = view.getByRole('button', { name: /commit 1 new assets/i }) as HTMLButtonElement;
    expect(commitButton.disabled).toBe(true);
    expect(view.getByText(/two approvals complete, but commits are disabled/i)).toBeTruthy();
  });

  it('lets the importer reopen an approved draft and clearly warns that approvals reset', async () => {
    const approved = importSession({
      status: 'APPROVED',
      fileName: 'gpu-assets.csv',
      draftRevision: 4,
      draftHash: 'approved-draft-hash',
      totalRows: 1,
      validRows: 1,
      approvalProgress: { accepted: 2, declined: 0, required: 2 },
    });
    const reopened = importSession({
      ...approved,
      status: 'AWAITING_APPROVAL',
      draftRevision: 5,
      draftHash: 'reopened-draft-hash',
      approvalProgress: { accepted: 0, declined: 0, required: 2 },
    });
    vi.spyOn(api, 'imports').mockResolvedValue([]);
    vi.spyOn(api, 'importSession').mockResolvedValue(approved);
    const reopenImport = vi.spyOn(api, 'reopenImport').mockResolvedValue(reopened);

    const view = render(<MemoryRouter initialEntries={['/import?session=import-session-1']}><ImportPage /></MemoryRouter>);

    expect(await view.findByText(/reopening resets both approvals/i)).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: /reopen to adjust/i }));
    await waitFor(() => expect(reopenImport).toHaveBeenCalledWith('import-session-1'));
    expect(await view.findByText(/all decisions for this revision reset automatically/i)).toBeTruthy();
  });

  it('lets a different privileged administrator accept the exact protected revision', async () => {
    mockedState.session.user = { id: 2, displayName: 'Igor Margulis', initials: 'IM', roles: ['privileged_administrator'], permissions: [] };
    mockedState.session.permissions['import.review'] = true;
    const awaitingReview = importSession({
      createdByUserId: 1,
      status: 'AWAITING_APPROVAL',
      fileName: 'gpu-assets.csv',
      draftRevision: 3,
      draftHash: 'review-draft-hash',
      totalRows: 1,
      validRows: 1,
    });
    const accepted = importSession({
      ...awaitingReview,
      reviews: [{ id: 1, draftRevision: 3, draftHash: 'review-draft-hash', reviewerUserId: 2, reviewerName: 'Igor Margulis', decision: 'ACCEPT', reason: null, createdAt: '2026-08-11T00:01:10Z' }],
      approvalProgress: { accepted: 1, declined: 0, required: 2 },
    });
    vi.spyOn(api, 'imports').mockResolvedValue([]);
    vi.spyOn(api, 'importSession').mockResolvedValue(awaitingReview);
    const reviewImport = vi.spyOn(api, 'reviewImport').mockResolvedValue(accepted);

    const view = render(<MemoryRouter initialEntries={['/import?session=import-session-1']}><ImportPage /></MemoryRouter>);
    fireEvent.click(await view.findByRole('button', { name: /accept this draft/i }));

    await waitFor(() => expect(reviewImport).toHaveBeenCalledWith('import-session-1', {
      decision: 'ACCEPT',
      reason: undefined,
      draftRevision: 3,
      draftHash: 'review-draft-hash',
    }));
    expect(await view.findByText(/your decision is recorded/i)).toBeTruthy();

  });
});
