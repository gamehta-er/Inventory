import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { FieldDefinition, ImportIssue, ImportSession } from '../types';
import { ImportIssueCard, ImportPage } from './ImportPage';

const mockedState = vi.hoisted(() => ({
  session: {
    user: { id: 1, displayName: 'Gaurav Mehta', initials: 'GM', roles: ['privileged_administrator'], permissions: [] },
    permissions: { 'import.lookup.resolve': true },
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

vi.mock('../state/AppState', () => ({
  useAppState: () => mockedState,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockedState.notify.mockClear();
  mockedState.refreshSession.mockClear();
  mockedState.refreshRegistry.mockClear();
  mockedState.invalidateInventory.mockClear();
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
    status: 'DRAFT',
    totalRows: 0,
    validRows: 0,
    warningRows: 0,
    invalidRows: 0,
    createdBy: 'Gaurav Mehta',
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
    ...overrides,
  };
}

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
  it('resumes a persistent session from its saved URL', async () => {
    const savedSession = importSession({ id: 'saved-session-42', fileName: null, status: 'DRAFT' });
    vi.spyOn(api, 'imports').mockResolvedValue([]);
    const loadSession = vi.spyOn(api, 'importSession').mockResolvedValue(savedSession);

    const view = render(<MemoryRouter initialEntries={['/import?session=saved-session-42']}><ImportPage /></MemoryRouter>);

    expect(await view.findByText('Choose completed CSV')).toBeTruthy();
    expect(view.getByText(/server stores the original CSV with this session/i)).toBeTruthy();
    expect(loadSession).toHaveBeenCalledWith('saved-session-42');
  });

  it('creates a persistent session and exposes the CSV upload step', async () => {
    const draftSession = importSession();
    vi.spyOn(api, 'imports').mockResolvedValue([]);
    const createSession = vi.spyOn(api, 'createImportSession').mockResolvedValue(draftSession);

    const view = render(<MemoryRouter initialEntries={['/import']}><ImportPage /></MemoryRouter>);
    expect(await view.findByRole('button', { name: /create import session/i })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: /create import session/i }));

    await waitFor(() => expect(createSession).toHaveBeenCalledWith(10, 'CREATE'));
    expect(await view.findByText('Choose completed CSV')).toBeTruthy();
    expect(view.getByRole('button', { name: /upload and map columns/i })).toBeTruthy();
    expect(view.getByRole('button', { name: /download current csv template/i })).toBeTruthy();
  });

  it('runs upload, mapping, atomic commit, and every required post-commit refresh', async () => {
    const draft = importSession();
    const mapping = importSession({
      fileName: 'gpu-assets.csv',
      status: 'MAPPING',
      totalRows: 1,
      headers: [{ sourceIndex: 0, header: 'Serial #', fieldKey: 'serial_number', ignored: false }],
    });
    const ready = importSession({
      fileName: 'gpu-assets.csv',
      status: 'READY',
      totalRows: 1,
      validRows: 1,
      validatedAt: '2026-08-11T00:01:00Z',
      headers: mapping.headers,
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
    });
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
    vi.spyOn(api, 'saveImportMappings').mockResolvedValue(ready);
    const commitImport = vi.spyOn(api, 'commitImport').mockResolvedValue({
      session: completed,
      idempotent: false,
      refresh: ['search', 'inventory', 'reports', 'activity', 'imports', 'categories'],
    });

    const view = render(<MemoryRouter initialEntries={['/import']}><ImportPage /></MemoryRouter>);
    fireEvent.click(await view.findByRole('button', { name: /create import session/i }));

    const fileInput = await waitFor(() => {
      const input = view.container.querySelector('input[type="file"]');
      expect(input).toBeTruthy();
      return input as HTMLInputElement;
    });
    fireEvent.change(fileInput, { target: { files: [new File(['Serial #\r\nSYN-GPU-000001\r\n'], 'gpu-assets.csv', { type: 'text/csv' })] } });
    const uploadButton = await waitFor(() => {
      const button = view.getByRole('button', { name: /upload and map columns/i }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      return button;
    });
    fireEvent.click(uploadButton);

    fireEvent.click(await view.findByRole('button', { name: /save mapping and validate/i }));
    expect(await view.findByText(/1 source row, 1 included/i)).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: /commit 1 new assets/i }));

    expect(await view.findByText('Import completed')).toBeTruthy();
    await waitFor(() => expect(commitImport).toHaveBeenCalledWith('import-session-1'));
    expect(mockedState.invalidateInventory).toHaveBeenCalledTimes(1);
    expect(mockedState.refreshSession).toHaveBeenCalledTimes(1);
    expect(mockedState.refreshRegistry).toHaveBeenCalledTimes(1);
    expect(api.imports).toHaveBeenCalled();
  });
});
