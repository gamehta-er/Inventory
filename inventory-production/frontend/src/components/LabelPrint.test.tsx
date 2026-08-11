import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LabelPrint } from './LabelPrint';

vi.mock('../api', () => ({
  api: {
    labels: vi.fn().mockResolvedValue([
      {
        assetId: 1,
        productName: 'RTX PRO 6000',
        modelNumber: 'MODEL-1',
        assetTag: 'INV-GPU-0001',
        serialNumber: 'SYN-GPU-000001',
        barcodeValue: 'INV-GPU-0001',
        barcodeSvg: '<svg aria-label="Code 128 barcode"><rect width="10" height="10"/></svg>',
      },
      {
        assetId: 2,
        productName: 'Lab Server',
        modelNumber: 'MODEL-2',
        assetTag: null,
        serialNumber: 'SYN-SRV-000001',
        barcodeValue: 'MODEL-2',
        barcodeSvg: '<svg aria-label="Code 128 barcode"><rect width="10" height="10"/></svg>',
      },
    ]),
  },
}));

afterEach(cleanup);

describe('LabelPrint', () => {
  it('renders exactly one physical label per selected asset', async () => {
    const view = render(<LabelPrint assetIds={[1, 2]} onClose={() => undefined} />);
    expect(await view.findByText('INV-GPU-0001')).toBeTruthy();
    expect(await view.findByText('MODEL-2')).toBeTruthy();
    expect(view.container.querySelectorAll('.physical-label')).toHaveLength(2);
    expect(view.container.querySelectorAll('.physical-label svg')).toHaveLength(2);
    expect(view.getByText('2 assets selected')).toBeTruthy();
  });
});
