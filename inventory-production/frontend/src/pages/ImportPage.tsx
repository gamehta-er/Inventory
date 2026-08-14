import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CirclePlus,
  Download,
  Eye,
  FilePenLine,
  FileSpreadsheet,
  FileUp,
  Link2,
  ListFilter,
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
import { Overlay } from '../components/Overlay';
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

function editableFieldValue(field: FieldDefinition, value: unknown): unknown {
  if ((field.dataType === 'lookup' || field.dataType === 'entity') && value !== null && value !== undefined && value !== '') {
    const normalized = String(value).trim().toLocaleLowerCase();
    const option = field.options.find((candidate) => String(candidate.id) === String(value)
      || candidate.value.trim().toLocaleLowerCase() === normalized
      || candidate.label.trim().toLocaleLowerCase() === normalized);
    return option?.label ?? value;
  }
  return value ?? '';
}

export function editableRowValues(session: ImportSession, row: ImportRow): Record<string, unknown> {
  const values = rawRowValues(session, row);
  for (const field of session.fields) {
    if (Object.prototype.hasOwnProperty.call(values, field.fieldKey)) values[field.fieldKey] = editableFieldValue(field, values[field.fieldKey]);
  }
  if (session.mode !== 'UPDATE') return values;

  const mappedFields = new Set(session.headers.flatMap((header) => header.fieldKey ? [header.fieldKey] : []));
  for (const field of session.fields) {
    if (mappedFields.has(field.fieldKey) || Object.prototype.hasOwnProperty.call(row.corrected_values, field.fieldKey)) continue;
    values[field.fieldKey] = editableFieldValue(field, row.after_values?.[field.fieldKey] ?? row.before_values?.[field.fieldKey]);
  }
  return values;
}

export function changedImportValues(initial: Record<string, unknown>, current: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(current).filter(([fieldKey, value]) => String(value ?? '') !== String(initial[fieldKey] ?? '')));
}

export function ImportIssueCard({
  issue,
  canApproveLookups,
  busy = false,
  onCorrect,
  onBulkCorrect,
  onApprove,
  onRepair,
  anchorId,
}: {
  issue: ImportIssue;
  canApproveLookups: boolean;
  busy?: boolean;
  onCorrect?: (value: string) => void;
  onBulkCorrect?: (value: string) => void;
  onApprove?: (reason: string) => void;
  onRepair?: () => void;
  anchorId?: string;
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

  return <li className={`import-issue import-issue--${issue.severity.toLowerCase()}`} id={anchorId} tabIndex={-1}>
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
    <div className="import-step-heading"><div><span className="eyebrow">Column decisions</span><h2>Review only the columns that need your judgment</h2><p>Confident matches are already selected. Unknown columns must be mapped or explicitly ignored.</p></div><span className="step-number">Only when needed</span></div>
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
  const [initialValues] = useState<Record<string, unknown>>(() => editableRowValues(session, row));
  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const changes = useMemo(() => changedImportValues(initialValues, values), [initialValues, values]);
  const hasChanges = Object.keys(changes).length > 0;
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
    <div className="form-actions"><button className="button button--primary" disabled={busy || !hasChanges} onClick={() => onSave(changes)} type="button"><Save size={16}/>Save Changes And Revalidate</button><button className="button" onClick={onCancel} type="button">Cancel</button></div>
  </div>;
}

function CsvFilePicker({ file, onChange }: { file?: File; onChange(file?: File): void }) {
  const [dragging, setDragging] = useState(false);
  function choose(candidate?: File) {
    if (!candidate || !/\.csv$/i.test(candidate.name)) return onChange(undefined);
    onChange(candidate);
  }
  return <label
    className={`file-picker file-picker--smart ${dragging ? 'is-dragging' : ''}`}
    onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
    onDragLeave={() => setDragging(false)}
    onDragOver={(event) => event.preventDefault()}
    onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files[0]); }}
  >
    <FileUp aria-hidden/>
    <span><strong>{file?.name ?? 'Drop a completed CSV here'}</strong><small>{file ? `${Math.ceil(file.size / 1024)} KB ready to analyze` : 'or choose a file - one or many rows, up to 10 MB'}</small></span>
    <b>{file ? 'Change file' : 'Choose CSV'}</b>
    <input type="file" accept=".csv,text/csv" onChange={(event) => choose(event.target.files?.[0])}/>
  </label>;
}

