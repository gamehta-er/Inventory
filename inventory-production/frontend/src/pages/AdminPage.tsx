import { AlertTriangle, CheckCircle2, ChevronDown, Database, ListTree, MapPin, Plus, ShieldCheck, Users } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { LoadingState } from '../components/LoadingState';
import { PageFailure } from '../components/PageFailure';
import { PageHeader } from '../components/PageHeader';
import { useAppState } from '../state/AppState';
import type { FieldDefinition, Profile } from '../types';

type Tab = 'profiles' | 'lookups' | 'locations' | 'users' | 'health';

const adminTabs: Tab[] = ['profiles', 'lookups', 'locations', 'users', 'health'];

function adminTab(value: string | null): Tab {
  return adminTabs.includes(value as Tab) ? value as Tab : 'profiles';
}

function toLookupValueKey(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
}

function Reason({ value, onChange }: { value: string; onChange(value: string): void }) {
  return <label className="field"><span>Reason <b aria-hidden>*</b></span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Why this configuration is changing" required/></label>;
}

export function AdminPage() {
  const { lookups, refreshRegistry, getProfile, notify } = useAppState();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParameter = searchParams.get('tab');
  const requestedLookup = searchParams.get('lookup') ?? undefined;
  const requestedValue = searchParams.get('value') ?? undefined;
  const [tab, setTab] = useState<Tab>(() => adminTab(tabParameter));
  const [profiles, setProfiles] = useState<Array<Record<string, unknown>>>([]);
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [roles, setRoles] = useState<Array<Record<string, unknown>>>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [loadedProfiles, setLoadedProfiles] = useState<Record<number, Profile>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [newFieldOpen, setNewFieldOpen] = useState<number | null>(null);

  useEffect(() => { setTab(adminTab(tabParameter)); }, [tabParameter]);

  const selectTab = (nextTab: Tab) => {
    setTab(nextTab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', nextTab);
    if (nextTab !== 'lookups') {
      next.delete('lookup');
      next.delete('value');
      next.delete('from');
    }
    setSearchParams(next, { replace: true });
  };

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [nextProfiles, identity, nextHealth] = await Promise.all([api.adminProfiles(), api.adminUsers(), api.adminHealth()]);
      setProfiles(nextProfiles); setUsers(identity.users); setRoles(identity.roles); setHealth(nextHealth);
    } catch (failure) {
      const message = (failure as Error).message;
      setError(message); notify(message, 'error');
    }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const openProfile = async (id: number) => {
    setExpanded((current) => current === id ? null : id);
    if (!loadedProfiles[id]) {
      try {
        const profile = await getProfile(id, true);
        setLoadedProfiles((current) => ({ ...current, [id]: profile }));
      } catch (failure) {
        const message = (failure as Error).message;
        setError(message); notify(message, 'error');
      }
    }
  };

  const updateField = async (profileId: number, field: FieldDefinition, updates: Record<string, unknown>) => {
    if (!reason.trim()) { notify('Enter a reason before changing a profile.', 'error'); return; }
    try {
      await api.updateProfileField(profileId, field.id, { ...updates, reason });
      await refreshRegistry();
      const profile = await getProfile(profileId, true); setLoadedProfiles((current) => ({ ...current, [profileId]: profile }));
      setReason(''); notify(`${field.label} updated.`); await load();
    } catch (error) { notify((error as Error).message, 'error'); }
  };

  if (loading && !profiles.length) return <LoadingState label="Loading administration"/>;
  if (error && !profiles.length) return <PageFailure title="Administration is temporarily unavailable" message={error} onRetry={() => void load()}/>;

  return <>
    <PageHeader eyebrow="Administration" title="Configuration without code changes" description="Profiles, field semantics, dropdowns, hierarchy, roles, and health are managed from one audited control plane."/>
    <nav className="segmented" aria-label="Administration sections">
      {([
        ['profiles', ListTree, 'Profiles'], ['lookups', Database, 'Dropdowns'], ['locations', MapPin, 'Locations'], ['users', Users, 'Users & roles'], ['health', ShieldCheck, 'Health'],
      ] as const).map(([key, Icon, label]) => <button className={tab === key ? 'segmented__active' : ''} key={key} onClick={() => selectTab(key)}><Icon size={17}/>{label}</button>)}
    </nav>

    {tab === 'profiles' && <div className="admin-layout">
      <section className="surface admin-main"><div className="section-heading"><div><span className="eyebrow">Asset profiles</span><h2>Categories and fields</h2><p>One definition drives forms, filters, imports, details, reports, and exports.</p></div><button className="button button--primary" onClick={() => setNewFieldOpen(-1)}><Plus size={17}/>New category</button></div>
        <div className="profile-list">{profiles.map((row) => { const id=Number(row.id); const profile=loadedProfiles[id]; return <article className="profile-row" key={id}><button className="profile-row__summary" onClick={() => void openProfile(id)}><span><strong>{String(row.profile_name)}</strong><small>{String(row.category_name)} | version {String(row.version)} | {String(row.field_count)} fields</small></span><ChevronDown className={expanded===id?'rotate':''}/></button>{expanded===id && <div className="profile-row__body">{!profile ? <LoadingState label="Loading profile"/> : <><Reason value={reason} onChange={setReason}/><div className="field-registry">{profile.fields.map((field) => <ProfileFieldEditor key={field.id} field={field} disabled={!reason.trim()} onSave={(updates) => updateField(id, field, updates)} onDeprecate={() => updateField(id, field, { active:false })}/>)}</div><button className="button button--secondary" onClick={()=>setNewFieldOpen(id)}><Plus size={16}/>Add field</button></>}</div>}</article>; })}</div>
      </section>
      <aside className="surface admin-aside"><h2>Profile contract</h2><p>Field keys are stable database identifiers. Labels can change, but changing keys can break imports, saved reports, and integrations.</p><ul><li>Definitions explain business meaning.</li><li>Aliases map incoming CSV headers.</li><li>Visibility controls every enabled surface.</li><li>Deprecation preserves historical values.</li></ul></aside>
    </div>}

    {tab === 'lookups' && <LookupManager initialLookupKey={requestedLookup} initialValue={requestedValue} reason={reason} setReason={setReason} onChanged={async(message)=>{notify(message);setReason('');await refreshRegistry();}}/>}
    {tab === 'locations' && <LocationManager reason={reason} setReason={setReason} onChanged={async(message)=>{notify(message);setReason('');await refreshRegistry();}}/>}
    {tab === 'users' && <UserManager users={users} roles={roles} reason={reason} setReason={setReason} onChanged={async()=>{notify('User roles updated.');setReason('');await load();}}/>}
    {tab === 'health' && <HealthPanel health={health}/>} 
    {newFieldOpen !== null && (newFieldOpen === -1 ? <NewCategory onClose={()=>setNewFieldOpen(null)} onSaved={async()=>{await refreshRegistry();setNewFieldOpen(null);await load();}}/> : <NewField profileId={newFieldOpen} onClose={()=>setNewFieldOpen(null)} onSaved={async()=>{await refreshRegistry();const profile=await getProfile(newFieldOpen,true);setLoadedProfiles((current)=>({...current,[newFieldOpen]:profile}));setNewFieldOpen(null);await load();}}/>)}
  </>;
}

