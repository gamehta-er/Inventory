import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CirclePlus,
  Download,
  FilePenLine,
  FileSpreadsheet,
  FileUp,
  Link2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, download } from '../api';
import { PageHeader } from '../components/PageHeader';
import { useAppState } from '../state/AppState';
import type {
  FieldDefinition,
  ImportIssue,
  ImportMode,
  ImportRow,
  ImportSession,
  ImportSessionSummary,
} from '../types';

const closedStatuses = new Set(['COMPLETED', 'CANCELLED']);

function humanStatus(status: string): string {
  return status.toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not provided';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function displayFieldValue(field: FieldDefinition, value: unknown): string {
  if ((field.dataType === 'lookup' || field.dataType === 'entity') && value !== null && value !== undefined && value !== '') {
    const normalized = String(value).trim().toLocaleLowerCase();
    const option = field.options.find((candidate) => String(candidate.id) === String(value)
      || candidate.value.trim().toLocaleLowerCase() === normalized
      || candidate.label.trim().toLocaleLowerCase() === normalized);
    if (option) return option.label;
  }
  return displayValue(value);
}

function rawRowValues(session: ImportSession, row: ImportRow): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const header of session.headers) {
    if (header.fieldKey) values[header.fieldKey] = row.source_values[String(header.sourceIndex)] ?? '';
  }
  return { ...values, ...row.corrected_values };
}

function editableRowValues(session: ImportSession, row: ImportRow): Record<string, unknown> {
  const values = rawRowValues(session, row);
  if (session.mode !== 'UPDATE') return values;

  const mappedFields = new Set(session.headers.flatMap((header) => header.fieldKey ? [header.fieldKey] : []));
  for (const field of session.fields) {
    if (mappedFields.has(field.fieldKey) || Object.prototype.hasOwnProperty.call(row.corrected_values, field.fieldKey)) continue;
    values[field.fieldKey] = row.after_values?.[field.fieldKey] ?? row.before_values?.[field.fieldKey] ?? '';
  }
  return values;
}

