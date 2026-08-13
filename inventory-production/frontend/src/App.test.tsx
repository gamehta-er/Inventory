import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const mocks = vi.hoisted(() => ({ reportView: true }));

vi.mock('./state/AppState', () => ({
  useAppState: () => ({
    auth: { authenticated: true, user: { id: 1, displayName: 'Test User' } },
    loading: false,
    fatalError: '',
    session: { permissions: { 'report.view': mocks.reportView } },
  }),
}));

vi.mock('./components/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./components/RouteErrorBoundary', () => ({ RouteErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./components/ToastRegion', () => ({ ToastRegion: () => null }));
vi.mock('./pages/SearchPage', () => ({ SearchPage: () => <h1>Search route</h1> }));
vi.mock('./pages/ReportsPage', () => ({ ReportsPage: () => <h1>Reports route</h1> }));
vi.mock('./pages/ActivityPage', () => ({ ActivityPage: () => null }));
vi.mock('./pages/AdminPage', () => ({ AdminPage: () => null }));
vi.mock('./pages/AssetRoutePage', () => ({ AssetModalRoute: () => null, AssetRoutePage: () => null }));
vi.mock('./pages/ImportPage', () => ({ ImportPage: () => null }));
vi.mock('./pages/InventoryPage', () => ({ InventoryPage: () => null }));

afterEach(() => {
  cleanup();
  mocks.reportView = true;
});

describe('role-aware home route', () => {
  it('opens Reports for a user with reporting permission', async () => {
    const view = render(<MemoryRouter initialEntries={['/']}><App/></MemoryRouter>);
    expect(await view.findByRole('heading', { name: 'Reports route' })).toBeTruthy();
  });

  it('opens Search for a standard user', async () => {
    mocks.reportView = false;
    const view = render(<MemoryRouter initialEntries={['/']}><App/></MemoryRouter>);
    expect(await view.findByRole('heading', { name: 'Search route' })).toBeTruthy();
  });

  it('keeps Search directly accessible to reporting users', async () => {
    const view = render(<MemoryRouter initialEntries={['/search']}><App/></MemoryRouter>);
    expect(await view.findByRole('heading', { name: 'Search route' })).toBeTruthy();
  });
});
