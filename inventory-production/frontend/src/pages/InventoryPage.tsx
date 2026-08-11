import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { AddAsset } from '../components/AddAsset';
import { AssetCard } from '../components/AssetCard';
import { LoadingState } from '../components/LoadingState';
import { PageFailure } from '../components/PageFailure';
import { PageHeader } from '../components/PageHeader';
import { useAppState } from '../state/AppState';
import type { AssetSummary } from '../types';

export function InventoryPage() {
  const { session, refreshSession, inventoryRevision, invalidateInventory } = useAppState();
  const location = useLocation();
  const navigate = useNavigate();
  const [category, setCategory] = useState('');
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const load = useCallback(async () => { setLoading(true); setError(''); try { const result = await api.assets({ category, page, limit: 50 }); setAssets(result.assets); setTotal(result.total); } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Inventory could not be loaded.'); } finally { setLoading(false); } }, [category, page]);
  useEffect(() => { void load(); }, [inventoryRevision, load]);
  function openAsset(id: number) { navigate(`/assets/${id}`, { state: { backgroundLocation: location } }); }
  return <>
    <PageHeader eyebrow="Inventory" title="Browse and manage assets." description="Choose a category, review tracked items, and open the complete asset workspace." actions={session?.permissions['asset.create'] && <button className="button button--primary" onClick={() => setAddOpen(true)}><Plus size={17}/>Add Asset</button>}/>
    <section className="inventory-toolbar surface"><label className="field"><span className="field__label">Category</span><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="">All categories</option>{session?.categories.map((item) => <option key={item.id} value={item.key}>{item.name} ({item.assetCount})</option>)}</select></label><strong>{total} assets</strong></section>
    {loading ? <LoadingState rows={6}/> : error ? <PageFailure message={error} onRetry={() => void load()}/> : assets.length === 0 ? <div className="empty-state surface"><h2>No assets found</h2><p>Choose another category or add the first asset for this category.</p></div> : <div className="asset-list">{assets.map((asset) => <AssetCard key={asset.id} asset={asset} selected={false} onSelect={() => undefined} onOpen={() => openAsset(asset.id)}/>)}</div>}
    {!error && total > 0 && <nav className="pagination" aria-label="Inventory pages"><button className="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {Math.max(1, Math.ceil(total / 50))}</span><button className="button" disabled={page * 50 >= total} onClick={() => setPage((value) => value + 1)}>Next</button></nav>}
    {addOpen && <AddAsset onClose={() => setAddOpen(false)} onCreated={(id) => { setAddOpen(false); invalidateInventory(); void refreshSession(); openAsset(id); }}/>} 
  </>;
}
