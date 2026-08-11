import { Camera, ExternalLink, ImageOff, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAppState } from '../state/AppState';
import type { ActivityEvent, ApiError, AssetDetail, Profile } from '../types';
import { DynamicForm } from './DynamicForm';
import { LabelPrint } from './LabelPrint';
import { LoadingState } from './LoadingState';
import { Overlay } from './Overlay';

export type AssetWorkspaceTab = 'overview' | 'update' | 'operations' | 'history';

function fieldErrors(error: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of (error as ApiError)?.details?.fields ?? []) result[issue.fieldKey] = issue.message;
  return result;
}

function asOptionalId(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function AssetWorkspace({ assetId, initialTab = 'overview', onClose, onChanged }: {
  assetId: number;
  initialTab?: AssetWorkspaceTab;
  onClose(): void;
  onChanged?(): void;
}) {
  const { session, lookups, getProfile, notify } = useAppState();
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<AssetWorkspaceTab>(initialTab);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [operation, setOperation] = useState('CHANGE_STATUS');
  const [operationValues, setOperationValues] = useState<Record<string, unknown>>({});
  const [printOpen, setPrintOpen] = useState(false);

  const load = useCallback(async () => {
    const next = await api.asset(assetId);
    const nextProfile = await getProfile(next.profileId);
    setAsset(next);
    setProfile(nextProfile);
    setValues(next.values);
    setOperationValues({
      statusId: next.status.id,
      ownerId: next.owner.id,
      locationId: next.location?.id ?? '',
      reason: '',
      referenceValue: '',
    });
  }, [assetId, getProfile]);

  useEffect(() => { load().catch((failure: Error) => setError(failure.message)); }, [load]);
  useEffect(() => { setTab(initialTab); }, [assetId, initialTab]);
  useEffect(() => {
    if (tab !== 'history') return;
    api.assetActivity(assetId)
      .then((result) => setActivity(result.events))
      .catch((failure: Error) => setError(failure.message));
  }, [assetId, tab]);

  const canUpdate = Boolean(session?.permissions['asset.update']);
  const canOperate = Boolean(session?.permissions['asset.operate']);
  const canImage = Boolean(session?.permissions['model.image']);
  const operationEntries = Object.entries(session?.lifecycle.operations ?? {});
  const operationRule = session?.lifecycle.operations[operation];
  const operationStatuses = session?.statuses.filter((status) => operationRule?.allowedStatuses.includes(status.value_key)) ?? [];
  const detailFields = useMemo(
    () => profile?.fields.filter((field) => field.surfaces.detail !== false) ?? [],
    [profile],
  );

  async function save() {
    if (!asset || !reason.trim()) { setError('Reason is required before saving.'); return; }
    setBusy(true); setError(''); setErrors({});
    try {
      const next = await api.updateAsset(asset.id, { revision: asset.revision, values, reason });
      setAsset(next); setValues(next.values); setReason('');
      notify('Asset updated.'); onChanged?.();
    } catch (failure) {
      const apiError = failure as ApiError;
      setErrors(fieldErrors(failure));
      setError(apiError.status === 409
        ? 'Another session changed this asset. The latest revision is loaded; review it before saving again.'
        : apiError.message);
      if (apiError.latest) { setAsset(apiError.latest); setValues(apiError.latest.values); }
    } finally { setBusy(false); }
  }

  async function applyOperation() {
    if (!asset || !String(operationValues.reason ?? '').trim()) { setError('Reason is required for this operation.'); return; }
    setBusy(true); setError('');
    try {
      const next = await api.operateAsset(asset.id, {
        operation,
        revision: asset.revision,
        reason: String(operationValues.reason),
        referenceValue: String(operationValues.referenceValue ?? ''),
        ownerId: asOptionalId(operationValues.ownerId) ?? undefined,
        locationId: asOptionalId(operationValues.locationId),
        statusId: asOptionalId(operationValues.statusId) ?? undefined,
      });
      setAsset(next); setValues(next.values);
      notify(`${operationRule?.label ?? 'Asset change'} completed.`);
      onChanged?.(); setTab('overview');
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  async function upload(file?: File) {
    if (!file || !asset) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('Choose a PNG, JPG, JPEG, or WebP image.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('The image must be 5 MB or smaller.'); return; }
    setBusy(true); setError('');
    try { await api.uploadModelImage(asset.model.id, file); await load(); notify('Model image updated.'); onChanged?.(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  async function removeImage() {
    if (!asset) return;
    setBusy(true); setError('');
    try { await api.removeModelImage(asset.model.id); await load(); notify('Model image removed.'); onChanged?.(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  if (error && !asset) return <Overlay title="Asset unavailable" onClose={onClose} size="workspace"><p className="form-alert">{error}</p></Overlay>;
  if (!asset || !profile) return <Overlay title="Loading asset" onClose={onClose} size="workspace"><LoadingState rows={6}/></Overlay>;

  const footer = tab === 'update' ? <>
    <button className="button button--primary" onClick={save} disabled={busy}><Save size={17}/>{busy ? 'Saving...' : 'Save Changes'}</button>
    <button className="button" onClick={() => { setValues(asset.values); setReason(''); setErrors({}); setError(''); }}>Cancel Changes</button>
  </> : tab === 'operations' ? <>
    <button className="button button--primary" onClick={applyOperation} disabled={busy}>{busy ? 'Applying...' : operationRule?.label ?? 'Apply Change'}</button>
    <button className="button" onClick={() => setTab('overview')}>Cancel</button>
  </> : undefined;

  return <>
    <Overlay
      title={asset.model.productName}
      subtitle={`${asset.category.name} | ${asset.assetTag || asset.serialNumber} | Revision ${asset.revision}`}
      onClose={onClose}
      size="workspace"
      footer={footer}
    >
      <div className="workspace-hero">
        <div className="workspace-hero__image">{asset.model.imagePath ? <img src={asset.model.imagePath} alt=""/> : <Camera/>}</div>
        <div><span className={`status status--${asset.status.value.toLowerCase()}`}>{asset.status.label}</span><p>{asset.model.modelNumber}</p></div>
      </div>
      <div className="tabs" role="tablist">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
        {canUpdate && <button className={tab === 'update' ? 'active' : ''} onClick={() => setTab('update')}>Update Asset</button>}
        {canOperate && <button className={tab === 'operations' ? 'active' : ''} onClick={() => setTab('operations')}>Asset Actions</button>}
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History</button>
      </div>
      {error && <p className="form-alert">{error}</p>}

      {tab === 'overview' && <div className="workspace-section">
        <div className="detail-grid">{detailFields.map((field) => <div className="detail-item" key={field.id}><span>{field.label}</span><strong>{String(asset.values[field.fieldKey] || 'Not provided')}</strong></div>)}</div>
        <div className="reference-sections">
          <div className="reference-list"><h3>NVBug References</h3>{asset.references.nvbugs.length ? asset.references.nvbugs.map((bug) => <a key={bug} href={`https://nvbugspro.nvidia.com/bug/${bug}`} target="_blank" rel="noreferrer">NVBug {bug}<ExternalLink size={14}/></a>) : <p>None recorded</p>}</div>
          <div className="reference-list"><h3>MRS Orders</h3>{asset.references.mrsOrders.length ? <p>{asset.references.mrsOrders.join(', ')}</p> : <p>None recorded</p>}</div>
          <div className="reference-list"><h3>Capacity Requests</h3>{asset.references.capacityRequests.length ? <p>{asset.references.capacityRequests.join(', ')}</p> : <p>None recorded</p>}</div>
        </div>
        <div className="workspace-actions">
          {session?.permissions['label.print'] && <button className="button" onClick={() => setPrintOpen(true)}>Print Label</button>}
          {canOperate && <button className="button" onClick={() => setTab('operations')}>Assign, Transfer, or Change Status</button>}
        </div>
      </div>}

      {tab === 'update' && <div className="workspace-section">
        <DynamicForm fields={profile.fields} values={values} onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} errors={errors} surface="update" lookups={lookups}/>
        <label className="field field--wide"><span className="field__label">Reason *</span><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this asset is changing."/></label>
        {canImage && <section className="image-manager"><h3>Model Image</h3><p>Shared by every asset using model {asset.model.modelNumber}.</p><div className="button-row"><label className="button"><Camera size={17}/>Choose image<input hidden type="file" accept=".png,.jpg,.jpeg,.webp" onChange={(event) => upload(event.target.files?.[0])}/></label>{asset.model.imagePath && <button className="button button--danger" onClick={removeImage}><ImageOff size={17}/>Remove image</button>}</div></section>}
      </div>}

      {tab === 'operations' && <div className="workspace-section operation-form">
        <label className="field"><span className="field__label">Asset action *</span><select value={operation} onChange={(event) => {
          const nextOperation = event.target.value;
          const nextRule = session?.lifecycle.operations[nextOperation];
          const defaultStatus = session?.statuses.find((status) => nextRule?.allowedStatuses.includes(status.value_key));
          setOperation(nextOperation);
          setOperationValues((current) => ({ ...current, statusId: nextRule?.requiresStatus ? defaultStatus?.id ?? '' : '' }));
        }}>{operationEntries.map(([key, rule]) => <option value={key} key={key}>{rule.label}</option>)}</select></label>
        {(operationRule?.requiresOwner || operation === 'TRANSFER') && <label className="field"><span className="field__label">Owner / Assignee{operationRule?.requiresOwner ? ' *' : ''}</span><select value={String(operationValues.ownerId ?? '')} onChange={(event) => setOperationValues((current) => ({ ...current, ownerId: event.target.value }))}><option value="">Select owner</option>{lookups?.users.map((user) => <option value={user.id} key={user.id}>{user.display_name}</option>)}</select></label>}
        {operation !== 'ARCHIVE' && <label className="field"><span className="field__label">Location</span><select value={String(operationValues.locationId ?? '')} onChange={(event) => setOperationValues((current) => ({ ...current, locationId: event.target.value }))}><option value="">No location</option>{lookups?.locations.map((location) => <option value={location.id} key={location.id}>{location.full_path}</option>)}</select></label>}
        {operationRule?.requiresStatus && <label className="field"><span className="field__label">Resulting status *</span><select value={String(operationValues.statusId ?? '')} onChange={(event) => setOperationValues((current) => ({ ...current, statusId: event.target.value }))}><option value="">Select status</option>{operationStatuses.map((status) => <option value={status.id} key={status.id}>{status.display_value}</option>)}</select></label>}
        <label className="field"><span className="field__label">NVBug #</span><input value={String(operationValues.referenceValue ?? '')} onChange={(event) => setOperationValues((current) => ({ ...current, referenceValue: event.target.value }))} placeholder="9000001"/></label>
        <label className="field field--wide"><span className="field__label">Reason *</span><textarea rows={4} value={String(operationValues.reason ?? '')} onChange={(event) => setOperationValues((current) => ({ ...current, reason: event.target.value }))} placeholder="Explain the operational change."/></label>
      </div>}

      {tab === 'history' && <div className="activity-list">{activity.length ? activity.map((event) => <article className="activity-row" key={event.id}>
        <span className="activity-row__time">{new Date(event.created_at).toLocaleString()}</span>
        <div><strong>{event.action_key.replaceAll('_', ' ')}</strong><p>{event.reason}</p><small>{event.actor} | {event.source}</small>{event.changes.length > 0 && <details><summary>{event.changes.length} field change{event.changes.length > 1 ? 's' : ''}</summary>{event.changes.map((change) => <p key={change.fieldKey}><b>{change.fieldLabel}:</b> {String(change.before ?? 'blank')} -&gt; {String(change.after ?? 'blank')}</p>)}</details>}</div>
      </article>) : <p className="empty-copy">No activity recorded for this asset yet.</p>}</div>}
    </Overlay>
    {printOpen && <LabelPrint assetIds={[asset.id]} onClose={() => setPrintOpen(false)}/>}
  </>;
}
