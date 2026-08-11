import { BarChart3, Download, Filter, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, download } from '../api';
import { FilterDrawer, filterCount, type AssetFilters } from '../components/FilterDrawer';
import { KpiStrip } from '../components/KpiStrip';
import { LoadingState } from '../components/LoadingState';
import { PageFailure } from '../components/PageFailure';
import { PageHeader } from '../components/PageHeader';
import { useAppState } from '../state/AppState';
import type { ReportResult } from '../types';

const emptyFilters: AssetFilters = { fieldValues: {} };

function trendLevel(value: number, maximum: number) {
  return Math.max(1, Math.min(10, Math.ceil(value / maximum * 10)));
}

export function ReportsPage() {
  const { notify, inventoryRevision } = useAppState();
  const location = useLocation();
  const navigate = useNavigate();
  const [reports, setReports] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [reportId, setReportId] = useState('inventory');
  const [filters, setFilters] = useState<AssetFilters>(emptyFilters);
  const [drillQuery, setDrillQuery] = useState<Record<string, unknown>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);

  const query = useMemo(() => ({ category: filters.category, fieldValues: filters.fieldValues, ...drillQuery, page, limit: 50 }), [drillQuery, filters, page]);

  useEffect(() => { api.reports().then(setReports).catch((error: Error) => notify(error.message, 'error')); }, [notify]);
  useEffect(() => {
    setLoading(true); setError('');
    api.report(reportId, query).then(setResult).catch((nextError: Error) => setError(nextError.message)).finally(() => setLoading(false));
  }, [inventoryRevision, query, reload, reportId]);

  const selectKpi = (key: string) => {
    setPage(1);
    if (key === 'missing_metadata') { setReportId('missing-metadata'); setDrillQuery({}); return; }
    if (key === 'total') { setReportId('inventory'); setDrillQuery({}); return; }
    setReportId('inventory');
    setDrillQuery({ availability: key });
  };

  const drill = (dimension: string, key: string) => {
    const parameter = ({ category: 'category', status: 'status', location: 'locationId', owner: 'ownerId', vendor: 'vendorId', model: 'model', project: 'project' } as Record<string, string>)[dimension];
    if (parameter) { setPage(1); setDrillQuery((current) => ({ ...current, [parameter]: key })); }
  };

  if (loading && !result) return <LoadingState label="Building report"/>;
  const current = reports.find((report) => report.id === reportId);
  const maxTrend = Math.max(1, ...(result?.trends ?? []).map((item) => item.value));

  return <>
    <PageHeader eyebrow="Reports" title="Inventory intelligence" description="Start broad, narrow through trusted dimensions, and open the exact assets behind every number."
      actions={<><button className="button button--secondary" onClick={() => setDrawerOpen(true)}><Filter size={17}/>Filters{filterCount(filters) ? ` (${filterCount(filters)})` : ''}</button><button className="button button--primary" onClick={() => download(api.reportExportUrl(reportId, query))}><Download size={17}/>Export CSV</button></>}/>

    <section className="report-toolbar surface">
      <label><span>Report</span><select value={reportId} onChange={(event) => { setReportId(event.target.value); setDrillQuery({}); setPage(1); }}>{reports.map((report) => <option value={report.id} key={report.id}>{report.name}</option>)}</select></label>
      <div><strong>{current?.name ?? 'Inventory'}</strong><p>{current?.description}</p></div>
      {Object.keys(drillQuery).length > 0 && <button className="button" onClick={() => { setDrillQuery({}); setPage(1); }}>Clear drilldown</button>}
    </section>

    {error ? <PageFailure title="Reports are temporarily unavailable" message={error} onRetry={() => setReload((value) => value + 1)}/> : result && <>
      <KpiStrip onSelect={selectKpi} items={[
        { key: 'total', label: 'Total', value: result.kpis.total ?? 0, detail: 'All matching assets' },
        { key: 'available', label: 'Available', value: result.kpis.available ?? 0, detail: 'Ready for use' },
        { key: 'unavailable', label: 'Unavailable', value: result.kpis.unavailable ?? 0, detail: 'Assigned or blocked' },
        { key: 'exceptions', label: 'Exceptions', value: result.kpis.exceptions ?? 0, detail: 'Needs attention' },
        { key: 'missing_metadata', label: 'Data quality', value: result.kpis.missing_metadata ?? 0, detail: 'Missing metadata' },
      ]}/>

      <div className="report-grid">
        {Object.entries(result.dimensions).map(([dimension, values]) => <section className="breakdown surface" key={dimension}><h2>{dimension.replaceAll('_', ' ')}</h2><div className="breakdown__list">{values.slice(0, 10).map((item) => <button key={`${dimension}-${item.key}`} onClick={() => drill(dimension, item.key)}><span>{item.label || 'Unassigned'}</span><strong>{item.value}</strong></button>)}</div></section>)}
      </div>

      {!!result.trends.length && <section className="trend surface"><div className="section-heading"><div><span className="eyebrow">Date received</span><h2>Inventory trend</h2></div></div><div className="trend__chart">{result.trends.map((item) => <div className="trend__bar" key={item.month}><span className={`trend__fill trend__fill--${trendLevel(item.value, maxTrend)}`}/><strong>{item.value}</strong><small>{item.month}</small></div>)}</div></section>}

      <section className="report-results surface"><div className="section-heading"><div><span className="eyebrow">Drilldown</span><h2>{result.total} matching assets</h2></div></div>{!result.rows.length ? <div className="empty-state"><Search/><h3>No matching assets</h3><p>Adjust or clear the report filters.</p></div> : <div className="compact-list">{result.rows.map((row) => <button key={String(row.id)} onClick={() => navigate(`/assets/${Number(row.id)}`, { state: { backgroundLocation: location } })}><span><strong>{String(row.product_name ?? '')}</strong><small>{String(row.category_name ?? '')}</small></span><span><strong>{String(row.asset_tag ?? 'No asset tag')}</strong><small>{String(row.serial_number ?? '')}</small></span><span><strong>{String(row.status_label ?? row.status ?? '')}</strong><small>{String(row.location ?? 'No location')}</small></span></button>)}</div>}{result.total > result.limit && <nav className="pagination" aria-label="Report pages"><button className="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {Math.ceil(result.total / result.limit)}</span><button className="button" disabled={page >= Math.ceil(result.total / result.limit)} onClick={() => setPage((value) => value + 1)}>Next</button></nav>}</section>
    </>}

    {drawerOpen && <FilterDrawer title="Report filters" value={filters} onApply={(value) => { setFilters(value); setDrillQuery({}); setPage(1); setDrawerOpen(false); }} onClear={() => { setFilters(emptyFilters); setDrillQuery({}); setPage(1); setDrawerOpen(false); }} onClose={() => setDrawerOpen(false)}/>} 
  </>;
}
