import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { AddAsset } from '../components/AddAsset';
import { AssetCard } from '../components/AssetCard';
import { AssetSelectionActions, AssetSelectionToggle } from '../components/AssetSelectionActions';
import { LabelPrint } from '../components/LabelPrint';
import { LoadingState } from '../components/LoadingState';
import { PageFailure } from '../components/PageFailure';
import { PageHeader } from '../components/PageHeader';
import { useAppState } from '../state/AppState';
import type { AssetSummary } from '../types';

export function InventoryPage() {
  const { session, notify, refreshSession, inventoryRevision, invalidateInventory } = useAppState();
  const location = useLocation();
  const navigate = useNavigate();
  const [category, setCategory] = useState('');
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [exporting, setExporting] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const load = useCallback(async () => { setLoading(true); setError(''); setSelected([]); setLabelsOpen(false); try { const result = await api.assets({ category, page, limit: 50 }); setAssets(result.assets); setTotal(result.total); } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Inventory could not be loaded.'); } finally { setLoading(false); } }, [category, page]);
  useEffect(() => { void load(); }, [inventoryRevision, load]);
  const selectedAssets = useMemo(() => assets.filter((asset) => selected.includes(asset.id)), [assets, selected]);
  const canExport = Boolean(session?.permissions['report.export']);
  const canPrint = Boolean(session?.permissions['label.print']);

  function toggleAsset(id: number, checked: boolean) {
    setSelected((current) => checked
      ? current.includes(id) ? current : [...current, id]
      : current.filter((selectedId) => selectedId !== id));
  }

  function togglePageSelection() {
    setSelected(selected.length === assets.length && assets.length > 0 ? [] : assets.map((asset) => asset.id));
  }

  async function exportSelected() {
    if (!canExport || selected.length === 0) return;
    setExporting(true);
    try {
      await api.exportAssets(selected);
      notify(`${selected.length} selected ${selected.length === 1 ? 'asset' : 'assets'} exported.`);
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : 'Selected assets could not be exported.', 'error');
    } finally {
      setExporting(false);
    }
  }

  function openAsset(id: number) { navigate(`/assets/${id}`, { state: { backgroundLocation: location } }); }
  return <>
    <PageHeader eyebrow="Inventory" title="Browse and manage assets." description="Choose a category, review tracked items, and open the complete asset workspace." actions={session?.permissions['asset.create'] && <button className="button button--primary" onClick={() => setAddOpen(true)}><Plus size={17}/>Add Asset</button>}/>
    <section className="inventory-toolbar surface"><label className="field"><span className="field__label">Category</span><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); setSelected([]); }}><option value="">All categories</option>{session?.categories.map((item) => <option key={item.id} value={item.key}>{item.name} ({item.assetCount})</option>)}</select></label><div className="inventory-toolbar__summary"><strong>{total} assets</strong><AssetSelectionToggle selectedCount={selected.length} visibleCount={assets.length} disabled={loading} onToggle={togglePageSelection}/></div></section>
    <AssetSelectionActions selectedCount={selected.length} canExport={canExport} canPrint={canPrint} exporting={exporting} onExport={() => void exportSelected()} onPrint={() => setLabelsOpen(true)} onClear={() => setSelected([])}/>
    {loading ? <LoadingState rows={6}/> : error ? <PageFailure message={error} onRetry={() => void load()}/> : assets.length === 0 ? <div className="empty-state surface"><h2>No assets found</h2><p>Choose another category or add the first asset for this category.</p></div> : <div className="asset-list">{assets.map((asset) => <AssetCard key={asset.id} asset={asset} selected={selected.includes(asset.id)} onSelect={(checked) => toggleAsset(asset.id, checked)} onOpen={() => openAsset(asset.id)}/>)}</div>}
    {!error && total > 0 && <nav className="pagination" aria-label="Inventory pages"><button className="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {Math.max(1, Math.ceil(total / 50))}</span><button className="button" disabled={page * 50 >= total} onClick={() => setPage((value) => value + 1)}>Next</button></nav>}
    {addOpen && <AddAsset onClose={() => setAddOpen(false)} onCreated={(id) => { setAddOpen(false); invalidateInventory(); void refreshSession(); openAsset(id); }}/>} 
    {labelsOpen && <LabelPrint assetIds={selectedAssets.map((asset) => asset.id)} onClose={() => setLabelsOpen(false)}/>}
  </>;
}