const surfaceLabels: Array<[keyof FieldDefinition['surfaces'], string]> = [
  ['add', 'Add form'],
  ['update', 'Update form'],
  ['filter', 'Filters'],
  ['detail', 'Asset details'],
  ['import', 'Import'],
  ['report', 'Reports'],
  ['export', 'Exports'],
];

function ProfileFieldEditor({ field, disabled, onSave, onDeprecate }: {
  field: FieldDefinition;
  disabled: boolean;
  onSave(updates: Record<string, unknown>): Promise<void>;
  onDeprecate(): Promise<void>;
}) {
  const [draft, setDraft] = useState(() => ({
    label: field.label,
    definition: field.definition,
    helpText: field.helpText,
    aliases: field.aliases.join(', '),
    required: field.required,
    uniqueWhenPopulated: field.uniqueWhenPopulated,
    displayOrder: field.displayOrder,
    minLength: String(field.validationRules.minLength ?? ''),
    maxLength: String(field.validationRules.maxLength ?? ''),
    minimum: String(field.validationRules.minimum ?? field.validationRules.min ?? ''),
    maximum: String(field.validationRules.maximum ?? field.validationRules.max ?? ''),
    pattern: String(field.validationRules.pattern ?? ''),
    surfaces: { ...field.surfaces },
  }));

  const save = async () => {
    const numeric = (value: string) => value.trim() === '' ? undefined : Number(value);
    const validationRules = {
      ...(numeric(draft.minLength) === undefined ? {} : { minLength: numeric(draft.minLength) }),
      ...(numeric(draft.maxLength) === undefined ? {} : { maxLength: numeric(draft.maxLength) }),
      ...(numeric(draft.minimum) === undefined ? {} : { minimum: numeric(draft.minimum) }),
      ...(numeric(draft.maximum) === undefined ? {} : { maximum: numeric(draft.maximum) }),
      ...(draft.pattern.trim() ? { pattern: draft.pattern.trim() } : {}),
    };
    await onSave({
      label: draft.label.trim(),
      definition: draft.definition.trim(),
      helpText: draft.helpText.trim(),
      aliases: draft.aliases.split(',').map((value) => value.trim()).filter(Boolean),
      required: draft.required,
      uniqueWhenPopulated: draft.uniqueWhenPopulated,
      displayOrder: Number(draft.displayOrder),
      validationRules,
      ...Object.fromEntries(surfaceLabels.map(([key]) => [
        `visible${key[0].toUpperCase()}${key.slice(1)}`,
        Boolean(draft.surfaces[key]),
      ])),
    });
  };

  return <details className="field-registry__item">
    <summary>
      <span><strong>{field.label}{field.required && <b> *</b>}</strong><code>{field.fieldKey}</code></span>
      <span className="field-registry__meta"><span>{field.dataType}</span><span>{field.storageTarget}</span></span>
    </summary>
    <div className="field-editor">
      <div className="field-key-note field--wide">
        <strong>Stable field key: <code>{field.fieldKey}</code></strong>
        <p>This identifier connects stored values, imports, filters, reports, and exports. It cannot be renamed after creation; change the display label instead.</p>
      </div>
      <label className="field"><span>Display label *</span><input value={draft.label} onChange={(event)=>setDraft((current)=>({...current,label:event.target.value}))} required/></label>
      <label className="field"><span>Display order *</span><input type="number" min="1" value={draft.displayOrder} onChange={(event)=>setDraft((current)=>({...current,displayOrder:Number(event.target.value)}))}/></label>
      <label className="field field--wide"><span>Business definition *</span><textarea value={draft.definition} onChange={(event)=>setDraft((current)=>({...current,definition:event.target.value}))}/></label>
      <label className="field field--wide"><span>User guidance *</span><textarea value={draft.helpText} onChange={(event)=>setDraft((current)=>({...current,helpText:event.target.value}))}/></label>
      <label className="field field--wide"><span>Import header aliases</span><input value={draft.aliases} onChange={(event)=>setDraft((current)=>({...current,aliases:event.target.value}))}/></label>
      <fieldset className="field-options field--wide"><legend>Data rules</legend><label><input type="checkbox" checked={draft.required} onChange={(event)=>setDraft((current)=>({...current,required:event.target.checked}))}/>Required</label><label><input type="checkbox" checked={draft.uniqueWhenPopulated} onChange={(event)=>setDraft((current)=>({...current,uniqueWhenPopulated:event.target.checked}))}/>Unique when provided</label></fieldset>
      <fieldset className="field-options field--wide"><legend>Application surfaces</legend>{surfaceLabels.map(([key,label])=><label key={key}><input type="checkbox" checked={Boolean(draft.surfaces[key])} onChange={(event)=>setDraft((current)=>({...current,surfaces:{...current.surfaces,[key]:event.target.checked}}))}/>{label}</label>)}</fieldset>
      <div className="validation-grid field--wide"><label className="field"><span>Minimum length</span><input type="number" min="0" value={draft.minLength} onChange={(event)=>setDraft((current)=>({...current,minLength:event.target.value}))}/></label><label className="field"><span>Maximum length</span><input type="number" min="1" value={draft.maxLength} onChange={(event)=>setDraft((current)=>({...current,maxLength:event.target.value}))}/></label><label className="field"><span>Minimum number</span><input type="number" value={draft.minimum} onChange={(event)=>setDraft((current)=>({...current,minimum:event.target.value}))}/></label><label className="field"><span>Maximum number</span><input type="number" value={draft.maximum} onChange={(event)=>setDraft((current)=>({...current,maximum:event.target.value}))}/></label><label className="field field--wide"><span>Format pattern</span><input value={draft.pattern} onChange={(event)=>setDraft((current)=>({...current,pattern:event.target.value}))} placeholder="Optional regular expression"/></label></div>
      <div className="field-editor__actions field--wide"><button type="button" className="button" disabled={disabled} onClick={()=>void save()}>Save field rules</button><button type="button" className="button button--danger" disabled={disabled} onClick={()=>void onDeprecate()}>Deprecate field</button>{disabled && <small>Enter a reason above before saving.</small>}</div>
    </div>
  </details>;
}

