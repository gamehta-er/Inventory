import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { SearchPage } from './SearchPage';

const notify = vi.fn();
const getProfile = vi.fn();
const assets = [{
  id: 1,
  revision: 1,
  serialNumber: 'SERIAL-1',
  assetTag: 'ASSET-1',
  dateReceived: '2026-08-01',
  category: { key: 'GPU', name: 'GPU' },
  model: { modelNumber: 'MODEL-1', productName: 'RTX 6000 Ada', imagePath: null },
  status: 'AVAILABLE',
  location: 'Building E / Lewis and Clarke / 139A',
  owner: 'Gaurav Mehta',
  vendor: 'NVIDIA',
  nvbugs: ['900001'],
  references: { nvbugs: ['900001'], mrsOrders: [], capacityRequests: [] },
}];

vi.mock('../state/AppState', () => ({
  useAppState: () => ({
    session: {
      permissions: { 'asset.create': true, 'label.print': true, 'report.export': true },
      categories: [{ id: 1, key: 'GPU', name: 'GPU', description: '', icon: 'box', profileId: 1, profileKey: 'GPU', profileName: 'GPU', version: 1, assetCount: 1 }],
    },
    notify,
    lookups: { lookups: [], locations: [], users: [], vendors: [] },
    getProfile,
    refreshSession: vi.fn(),
    invalidateInventory: vi.fn(),
    inventoryRevision: 0,
  }),
}));

vi.mock('../api', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../api')>();
  return { ...original, api: { ...original.api, assets: vi.fn(), exportAssets: vi.fn(), labelPreview: vi.fn(), labels: vi.fn() } };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.style.overflow = '';
});

function HistoryControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return <><button type="button" onClick={() => navigate(-1)}>Browser Back</button><output data-testid="search-location">{location.search}</output></>;
}

describe('NVIDIA hardware search experience', () => {
  it('keeps text, family, lifecycle, selection, export, and label actions connected', async () => {
    vi.mocked(api.assets).mockResolvedValue({ assets, total: 1, page: 1, limit: 100, summary: { total: 1, available: 1, unavailable: 0, exceptions: 0 } });
    vi.mocked(api.exportAssets).mockResolvedValue(undefined);
    vi.mocked(api.labelPreview).mockResolvedValue([]);

    const view = render(<MemoryRouter><SearchPage/></MemoryRouter>);
    await view.findByText('RTX 6000 Ada');

    fireEvent.change(view.getByRole('searchbox', { name: 'Search inventory' }), { target: { value: 'SERIAL-1' } });
    fireEvent.click(view.getByRole('button', { name: 'Search inventory' }));
    await waitFor(() => expect(api.assets).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'SERIAL-1' })));

    fireEvent.click(view.getByRole('button', { name: /GPU1/ }));
    await waitFor(() => expect(api.assets).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'SERIAL-1', category: 'GPU' })));

    fireEvent.click(view.getByRole('button', { name: /1AvailableReady for assignment/ }));
    await waitFor(() => expect(api.assets).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'GPU', availability: 'available' })));

    fireEvent.click(view.getByRole('checkbox', { name: 'Select RTX 6000 Ada' }));
    fireEvent.click(view.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(api.exportAssets).toHaveBeenCalledWith([1]));

    fireEvent.click(view.getByRole('button', { name: 'Print Labels' }));
    await waitFor(() => expect(api.labelPreview).toHaveBeenCalledWith([1]));
  });

  it('shows removable criteria, clears facets without clearing text, and restores state with Browser Back', async () => {
    vi.mocked(api.assets).mockResolvedValue({ assets, total: 1, page: 1, limit: 100, summary: { total: 1, available: 1, unavailable: 0, exceptions: 0 } });
    getProfile.mockResolvedValue({
      id: 1,
      version: 1,
      description: 'GPU profile',
      fields: [{
        id: 12,
        fieldKey: 'board_architecture',
        label: 'Board Architecture',
        definition: '',
        helpText: '',
        dataType: 'lookup',
        storageTarget: 'asset_field_values',
        aliases: [],
        validationRules: {},
        uniqueWhenPopulated: false,
        required: false,
        displayOrder: 1,
        surfaces: { filter: true },
        options: [{ id: 2, value: 'AMPERE', label: 'AMPERE' }],
      }],
    });

    const view = render(<MemoryRouter initialEntries={['/?q=SERIAL-1&family=GPU&availability=available&filterCategory=GPU&field_board_architecture=2']}><HistoryControls/><SearchPage/></MemoryRouter>);

    await view.findByRole('button', { name: 'Remove Search: SERIAL-1' });
    await view.findByRole('button', { name: 'Remove Family: GPU' });
    await view.findByRole('button', { name: 'Remove Availability: Available' });
    await view.findByRole('button', { name: 'Remove Board Architecture: AMPERE' });
    expect(view.getAllByText('5 active').length).toBeGreaterThan(0);

    fireEvent.click(view.getByRole('button', { name: 'Remove Board Architecture: AMPERE' }));
    await waitFor(() => expect(api.assets).toHaveBeenLastCalledWith(expect.objectContaining({ fieldValues: {} })));
    expect(view.queryByRole('button', { name: 'Remove Board Architecture: AMPERE' })).toBeNull();
    expect(view.getByRole('button', { name: 'Remove Family: GPU' })).toBeTruthy();

    fireEvent.click(view.getAllByRole('button', { name: /Filters3/ })[0]);
    fireEvent.click(view.getByRole('button', { name: 'Clear Filters' }));
    await waitFor(() => expect(api.assets).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'SERIAL-1', category: undefined, availability: undefined, fieldValues: {} })));
    expect(view.getByRole('button', { name: 'Remove Search: SERIAL-1' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Remove Family: GPU' })).toBeNull();

    fireEvent.click(view.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(view.getByTestId('search-location').textContent).toBe(''));
    expect(view.queryByLabelText('Applied search criteria')).toBeNull();

    fireEvent.click(view.getByRole('button', { name: 'Browser Back' }));
    fireEvent.click(view.getByRole('button', { name: 'Browser Back' }));
    fireEvent.click(view.getByRole('button', { name: 'Browser Back' }));
    await view.findByRole('button', { name: 'Remove Board Architecture: AMPERE' });
    await waitFor(() => expect(api.assets).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'SERIAL-1', category: 'GPU', availability: 'available', fieldValues: { board_architecture: '2' } })));
  });
});