type ReviewFilter = 'ALL' | 'ACTION' | 'WARNING' | 'READY' | 'EXCLUDED';

function reviewFilterLabel(filter: ReviewFilter): string {
  return ({ ALL: 'All rows', ACTION: 'Needs action', WARNING: 'Warnings', READY: 'Ready', EXCLUDED: 'Excluded' })[filter];
}

function rowMatchesFilter(row: ImportRow, filter: ReviewFilter): boolean {
  if (filter === 'ACTION') return row.included && ['BLOCKED', 'CONFIGURATION_ERROR'].includes(row.status);
  if (filter === 'WARNING') return row.included && row.status === 'WARNING';
  if (filter === 'READY') return row.included && ['VALID', 'COMMITTED'].includes(row.status);
  if (filter === 'EXCLUDED') return !row.included || row.status === 'EXCLUDED';
  return true;
}

function issueGroupKey(issue: ImportIssue): string {
  return [issue.severity, issue.code, issue.fieldKey ?? '', issue.sourceValue?.trim().toLocaleLowerCase() ?? ''].join('|');
}

function ReviewPanel({ session, canApproveLookups, busy, busyIssue, selectedRowId, onOpenRow, onCloseRow, onEdit, onToggle, onCorrect, onBulkCorrect, onApprove, onRepair }: {
  session: ImportSession;
  canApproveLookups: boolean;
  busy: boolean;
  busyIssue: string;
  selectedRowId?: string | null;
  onOpenRow(row: ImportRow): void;
  onCloseRow(): void;
  onEdit(row: ImportRow, values: Record<string, unknown>): void;
  onToggle(row: ImportRow, included: boolean): void;
  onCorrect(row: ImportRow, issue: ImportIssue, value: string): void;
  onBulkCorrect(issue: ImportIssue, value: string): void;
  onApprove(issue: ImportIssue, reason: string): void;
  onRepair(issue: ImportIssue): void;
}) {
  const [filter, setFilter] = useState<ReviewFilter>(session.invalidRows > 0 ? 'ACTION' : 'ALL');
  const [editing, setEditing] = useState(false);
  const selectedRow = session.rows.find((row) => row.id === selectedRowId);
  const rows = session.rows.filter((row) => rowMatchesFilter(row, filter));
  const issueGroups = useMemo(() => {
    const groups = new Map<string, { issue: ImportIssue; rows: ImportRow[] }>();
    for (const row of session.rows.filter((item) => item.included)) {
      for (const issue of row.issues) {
        const key = issueGroupKey(issue);
        const current = groups.get(key);
        if (current) current.rows.push(row);
        else groups.set(key, { issue, rows: [row] });
      }
    }
    return [...groups.values()].sort((left, right) => {
      const priority = { CONFIGURATION: 0, ERROR: 1, WARNING: 2 };
      return priority[left.issue.severity] - priority[right.issue.severity] || right.rows.length - left.rows.length;
    });
  }, [session.rows]);
  const counts: Record<ReviewFilter, number> = {
    ALL: session.rows.length,
    ACTION: session.rows.filter((row) => rowMatchesFilter(row, 'ACTION')).length,
    WARNING: session.rows.filter((row) => rowMatchesFilter(row, 'WARNING')).length,
    READY: session.rows.filter((row) => rowMatchesFilter(row, 'READY')).length,
    EXCLUDED: session.rows.filter((row) => rowMatchesFilter(row, 'EXCLUDED')).length,
  };

  return <>
    {issueGroups.length > 0 && <section className="import-exception-center" aria-labelledby="exception-center-title">
      <header><div><span className="eyebrow">Exception center</span><h3 id="exception-center-title">Resolve repeated issues once</h3><p>Identical source values are grouped across the batch. Approved corrections can be applied to every matching row.</p></div><span className="status status--needs_attention">{issueGroups.length} issue group{issueGroups.length === 1 ? '' : 's'}</span></header>
      <div className="import-exception-groups">{issueGroups.map((group) => <article className="import-exception-group" key={issueGroupKey(group.issue)}>
        <div className="import-exception-group__meta"><span>{group.rows.length} affected row{group.rows.length === 1 ? '' : 's'}</span><button className="text-button" onClick={() => onOpenRow(group.rows[0]!)} type="button">View first row</button></div>
        <ul className="issue-list"><ImportIssueCard
          issue={group.issue}
          canApproveLookups={canApproveLookups}
          busy={busyIssue === `bulk:${group.issue.fieldKey}` || busyIssue === `lookup:${group.issue.fieldKey}`}
          onCorrect={(value) => group.rows.length > 1 ? onBulkCorrect(group.issue, value) : onCorrect(group.rows[0]!, group.issue, value)}
          onBulkCorrect={group.rows.length > 1 && group.issue.sourceValue ? (value) => onBulkCorrect(group.issue, value) : undefined}
          onApprove={(reason) => onApprove(group.issue, reason)}
          onRepair={() => onRepair(group.issue)}
        /></ul>
      </article>)}</div>
    </section>}

    <section className="import-row-review" aria-labelledby="row-review-title">
      <header><div><span className="eyebrow">Row review</span><h3 id="row-review-title">Confirm the staged inventory</h3></div><ListFilter aria-hidden size={18}/></header>
      <div className="import-review-filters" role="tablist" aria-label="Filter import rows">{(['ALL', 'ACTION', 'WARNING', 'READY', 'EXCLUDED'] as ReviewFilter[]).map((item) => <button aria-selected={filter === item} className={filter === item ? 'is-active' : ''} key={item} onClick={() => setFilter(item)} role="tab" type="button"><span>{reviewFilterLabel(item)}</span><b>{counts[item]}</b></button>)}</div>
      <div className="import-table-wrap"><table className="import-table">
        <thead><tr><th>CSV row</th><th>Product</th><th>Serial #</th><th>Model #</th><th>Asset status</th><th>Review result</th><th>Issues</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{rows.map((row) => {
          const values = { ...rawRowValues(session, row), ...row.normalized_values };
          return <tr className={!row.included ? 'is-excluded' : ''} id={`import-row-${row.id}`} key={row.id}>
            <td>{row.row_number}</td><td><strong>{displayValue(values.product_name)}</strong></td><td>{displayValue(values.serial_number)}</td><td>{displayValue(values.model_number)}</td><td>{displayValue(values.asset_status)}</td><td><span className={`status status--${row.status.toLowerCase()}`}>{humanStatus(row.status)}</span></td><td>{row.issues.length ? `${row.issues.length} issue${row.issues.length === 1 ? '' : 's'}` : 'No issues'}</td><td><button className="button button--quiet" onClick={() => onOpenRow(row)} type="button"><Eye size={15}/>Review</button></td>
          </tr>;
        })}</tbody>
      </table>{rows.length === 0 && <div className="import-table-empty"><CheckCircle2 size={22}/><strong>No rows in this view</strong><span>Choose another filter to continue reviewing the batch.</span></div>}</div>
    </section>

    {selectedRow && <Overlay
      title={`CSV row ${selectedRow.row_number}: ${displayValue(selectedRow.normalized_values.product_name ?? rawRowValues(session, selectedRow).product_name)}`}
      subtitle={`${humanStatus(selectedRow.status)} - ${selectedRow.issues.length} issue${selectedRow.issues.length === 1 ? '' : 's'}`}
      onClose={() => { setEditing(false); onCloseRow(); }}
      size="workspace"
      footer={!closedStatuses.has(session.status) ? <><button className="button button--quiet" disabled={busy} onClick={() => onToggle(selectedRow, !selectedRow.included)} type="button">{selectedRow.included ? <><Trash2 size={15}/>Exclude Row</> : <><RotateCcw size={15}/>Restore Row</>}</button><button className="button button--primary" onClick={() => setEditing((current) => !current)} type="button"><Pencil size={15}/>{editing ? 'Close Editor' : 'Edit Row'}</button></> : undefined}
    >
      {editing && <RowEditor session={session} row={selectedRow} busy={busy} onSave={(values) => { onEdit(selectedRow, values); setEditing(false); }} onCancel={() => setEditing(false)}/>}
      {session.mode === 'UPDATE' && selectedRow.before_values && <div className="import-diff"><strong>Proposed changes</strong><div>{session.fields.filter((field) => selectedRow.before_values?.[field.fieldKey] !== selectedRow.after_values?.[field.fieldKey]).map((field) => <span key={field.id}><b>{field.label}</b><s>{displayFieldValue(field, selectedRow.before_values?.[field.fieldKey])}</s><i aria-hidden>to</i><em className={selectedRow.after_values?.[field.fieldKey] == null ? 'will-clear' : ''}>{selectedRow.after_values?.[field.fieldKey] == null ? 'Will clear existing value' : displayFieldValue(field, selectedRow.after_values?.[field.fieldKey])}</em></span>)}</div></div>}
      <dl className="import-row__fields">{session.fields.map((field) => <div key={field.id}><dt>{field.label}{field.required ? ' *' : ''}</dt><dd>{displayFieldValue(field, selectedRow.normalized_values[field.fieldKey] ?? rawRowValues(session, selectedRow)[field.fieldKey])}</dd></div>)}</dl>
      {selectedRow.issues.length > 0 && <ul className="issue-list">{selectedRow.issues.map((issue, index) => <ImportIssueCard anchorId={`import-row-${selectedRow.id}-field-${issue.fieldKey ?? issue.code}`} issue={issue} canApproveLookups={canApproveLookups} busy={busyIssue === `${selectedRow.id}:${issue.fieldKey}`} onCorrect={(value) => onCorrect(selectedRow, issue, value)} onBulkCorrect={issue.sourceValue ? (value) => onBulkCorrect(issue, value) : undefined} onApprove={(reason) => onApprove(issue, reason)} onRepair={() => onRepair(issue)} key={`${issue.fieldKey ?? issue.code}-${index}`}/>)}</ul>}
    </Overlay>}
  </>;
}

