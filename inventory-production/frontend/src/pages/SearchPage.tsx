import { Filter, Plus, Search, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { AddAsset } from '../components/AddAsset';
import { AssetCard } from '../components/AssetCard';
import { AssetSelectionActions, AssetSelectionToggle } from '../components/AssetSelectionActions';
import { FilterDrawer, filterCount, type AssetFilters } from '../components/FilterDrawer';
import { KpiStrip } from '../components/KpiStrip';
import { LabelPrint } from '../components/LabelPrint';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { useAppState } from '../state/AppState';
import type { AssetSummary, AssetSummaryCounts } from '../types';

const emptyFilters: AssetFilters = { fieldValues: {} };

export function SearchPage() {
  const { session, notify, refreshSession, invalidateInventory, inventoryRevision } = useAppState();
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [quickCategory, setQuickCategory] = useState<string>();
  const [quickAvailability, setQuickAvailability] = useState<string>();
  const [filters, setFilters] = useState<AssetFilters>(emptyFilters);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<AssetSummaryCounts>({ total: 0, available: 0, unavailable: 0, exceptions: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);

  const load = useCallback(async (nextQuery = query, nextFilters = filters, categoryOnly = quickCategory, availability = quickAvailability) => {
    setLoading(true); setError(''); setSelected([]);
    try {
      const result = await api.assets({ q: nextQuery, category: nextFilters.category || categoryOnly, availability, fieldValues: nextFilters.fieldValues, limit: 100 });
      setAssets(result.assets); setTotal(result.total); setSummary(result.summary);
    } catch (failure) { setError((failure as Error).message); }
    finally { setLoading(false); }
  }, [filters, query, quickAvailability, quickCategory]);

  useEffect(() => { void load(); }, [inventoryRevision]);

  const selectedAssets = useMemo(() => assets.filter((asset) => selected.includes(asset.id)), [assets, selected]);
  function textSearch() { setQuickCategory(undefined); setQuickAvailability(undefined); void load(query, filters, undefined, undefined); }
  function categorySearch(category: string) { setQuery(''); setQuickCategory(category); setQuickAvailability(undefined); void load('', filters, category, undefined); }
  function clearSearch() { setQuery(''); setQuickCategory(undefined); setQuickAvailability(undefined); void load('', filters, undefined, undefined); }
  function applyFilters(next: AssetFilters) { setFilters(next); setQuickCategory(undefined); setQuickAvailability(undefined); setFiltersOpen(false); void load(query, next, undefined, undefined); }
  function clearFilters() { setFilters(emptyFilters); setFiltersOpen(false); void load(query, emptyFilters, quickCategory, quickAvailability); }
  async function exportSelected() { try { await api.exportAssets(selected); notify('Selected assets exported.'); } catch (failure) { notify((failure as Error).message, 'error'); } }
  async function changed() { invalidateInventory(); await Promise.all([load(), refreshSession()]); }
  function openAsset(id: number) { navigate(`/assets/${id}`, { state: { backgroundLocation: location } }); }

  return <>
    <PageHeader eyebrow="Search" title="Find the exact inventory item." description="Search by identifier, use a category shortcut, or apply explicit profile filters. Each method stays independent." />
    <section className="search-command surface">
      <label className="search-box"><span>Search inventory</span><div><Search size={20}/><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && textSearch()} placeholder="Serial, asset tag, product, model, owner, NVBug, or location"/><button className="button button--primary" onClick={textSearch}>Search</button><button className="button" onClick={clearSearch}>Clear</button></div></label>
      <div className="command-actions">{session?.permissions['asset.create'] && <button className="button" onClick={() => setAddOpen(true)}><Plus size={17}/>Add Asset</button>}<button className="button" onClick={() => setFiltersOpen(true)}><Filter size={17}/>Filters{filterCount(filters) > 0 && <span className="button__count">{filterCount(filters)}</span>}</button></div>
      <div className="category-grid" aria-label="Category quick searches">{session?.categories.map((category) => <button key={category.id} onClick={() => categorySearch(category.key)}><span>{category.name}</span><strong>{category.assetCount}</strong></button>)}</div>
    </section>
    <KpiStrip items={[
      { key:'total',label:'Total',value:summary.total,detail:'Matching tracked assets' },
      { key:'available',label:'Available',value:summary.available,detail:'Ready for assignment' },
      { key:'unavailable',label:'Unavailable',value:summary.unavailable,detail:'Assigned or blocked' },
      { key:'exceptions',label:'Needs attention',value:summary.exceptions,detail:'Rework or e-waste' },
    ]} onSelect={(key) => {
      const availability = key === 'total' ? undefined : key;
      setQuickAvailability(availability);
      void load(query, filters, quickCategory, availability);
    }}/>
    <section className="results-section">
      <div className="results-heading"><div><span className="eyebrow">Results</span><h2>{total} {quickCategory ? `${quickCategory} ` : ''}{total === 1 ? 'asset' : 'assets'} found</h2></div><div className="results-actions"><AssetSelectionToggle selectedCount={selected.length} visibleCount={assets.length} disabled={loading} onToggle={() => setSelected(selected.length === assets.length && assets.length ? [] : assets.map((asset) => asset.id))}/><button className="button" onClick={() => setFiltersOpen(true)}><Filter size={17}/>Filters</button></div></div>
      <AssetSelectionActions selectedCount={selected.length} canExport={Boolean(session?.permissions['report.export'])} canPrint={Boolean(session?.permissions['label.print'])} onExport={() => void exportSelected()} onPrint={() => setLabelsOpen(true)} onClear={() => setSelected([])}/>
      {error ? <div className="empty-state"><XCircle/><h3>Search could not be completed</h3><p>{error}</p><button className="button" onClick={() => load()}>Try Again</button></div> : loading ? <LoadingState rows={5}/> : assets.length ? <div className="asset-list">{assets.map((asset) => <AssetCard key={asset.id} asset={asset} selected={selected.includes(asset.id)} onSelect={(checked) => setSelected((current) => checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))} onOpen={() => openAsset(asset.id)}/>)}</div> : <div className="empty-state"><Search/><h3>No matching assets</h3><p>The search completed successfully. Adjust the text or remove an applied filter.</p><div><button className="button" onClick={clearSearch}>Clear Search</button><button className="button" onClick={clearFilters}>Clear Filters</button></div></div>}
    </section>
    {filtersOpen && <FilterDrawer value={filters} onApply={applyFilters} onClear={clearFilters} onClose={() => setFiltersOpen(false)}/>} 
    {addOpen && <AddAsset onClose={() => setAddOpen(false)} onCreated={(id) => { setAddOpen(false); void changed(); openAsset(id); }}/>} 
    {labelsOpen && <LabelPrint assetIds={selectedAssets.map((asset) => asset.id)} onClose={() => setLabelsOpen(false)}/>} 
  </>;
}
