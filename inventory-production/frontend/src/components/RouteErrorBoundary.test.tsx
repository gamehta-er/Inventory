import { cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteErrorBoundary } from './RouteErrorBoundary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function BrokenPage(): never {
  const error = new Error('Malformed route data') as Error & { requestId?: string };
  error.requestId = 'req-route-123';
  throw error;
}

describe('RouteErrorBoundary', () => {
  it('contains a route crash and returns the user to Search', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const view = render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route
            path="/reports"
            element={<RouteErrorBoundary><BrokenPage /></RouteErrorBoundary>}
          />
          <Route path="/" element={<h1>Search inventory</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(view.getByRole('alert').textContent).toContain('This page could not be displayed');
    expect(view.getByRole('alert').textContent).toContain('req-route-123');

    fireEvent.click(view.getByRole('button', { name: 'Return to Search' }));
    expect(view.getByRole('heading', { name: 'Search inventory' })).toBeTruthy();
  });
});
