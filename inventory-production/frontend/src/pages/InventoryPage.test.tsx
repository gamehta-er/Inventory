import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { InventoryPage } from './InventoryPage';

const notify = vi.fn();
const permissions: Record<string, boolean> = { 'asset.view': true, 'label.print': true, 'report.export': true };
const assets = [
  {
    id: 1, revision: 1, serialNumber: 'SERIAL-1', assetTag: 'ASSET-1', dateReceived: '2026-08-01',
    category: { key: 'GPU', name: 'GPU' }, model: { modelNumber: 'MODEL-1', productName: 'GPU One', imagePath: null },
    status: 'AVAILABLE', location: null, owner: 'Gaurav Mehta', vendor: 'NVIDIA', nvbugs: [],
    references: { nvbugs: [], mrsOrders: [], capacityRequests: [] },
  },
  {
    id: 2, revision: 1, serialNumber: 'SERIAL-2', assetTag: 'ASSET-2', dateReceived: '2026-08-01',
    category: { key: 'GPU', name: 'GPU' }, model: { modelNumber: 'MODEL-2', productName: 'GPU Two', imagePath: null },
    status: 'AVAILABLE', location: null, owner: 'Monica Martin', vendor: 'NVIDIA', nvbugs: [],
    references: { nvbugs: [], mrsOrders: [], capacityRequests: [] },
  },
];

vi.mock('../state/AppState', () => ({
  useAppState: () => ({
    session: { permissions, categories: [] },
    notify,
    refreshSession: vi.fn(),
    inventoryRevision: 0,
    invalidateInventory: vi.fn(),
  }),
}));

vi.mock('../api', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../api')>();
  return { ...original, api: { ...original.api, assets: vi.fn(), exportAssets: vi.fn(), labelPreview: vi.fn(), labels: vi.fn() } };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  permissions['label.print'] = true;
  permissions['report.export'] = true;
  document.body.style.overflow = '';
});

describe('Inventory asset selection', () => {
  it('selects individual and visible assets and enables export and label actions', async () => {
    vi.mocked(api.assets).mockResolvedValue({ assets, total: 2, page: 1, limit: 50, summary: { total: 2, available: 2, unavailable: 0, exceptions: 0 } });
    vi.mocked(api.exportAssets).mockResolvedValue(undefined);
    vi.mocked(api.labelPreview).mockResolvedValue([]);
    const view = render(<MemoryRouter><InventoryPage/></MemoryRouter>);

    const first = await view.findByRole('checkbox', { name: 'Select GPU One' });
    fireEvent.click(first);
    expect((first as HTMLInputElement).checked).toBe(true);
    expect(view.getByText('1 asset selected')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(api.exportAssets).toHaveBeenCalledWith([1]));

    fireEvent.click(view.getByRole('button', { name: 'Select Page' }));
    expect(view.getByText('2 assets selected')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Print Labels' }));
    await waitFor(() => expect(api.labelPreview).toHaveBeenCalledWith([1, 2]));
  });

  it('clears page selection and resets selected rows', async () => {
    vi.mocked(api.assets).mockResolvedValue({ assets, total: 2, page: 1, limit: 50, summary: { total: 2, available: 2, unavailable: 0, exceptions: 0 } });
    const view = render(<MemoryRouter><InventoryPage/></MemoryRouter>);
    await view.findByRole('checkbox', { name: 'Select GPU One' });

    fireEvent.click(view.getByRole('button', { name: 'Select Page' }));
    expect(view.getAllByRole('checkbox').every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(view.getByRole('button', { name: 'Clear Page Selection' }));
    expect(view.queryByText('2 assets selected')).toBeNull();
    expect(view.getAllByRole('checkbox').every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true);
  });

  it('shows only bulk actions authorized for the signed-in user', async () => {
    permissions['report.export'] = false;
    vi.mocked(api.assets).mockResolvedValue({ assets, total: 2, page: 1, limit: 50, summary: { total: 2, available: 2, unavailable: 0, exceptions: 0 } });
    const view = render(<MemoryRouter><InventoryPage/></MemoryRouter>);
    fireEvent.click(await view.findByRole('checkbox', { name: 'Select GPU One' }));

    expect(view.getByRole('button', { name: 'Print Labels' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Export CSV' })).toBeNull();
  });
});
