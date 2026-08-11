import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../state/AppState';
import type { Profile } from '../types';
import { DynamicForm } from './DynamicForm';
import { LoadingState } from './LoadingState';
import { Overlay } from './Overlay';

export interface AssetFilters {
  category?: string;
  fieldValues: Record<string, unknown>;
}

export function filterCount(filters: AssetFilters): number {
  return (filters.category ? 1 : 0) + Object.values(filters.fieldValues).filter((value) => value !== '' && value !== null && value !== undefined).length;
}

export function FilterDrawer({ value, onApply, onClear, onClose, title = 'Advanced Filters', surface = 'filter' }: {
  value: AssetFilters;
  onApply(value: AssetFilters): void;
  onClear(): void;
  onClose(): void;
  title?: string;
  surface?: 'filter';
}) {
  const { session, lookups, getProfile } = useAppState();
  const [draft, setDraft] = useState<AssetFilters>({ category: value.category, fieldValues: { ...value.fieldValues } });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const category = useMemo(() => session?.categories.find((item) => item.key === draft.category), [draft.category, session]);

  useEffect(() => {
    if (!category) { setProfile(null); return; }
    setProfile(null); setError('');
    getProfile(category.profileId).then(setProfile).catch((failure: Error) => setError(failure.message));
  }, [category, getProfile]);

  return <Overlay
    title={title}
    subtitle="Choose only the criteria you need. Results change after Apply Filters."
    onClose={onClose}
    size="wide"
    footer={<><button className="button button--primary" onClick={() => onApply(draft)}><SlidersHorizontal size={17}/>Apply Filters</button><button className="button" onClick={() => { setDraft({ fieldValues: {} }); onClear(); }}>Clear Filters</button></>}
  >
    <label className="field field--wide"><span className="field__label">Category</span><select value={draft.category ?? ''} onChange={(event) => setDraft({ category: event.target.value || undefined, fieldValues: {} })}><option value="">All categories</option>{session?.categories.map((item) => <option value={item.key} key={item.id}>{item.name}</option>)}</select><span className="field__help">Selecting a category reveals its complete profile-defined filter set.</span></label>
    {error && <p className="form-alert">{error}</p>}
    {category && !profile ? <LoadingState rows={5}/> : profile ? <section className="filter-profile"><div className="section-heading"><div><span className="eyebrow">{category?.name}</span><h3>Category fields</h3></div><span>{profile.fields.filter((field) => field.surfaces.filter !== false).length} available</span></div><DynamicForm fields={profile.fields} values={draft.fieldValues} onChange={(key, fieldValue) => setDraft((current) => ({ ...current, fieldValues: { ...current.fieldValues, [key]: fieldValue } }))} surface={surface} lookups={lookups} compact/></section> : <div className="empty-state empty-state--compact"><SlidersHorizontal/><h3>Select a category for profile fields</h3><p>Common search remains available without choosing a category.</p></div>}
  </Overlay>;
}