function NewCategory({ onClose, onSaved }: { onClose():void; onSaved():Promise<void> }) {
  const { notify } = useAppState(); const [busy,setBusy]=useState(false);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const data=new FormData(event.currentTarget);setBusy(true);try{await api.createCategory({key:data.get('key'),name:data.get('name'),description:data.get('description'),icon:data.get('icon'),reason:data.get('reason'),copyStandardFields:true});notify('Category and profile created.');await onSaved();}catch(error){notify((error as Error).message,'error');}finally{setBusy(false);}};
  return <div className="inline-dialog surface"><div className="section-heading"><div><h2>New category</h2><p>Creates an adaptable profile using the standard field contract.</p></div><button className="icon-button" aria-label="Close new category" onClick={onClose}>X</button></div><form className="form-grid" onSubmit={submit}><label className="field"><span>Key *</span><input name="key" placeholder="NIC" required pattern="[A-Za-z0-9_]+"/></label><label className="field"><span>Name *</span><input name="name" placeholder="Network Interface Card" required/></label><label className="field field--wide"><span>Definition *</span><textarea name="description" required/></label><label className="field"><span>Icon key</span><input name="icon" defaultValue="box"/></label><label className="field field--wide"><span>Reason *</span><input name="reason" required/></label><div className="form-actions"><button type="button" onClick={onClose}>Cancel</button><button className="button--primary" disabled={busy}>{busy?'Creating...':'Create category'}</button></div></form></div>;
}

