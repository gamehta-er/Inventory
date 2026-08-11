import { Clock3, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { LoadingState } from '../components/LoadingState';
import { PageFailure } from '../components/PageFailure';
import { PageHeader } from '../components/PageHeader';
import { useAppState } from '../state/AppState';
import type { ActivityResponse } from '../types';

export function ActivityPage() {
  const { inventoryRevision } = useAppState();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.activity({ query, action, page, limit: 40 })
      .then(setResult)
      .catch((nextError: Error) => setError(nextError.message))
      .finally(() => setLoading(false));
  }, [action, inventoryRevision, page, query, reload]);

  return <>
    <PageHeader eyebrow="Activity" title="Every change, traceable" description="A structured, immutable record of inventory, import, profile, report, and label activity."/>
    <section className="activity-toolbar surface"><label><Search size={17}/><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search asset, actor, reason, or reference"/></label><select value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }}><option value="">All actions</option><option value="ASSET_CREATED">Asset created</option><option value="ASSET_UPDATED">Asset updated</option><option value="STATUS_CHANGED">Status changed</option><option value="ASSET_ASSIGNED">Assigned</option><option value="ASSET_RETURNED">Returned</option><option value="ASSET_TRANSFERRED">Transferred</option><option value="IMPORT_COMMITTED">Import committed</option><option value="LABEL_PRINTED">Label printed</option></select></section>
    {loading && !result ? <LoadingState label="Loading activity"/> : error ? <PageFailure message={error} onRetry={() => setReload((value) => value + 1)}/> : <section className="activity-list">{!result?.events.length ? <div className="empty-state surface"><Clock3/><h3>No activity matches</h3><p>Try a different action or search term.</p></div> : result.events.map((event, index) => {
      const timestamp = new Date(event.created_at);
      const displayTime = Number.isNaN(timestamp.getTime()) ? 'Time unavailable' : timestamp.toLocaleString();
      return <article className="activity-event surface" key={`${event.id}-${index}`}><div className="activity-event__marker"><Clock3 size={16}/></div><div className="activity-event__body"><div className="activity-event__heading"><div><strong>{event.record_label}</strong><span>{event.action_key.replaceAll('_', ' ')}</span></div><time>{displayTime}</time></div><p>{event.reason}</p><div className="activity-event__meta"><span>{event.actor}</span><span>{event.source}</span>{event.reference_value && <span>{event.reference_value}</span>}</div>{event.changes.length > 0 && <details><summary>{event.changes.length} field change{event.changes.length === 1 ? '' : 's'}</summary><div className="change-list">{event.changes.map((change, changeIndex) => <div key={`${change.fieldKey}-${changeIndex}`}><strong>{change.fieldLabel}</strong><span>{String(change.before ?? 'Empty')}</span><span aria-hidden>-&gt;</span><span>{String(change.after ?? 'Empty')}</span></div>)}</div></details>}{event.record_type === 'asset' && Number.isFinite(Number(event.record_id)) ? <button className="text-button" onClick={() => navigate(`/assets/${event.record_id}?tab=history`, { state: { backgroundLocation: location } })}>Open affected asset</button> : event.route_path && <button className="text-button" onClick={() => navigate(event.route_path)}>Open affected record</button>}</div></article>;
    })}</section>}
    {result && result.total > result.limit && <div className="pagination"><button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {Math.ceil(result.total / result.limit)}</span><button disabled={page >= Math.ceil(result.total / result.limit)} onClick={() => setPage((value) => value + 1)}>Next</button></div>}
  </>;
}