export function ImportIssueCard({
  issue,
  canApproveLookups,
  busy = false,
  onCorrect,
  onBulkCorrect,
  onApprove,
  onRepair,
}: {
  issue: ImportIssue;
  canApproveLookups: boolean;
  busy?: boolean;
  onCorrect?: (value: string) => void;
  onBulkCorrect?: (value: string) => void;
  onApprove?: (reason: string) => void;
  onRepair?: () => void;
}) {
  const approvedValues = issue.approvedValues ?? [];
  const suggested = issue.suggestedValues ?? [];
  const [showValues, setShowValues] = useState(false);
  const [showApproval, setShowApproval] = useState(false);
  const [reason, setReason] = useState('');
  const sourceValue = issue.sourceValue?.trim() ?? '';
  const isControlled = issue.code === 'LOOKUP_VALUE_UNRECOGNIZED'
    || issue.code === 'PROFILE_LOOKUP_MISSING'
    || ['LOCATION_NOT_RECOGNIZED', 'OWNER_NOT_RECOGNIZED', 'VENDOR_NOT_RECOGNIZED'].includes(issue.code);
  const canAdd = (issue.code === 'LOOKUP_VALUE_UNRECOGNIZED' || issue.code === 'VENDOR_NOT_RECOGNIZED')
    && Boolean(sourceValue)
    && canApproveLookups;

  return <li className={`import-issue import-issue--${issue.severity.toLowerCase()}`}>
    {issue.severity === 'WARNING' ? <TriangleAlert aria-hidden size={18}/> : <XCircle aria-hidden size={18}/>}
    <div className="import-issue__content">
      <div className="import-issue__heading">
        <strong>{issue.fieldLabel ?? issue.fieldKey ?? 'Import value'}</strong>
        <span>{issue.severity === 'ERROR' ? 'Blocking error' : issue.severity === 'CONFIGURATION' ? 'Configuration error' : humanStatus(issue.severity)}</span>
      </div>
      {isControlled && <p className="import-issue__rejected"><span>CSV value</span><b>{sourceValue || 'Empty value'}</b></p>}
      <p>{issue.message}</p>
      {isControlled && <p className="import-issue__explanation">Capitalization and configured aliases are matched automatically. This value is genuinely outside the active controlled list.</p>}

      {issue.code === 'PROFILE_LOOKUP_MISSING' ? <div className="import-issue__actions">
        <button className="button" onClick={onRepair} type="button"><Settings2 size={16}/>Repair Profile</button>
      </div> : isControlled && <>
        <button className="button button--quiet import-issue__toggle" onClick={() => setShowValues((current) => !current)} type="button">
          {showValues ? 'Hide approved values' : `View approved values (${approvedValues.length})`}
        </button>
        {showValues && <div className="import-issue__approved">
          <span>Use an approved value</span>
          {approvedValues.length ? <div className="import-issue__values">
            {approvedValues.map((option) => <div className="import-approved-value" key={option.id}>
              <button disabled={busy} onClick={() => onCorrect?.(option.label)} type="button">{option.label}</button>
              {onBulkCorrect && <button className="button--quiet" disabled={busy} onClick={() => onBulkCorrect(option.label)} type="button">Use for all matches</button>}
            </div>)}
          </div> : <p className="import-issue__empty">No approved values are configured for this field.</p>}
        </div>}
        {!showValues && suggested.length > 0 && <div className="import-suggestions"><span>Closest matches</span>{suggested.map((value) => <button disabled={busy} key={value} onClick={() => onCorrect?.(value)} type="button">{value}</button>)}</div>}
        {canAdd && <div className="import-issue__approval">
          <button className="button import-issue__action" disabled={busy} onClick={() => setShowApproval((current) => !current)} type="button"><CirclePlus size={16}/>Add As New Value</button>
          {showApproval && <div className="import-issue__approval-form">
            <p>Add <strong>{sourceValue}</strong> to {issue.lookupName ?? issue.fieldLabel}. Every matching row will revalidate automatically.</p>
            <label className="field"><span className="field__label">Reason *</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this an approved operational value?"/></label>
            <button className="button button--primary" disabled={busy || reason.trim().length < 3} onClick={() => onApprove?.(reason.trim())} type="button">Add Value And Revalidate</button>
          </div>}
        </div>}
        {!canApproveLookups && sourceValue && <small className="import-issue__admin-note">A Super User or Privileged Administrator can add a valid controlled value from this review.</small>}
        {issue.adminRoute && issue.code !== 'VENDOR_NOT_RECOGNIZED' && <button className="button button--quiet import-issue__action" onClick={onRepair} type="button"><Settings2 size={16}/>Manage Approved Values</button>}
      </>}

      <div className="import-issue__step"><FilePenLine aria-hidden size={17}/><span>Correct this staged row here, or correct the source CSV and upload it again.</span></div>
    </div>
  </li>;
}

function MappingPanel({ session, busy, onSave }: { session: ImportSession; busy: boolean; onSave(mappings: Array<{ sourceIndex: number; fieldKey?: string; ignored?: boolean }>): void }) {
  const [choices, setChoices] = useState<Record<number, string>>(() => Object.fromEntries(session.headers.map((header) => [header.sourceIndex, header.fieldKey ?? (header.ignored ? '__ignore' : '')])));
  useEffect(() => setChoices(Object.fromEntries(session.headers.map((header) => [header.sourceIndex, header.fieldKey ?? (header.ignored ? '__ignore' : '')]))), [session]);
  const duplicateSelections = Object.values(choices).filter((value) => value && value !== '__ignore').filter((value, index, all) => all.indexOf(value) !== index);
  const undecided = session.headers.filter((header) => !choices[header.sourceIndex]);

  return <section className="import-mapping">
    <div className="import-step-heading"><div><span className="eyebrow">Column mapping</span><h2>Confirm where every CSV column belongs</h2><p>Automatic matches are preselected. Unknown columns must be mapped or explicitly ignored.</p></div><span className="step-number">2 of 3</span></div>
    {session.mappingIssues.length > 0 && <div className="mapping-issues">{session.mappingIssues.map((issue, index) => <p className={`mapping-issue mapping-issue--${issue.severity.toLowerCase()}`} key={`${issue.code}-${index}`}><TriangleAlert size={16}/>{issue.message}</p>)}</div>}
    <div className="mapping-grid">
      {session.headers.map((header) => <label className="mapping-row" key={header.sourceIndex}>
        <span><small>CSV column {header.sourceIndex + 1}</small><strong>{header.header || 'Blank header'}</strong></span>
        <select value={choices[header.sourceIndex] ?? ''} onChange={(event) => setChoices((current) => ({ ...current, [header.sourceIndex]: event.target.value }))}>
          <option value="">Choose mapping</option>
          <option value="__ignore">Ignore this column</option>
          {session.fields.map((field) => <option key={field.id} value={field.fieldKey}>{field.label}{field.required ? ' *' : ''}</option>)}
        </select>
      </label>)}
    </div>
    <div className="import-sticky-actions"><span>{undecided.length ? `${undecided.length} column decision${undecided.length === 1 ? '' : 's'} remaining` : duplicateSelections.length ? 'A profile field is mapped more than once' : 'Every column has a decision'}</span><button className="button button--primary" disabled={busy || undecided.length > 0 || duplicateSelections.length > 0} onClick={() => onSave(session.headers.map((header) => {
      const choice = choices[header.sourceIndex];
      return choice === '__ignore' ? { sourceIndex: header.sourceIndex, ignored: true } : { sourceIndex: header.sourceIndex, fieldKey: choice };
    }))} type="button"><Check size={17}/>{busy ? 'Validating...' : 'Save Mapping And Validate'}</button></div>
  </section>;
}

