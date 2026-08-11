import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Overlay } from './Overlay';

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('Overlay', () => {
  it('closes from the backdrop, Escape, and close button', () => {
    const onClose = vi.fn();
    const view = render(<Overlay title="Asset details" onClose={onClose}><p>Asset content</p></Overlay>);
    const dialog = view.getByRole('dialog', { name: 'Asset details' });
    expect(dialog).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(view.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('does not close when the sheet content is clicked', () => {
    const onClose = vi.fn();
    const view = render(<Overlay title="Filters" onClose={onClose}><button>Inside</button></Overlay>);
    fireEvent.mouseDown(view.getByRole('button', { name: 'Inside' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
