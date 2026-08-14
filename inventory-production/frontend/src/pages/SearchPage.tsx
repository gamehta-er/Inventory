import { CircleAlert, CircleCheck, Filter, PackageSearch, Plus, Search, X, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { AddAsset } from '../components/AddAsset';
import { AssetCard } from '../components/AssetCard';
import { AssetSelectionActions, AssetSelectionToggle } from '../components/AssetSelectionActions';
import { FilterDrawer, filterCount, type AssetFilters } from '../components/FilterDrawer';
import { LabelPrint } from '../components/LabelPrint';
import { LoadingState } from '../components/LoadingState';
import { useAppState } from '../state/AppState';
import type { AssetSummary, AssetSummaryCounts, FieldDefinition, Lookups, Profile } from '../types';

const fieldParameterPrefix = 'field_';

function hasValue(value: unknown): boolean {
  return value !== '' && value !== null && value !== undefined;
}

function readFilters(parameters: URLSearchParams): AssetFilters {
  const fieldValues: Record<string, unknown> = {};
  parameters.forEach((value, key) => {
    if (key.startsWith(fieldParameterPrefix) && value !== '') fieldValues[key.slice(fieldParameterPrefix.length)] = value;
  });
  return { category: parameters.get('filterCategory') || undefined, fieldValues };
}

function clearAdvancedFilterParameters(parameters: URLSearchParams): void {
  parameters.delete('filterCategory');
  Array.from(parameters.keys()).filter((key) => key.startsWith(fieldParameterPrefix)).forEach((key) => parameters.delete(key));
}

function humanizeFieldKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fieldValueLabel(field: FieldDefinition | undefined, value: unknown, lookups: Lookups | null): string {
  const source = String(value);
  if (!field) return source;
  if (field.fieldKey === 'location') return lookups?.locations.find((item) => String(item.id) === source)?.full_path ?? source;
  if (field.fieldKey === 'owner') return lookups?.users.find((item) => String(item.id) === source)?.display_name ?? source;
  if (field.fieldKey === 'vendor') return lookups?.vendors.find((item) => String(item.id) === source)?.vendor_name ?? source;
  return field.options.find((item) => String(item.id) === source || item.value.toLowerCase() === source.toLowerCase())?.label ?? source;
}

export function SearchPage() {
  const { session, lookups, getProfile, notify, refreshSession, invalidateInventory, inventoryRevision } = useAppState();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParameters, setSearchParameters] = useSearchParams();
  const parameterKey = searchParameters.toString();
  const appliedCriteria = useMemo(() => ({
    query: searchParameters.get('q') ?? '',
    quickCategory: searchParameters.get('family') || undefined,
    quickAvailability: searchParameters.get('availability') || undefined,
    filters: readFilters(searchParameters),
  }), [parameterKey]);
  const { query: appliedQuery, quickCategory, quickAvailability, filters } = appliedCriteria;
  const [query, setQuery] = useState(appliedQuery);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<AssetSummaryCounts>({ total: 0, available: 0, unavailable: 0, exceptions: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [filterProfile, setFilterProfile] = useState<Profile | null>(null);

  const filterCategory = useMemo(() => session?.categories.find((category) => category.key === filters.category), [filters.category, session]);

  useEffect(() => { setQuery(appliedQuery); }, [appliedQuery]);

  useEffect(() => {
    let active = true;
    if (!filterCategory) { setFilterProfile(null); return () => { active = false; }; }
    setFilterProfile(null);
    getProfile(filterCategory.profileId).then((profile) => { if (active) setFilterProfile(profile); }).catch(() => { if (active) setFilterProfile(null); });
    return () => { active = false; };
  }, [filterCategory, getProfile]);

  const load = useCallback(async () => {
    setLoading(true); setError(''); setSelected([]);
    try {
      const result = await api.assets({ q: appliedQuery, category: quickCategory ?? filters.category, availability: quickAvailability, fieldValues: filters.fieldValues, limit: 100 });
      setAssets(result.assets); setTotal(result.total); setSummary(result.summary);
    } catch (failure) { setError((failure as Error).message); }
    finally { setLoading(false); }
  }, [appliedQuery, filters.category, filters.fieldValues, quickAvailability, quickCategory]);

  useEffect(() => { void load(); }, [inventoryRevision, load]);

  const selectedAssets = useMemo(() => assets.filter((asset) => selected.includes(asset.id)), [assets, selected]);
  const categoryName = useCallback((key: string | undefined) => session?.categories.find((category) => category.key === key)?.name ?? key ?? '', [session]);
  const activeFilterCount = filterCount(filters) + (quickCategory ? 1 : 0) + (quickAvailability ? 1 : 0);

  function updateCriteria(change: (next: URLSearchParams) => void): void {
    const next = new URLSearchParams(searchParameters);
    change(next);
    setSearchParameters(next);
  }

  function textSearch(): void {
    updateCriteria((next) => {
      const normalized = query.trim();
      if (normalized) next.set('q', normalized); else next.delete('q');
    });
  }

  function categorySearch(category?: string): void {
    updateCriteria((next) => {
      if (!category || category === quickCategory) next.delete('family'); else next.set('family', category);
    });
  }

  function availabilitySearch(availability?: string): void {
    updateCriteria((next) => {
      if (!availability || availability === quickAvailability) next.delete('availability'); else next.set('availability', availability);
    });
  }

  function clearSearch(): void {
    setQuery('');
    updateCriteria((next) => next.delete('q'));
  }

  function applyFilters(nextFilters: AssetFilters): void {
    setFiltersOpen(false);
    updateCriteria((next) => {
      clearAdvancedFilterParameters(next);
      if (nextFilters.category) next.set('filterCategory', nextFilters.category);
      Object.entries(nextFilters.fieldValues).filter(([, value]) => hasValue(value)).forEach(([key, value]) => next.set(`${fieldParameterPrefix}${key}`, String(value)));
    });
  }

  function clearFilters(): void {
    setFiltersOpen(false);
    updateCriteria((next) => {
      clearAdvancedFilterParameters(next);
      next.delete('family');
      next.delete('availability');
    });
  }

  function clearAllCriteria(): void {
    setQuery('');
    setFiltersOpen(false);
    setSearchParameters(new URLSearchParams());
  }

  function removeFieldFilter(fieldKey: string): void {
    updateCriteria((next) => next.delete(`${fieldParameterPrefix}${fieldKey}`));
  }

  async function exportSelected() { try { await api.exportAssets(selected); notify('Selected assets exported.'); } catch (failure) { notify((failure as Error).message, 'error'); } }
  async function changed() { await refreshSession(); invalidateInventory(); }
  function openAsset(id: number) { navigate(`/assets/${id}`, { state: { backgroundLocation: location } }); }

  const fleet = [
    { key: undefined, label: 'Tracked', value: summary.total, detail: 'Matching hardware', icon: PackageSearch },
    { key: 'available', label: 'Available', value: summary.available, detail: 'Ready for assignment', icon: CircleCheck },
    { key: 'unavailable', label: 'Unavailable', value: summary.unavailable, detail: 'Assigned or blocked', icon: PackageSearch },
    { key: 'exceptions', label: 'Attention', value: summary.exceptions, detail: 'Rework or e-waste', icon: CircleAlert },
  ];

  const criteria = [
    ...(appliedQuery ? [{ key: 'query', label: `Search: ${appliedQuery}`, remove: clearSearch }] : []),
    ...(quickCategory ? [{ key: 'family', label: `Family: ${categoryName(quickCategory)}`, remove: () => categorySearch(quickCategory) }] : []),
    ...(quickAvailability ? [{ key: 'availability', label: `Availability: ${fleet.find((item) => item.key === quickAvailability)?.label ?? quickAvailability}`, remove: () => availabilitySearch(quickAvailability) }] : []),
    ...(filters.category ? [{ key: 'filter-category', label: `Profile filters: ${categoryName(filters.category)}`, remove: () => updateCriteria((next) => clearAdvancedFilterParameters(next)) }] : []),
    ...Object.entries(filters.fieldValues).filter(([, value]) => hasValue(value)).map(([key, value]) => {
      const field = filterProfile?.fields.find((item) => item.fieldKey === key);
      return { key: `field-${key}`, label: `${field?.label ?? humanizeFieldKey(key)}: ${fieldValueLabel(field, value, lookups)}`, remove: () => removeFieldFilter(key) };
    }),
  ];

  return <div className="hardware-search">
    <section className="hardware-search__hero" aria-labelledby="hardware-search-title">
      <img className="hardware-search__hero-image" src="/hardware/nvidia-rtx6000-ada.jpg" alt="NVIDIA RTX 6000 Ada Generation graphics card"/>
      <div className="hardware-search__hero-copy">
        <span className="eyebrow">NVIDIA hardware inventory</span>
        <h1 id="hardware-search-title">Find the exact hardware. Know its operational state.</h1>
        <p>Locate a GPU, system, board, or accessory by identity, assignment, reference, or physical location.</p>
        <form className="hardware-search__form" onSubmit={(event) => { event.preventDefault(); textSearch(); }}>
          <div className="hardware-search__field">
            <Search size={21}/>
            <label className="sr-only" htmlFor="hardware-search-input">Search inventory</label>
            <input id="hardware-search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Serial, asset tag, product, model, NVBug, owner, or location"/>
            {query && <button type="button" onClick={clearSearch} aria-label="Clear search text"><X size={18}/></button>}
          </div>
          <button className="button hardware-search__submit" type="submit">Search inventory</button>
        </form>
        <div className="hardware-search__hints" aria-label="Searchable inventory data"><span>Exact identifiers</span><span>Hardware models</span><span>Owners and teams</span><span>Lab locations</span></div>
      </div>
    </section>

    <section className="hardware-fleet" aria-label="Fleet summary">
      {fleet.map(({ key, label, value, detail, icon: Icon }) => <button type="button" key={label} className={`hardware-fleet__stat ${quickAvailability === key ? 'hardware-fleet__stat--active' : ''}`} aria-pressed={quickAvailability === key} onClick={() => availabilitySearch(key)}><Icon size={19}/><strong>{value}</strong><span><b>{label}</b><small>{detail}</small></span></button>)}
      <div className="hardware-fleet__actions">{session?.permissions['asset.create'] && <button className="button" onClick={() => setAddOpen(true)}><Plus size={17}/>Add Asset</button>}<button className="button" onClick={() => setFiltersOpen(true)}><Filter size={17}/>Filters{activeFilterCount > 0 && <span className="button__count">{activeFilterCount}</span>}</button></div>
    </section>

    <section className="hardware-families" aria-labelledby="hardware-family-title">
      <div className="section-heading"><div><h2 id="hardware-family-title">Hardware families</h2><p>Choose a family without changing your search text or applied filters.</p></div></div>
      <div className="hardware-families__grid" aria-label="Hardware family filters">
        <button type="button" className={!quickCategory ? 'hardware-family hardware-family--active' : 'hardware-family'} aria-pressed={!quickCategory} onClick={() => categorySearch()}><span>All hardware</span><strong>{session?.categories.reduce((count, category) => count + category.assetCount, 0) ?? 0}</strong></button>
        {session?.categories.map((category) => <button type="button" className={quickCategory === category.key ? 'hardware-family hardware-family--active' : 'hardware-family'} aria-pressed={quickCategory === category.key} key={category.id} onClick={() => categorySearch(category.key)}><span>{category.name}</span><strong>{category.assetCount}</strong></button>)}
      </div>
    </section>

    {criteria.length > 0 && <section className="hardware-criteria" aria-label="Applied search criteria">
      <div className="hardware-criteria__heading"><span className="eyebrow">Applied criteria</span><strong>{criteria.length} active</strong></div>
      <div className="hardware-criteria__chips">{criteria.map((criterion) => <button type="button" key={criterion.key} onClick={criterion.remove} aria-label={`Remove ${criterion.label}`}><span>{criterion.label}</span><X size={15}/></button>)}</div>
      <button className="button hardware-criteria__clear" type="button" onClick={clearAllCriteria}><XCircle size={17}/>Clear all</button>
    </section>}

    <section className="results-section hardware-results">
      <div className="results-heading"><div><span className="eyebrow">Results</span><h2>{total} {quickCategory ? `${categoryName(quickCategory)} ` : ''}{total === 1 ? 'asset' : 'assets'} found</h2></div><div className="results-actions"><AssetSelectionToggle selectedCount={selected.length} visibleCount={assets.length} disabled={loading} onToggle={() => setSelected(selected.length === assets.length && assets.length ? [] : assets.map((asset) => asset.id))}/><button className="button" onClick={() => setFiltersOpen(true)}><Filter size={17}/>Filters{activeFilterCount > 0 && <span className="button__count">{activeFilterCount}</span>}</button></div></div>
      <AssetSelectionActions selectedCount={selected.length} canExport={Boolean(session?.permissions['report.export'])} canPrint={Boolean(session?.permissions['label.print'])} onExport={() => void exportSelected()} onPrint={() => setLabelsOpen(true)} onClear={() => setSelected([])}/>
      {error ? <div className="empty-state"><XCircle/><h3>Search could not be completed</h3><p>{error}</p><button className="button" onClick={() => void load()}>Try Again</button></div> : loading ? <LoadingState rows={5}/> : assets.length ? <div className="asset-list">{assets.map((asset) => <AssetCard key={asset.id} asset={asset} selected={selected.includes(asset.id)} onSelect={(checked) => setSelected((current) => checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))} onOpen={() => openAsset(asset.id)}/>)}</div> : <div className="empty-state"><Search/><h3>No matching assets</h3><p>The search completed successfully. Clear all criteria to return to the complete inventory.</p><button className="button button--primary" onClick={clearAllCriteria}>Clear all criteria</button></div>}
    </section>
    {filtersOpen && <FilterDrawer value={filters} onApply={applyFilters} onClear={clearFilters} onClose={() => setFiltersOpen(false)}/>} 
    {addOpen && <AddAsset onClose={() => setAddOpen(false)} onCreated={(id) => { setAddOpen(false); void changed(); openAsset(id); }}/>} 
    {labelsOpen && <LabelPrint assetIds={selectedAssets.map((asset) => asset.id)} onClose={() => setLabelsOpen(false)}/>} 
  </div>;
}