function RowEditor({ session, row, busy, onSave, onCancel }: { session: ImportSession; row: ImportRow; busy: boolean; onSave(values: Record<string, unknown>): void; onCancel(): void }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => editableRowValues(session, row));
  return <div className="import-row-editor">
    <div className="form-grid">
      {session.fields.map((field) => <label className={`field ${field.dataType === 'long_text' ? 'field--wide' : ''}`} key={field.id}>
        <span className="field__label">{field.label}{field.required ? ' *' : ''}</span>
        {(field.dataType === 'lookup' || field.dataType === 'entity') && field.options.length > 0
          ? <select value={String(values[field.fieldKey] ?? '')} onChange={(event) => setValues((current) => ({ ...current, [field.fieldKey]: event.target.value }))}><option value="">Not provided</option>{field.options.map((option) => <option key={option.id} value={option.label}>{option.label}</option>)}</select>
          : field.dataType === 'long_text'
            ? <textarea value={String(values[field.fieldKey] ?? '')} onChange={(event) => setValues((current) => ({ ...current, [field.fieldKey]: event.target.value }))}/>
            : <input type={field.dataType === 'date' ? 'date' : field.dataType === 'number' ? 'number' : 'text'} value={String(values[field.fieldKey] ?? '')} onChange={(event) => setValues((current) => ({ ...current, [field.fieldKey]: event.target.value }))}/>} 
        <small>{field.helpText || field.definition}</small>
      </label>)}
    </div>
    <div className="form-actions"><button className="button button--primary" disabled={busy} onClick={() => onSave(values)} type="button"><Save size={16}/>Save And Revalidate</button><button className="button" onClick={onCancel} type="button">Cancel</button></div>
  </div>;
}