function NewField({profileId,onClose,onSaved}:{profileId:number;onClose():void;onSaved():Promise<void>}) {
  const {lookups,notify}=useAppState();
  const[busy,setBusy]=useState(false);
  const[dataType,setDataType]=useState('text');
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    const optionalNumber=(name:string)=>String(data.get(name)??'').trim()===''?undefined:Number(data.get(name));
    const validationRules={
      ...(optionalNumber('minLength')===undefined?{}:{minLength:optionalNumber('minLength')}),
      ...(optionalNumber('maxLength')===undefined?{}:{maxLength:optionalNumber('maxLength')}),
      ...(optionalNumber('minimum')===undefined?{}:{minimum:optionalNumber('minimum')}),
      ...(optionalNumber('maximum')===undefined?{}:{maximum:optionalNumber('maximum')}),
      ...(String(data.get('pattern')??'').trim()?{pattern:String(data.get('pattern')).trim()}:{}),
    };
    setBusy(true);
    try{
      await api.addProfileField(profileId,{
        fieldKey:data.get('fieldKey'),label:data.get('label'),definition:data.get('definition'),helpText:data.get('helpText'),dataType,
        lookupListId:dataType==='lookup'?Number(data.get('lookupListId')):null,
        required:data.get('required')==='on',uniqueWhenPopulated:data.get('unique')==='on',displayOrder:Number(data.get('displayOrder')),
        aliases:String(data.get('aliases')??'').split(',').map(v=>v.trim()).filter(Boolean),validationRules,
        visibleAdd:data.get('visibleAdd')==='on',visibleUpdate:data.get('visibleUpdate')==='on',visibleFilter:data.get('visibleFilter')==='on',
        visibleDetail:data.get('visibleDetail')==='on',visibleImport:data.get('visibleImport')==='on',visibleReport:data.get('visibleReport')==='on',visibleExport:data.get('visibleExport')==='on',
        reason:data.get('reason'),
      });
      notify('Profile field created and registry caches refreshed.');
      await onSaved();
    }catch(error){notify((error as Error).message,'error');}finally{setBusy(false);}
  };
  return <div className="inline-dialog surface"><div className="section-heading"><div><h2>Add profile field</h2><p>Define the business meaning once, then choose exactly where the field is used.</p></div><button className="icon-button" aria-label="Close new field" onClick={onClose}>X</button></div><form className="form-grid" onSubmit={submit}>
    <label className="field"><span>Field key *</span><input name="fieldKey" placeholder="firmware_version" required pattern="[a-z][a-z0-9_]+"/><small>Permanent identifier used by storage, import, filters, reports, and exports.</small></label>
    <label className="field"><span>Display label *</span><input name="label" placeholder="Firmware version" required/></label>
    <label className="field"><span>Type *</span><select name="dataType" value={dataType} onChange={(event)=>setDataType(event.target.value)}><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="long_text">Long text</option><option value="lookup">Dropdown</option><option value="boolean">Yes / No</option><option value="multi_reference">Multiple references</option></select></label>
    <label className="field"><span>Display order *</span><input name="displayOrder" type="number" min="1" defaultValue="100" required/></label>
    {dataType==='lookup'&&<label className="field field--wide"><span>Dropdown list *</span><select name="lookupListId" required><option value="">Select controlled list</option>{lookups?.lookups.map((lookup)=><option value={lookup.id} key={lookup.id}>{lookup.lookup_name}</option>)}</select></label>}
    <label className="field field--wide"><span>Business definition *</span><textarea name="definition" required/></label>
    <label className="field field--wide"><span>User guidance *</span><textarea name="helpText" required/></label>
    <label className="field field--wide"><span>Import aliases</span><input name="aliases" placeholder="Firmware, Firmware Version"/></label>
    <fieldset className="field-options field--wide"><legend>Data rules</legend><label><input type="checkbox" name="required"/>Required</label><label><input type="checkbox" name="unique"/>Unique when provided</label></fieldset>
    <fieldset className="field-options field--wide"><legend>Application surfaces</legend>{surfaceLabels.map(([key,label])=><label key={key}><input type="checkbox" name={`visible${key[0].toUpperCase()}${key.slice(1)}`} defaultChecked/>{label}</label>)}</fieldset>
    <div className="validation-grid field--wide"><label className="field"><span>Minimum length</span><input name="minLength" type="number" min="0"/></label><label className="field"><span>Maximum length</span><input name="maxLength" type="number" min="1"/></label><label className="field"><span>Minimum number</span><input name="minimum" type="number"/></label><label className="field"><span>Maximum number</span><input name="maximum" type="number"/></label><label className="field field--wide"><span>Format pattern</span><input name="pattern" placeholder="Optional regular expression"/></label></div>
    <label className="field field--wide"><span>Reason *</span><input name="reason" required/></label><div className="form-actions"><button type="button" onClick={onClose}>Cancel</button><button className="button--primary" disabled={busy}>{busy?'Adding...':'Add field'}</button></div>
  </form></div>;
}

