import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CircleCheck,
  Clock3,
  Database,
  Download,
  Filter,
  MapPin,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Upload,
  UserRound,
  Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, download } from '../api';
import { FilterDrawer, filterCount, type AssetFilters } from '../components/FilterDrawer';
import { LoadingState } from '../components/LoadingState';
import { PageFailure } from '../components/PageFailure';
import { PageHeader } from '../components/PageHeader';
import { useAppState } from '../state/AppState';
import type { CommandCenterResult, ReportResult } from '../types';

const emptyFilters: AssetFilters = { fieldValues: {} };
type ReportView = 'command' | 'leadership' | 'operations' | 'quality';

const views: Array<{ id: ReportView; label: string; description: string }> = [
  { id: 'command', label: 'Command center', description: 'Current health, risk, queues, and recent work.' },
  { id: 'leadership', label: 'Leadership', description: 'Inventory health and management attention.' },
  { id: 'operations', label: 'Operations', description: 'Lifecycle, ownership, and asset drilldown.' },
  { id: 'quality', label: 'Data quality', description: 'Profile-driven completeness and risk.' },
];

const dimensionLabels: Record<string, string> = {
  category: 'Category', status: 'Lifecycle status', location: 'Location', owner: 'Owner',
  vendor: 'Vendor', model: 'Model', project: 'Project',
};

function percent(value: number, total: number) {
  return total > 0 ? Math.round(value / total * 100) : 0;
}

function visualLevel(value: number, maximum: number) {
  return Math.max(1, Math.min(10, Math.ceil(value / maximum * 10)));
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Just refreshed' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function KpiButton({ label, value, detail, active, onClick }: {
  label: string; value: number; detail: string; active?: boolean; onClick(): void;
}) {
  return <button className={`report-kpi${active ? ' report-kpi--active' : ''}`} onClick={onClick}>
    <span>{label}</span><strong>{value.toLocaleString()}</strong><small>{detail}</small>
  </button>;
}

function TrendChart({ values, onSelect }: { values: ReportResult['trends']; onSelect(month: string): void }) {
  const visible = values.slice(-12);
  const maximum = Math.max(1, ...visible.map((item) => item.value));
  if (!visible.length) return <div className="report-empty-inline"><BarChart3/><span>No received-date history matches this view.</span></div>;
  return <div className="report-trend" aria-label="Assets received by month">
    {visible.map((item) => <button type="button" className="report-trend__month" key={item.month} aria-label={`${item.month}: ${item.value} assets`} title={`${item.month}: ${item.value} assets`} onClick={() => onSelect(item.month)}>
      <strong>{item.value}</strong><span><i className={`report-bar-level--${visualLevel(item.value, maximum)}`}/></span><small>{item.month}</small>
    </button>)}
  </div>;
}

function Breakdown({ title, values, onSelect }: {
  title: string; values: Array<{ key: string; label: string; value: number }>; onSelect(key: string): void;
}) {
  const maximum = Math.max(1, ...values.map((item) => item.value));
  return <section className="report-breakdown surface">
    <header><h2>{title}</h2><span>{values.length} groups</span></header>
    {!values.length ? <div className="report-empty-inline"><Database/><span>No grouped data matches this view.</span></div> :
      <div className="report-breakdown__list">{values.slice(0, 8).map((item) => <button key={item.key} onClick={() => onSelect(item.key)}>
        <span><strong>{item.label || 'Unassigned'}</strong><i><b className={`report-width-level--${visualLevel(item.value, maximum)}`}/></i></span><em>{item.value}</em>
      </button>)}</div>}
  </section>;
}

function AttentionItem({ icon, title, detail, count, tone, onClick }: {
  icon: ReactNode; title: string; detail: string; count: number; tone: 'danger' | 'warning' | 'info'; onClick(): void;
}) {
  return <button className={`report-attention report-attention--${tone}`} onClick={onClick}>
    <span className="report-attention__icon">{icon}</span><span><strong>{title}</strong><small>{detail}</small></span><b>{count}</b><ArrowRight size={16}/>
  </button>;
}