function ReviewPanel({ session, canApproveLookups, busy, busyIssue, onEdit, onToggle, onCorrect, onBulkCorrect, onApprove, onRepair }: {
  session: ImportSession;
  canApproveLookups: boolean;
  busy: boolean;
  busyIssue: string;
  onEdit(row: ImportRow, values: Record<string, unknown>): void;
  onToggle(row: ImportRow, included: boolean): void;
  onCorrect(row: ImportRow, issue: ImportIssue, value: string): void;
  onBulkCorrect(issue: ImportIssue, value: string): void;
  onApprove(issue: ImportIssue, reason: string): void;
  onRepair(issue: ImportIssue): void;
}) {
  const [editing, setEditing] = useState<string>();
  return <div className="import-rows">
    {session.rows.map((row) => <article className={`import-row import-row--${row.status.toLowerCase()} ${!row.included ? 'import-row--excluded' : ''}`} id={`import-row-${row.id}`} key={row.id}>
      <header><div><span className="eyebrow">CSV row {row.row_number}</span><h3>{displayValue(row.normalized_values.product_name ?? rawRowValues(session, row).product_name)}</h3></div><div className="import-row__header-actions"><span className={`status status--${row.status.toLowerCase()}`}>{humanStatus(row.status)}</span>{!closedStatuses.has(session.status) && <button className="button" onClick={() => setEditing(editing === row.id ? undefined : row.id)} type="button"><Pencil size={15}/>{editing === row.id ? 'Close Editor' : 'Edit Row'}</button>}</div></header>
      {editing === row.id && <RowEditor session={session} row={row} busy={busy} onSave={(values) => { onEdit(row, values); setEditing(undefined); }} onCancel={() => setEditing(undefined)}/>} 
      {session.mode === 'UPDATE' && row.before_values && <div className="import-diff"><strong>Proposed changes</strong><div>{session.fields.filter((field) => row.before_values?.[field.fieldKey] !== row.after_values?.[field.fieldKey]).map((field) => <span key={field.id}><b>{field.label}</b><s>{displayFieldValue(field, row.before_values?.[field.fieldKey])}</s><i aria-hidden>to</i><em className={row.after_values?.[field.fieldKey] == null ? 'will-clear' : ''}>{row.after_values?.[field.fieldKey] == null ? 'Will clear existing value' : displayFieldValue(field, row.after_values?.[field.fieldKey])}</em></span>)}</div></div>}
      <dl className="import-row__fields">{session.fields.map((field) => <div key={field.id}><dt>{field.label}{field.required ? ' *' : ''}</dt><dd>{displayFieldValue(field, row.normalized_values[field.fieldKey] ?? rawRowValues(session, row)[field.fieldKey])}</dd></div>)}</dl>
      {row.issues.length > 0 && <ul className="issue-list">{row.issues.map((issue, index) => <ImportIssueCard
        issue={issue}
        canApproveLookups={canApproveLookups}
        busy={busyIssue === `${row.id}:${issue.fieldKey}`}
        onCorrect={(value) => onCorrect(row, issue, value)}
        onBulkCorrect={issue.sourceValue ? (value) => onBulkCorrect(issue, value) : undefined}
        onApprove={(reason) => onApprove(issue, reason)}
        onRepair={() => onRepair(issue)}
        key={`${issue.fieldKey ?? issue.code}-${index}`}
      />)}</ul>}
      {!closedStatuses.has(session.status) && <footer className="import-row__footer"><button className="button button--quiet" disabled={busy} onClick={() => onToggle(row, !row.included)} type="button">{row.included ? <><Trash2 size={15}/>Exclude Row</> : <><RotateCcw size={15}/>Restore Row</>}</button></footer>}
    </article>)}
  </div>;
}