function LookupManager({initialLookupKey,initialValue,reason,setReason,onChanged}:{initialLookupKey?:string;initialValue?:string;reason:string;setReason(value:string):void;onChanged(message:string):Promise<void>}) {
  const {lookups,notify}=useAppState();
  const [list,setList]=useState(initialLookupKey??lookups?.lookups[0]?.lookup_key??'');
  const [valueKey,setValueKey]=useState(()=>toLookupValueKey(initialValue??''));
  const [displayValue,setDisplayValue]=useState(initialValue??'');
  const [busy,setBusy]=useState(false);
  const selected=lookups?.lookups.find((item)=>item.lookup_key===list);
  useEffect(()=>{
    if(initialLookupKey) setList(initialLookupKey);
    if(initialValue){setValueKey(toLookupValueKey(initialValue));setDisplayValue(initialValue);}
  },[initialLookupKey,initialValue]);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!reason.trim()){notify('Enter a reason.','error');return;}const data=new FormData(event.currentTarget);setBusy(true);try{await api.addLookupValue(list,{valueKey,displayValue,description:data.get('description'),aliases:String(data.get('aliases')??'').split(',').map((value)=>value.trim()).filter(Boolean),reason});await onChanged(`${displayValue} approved for ${selected?.lookup_name??'the dropdown'}.`);setValueKey('');setDisplayValue('');event.currentTarget.reset();}catch(error){notify((error as Error).message,'error');}finally{setBusy(false);}};
  return <section className="admin-grid"><div className="surface"><div className="section-heading"><div><h2>Dropdown values</h2><p>Controlled options, descriptions, aliases, and ordering.</p></div></div><label className="field"><span>Dropdown list</span><select value={list} onChange={(event)=>setList(event.target.value)}>{lookups?.lookups.map((item)=><option value={item.lookup_key} key={item.lookup_key}>{item.lookup_name}</option>)}</select></label><div className="tag-list">{selected?.values.map((value)=><span key={value.id}>{value.label}</span>)}</div></div><form className="surface form-grid" onSubmit={submit}>{initialValue&&<div className="lookup-correction-context field--wide"><span className="eyebrow">Import correction</span><strong>Review &quot;{initialValue}&quot; for {selected?.lookup_name??'this dropdown'}</strong><p>Approve it only when it is a valid reusable business option. Otherwise, return to the import and replace it with one of the existing approved values.</p></div>}<h2 className="field--wide">Add value</h2><label className="field"><span>Key *</span><input name="key" value={valueKey} onChange={(event)=>setValueKey(event.target.value)} required/></label><label className="field"><span>Label *</span><input name="label" value={displayValue} onChange={(event)=>{setDisplayValue(event.target.value);setValueKey(toLookupValueKey(event.target.value));}} required/></label><label className="field field--wide"><span>Description</span><input name="description"/></label><label className="field field--wide"><span>Aliases</span><input name="aliases" placeholder="Comma separated"/></label><Reason value={reason} onChange={setReason}/><div className="form-actions"><button className="button button--primary" disabled={busy}>{busy?'Adding...':'Approve value'}</button></div></form></section>;
}

