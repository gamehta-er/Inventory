import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AssetWorkspace, type AssetWorkspaceTab } from '../components/AssetWorkspace';
import { SearchPage } from './SearchPage';
import { useAppState } from '../state/AppState';

const tabs: AssetWorkspaceTab[] = ['overview', 'update', 'operations', 'history'];

function WorkspaceRoute({ direct = false }: { direct?: boolean }) {
  const { assetId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { invalidateInventory, refreshSession } = useAppState();
  const id = Number(assetId);
  if (!Number.isInteger(id) || id < 1) return <Navigate to="/" replace/>;
  const requestedTab = searchParams.get('tab') as AssetWorkspaceTab | null;
  const initialTab = requestedTab && tabs.includes(requestedTab) ? requestedTab : 'overview';
  return <AssetWorkspace
    assetId={id}
    initialTab={initialTab}
    onClose={() => direct ? navigate('/') : navigate(-1)}
    onChanged={async () => { invalidateInventory(); await refreshSession(); }}
  />;
}

export function AssetModalRoute() {
  return <WorkspaceRoute/>;
}

export function AssetRoutePage() {
  return <><SearchPage/><WorkspaceRoute direct/></>;
}
