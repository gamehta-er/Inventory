import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, download } from '../api';
import type { CommandCenterResult, ReportResult } from '../types';
import { ReportsPage } from './ReportsPage';

const notify = vi.fn();
const permissions = { 'report.view': true, 'report.export': true, 'import.execute': true, 'activity.view': true, 'admin.system': true };
const reportResult: ReportResult = {
  reportId: 'inventory',
  kpis: { total: 27, available: 26, in_use: 1, exceptions: 2, rework: 1, e_waste: 1, missing_metadata: 3, gpu_ready: 4 },
  dimensions: {
    category: [{ key: 'GPU', label: 'GPU', value: 27 }], status: [{ key: 'AVAILABLE', label: 'Available', value: 22 }],
    location: [{ key: '__UNASSIGNED__', label: 'Unassigned', value: 3 }], owner: [], vendor: [], model: [], project: [],
  },
  trends: [{ month: '2026-07', value: 10 }, { month: '2026-08', value: 17 }],
  quality: { complete: 24, missing: 3, issues: [{ key: 'serial_number', label: 'Serial #', value: 2 }] },
  rows: [{ id: 8, product_name: 'RTX PRO 6000', category_name: 'GPU', model_number: '699-TEST', serial_number: 'SERIAL-8', owner: 'Gaurav Mehta', location: null, status_label: 'Available', asset_tag: null }],
  page: 1, limit: 50, total: 27,
};
const commandResult: CommandCenterResult = {
  generatedAt: '2026-08-12T20:00:00Z', queryTimeMs: 84, database: { status: 'ready' },
  inventory: { ...reportResult, kpis: { ...reportResult.kpis, received_30_days: 17, unassigned_owner: 2, unassigned_location: 3 } },
  actionQueues: { rework: 1, eWaste: 1, metadataGaps: 3, unassignedOwner: 2, unassignedLocation: 3, importsNeedingAttention: 1 },
  imports: { open: 2, needsAttention: 1, ready: 1, recent: [{ id: 'batch-1', mode: 'CREATE', file_name: 'inventory.csv', status: 'NEEDS_ATTENTION', total_rows: 13, valid_rows: 12, warning_rows: 0, invalid_rows: 1, category_name: 'GPU', profile_name: 'GPU', created_by: 'Gaurav Mehta', created_at: '2026-08-12T19:00:00Z', updated_at: '2026-08-12T19:30:00Z' }] },
  recentActivity: [{ id: 1, action_key: 'ASSET_UPDATED', source: 'assets', reason: 'Owner changed', record_type: 'asset', record_id: '8', record_label: 'RTX PRO 6000', route_path: '/assets/8', created_at: '2026-08-12T19:45:00Z', actor: 'Gaurav Mehta', effective_role_keys: ['super_user'], changes: [] }],
};

vi.mock('../state/AppState', () => ({
  useAppState: () => ({ notify, inventoryRevision: 0, session: { permissions } }),
}));

vi.mock('../api', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../api')>();
  return {
    ...original,
    download: vi.fn(),
    api: { ...original.api, reports: vi.fn(), commandCenter: vi.fn(), report: vi.fn(), reportExportUrl: vi.fn(() => '/api/v1/reports/inventory/export') },
  };
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function arrange() {
  vi.mocked(api.reports).mockResolvedValue([
    { id: 'inventory', name: 'Inventory Overview', description: 'All inventory.' },
    { id: 'rework', name: 'Rework Queue', description: 'Corrective work.' },
    { id: 'e-waste', name: 'E-Waste Queue', description: 'Disposition.' },
    { id: 'missing-metadata', name: 'Required Metadata Gaps', description: 'Incomplete required fields.' },
  ]);
  vi.mocked(api.commandCenter).mockResolvedValue(commandResult);
  vi.mocked(api.report).mockResolvedValue(reportResult);
}

describe('Reports management command center', () => {
  it('renders the consistent snapshot and opens real report queues', async () => {
    arrange();
    const view = render(<MemoryRouter><ReportsPage/></MemoryRouter>);

    expect(await view.findByText('Inventory command center')).toBeTruthy();
    expect(view.getByText('Priority action center')).toBeTruthy();
    expect(view.getByText('inventory.csv')).toBeTruthy();
    expect(view.getByText(/Owner changed/)).toBeTruthy();
    expect(view.getByRole('button', { name: /Tracked assets27/ })).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: /Rework queue/ }));
    await waitFor(() => expect(api.report).toHaveBeenCalledWith('rework', expect.any(Object)));

    fireEvent.click(view.getByRole('button', { name: /2026-08: 17 assets/ }));
    await waitFor(() => expect(api.report).toHaveBeenLastCalledWith('rework', expect.objectContaining({ receivedMonth: '2026-08' })));

    fireEvent.click(view.getByRole('button', { name: 'Export current view' }));
    expect(download).toHaveBeenCalledWith('/api/v1/reports/inventory/export');
  });

  it('drills from a profile-driven quality issue to matching assets', async () => {
    arrange();
    const view = render(<MemoryRouter><ReportsPage/></MemoryRouter>);

    await view.findByText('Inventory command center');
    fireEvent.click(view.getByRole('button', { name: /Data qualityProfile-driven completeness/ }));
    fireEvent.click(await view.findByRole('button', { name: /Serial #/ }));

    await waitFor(() => expect(api.report).toHaveBeenLastCalledWith('inventory', expect.objectContaining({ missingField: 'serial_number' })));
  });

  it('applies the date range to the server-owned command center snapshot', async () => {
    arrange();
    const view = render(<MemoryRouter><ReportsPage/></MemoryRouter>);
    await view.findByText('Inventory command center');

    fireEvent.change(view.getByLabelText('Received from'), { target: { value: '2026-08-01' } });
    await waitFor(() => expect(api.commandCenter).toHaveBeenLastCalledWith(expect.objectContaining({ receivedFrom: '2026-08-01' })));
  });
});
