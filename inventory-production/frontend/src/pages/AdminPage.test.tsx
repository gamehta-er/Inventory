import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { HealthPanel, LocationManager } from './AdminPage';

const notify = vi.fn();

vi.mock('../state/AppState', () => ({ useAppState: () => ({ notify }) }));
vi.mock('../api', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../api')>();
  return { ...original, api: { ...original.api, setMaintenance: vi.fn(), addLocationPath: vi.fn() } };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.style.overflow = '';
});

describe('Admin maintenance control', () => {
  it('requires confirmation and a reason before enabling maintenance', async () => {
    vi.mocked(api.setMaintenance).mockResolvedValue({ maintenance: { enabled: true }, changed: true });
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const view = render(<HealthPanel health={{ counts: {}, incompleteProfiles: [], fieldUsage: [], maintenance: { enabled: false } }} onChanged={onChanged}/>);

    fireEvent.click(view.getByRole('button', { name: 'Enable maintenance' }));
    expect(view.getByRole('dialog', { name: 'Enable maintenance mode' })).toBeTruthy();
    fireEvent.click(view.getAllByRole('button', { name: 'Enable maintenance' }).at(-1)!);
    expect(api.setMaintenance).not.toHaveBeenCalled();

    fireEvent.change(view.getByPlaceholderText('Why this configuration is changing'), { target: { value: 'Planned database maintenance' } });
    fireEvent.click(view.getAllByRole('button', { name: 'Enable maintenance' }).at(-1)!);

    await waitFor(() => expect(api.setMaintenance).toHaveBeenCalledWith(true, 'Planned database maintenance'));
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('presents a recovery action when maintenance is already active', () => {
    const view = render(<HealthPanel health={{ counts: {}, incompleteProfiles: [], fieldUsage: [], maintenance: { enabled: true, enabledBy: 'Gaurav Mehta', reason: 'Service work' } }} onChanged={vi.fn().mockResolvedValue(undefined)}/>);
    expect(view.getByRole('button', { name: 'Resume service' })).toBeTruthy();
    expect(view.getByText(/Gaurav Mehta/)).toBeTruthy();
  });
});

describe('Admin guided location hierarchy', () => {
  it('fills and submits the approved Building E storage-path example', async () => {
    vi.mocked(api.addLocationPath).mockResolvedValue({
      location: {},
      createdCount: 5,
      path: 'Building E / Lewis and Clarke (Room 139A) / Row 1 / Rack 1 / Bin A',
    });
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const view = render(<LocationManager reason="Initial location setup" setReason={vi.fn()} onChanged={onChanged}/>);

    fireEvent.click(view.getByRole('button', { name: 'Use sample' }));

    expect((view.getByLabelText(/Building/) as HTMLInputElement).value).toBe('Building E');
    expect((view.getByLabelText(/Room name/) as HTMLInputElement).value).toBe('Lewis and Clarke');
    expect((view.getByLabelText(/Room number/) as HTMLInputElement).value).toBe('139A');
    expect((view.getByLabelText(/Bin row/) as HTMLInputElement).value).toBe('Row 1');
    expect((view.getByLabelText(/Rack location/) as HTMLInputElement).value).toBe('1');
    expect((view.getByLabelText(/Bin location/) as HTMLInputElement).value).toBe('Bin A');
    expect((view.getByLabelText(/Bin ID/) as HTMLInputElement).value).toBe('LNCRO1RA1BA');

    fireEvent.click(view.getByRole('button', { name: 'Add storage path' }));

    await waitFor(() => expect(api.addLocationPath).toHaveBeenCalledWith({
      building: 'Building E',
      roomName: 'Lewis and Clarke',
      roomNumber: '139A',
      binRow: 'Row 1',
      rackLocation: '1',
      binLocation: 'Bin A',
      binId: 'LNCRO1RA1BA',
      reason: 'Initial location setup',
    }));
    expect(onChanged).toHaveBeenCalledWith('Storage path added: Building E / Lewis and Clarke (Room 139A) / Row 1 / Rack 1 / Bin A');
  });
});
