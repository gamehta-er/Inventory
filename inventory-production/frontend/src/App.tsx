import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { LoadingState } from './components/LoadingState';
import { LoginPage } from './components/LoginPage';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { ToastRegion } from './components/ToastRegion';
import { ActivityPage } from './pages/ActivityPage';
import { AdminPage } from './pages/AdminPage';
import { AssetModalRoute, AssetRoutePage } from './pages/AssetRoutePage';
import { ImportPage } from './pages/ImportPage';
import { InventoryPage } from './pages/InventoryPage';
import { ReportsPage } from './pages/ReportsPage';
import { SearchPage } from './pages/SearchPage';
import { useAppState } from './state/AppState';

export function App() {
  const { auth, loading, fatalError } = useAppState();
  const location = useLocation();
  const backgroundLocation = (location.state as { backgroundLocation?: Location } | null)?.backgroundLocation;
  if (loading) return <LoadingState label="Starting Inventory Project"/>;
  if (fatalError) return <div className="fatal-state"><h1>Inventory Project could not start</h1><p>{fatalError}</p><button onClick={() => window.location.reload()}>Retry</button></div>;
  if (!auth?.authenticated || !auth.user) return <><LoginPage/><ToastRegion/></>;
  return <AppShell>
    <RouteErrorBoundary>
      <Routes location={backgroundLocation ?? location}>
        <Route path="/" element={<SearchPage/>}/>
        <Route path="/assets/:assetId" element={<AssetRoutePage/>}/>
        <Route path="/inventory" element={<InventoryPage/>}/>
        <Route path="/import" element={<ImportPage/>}/>
        <Route path="/reports" element={<ReportsPage/>}/>
        <Route path="/activity" element={<ActivityPage/>}/>
        <Route path="/admin" element={<AdminPage/>}/>
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes>
      {backgroundLocation && <Routes><Route path="/assets/:assetId" element={<AssetModalRoute/>}/></Routes>}
    </RouteErrorBoundary>
    <ToastRegion/>
  </AppShell>;
}
