import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LabelPrint } from './LabelPrint';

const mocks = vi.hoisted(() => {
  const labels = [
    {
      assetId: 1, productName: 'RTX PRO 6000', modelNumber: 'MODEL-1', assetTag: 'INV-GPU-0001',
      serialNumber: 'SYN-GPU-000001', barcodeValue: 'INV-GPU-0001',
      barcodeSvg: '<svg aria-label="Code 128 barcode"><rect width="10" height="10"/></svg>',
    },
    {
      assetId: 2, productName: 'Lab Server', modelNumber: 'MODEL-2', assetTag: null,
      serialNumber: 'SYN-SRV-000001', barcodeValue: 'SYN-SRV-000001',
      barcodeSvg: '<svg aria-label="Code 128 barcode"><rect width="10" height="10"/></svg>',
    },
  ];
  return {
    labels,
    previewLabels: vi.fn().mockResolvedValue(labels),
    printLabels: vi.fn((assetIds: number[]) => Promise.resolve(
      labels.filter((label) => assetIds.includes(label.assetId)),
    )),
    roles: ['super_user', 'privileged_administrator'],
  };
});

vi.mock('../api', () => ({
  api: {
    labelPreview: mocks.previewLabels,
    labels: mocks.printLabels,
  },
}));

vi.mock('../state/AppState', () => ({
  useAppState: () => ({
    session: { user: { roles: mocks.roles } },
    notify: vi.fn(),
  }),
}));

beforeEach(() => {
  mocks.previewLabels.mockResolvedValue(mocks.labels);
  mocks.printLabels.mockImplementation((assetIds: number[]) => Promise.resolve(
    mocks.labels.filter((label) => assetIds.includes(label.assetId)),
  ));
});

afterEach(() => {
  cleanup();
  mocks.roles.splice(0, mocks.roles.length, 'super_user', 'privileged_administrator');
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('LabelPrint', () => {
  it('renders exactly one physical label per selected asset', async () => {
    const view = render(<LabelPrint assetIds={[1, 2]} onClose={() => undefined} />);
    await waitFor(() => expect(view.container.querySelectorAll('.physical-label')).toHaveLength(2));
    expect(view.container.textContent).toContain('INV-GPU-0001');
    expect(view.container.textContent).toContain('MODEL-2');
    expect(view.container.querySelectorAll('.physical-label')).toHaveLength(2);
    expect(view.container.querySelectorAll('.physical-label svg')).toHaveLength(2);
    expect(document.body.querySelectorAll('.print-root .physical-label')).toHaveLength(0);
    expect(view.getByText('2 of 2 labels included')).toBeTruthy();
  });

  it('lets an elevated user choose rows and fields before printing', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(document.body.querySelectorAll('.print-root .physical-label')).toHaveLength(1);
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const view = render(<LabelPrint assetIds={[1, 2]} onClose={() => undefined} />);
    await view.findByText('2 of 2 labels included');

    fireEvent.click(view.getByRole('checkbox', { name: /Lab Server/ }));
    fireEvent.click(view.getByRole('checkbox', { name: 'Model #' }));
    fireEvent.click(view.getByRole('button', { name: 'Print 1 Label' }));

    await waitFor(() => expect(mocks.printLabels).toHaveBeenCalledWith(
      [1],
      ['productName', 'assetTag', 'serialNumber'],
    ));
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.body.querySelectorAll('.print-root .physical-label')).toHaveLength(0);
  });

  it('keeps custom row and field controls hidden from a regular user', async () => {
    mocks.roles.splice(0, mocks.roles.length, 'user');
    const view = render(<LabelPrint assetIds={[1, 2]} onClose={() => undefined} />);
    await view.findByText('2 of 2 labels included');
    expect(view.queryByLabelText('Label print settings')).toBeNull();
    expect(view.getByText('2 labels')).toBeTruthy();
  });
});