function LocationManager({reason,setReason,onChanged}:{reason:string;setReason(value:string):void;onChanged(message:string):Promise<void>}) {
  const {lookups,notify}=useAppState();const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!reason.trim()){notify('Enter a reason.','error');return;}const data=new FormData(event.currentTarget);try{await api.addLocation({key:data.get('key'),name:data.get('name'),typeKey:data.get('typeKey'),parentId:data.get('parentId')||null,reason});await onChanged('Location added.');event.currentTarget.reset();}catch(error){notify((error as Error).message,'error');}};
  return <section className="admin-grid"><div className="surface"><h2>Location hierarchy</h2><p>Building &gt; Lab/Room &gt; Rack &gt; RU &gt; Cabinet/Storage.</p><div className="location-tree">{lookups?.locations.map((location)=><div key={location.id}><MapPin size={15}/>{location.full_path}</div>)}</div></div><form className="surface form-grid" onSubmit={submit}><label className="field"><span>Key *</span><input name="key" required/></label><label className="field"><span>Name *</span><input name="name" required/></label><label className="field"><span>Type *</span><select name="typeKey"><option value="BUILDING">Building</option><option value="LAB_ROOM">Lab / Room</option><option value="RACK">Rack</option><option value="RU">RU</option><option value="CABINET_STORAGE">Cabinet / Storage</option></select></label><label className="field"><span>Parent</span><select name="parentId"><option value="">No parent</option>{lookups?.locations.map((location)=><option key={location.id} value={location.id}>{location.full_path}</option>)}</select></label><Reason value={reason} onChange={setReason}/><div className="form-actions"><button className="button--primary">Add location</button></div></form></section>;
}