export function ImportPage() {
  const { session: appSession, notify, refreshSession, refreshRegistry, invalidateInventory } = useAppState();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSessionId = searchParams.get('session');
  const requestedRowId = searchParams.get('row');
  const requestedFieldKey = searchParams.get('field');
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
  useEffect(() => {
    if (!importSession || !requestedRowId) return;
    const issueId = requestedFieldKey ? `import-row-${requestedRowId}-field-${requestedFieldKey}` : `import-row-${requestedRowId}`;
    const target = document.getElementById(issueId) ?? document.getElementById(`import-row-${requestedRowId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
  }, [importSession, requestedRowId, requestedFieldKey]);

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
    if (!file) { setError('Choose a completed CSV file.'); return; }
    setBusy(true); setError('');
    try {
      const draft = await api.createImportSession(profileId, mode);
      useSession(draft);
      const next = await api.uploadImportFile(draft.id, file);
      useSession(next);
      await refreshRecent();
      notify(next.status === 'MAPPING'
        ? 'CSV analyzed. Review the columns that could not be matched safely.'
        : `CSV analyzed automatically. ${next.invalidRows ? `${next.invalidRows} row${next.invalidRows === 1 ? '' : 's'} need attention.` : 'The batch is ready for review.'}`);
    } catch (failure) {
      setError((failure as Error).message);
      notify((failure as Error).message, 'error');
    } finally { setBusy(false); }
  }

  async function upload() {
    if (!importSession || !file) { setError('Choose a completed CSV file.'); return; }
    await run(async () => {
      const next = await api.uploadImportFile(importSession.id, file);
      return next;
    }, 'CSV analyzed. Confident columns were mapped automatically.');
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
  const firstIssue = importSession?.rows.flatMap((row) => row.issues.map((issue) => ({ row, issue })))[0];
  const activeSessions = recent.filter((item) => !closedStatuses.has(item.status)).length;
  const attentionSessions = recent.filter((item) => ['MAPPING', 'NEEDS_ATTENTION', 'NEEDS_REVALIDATION', 'FAILED'].includes(item.status)).length;

  return <>
    <PageHeader eyebrow="Smart Import" title="Bring inventory in with confidence." description="Choose a CSV and let the profile contract handle mapping and validation. You only stop where a decision is genuinely required." />
    <div className="import-shell">
      <aside className="import-sidebar surface">
        <div className="import-mode-heading"><span className="eyebrow">Import sessions</span>{importSession && <button className="icon-button" aria-label="Start a new import" onClick={() => useSession(undefined)}><CirclePlus size={18}/></button>}</div>
        <div className="import-session-health" aria-label="Import session summary"><span><strong>{activeSessions}</strong>Active</span><span className={attentionSessions ? 'has-attention' : ''}><strong>{attentionSessions}</strong>Need attention</span></div>
        <div className="recent-list"><h3>Recent sessions</h3>{recent.length ? recent.map((item) => <button className={item.id === importSession?.id ? 'is-active' : ''} key={item.id} onClick={() => setSearchParams({ session: item.id })}><span>{item.file_name ?? `${item.category_name} ${item.mode === 'CREATE' ? 'create' : 'update'}`}</span><small>{item.total_rows} rows - {humanStatus(item.status)}</small></button>) : <p>No import sessions yet.</p>}</div>
      </aside>

      <main className="import-workspace surface">
        {error && <div className="form-alert" role="alert"><TriangleAlert size={18}/><span>{error}</span></div>}
        {!importSession ? <section className="import-start">
          <div className="import-step-heading"><div><span className="eyebrow">New smart import</span><h2>Choose the contract and source file</h2><p>Known columns map automatically. The application asks for column decisions only when it cannot make a safe match.</p></div><span className="step-number">Ready when you are</span></div>
          <div className="import-start-grid">
            <label className="field"><span className="field__label">Asset category *</span><select value={profileId} onChange={(event) => setProfileId(Number(event.target.value))}>{appSession?.categories.map((item) => <option key={item.id} value={item.profileId}>{item.name}</option>)}</select></label>
            <fieldset className="mode-picker"><legend>Import mode *</legend><button className={mode === 'CREATE' ? 'is-active' : ''} onClick={() => setMode('CREATE')} type="button"><CirclePlus/><span><strong>Create Assets</strong><small>New serials only</small></span></button><button className={mode === 'UPDATE' ? 'is-active' : ''} onClick={() => setMode('UPDATE')} type="button"><RefreshCw/><span><strong>Update Existing</strong><small>Exact Serial # match</small></span></button></fieldset>
          </div>
          <div className="import-contract-summary"><FileSpreadsheet size={22}/><div><strong>{category?.name ?? 'Profile'} contract</strong><p>Required blanks block; optional blanks are accepted. The profile and controlled values are pinned for a repeatable result.</p></div><div className="import-contract-actions"><button className="button" disabled={!profileId} onClick={() => download(api.importTemplateUrl(profileId), `${category?.key?.toLowerCase() ?? 'inventory'}-import.csv`)} type="button"><Download size={16}/>Download template</button><button className="button button--quiet" onClick={() => setInstructionsOpen((current) => !current)} type="button">{instructionsOpen ? 'Hide guide' : 'Field guide'}</button></div></div>
          {instructionsOpen && <div className="import-instructions"><h3>What happens after analysis</h3><ol><li>Recognized labels, field keys, and approved aliases map automatically.</li><li>Only unknown or ambiguous columns require a mapping decision.</li><li>Repeated data issues are grouped so one correction can resolve many rows.</li><li>Warnings remain importable; blocking issues must be resolved.</li><li>The included batch commits in one transaction or not at all.</li></ol><p><strong>Update Existing:</strong> blank optional mapped cells clear existing values. Blank required cells always block.</p></div>}
          <CsvFilePicker file={file} onChange={(next) => { setFile(next); setError(next ? '' : 'Choose a CSV file.'); }}/>
          <div className="import-analysis-note"><CheckCircle2 size={18}/><span><strong>No inventory changes happen during analysis.</strong> You will review the complete result before commit.</span></div>
          <div className="form-actions"><button className="button button--primary" disabled={busy || !profileId || !file} onClick={start} type="button"><FileSpreadsheet size={17}/>{busy ? 'Analyzing CSV...' : 'Analyze CSV'}</button></div>
        </section> : <>
          <header className="import-session-header"><div><button className="text-button" onClick={() => useSession(undefined)} type="button"><ArrowLeft size={15}/>All sessions</button><span className="eyebrow">{importSession.categoryName} - {importSession.mode === 'CREATE' ? 'Create Assets' : 'Update Existing'}</span><h2>{importSession.fileName ?? 'Upload source CSV'}</h2><p>Profile version {importSession.profileVersion} - Created by {importSession.createdBy}</p></div><span className={`status status--${importSession.status.toLowerCase()}`}>{humanStatus(importSession.status)}</span></header>

          {importSession.status === 'DRAFT' && <section className="import-upload-step">
            <div className="import-step-heading"><div><span className="eyebrow">Source file</span><h2>Choose a CSV to analyze</h2><p>The original CSV is stored with this session so you can leave and resume safely.</p></div><span className="step-number">Draft</span></div>
            <div className="import-template-actions"><button className="button" onClick={() => download(api.importTemplateUrl(importSession.profileId), `${importSession.categoryKey.toLowerCase()}-import.csv`)} type="button"><Download size={17}/>Download Current CSV Template</button><button className="button" onClick={() => setInstructionsOpen((current) => !current)} type="button">{instructionsOpen ? 'Hide Field Guide' : 'View Field Guide'}</button></div>
            {instructionsOpen && <div className="field-guide">{importSession.fields.map((field) => <article key={field.id}><strong>{field.label}{field.required ? ' *' : ''}</strong><span>{field.fieldKey}</span><p>{field.definition || field.helpText}</p><small>{field.required ? 'Required' : 'Optional'} - {humanStatus(field.dataType)}</small></article>)}</div>}
            <CsvFilePicker file={file} onChange={(next) => { setFile(next); setError(next ? '' : 'Choose a CSV file.'); }}/>
            <div className="form-actions"><button className="button button--primary" disabled={busy || !file} onClick={upload} type="button"><FileSpreadsheet size={17}/>{busy ? 'Analyzing CSV...' : 'Analyze CSV'}</button></div>
          </section>}

          {importSession.status === 'MAPPING' && <MappingPanel session={importSession} busy={busy} onSave={(mappings) => void run(() => api.saveImportMappings(importSession.id, mappings), 'Column decisions saved. The complete batch was validated.')}/>}

          {!['DRAFT', 'MAPPING'].includes(importSession.status) && <section className="import-review">
            <div className="import-step-heading"><div><span className="eyebrow">Analysis complete</span><h2>{importSession.totalRows} source row{importSession.totalRows === 1 ? '' : 's'}, {includedRows} included</h2><p>Review exceptions first, then confirm the staged rows. Warnings can commit; blocking and configuration errors cannot.</p></div><span className="step-number">{importSession.invalidRows ? 'Action required' : 'Ready for review'}</span></div>
            <div className="batch-kpis"><span><strong>{importSession.validRows}</strong>Valid</span><span><strong>{importSession.warningRows}</strong>Warnings</span><span><strong>{importSession.invalidRows}</strong>Blocked</span><span><strong>{importSession.rows.filter((row) => !row.included).length}</strong>Excluded</span></div>
            {importSession.failureMessage && <p className="form-alert">{importSession.failureMessage}</p>}
            {importSession.status === 'COMPLETED' ? <div className="import-complete"><CheckCircle2 size={34}/><div><h3>Import completed</h3><p>{importSession.results.length} asset{importSession.results.length === 1 ? '' : 's'} committed. Inventory, reports, activity, and category totals have refreshed.</p></div><div className="import-result-links">{importSession.results.map((result) => <button className="button" key={result.import_row_id} onClick={() => navigate(`/assets/${Number(result.asset_id)}`, { state: { backgroundLocation: location } })} type="button"><Link2 size={15}/>{result.product_name} - {result.serial_number}</button>)}</div></div> : <>
            {importSession.invalidRows > 0 && <div className="import-correction-summary"><TriangleAlert size={21}/><div><strong>{importSession.invalidRows} included row{importSession.invalidRows === 1 ? '' : 's'} need attention</strong><p>Each issue below links to its field and offers the corrections permitted by your role.</p></div>{firstIssue && <button className="button" onClick={() => setSearchParams({ session: importSession.id, row: firstIssue.row.id, field: firstIssue.issue.fieldKey ?? firstIssue.issue.code })} type="button">Review First Issue</button>}</div>}
              <div className="import-review-actions"><button className="button" disabled={busy} onClick={() => void run(() => api.validateImport(importSession.id), 'Session revalidated against the current profile and controlled values.')} type="button"><RefreshCw size={16}/>Revalidate</button><button className="button" onClick={() => download(api.importValidationUrl(importSession.id), `${importSession.fileName ?? 'import'}-validation.csv`)} type="button"><Download size={16}/>Validation Report</button><button className="button button--danger" disabled={busy} onClick={() => void run(() => api.cancelImport(importSession.id), 'Import session cancelled.')} type="button">Cancel Session</button></div>
              <ReviewPanel
                session={importSession}
                canApproveLookups={canApproveLookups}
                busy={busy}
                busyIssue={busyIssue}
                selectedRowId={requestedRowId}
                onOpenRow={(row) => setSearchParams({ session: importSession.id, row: row.id })}
                onCloseRow={() => setSearchParams({ session: importSession.id })}
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
