import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAppState } from '../state/AppState';
import type { ApiError, Profile } from '../types';
import { DynamicForm } from './DynamicForm';
import { LoadingState } from './LoadingState';
import { Overlay } from './Overlay';

function validationErrors(error: unknown): Record<string, string> {
  const fields = (error as ApiError)?.details?.fields ?? [];
  return Object.fromEntries(fields.map((issue) => [issue.fieldKey, issue.message]));
}

export function AddAsset({ initialProfileId, onClose, onCreated }: {
  initialProfileId?: number;
  onClose(): void;
  onCreated(assetId: number): void;
}) {
  const { session, lookups, getProfile, notify } = useAppState();
  const [profileId, setProfileId] = useState(initialProfileId ?? session?.categories[0]?.profileId ?? 0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profileId) return;
    setProfile(null); setValues({}); setErrors({}); setError('');
    getProfile(profileId).then(setProfile).catch((failure: Error) => setError(failure.message));
  }, [getProfile, profileId]);

  async function submit() {
    if (!reason.trim()) { setError('Reason is required before adding an asset.'); return; }
    setBusy(true); setError(''); setErrors({});
    try {
      const asset = await api.createAsset({ profileId, values, reason });
      notify('Asset added to inventory.');
      onCreated(asset.id);
    } catch (failure) {
      setErrors(validationErrors(failure));
      setError((failure as Error).message);
    } finally { setBusy(false); }
  }

  return <Overlay
    title="Add Asset"
    subtitle="Create one tracked inventory item from its governed category profile."
    onClose={onClose}
    size="wide"
    footer={<><button className="button button--primary" onClick={submit} disabled={busy || !profile}><Save size={17}/>{busy ? 'Adding...' : 'Add Asset'}</button><button className="button" onClick={onClose}>Cancel</button></>}
  >
    <label className="field field--wide"><span className="field__label">Category *</span><select value={profileId} onChange={(event) => setProfileId(Number(event.target.value))}>{session?.categories.map((category) => <option value={category.profileId} key={category.id}>{category.name}</option>)}</select><span className="field__help">The selected profile controls fields, validation, filters, imports, reports, and exports.</span></label>
    {error && <p className="form-alert">{error}</p>}
    {!profile ? <LoadingState rows={6}/> : <DynamicForm fields={profile.fields} values={values} onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} errors={errors} surface="add" lookups={lookups}/>} 
    <label className="field field--wide"><span className="field__label">Reason *</span><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this asset being added?"/><span className="field__help">This explanation is stored in the immutable activity ledger.</span></label>
  </Overlay>;
}