function UserManager({users,roles,reason,setReason,onChanged}:{users:Array<Record<string,unknown>>;roles:Array<Record<string,unknown>>;reason:string;setReason(value:string):void;onChanged():Promise<void>}) {
  const {notify}=useAppState();const update=async(user:Record<string,unknown>,role:string,enabled:boolean)=>{if(!reason.trim()){notify('Enter a reason before changing roles.','error');return;}const current=(user.roles as string[])??[];const next=enabled?[...new Set([...current,role])]:current.filter((item)=>item!==role);try{await api.updateUserRoles(Number(user.id),next,reason);await onChanged();}catch(error){notify((error as Error).message,'error');}};
  return <section className="surface"><div className="section-heading"><div><h2>Users and roles</h2><p>Every active team member retains User. Elevated roles are database-enforced and audited.</p></div></div><Reason value={reason} onChange={setReason}/><div className="user-table"><div className="user-table__header"><span>User</span>{roles.map((role)=><span key={String(role.role_key)}>{String(role.role_name)}</span>)}</div>{users.map((user)=><div className="user-table__row" key={String(user.id)}><span><strong>{String(user.display_name)}</strong><small>{String(user.email??'')}</small></span>{roles.map((role)=>{const key=String(role.role_key);const checked=((user.roles as string[])??[]).includes(key);return <label key={key}><input type="checkbox" checked={checked} disabled={key==='user'} onChange={(event)=>void update(user,key,event.target.checked)}/><span className="sr-only">{key}</span></label>;})}</div>)}</div></section>;
}

function HealthPanel({health}:{health:Record<string,unknown>|null}) {
  const counts=(health?.counts??{}) as Record<string,number>;const incomplete=(health?.incompleteProfiles??[]) as Array<Record<string,unknown>>;const usage=(health?.fieldUsage??[]) as Array<Record<string,unknown>>;
  return <><section className="kpi-strip">{Object.entries(counts).map(([key,value])=><div className="kpi-card kpi-card--static" key={key}><Database/><span>{key.replaceAll('_',' ')}</span><strong>{value}</strong><small>Active configuration</small></div>)}</section><section className="admin-grid"><div className="surface"><h2>Profile health</h2>{incomplete.length?<div className="warning-list">{incomplete.map((item)=><p key={String(item.id)}><AlertTriangle/> {String(item.profile_name)} has no active fields.</p>)}</div>:<p className="success-message"><CheckCircle2/>All active profiles have fields.</p>}</div><div className="surface"><h2>Field usage</h2><div className="compact-list">{usage.map((item)=><div key={String(item.id)}><span><strong>{String(item.field_key)}</strong><small>{String(item.field_label)}</small></span><strong>{String(item.profile_count)} profiles</strong></div>)}</div></div></section></>;
}