export function ReportsPage() {
  const { notify, inventoryRevision, session } = useAppState();
  const location = useLocation();
  const navigate = useNavigate();
  const [reports, setReports] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [view, setView] = useState<ReportView>('command');
  const [reportId, setReportId] = useState('inventory');
  const [filters, setFilters] = useState<AssetFilters>(emptyFilters);
  const [drillQuery, setDrillQuery] = useState<Record<string, unknown>>({});
  const [receivedFrom, setReceivedFrom] = useState('');
  const [receivedTo, setReceivedTo] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [command, setCommand] = useState<CommandCenterResult | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);

  const baseFilters = useMemo(() => ({
    category: filters.category,
    fieldValues: filters.fieldValues,
    receivedFrom: receivedFrom || undefined,
    receivedTo: receivedTo || undefined,
  }), [filters, receivedFrom, receivedTo]);
  const query = useMemo(() => ({ ...baseFilters, ...drillQuery, page, limit: 50 }), [baseFilters, drillQuery, page]);

  useEffect(() => { api.reports().then(setReports).catch((nextError: Error) => notify(nextError.message, 'error')); }, [notify]);
  useEffect(() => {
    setLoading(true);
    setError('');
    const work = view === 'command'
      ? api.commandCenter(baseFilters).then(setCommand)
      : api.report(reportId, query).then(setResult);
    work.catch((nextError: Error) => setError(nextError.message)).finally(() => setLoading(false));
  }, [baseFilters, inventoryRevision, query, reload, reportId, view]);

  const setScope = (nextReportId: string, nextDrill: Record<string, unknown> = {}) => {
    setReportId(nextReportId); setDrillQuery(nextDrill); setPage(1);
  };
  const openAnalysis = (nextView: Exclude<ReportView, 'command'>, nextReportId = 'inventory', nextDrill: Record<string, unknown> = {}) => {
    setView(nextView); setScope(nextReportId, nextDrill);
  };
  const setReportView = (nextView: ReportView) => {
    setView(nextView); setScope('inventory');
  };
  const selectKpi = (key: string) => {
    if (key === 'total') setScope('inventory');
    else if (key === 'available') setScope('inventory', { availability: 'available' });
    else if (key === 'in_use') setScope('inventory', { status: 'IN_USE' });
    else if (key === 'exceptions') setScope('inventory', { availability: 'exceptions' });
    else if (key === 'missing_metadata') setScope('missing-metadata');
  };
  const drill = (dimension: string, key: string) => {
    const parameter = ({ category: 'category', status: 'status', location: 'locationId', owner: 'ownerId', vendor: 'vendorId', model: 'model', project: 'project' } as Record<string, string>)[dimension];
    if (parameter) setScope(reportId, { ...drillQuery, [parameter]: key });
  };
  const openAsset = (id: number) => navigate(`/assets/${id}`, { state: { backgroundLocation: location } });
  const openActivityRecord = (path: string) => {
    if (path.startsWith('/assets/')) navigate(path, { state: { backgroundLocation: location } });
    else if (path.startsWith('/import')) navigate('/import');
    else if (path.startsWith('/reports')) navigate('/reports');
    else if (path.startsWith('/admin')) navigate('/admin');
    else navigate(path || '/activity');
  };

  if (loading && !command && !result) return <LoadingState label="Building command center"/>;
  const current = reports.find((report) => report.id === reportId);
  const kpis = result?.kpis ?? {};
  const total = kpis.total ?? result?.total ?? 0;
  const completion = result ? percent(result.quality.complete, total) : 0;
  const hasDrilldown = Object.keys(drillQuery).length > 0 || reportId !== 'inventory';

  return <>
    <PageHeader
      eyebrow="Reports"
      title={view === 'command' ? 'Inventory command center' : 'Inventory intelligence'}
      description={view === 'command' ? 'A live operating view of deployment readiness, risk, data quality, and work requiring action.' : 'Move from management health to the exact assets behind every number.'}
      actions={<>
        <button className="button button--secondary" onClick={() => setReload((value) => value + 1)}><RefreshCw size={17}/>Refresh</button>
        <button className="button button--secondary" onClick={() => setDrawerOpen(true)}><Filter size={17}/>Filters{filterCount(filters) ? ` (${filterCount(filters)})` : ''}</button>
        <button className="button button--primary" onClick={() => download(api.reportExportUrl(reportId, query))}><Download size={17}/>Export current view</button>
      </>}
    />

    <nav className="report-view-tabs" aria-label="Report views">
      {views.map((item) => <button className={view === item.id ? 'is-active' : ''} key={item.id} onClick={() => setReportView(item.id)}>
        <strong>{item.label}</strong><span>{item.description}</span>
      </button>)}
    </nav>

    <section className="command-controls surface">
      <div><span className="eyebrow">Snapshot scope</span><strong>{receivedFrom || receivedTo ? 'Assets received in the selected period' : 'All active inventory'}</strong></div>
      <label className="field"><span>Received from</span><input type="date" value={receivedFrom} onChange={(event) => setReceivedFrom(event.target.value)}/></label>
      <label className="field"><span>Received to</span><input type="date" value={receivedTo} onChange={(event) => setReceivedTo(event.target.value)}/></label>
      {(receivedFrom || receivedTo) && <button className="button" onClick={() => { setReceivedFrom(''); setReceivedTo(''); }}>Clear dates</button>}
    </section>

    {error ? <PageFailure title="Reports are temporarily unavailable" message={error} onRetry={() => setReload((value) => value + 1)}/> : view === 'command' && command ? <>
      <section className="command-freshness" aria-label="Snapshot status">
        <span><CircleCheck size={16}/>Database {command.database.status}</span>
        <span><Clock3 size={16}/>Refreshed {formatTimestamp(command.generatedAt)}</span>
        <span>Query completed in {command.queryTimeMs.toLocaleString()} ms</span>
      </section>

      <section className="report-kpis" aria-label="Management inventory health">
        <KpiButton label="Tracked assets" value={command.inventory.kpis.total ?? 0} detail="All matching active inventory" onClick={() => openAnalysis('leadership')}/>
        <KpiButton label="Ready to deploy" value={command.inventory.kpis.available ?? 0} detail={`${percent(command.inventory.kpis.available ?? 0, command.inventory.total)}% of this view`} onClick={() => openAnalysis('operations', 'inventory', { availability: 'available' })}/>
        <KpiButton label="In use" value={command.inventory.kpis.in_use ?? 0} detail="Currently assigned" onClick={() => openAnalysis('operations', 'inventory', { status: 'IN_USE' })}/>
        <KpiButton label="At risk" value={command.inventory.kpis.exceptions ?? 0} detail="Rework or e-waste" onClick={() => openAnalysis('leadership', 'inventory', { availability: 'exceptions' })}/>
        <KpiButton label="Data quality" value={percent(command.inventory.quality.complete, command.inventory.total)} detail={`${command.inventory.quality.missing} records need review`} onClick={() => openAnalysis('quality')}/>
      </section>

      <div className="report-intelligence-grid command-primary-grid">
        <section className="report-chart-panel surface">
          <header><div><span className="eyebrow">Assets received</span><h2>Inventory movement</h2></div><small>{command.inventory.kpis.received_30_days ?? 0} received in the last 30 days</small></header>
          <TrendChart values={command.inventory.trends} onSelect={(month) => openAnalysis('operations', 'inventory', { receivedMonth: month })}/>
        </section>
        <section className="report-attention-panel surface">
          <header><span className="eyebrow">Priority action center</span><h2>Work requiring attention</h2></header>
          <div>
            <AttentionItem icon={<AlertTriangle/>} title="Metadata gaps" detail="Required profile fields are incomplete" count={command.actionQueues.metadataGaps} tone="info" onClick={() => openAnalysis('quality', 'missing-metadata')}/>
            <AttentionItem icon={<Upload/>} title="Imports needing review" detail="Failed, stale, or blocked import sessions" count={command.actionQueues.importsNeedingAttention} tone="warning" onClick={() => navigate('/import')}/>
            <AttentionItem icon={<Wrench/>} title="Rework queue" detail="Assets requiring corrective work" count={command.actionQueues.rework} tone="warning" onClick={() => openAnalysis('operations', 'rework')}/>
            <AttentionItem icon={<ShieldAlert/>} title="E-waste queue" detail="Assets awaiting disposition" count={command.actionQueues.eWaste} tone="danger" onClick={() => openAnalysis('operations', 'e-waste')}/>
            <AttentionItem icon={<UserRound/>} title="Unassigned ownership" detail="Assets without a current owner" count={command.actionQueues.unassignedOwner} tone="info" onClick={() => openAnalysis('operations', 'inventory', { ownerId: '__UNASSIGNED__' })}/>
            <AttentionItem icon={<MapPin/>} title="Unassigned locations" detail="Assets without a physical location" count={command.actionQueues.unassignedLocation} tone="info" onClick={() => openAnalysis('operations', 'inventory', { locationId: '__UNASSIGNED__' })}/>
          </div>
        </section>
      </div>

      <section className="command-lifecycle surface">
        <header><div><span className="eyebrow">Lifecycle flow</span><h2>Where inventory is now</h2></div><small>Select a status to open the matching assets</small></header>
        <div>{(command.inventory.dimensions.status ?? []).map((item) => <button key={item.key} onClick={() => openAnalysis('operations', 'inventory', { status: item.key })}>
          <strong>{item.value}</strong><span>{item.label}</span><small>{percent(item.value, command.inventory.total)}%</small>
        </button>)}</div>
      </section>

      <div className="report-breakdown-grid report-breakdown-grid--two">
        {['category', 'location', 'owner', 'vendor'].map((dimension) => <Breakdown key={dimension} title={dimensionLabels[dimension]} values={command.inventory.dimensions[dimension] ?? []} onSelect={(key) => {
          const parameter = ({ category: 'category', location: 'locationId', owner: 'ownerId', vendor: 'vendorId' } as Record<string, string>)[dimension];
          openAnalysis('operations', 'inventory', { [parameter]: key });
        }}/>) }
      </div>

      <div className="command-operations-grid">
        <section className="command-activity surface">
          <header><div><span className="eyebrow">Recent activity</span><h2>What changed</h2></div><button className="button" onClick={() => navigate('/activity')}>View all activity</button></header>
          {!command.recentActivity.length ? <div className="report-empty-inline"><Activity/><span>No recent activity is available for your role.</span></div> :
            <div>{command.recentActivity.map((event) => <button key={event.id} onClick={() => openActivityRecord(event.route_path)}>
              <span><strong>{event.record_label}</strong><small>{event.actor} · {event.reason || event.action_key.replaceAll('_', ' ')}</small></span><time>{formatTimestamp(event.created_at)}</time><ArrowRight size={16}/>
            </button>)}</div>}
        </section>
        <section className="command-imports surface">
          <header><div><span className="eyebrow">Import pipeline</span><h2>Batch status</h2></div><button className="button" onClick={() => navigate('/import')}>Open imports</button></header>
          <div className="command-imports__summary"><span><strong>{command.imports.open}</strong><small>Open</small></span><span><strong>{command.imports.needsAttention}</strong><small>Needs attention</small></span><span><strong>{command.imports.ready}</strong><small>Ready</small></span></div>
          {!command.imports.recent.length ? <div className="report-empty-inline"><Upload/><span>No recent import sessions are available for your role.</span></div> :
            <div className="command-imports__list">{command.imports.recent.slice(0, 4).map((item) => <button key={item.id} onClick={() => navigate('/import')}>
              <span><strong>{item.file_name || `${item.category_name} ${item.mode.toLowerCase()}`}</strong><small>{item.total_rows} rows · {item.created_by}</small></span><b>{item.status.replaceAll('_', ' ')}</b><ArrowRight size={16}/>
            </button>)}</div>}
        </section>
        <section className="command-actions surface">
          <header><span className="eyebrow">Authorized actions</span><h2>Continue the work</h2></header>
          <div>
            <button onClick={() => navigate('/inventory')}><Database/><span><strong>Open inventory</strong><small>Browse and manage tracked assets</small></span><ArrowRight size={16}/></button>
            {session?.permissions['import.execute'] && <button onClick={() => navigate('/import')}><Upload/><span><strong>Run an import</strong><small>Create or update assets in a controlled batch</small></span><ArrowRight size={16}/></button>}
            {session?.permissions['activity.view'] && <button onClick={() => navigate('/activity')}><Activity/><span><strong>Review activity</strong><small>Inspect audited changes and source records</small></span><ArrowRight size={16}/></button>}
            {session?.permissions['admin.system'] && <button onClick={() => navigate('/admin')}><Settings/><span><strong>Manage configuration</strong><small>Profiles, dropdowns, locations, users, and health</small></span><ArrowRight size={16}/></button>}
          </div>
        </section>
      </div>

      <section className="report-results surface">
        <div className="section-heading"><div><span className="eyebrow">Recently received inventory</span><h2>{command.inventory.rows.length} recent records in this snapshot</h2></div></div>
        {!command.inventory.rows.length ? <div className="empty-state"><Search/><h3>No matching assets</h3><p>Adjust or clear the command-center filters.</p></div> :
          <div className="report-asset-list">{command.inventory.rows.map((row) => <button key={String(row.id)} onClick={() => openAsset(Number(row.id))}>
            <span><small>Asset</small><strong>{String(row.product_name ?? 'Unnamed asset')}</strong><em>{String(row.category_name ?? '')}</em></span>
            <span><small>Model / Serial</small><strong>{String(row.model_number ?? '')}</strong><em>{String(row.serial_number ?? '')}</em></span>
            <span><small>Owner / Location</small><strong>{String(row.owner ?? 'Unassigned')}</strong><em>{String(row.location ?? 'Unassigned')}</em></span>
            <span><small>Status</small><strong>{String(row.status_label ?? row.status ?? '')}</strong><em>{String(row.asset_tag ?? 'No asset tag')}</em></span><ArrowRight size={17}/>
          </button>)}</div>}
      </section>
    </> : view !== 'command' && result && <>
      <section className="report-toolbar surface">
        <label className="field"><span>Analysis focus</span><select value={reportId} onChange={(event) => setScope(event.target.value)}>{reports.map((report) => <option value={report.id} key={report.id}>{report.name}</option>)}</select></label>
        <div className="report-toolbar__context"><strong>{current?.name ?? 'Inventory Overview'}</strong><p>{current?.description ?? 'Authoritative inventory data.'}</p></div>
        {hasDrilldown && <button className="button" onClick={() => setScope('inventory')}>Clear drilldown</button>}
      </section>

      {view === 'leadership' && <>
        <section className="report-kpis" aria-label="Inventory health">
          <KpiButton label="Tracked assets" value={total} detail="All matching inventory" active={!hasDrilldown} onClick={() => selectKpi('total')}/>
          <KpiButton label="Ready to deploy" value={kpis.available ?? 0} detail={`${percent(kpis.available ?? 0, total)}% of this view`} onClick={() => selectKpi('available')}/>
          <KpiButton label="In use" value={kpis.in_use ?? 0} detail="Currently assigned" onClick={() => selectKpi('in_use')}/>
          <KpiButton label="Needs attention" value={kpis.exceptions ?? 0} detail="Rework or e-waste" onClick={() => selectKpi('exceptions')}/>
          <KpiButton label="Metadata gaps" value={kpis.missing_metadata ?? 0} detail={`${completion}% complete`} onClick={() => selectKpi('missing_metadata')}/>
        </section>
        <div className="report-intelligence-grid">
          <section className="report-chart-panel surface"><header><div><span className="eyebrow">Assets received</span><h2>Inventory movement</h2></div><small>Latest 12 recorded months</small></header><TrendChart values={result.trends} onSelect={(month) => setScope(reportId, { ...drillQuery, receivedMonth: month })}/></section>
          <section className="report-attention-panel surface"><header><span className="eyebrow">Action queues</span><h2>Management attention</h2></header><div>
            <AttentionItem icon={<Wrench/>} title="Rework queue" detail="Assets requiring corrective work" count={kpis.rework ?? 0} tone="warning" onClick={() => setScope('rework')}/>
            <AttentionItem icon={<ShieldAlert/>} title="E-waste queue" detail="Assets awaiting disposition" count={kpis.e_waste ?? 0} tone="danger" onClick={() => setScope('e-waste')}/>
            <AttentionItem icon={<AlertTriangle/>} title="Metadata gaps" detail="Required profile fields are incomplete" count={kpis.missing_metadata ?? 0} tone="info" onClick={() => setScope('missing-metadata')}/>
          </div></section>
        </div>
        <div className="report-breakdown-grid">{['category', 'status', 'location'].map((dimension) => <Breakdown key={dimension} title={dimensionLabels[dimension]} values={result.dimensions[dimension] ?? []} onSelect={(key) => drill(dimension, key)}/>)}</div>
      </>}

      {view === 'operations' && <>
        <section className="report-kpis" aria-label="Operational inventory">
          <KpiButton label="Ready to deploy" value={kpis.available ?? 0} detail="Available or GPU ready" onClick={() => selectKpi('available')}/><KpiButton label="In use" value={kpis.in_use ?? 0} detail="Currently assigned" onClick={() => selectKpi('in_use')}/><KpiButton label="GPU ready" value={kpis.gpu_ready ?? 0} detail="Prepared for assignment" onClick={() => setScope('inventory', { status: 'GPU_READY' })}/><KpiButton label="Rework" value={kpis.rework ?? 0} detail="Corrective work queue" onClick={() => setScope('rework')}/><KpiButton label="E-waste" value={kpis.e_waste ?? 0} detail="Disposition queue" onClick={() => setScope('e-waste')}/>
        </section>
        <section className="report-chart-panel surface"><header><div><span className="eyebrow">Date received</span><h2>Intake history</h2></div><small>Click a breakdown below to narrow the asset list</small></header><TrendChart values={result.trends} onSelect={(month) => setScope(reportId, { ...drillQuery, receivedMonth: month })}/></section>
        <div className="report-breakdown-grid report-breakdown-grid--two">{['status', 'category', 'location', 'owner', 'vendor', 'model', 'project'].map((dimension) => <Breakdown key={dimension} title={dimensionLabels[dimension]} values={result.dimensions[dimension] ?? []} onSelect={(key) => drill(dimension, key)}/>)}</div>
      </>}

      {view === 'quality' && <>
        <section className="report-quality-summary surface"><div className="report-quality-score"><CircleCheck/><strong>{completion}%</strong><span>Required metadata complete</span></div><div><span className="eyebrow">Profile-driven quality</span><h2>{result.quality.missing} assets need review</h2><p>Counts are calculated from each asset's active profile. Optional fields do not reduce this score.</p></div><button className="button button--secondary" onClick={() => setScope('missing-metadata')}>Open all metadata gaps</button></section>
        <section className="report-quality-issues surface"><header><div><span className="eyebrow">Required fields</span><h2>Where records are incomplete</h2></div><small>Select a field to see the affected assets</small></header>
          {!result.quality.issues.length ? <div className="report-empty-inline report-empty-inline--success"><CircleCheck/><span>No required-field gaps match this view.</span></div> : <div>{result.quality.issues.map((item) => <button key={item.key} onClick={() => setScope('inventory', { missingField: item.key })}><span><strong>{item.label}</strong><small>{item.key}</small></span><b>{item.value}</b><ArrowRight size={16}/></button>)}</div>}
        </section>
      </>}

      <section className="report-results surface">
        <div className="section-heading"><div><span className="eyebrow">Asset drilldown</span><h2>{result.total.toLocaleString()} matching assets</h2></div>{loading && <small>Refreshing...</small>}</div>
        {!result.rows.length ? <div className="empty-state"><Search/><h3>No matching assets</h3><p>Adjust or clear the report filters.</p></div> : <div className="report-asset-list">{result.rows.map((row) => <button key={String(row.id)} onClick={() => openAsset(Number(row.id))}><span><small>Asset</small><strong>{String(row.product_name ?? 'Unnamed asset')}</strong><em>{String(row.category_name ?? '')}</em></span><span><small>Model / Serial</small><strong>{String(row.model_number ?? '')}</strong><em>{String(row.serial_number ?? '')}</em></span><span><small>Owner / Location</small><strong>{String(row.owner ?? 'Unassigned')}</strong><em>{String(row.location ?? 'Unassigned')}</em></span><span><small>Status</small><strong>{String(row.status_label ?? row.status ?? '')}</strong><em>{String(row.asset_tag ?? 'No asset tag')}</em></span><ArrowRight size={17}/></button>)}</div>}
        {result.total > result.limit && <nav className="pagination" aria-label="Report pages"><button className="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {Math.ceil(result.total / result.limit)}</span><button className="button" disabled={page >= Math.ceil(result.total / result.limit)} onClick={() => setPage((value) => value + 1)}>Next</button></nav>}
      </section>
    </>}

    {drawerOpen && <FilterDrawer title="Report filters" value={filters} onApply={(value) => { setFilters(value); setDrillQuery({}); setPage(1); setDrawerOpen(false); }} onClear={() => { setFilters(emptyFilters); setDrillQuery({}); setPage(1); setDrawerOpen(false); }} onClose={() => setDrawerOpen(false)}/>} 
  </>;
}