export function ImportPage() {
  const { session: appSession, notify, refreshSession, refreshRegistry, invalidateInventory } = useAppState();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSessionId = searchParams.get('session');
  const [profileId, setProfileId] = useState(appSession?.categories[0]?.profileId ?? 0);
  const [mode, setMode] = useState<ImportMode>('CREATE');
  const [file, setFile] = useState<File>();
  const [importSession, setImportSession] = useState<ImportSession>();
  const [recent, setRecent] = useState<ImportSessionSummary[]>([]);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyIssue, setBusyIssue] = useState('');
  const [error, setError] = useState('');
  const category = useMemo(() => appSession?.categories.find((item) => item.profileId === profileId), [appSession, profileId]);
  const canApproveLookups = Boolean(appSession?.permissions['import.lookup.resolve']);

  async function refreshRecent() {
    setRecent(await api.imports());
  }

  useEffect(() => {
    void refreshRecent().catch((failure: Error) => {
      setError(`Import sessions could not be loaded. ${failure.message}`);
    });
  }, []);
  useEffect(() => {
    const defaultProfileId = appSession?.categories[0]?.profileId;
    if (!profileId && defaultProfileId) setProfileId(defaultProfileId);
  }, [appSession?.categories, profileId]);
  useEffect(() => {
    if (!requestedSessionId) return;
    setBusy(true);
    api.importSession(requestedSessionId).then((next) => { setImportSession(next); setProfileId(next.profileId); setMode(next.mode); }).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false));
  }, [requestedSessionId]);

  function useSession(next?: ImportSession) {
    setImportSession(next);
    setError('');
    if (next) setSearchParams({ session: next.id });
    else setSearchParams({});
  }

  async function run(action: () => Promise<ImportSession>, success?: string) {
    setBusy(true); setError('');
    try {
      const next = await action();
      useSession(next);
      await refreshRecent();
      if (success) notify(success);
    } catch (failure) {
      setError((failure as Error).message);
      notify((failure as Error).message, 'error');
    } finally { setBusy(false); }
  }

  async function start() {
    await run(() => api.createImportSession(profileId, mode));
  }

  async function upload() {
    if (!importSession || !file) { setError('Choose a completed CSV file.'); return; }
    await run(() => api.uploadImportFile(importSession.id, file), 'CSV staged. Confirm the column mapping before validation.');
  }

  async function commit() {
    if (!importSession) return;
    setBusy(true); setError('');
    try {
      const result = await api.commitImport(importSession.id);
      useSession(result.session);
      invalidateInventory();
      await Promise.all([refreshSession(), refreshRegistry(), refreshRecent()]);
      notify(`${result.session.results.length} asset${result.session.results.length === 1 ? '' : 's'} ${result.session.mode === 'CREATE' ? 'created' : 'updated'}. All inventory views are refreshed.`);
    } catch (failure) {
      setError((failure as Error).message);
      notify((failure as Error).message, 'error');
    } finally { setBusy(false); }
  }

  async function correctRow(row: ImportRow, issue: ImportIssue, value: string) {
    if (!importSession || !issue.fieldKey) return;
    setBusyIssue(`${row.id}:${issue.fieldKey}`);
    try { useSession(await api.updateImportRow(importSession.id, row.id, { fieldKey: issue.fieldKey, value })); await refreshRecent(); notify(`${issue.fieldLabel ?? issue.fieldKey} corrected and all rows revalidated.`); }
    catch (failure) { notify((failure as Error).message, 'error'); setError((failure as Error).message); }
    finally { setBusyIssue(''); }
  }

  async function bulkCorrect(issue: ImportIssue, value: string) {
    if (!importSession || !issue.fieldKey || issue.sourceValue === undefined) return;
    setBusyIssue(`bulk:${issue.fieldKey}`);
    try { const result = await api.bulkCorrectImport(importSession.id, issue.fieldKey, issue.sourceValue, value); useSession(result.session); await refreshRecent(); notify(`${result.changed} matching row${result.changed === 1 ? '' : 's'} corrected and revalidated.`); }
    catch (failure) { notify((failure as Error).message, 'error'); setError((failure as Error).message); }
    finally { setBusyIssue(''); }
  }

  async function approveLookup(issue: ImportIssue, reason: string) {
    if (!importSession || !issue.fieldKey || !issue.sourceValue) return;
    setBusyIssue(`lookup:${issue.fieldKey}`);
    try { useSession(await api.addImportLookup(importSession.id, issue.fieldKey, issue.sourceValue, reason)); await Promise.all([refreshRegistry(), refreshRecent()]); notify(`"${issue.sourceValue}" was added and every matching row was revalidated.`); }
    catch (failure) { notify((failure as Error).message, 'error'); setError((failure as Error).message); }
    finally { setBusyIssue(''); }
  }

  const includedRows = importSession?.rows.filter((row) => row.included).length ?? 0;
  const currentStep = !importSession ? 0 : importSession.status === 'DRAFT' ? 1 : importSession.status === 'MAPPING' ? 2 : 3;

  return <>
    <PageHeader eyebrow="Import" title="Bring inventory in with confidence." description="Create or update multiple assets through a resumable, validated session. Nothing changes in inventory until the complete included batch is ready." />
    <div className="import-shell">
      <aside className="import-sidebar surface">
        <div className="import-mode-heading"><span className="eyebrow">Import sessions</span>{importSession && <button className="icon-button" aria-label="Start a new import" onClick={() => useSession(undefined)}><CirclePlus size={18}/></button>}</div>
        <div className="import-progress" aria-label="Import progress"><span className={currentStep >= 1 ? 'is-active' : ''}>1 Upload</span><span className={currentStep >= 2 ? 'is-active' : ''}>2 Map</span><span className={currentStep >= 3 ? 'is-active' : ''}>3 Review</span></div>
        <div className="recent-list"><h3>Recent sessions</h3>{recent.length ? recent.map((item) => <button className={item.id === importSession?.id ? 'is-active' : ''} key={item.id} onClick={() => setSearchParams({ session: item.id })}><span>{item.file_name ?? `${item.category_name} ${item.mode === 'CREATE' ? 'create' : 'update'}`}</span><small>{item.total_rows} rows - {humanStatus(item.status)}</small></button>) : <p>No import sessions yet.</p>}</div>
      </aside>

      <main className="import-workspace surface">
        {error && <div className="form-alert" role="alert"><TriangleAlert size={18}/><span>{error}</span></div>}
        {!importSession ? <section className="import-start">
          <div className="import-step-heading"><div><span className="eyebrow">New session</span><h2>Choose the inventory contract</h2><p>The category profile defines the generated template, mappings, validation, and allowed values.</p></div><span className="step-number">Start</span></div>
          <div className="import-start-grid">
            <label className="field"><span className="field__label">Asset category *</span><select value={profileId} onChange={(event) => setProfileId(Number(event.target.value))}>{appSession?.categories.map((item) => <option key={item.id} value={item.profileId}>{item.name}</option>)}</select></label>
            <fieldset className="mode-picker"><legend>Import mode *</legend><button className={mode === 'CREATE' ? 'is-active' : ''} onClick={() => setMode('CREATE')} type="button"><CirclePlus/><span><strong>Create Assets</strong><small>New serials only</small></span></button><button className={mode === 'UPDATE' ? 'is-active' : ''} onClick={() => setMode('UPDATE')} type="button"><RefreshCw/><span><strong>Update Existing</strong><small>Exact Serial # match</small></span></button></fieldset>
          </div>
          <div className="import-contract-summary"><FileSpreadsheet size={22}/><div><strong>{category?.name ?? 'Profile'} contract</strong><p>The current profile and controlled values are pinned when this session starts. Required blanks block; optional blanks are accepted.</p></div><button className="button" onClick={() => setInstructionsOpen((current) => !current)} type="button">{instructionsOpen ? 'Hide Instructions' : 'View Instructions'}</button></div>
          {instructionsOpen && <div className="import-instructions"><h3>How this import works</h3><ol><li>Start the session and download its profile-generated CSV.</li><li>Upload one or many rows. Quoted commas, BOM, and Windows line endings are supported.</li><li>Confirm every column mapping. Unknown columns may be mapped or ignored.</li><li>Resolve blocking issues in the staged rows. Warnings do not stop the batch.</li><li>Commit only when every included row is ready. The batch is all-or-nothing.</li></ol><p><strong>Update mode:</strong> blank optional mapped cells clear existing values. Blank required cells always block.</p></div>}
          <div className="form-actions"><button className="button button--primary" disabled={busy || !profileId} onClick={start} type="button">Create Import Session</button></div>
        </section> : <>
          <header className="import-session-header"><div><button className="text-button" onClick={() => useSession(undefined)} type="button"><ArrowLeft size={15}/>All sessions</button><span className="eyebrow">{importSession.categoryName} - {importSession.mode === 'CREATE' ? 'Create Assets' : 'Update Existing'}</span><h2>{importSession.fileName ?? 'Upload source CSV'}</h2><p>Profile version {importSession.profileVersion} - Created by {importSession.createdBy}</p></div><span className={`status status--${importSession.status.toLowerCase()}`}>{humanStatus(importSession.status)}</span></header>

          {importSession.status === 'DRAFT' && <section className="import-upload-step">
            <div className="import-step-heading"><div><span className="eyebrow">Source file</span><h2>Use the generated profile template</h2><p>The server stores the original CSV with this session so you can leave and resume safely.</p></div><span className="step-number">1 of 3</span></div>
            <div className="import-template-actions"><button className="button" onClick={() => download(api.importTemplateUrl(importSession.profileId), `${importSession.categoryKey.toLowerCase()}-import.csv`)} type="button"><Download size={17}/>Download Current CSV Template</button><button className="button" onClick={() => setInstructionsOpen((current) => !current)} type="button">{instructionsOpen ? 'Hide Field Guide' : 'View Field Guide'}</button></div>
            {instructionsOpen && <div className="field-guide">{importSession.fields.map((field) => <article key={field.id}><strong>{field.label}{field.required ? ' *' : ''}</strong><span>{field.fieldKey}</span><p>{field.definition || field.helpText}</p><small>{field.required ? 'Required' : 'Optional'} - {humanStatus(field.dataType)}</small></article>)}</div>}
            <label className="file-picker"><FileUp/><span><strong>{file?.name ?? 'Choose completed CSV'}</strong><small>{file ? `${Math.ceil(file.size / 1024)} KB` : 'One or many rows, up to 10 MB'}</small></span><input type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files?.[0]); setError(''); }}/></label>
            <div className="form-actions"><button className="button button--primary" disabled={busy || !file} onClick={upload} type="button"><FileUp size={17}/>{busy ? 'Uploading...' : 'Upload And Map Columns'}</button></div>
          </section>}

          {importSession.status === 'MAPPING' && <MappingPanel session={importSession} busy={busy} onSave={(mappings) => void run(() => api.saveImportMappings(importSession.id, mappings), 'Column mapping saved. The complete batch was validated.')}/>} 

          {!['DRAFT', 'MAPPING'].includes(importSession.status) && <section className="import-review">
            <div className="import-step-heading"><div><span className="eyebrow">Batch review</span><h2>{importSession.totalRows} source row{importSession.totalRows === 1 ? '' : 's'}, {includedRows} included</h2><p>Warnings can commit. Blocking and configuration errors must be resolved first.</p></div><span className="step-number">3 of 3</span></div>
            <div className="batch-kpis"><span><strong>{importSession.validRows}</strong>Valid</span><span><strong>{importSession.warningRows}</strong>Warnings</span><span><strong>{importSession.invalidRows}</strong>Blocked</span><span><strong>{importSession.rows.filter((row) => !row.included).length}</strong>Excluded</span></div>
            {importSession.failureMessage && <p className="form-alert">{importSession.failureMessage}</p>}
            {importSession.status === 'COMPLETED' ? <div className="import-complete"><CheckCircle2 size={34}/><div><h3>Import completed</h3><p>{importSession.results.length} asset{importSession.results.length === 1 ? '' : 's'} committed. Inventory, reports, activity, and category totals have refreshed.</p></div><div className="import-result-links">{importSession.results.map((result) => <button className="button" key={result.import_row_id} onClick={() => navigate(`/assets/${Number(result.asset_id)}`, { state: { backgroundLocation: location } })} type="button"><Link2 size={15}/>{result.product_name} - {result.serial_number}</button>)}</div></div> : <>
              {importSession.invalidRows > 0 && <div className="import-correction-summary"><TriangleAlert size={21}/><div><strong>{importSession.invalidRows} included row{importSession.invalidRows === 1 ? '' : 's'} need attention</strong><p>Each issue below links to its field and offers the corrections permitted by your role.</p></div></div>}
              <div className="import-review-actions"><button className="button" disabled={busy} onClick={() => void run(() => api.validateImport(importSession.id), 'Session revalidated against the current profile and controlled values.')} type="button"><RefreshCw size={16}/>Revalidate</button><button className="button" onClick={() => download(api.importValidationUrl(importSession.id), `${importSession.fileName ?? 'import'}-validation.csv`)} type="button"><Download size={16}/>Validation Report</button><button className="button button--danger" disabled={busy} onClick={() => void run(() => api.cancelImport(importSession.id), 'Import session cancelled.')} type="button">Cancel Session</button></div>
              <ReviewPanel
                session={importSession}
                canApproveLookups={canApproveLookups}
                busy={busy}
                busyIssue={busyIssue}
                onEdit={(row, values) => void run(() => api.updateImportRow(importSession.id, row.id, { values }), `CSV row ${row.row_number} saved and revalidated.`)}
                onToggle={(row, included) => void run(() => api.updateImportRow(importSession.id, row.id, { included }), `CSV row ${row.row_number} ${included ? 'restored' : 'excluded'}.`)}
                onCorrect={(row, issue, value) => void correctRow(row, issue, value)}
                onBulkCorrect={(issue, value) => void bulkCorrect(issue, value)}
                onApprove={(issue, reason) => void approveLookup(issue, reason)}
                onRepair={(issue) => navigate(issue.adminRoute ?? '/admin')}
              />
              <div className="import-sticky-actions"><span>{importSession.status === 'READY' ? `${includedRows} included rows will commit in one transaction` : 'Resolve all blocking and configuration errors before commit'}</span><button className="button button--primary" disabled={busy || importSession.status !== 'READY'} onClick={commit} type="button"><CheckCircle2 size={17}/>{busy ? 'Committing...' : `Commit ${includedRows} ${importSession.mode === 'CREATE' ? 'New' : 'Updated'} Assets`}</button></div>
            </>}
          </section>}
        </>}
      </main>
    </div>
  </>;
}
