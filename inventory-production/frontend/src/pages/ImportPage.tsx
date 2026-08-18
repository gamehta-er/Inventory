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
  ShieldCheck,
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
  ImportControl,
  ImportMode,
  ImportRow,
  ImportSession,
  ImportSessionSummary,
} from '../types';

const closedStatuses = new Set(['COMPLETED', 'CANCELLED']);
const importCountFormatter = new Intl.NumberFormat();

function humanStatus(status: string): string {
  return status.toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export function formatImportCount(value: number, locales?: Intl.LocalesArgument): string {
  return locales ? new Intl.NumberFormat(locales).format(value) : importCountFormatter.format(value);
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
  canEdit = true,
}: {
  issue: ImportIssue;
  canApproveLookups: boolean;
  busy?: boolean;
  onCorrect?: (value: string) => void;
  onBulkCorrect?: (value: string) => void;
  onApprove?: (reason: string) => void;
  onRepair?: () => void;
  anchorId?: string;
  canEdit?: boolean;
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
  const canAdd = canEdit && (issue.code === 'LOOKUP_VALUE_UNRECOGNIZED' || issue.code === 'VENDOR_NOT_RECOGNIZED')
    && Boolean(sourceValue)
    && canApproveLookups;

  return <li className={`import-issue import-issue--${issue.severity.toLowerCase()}`} id={anchorId} tabIndex={-1}>
    {issue.severity === 'WARNING' ? <TriangleAlert aria-hidden size={18}/> : <XCircle aria-hidden size={18}/>}
    <div className="import-issue__content">
      <div className="import-issue__heading">
        <strong>{issue.fieldLabel ?? issue.fieldKey ?? 'Import value'}</strong>
        <span>{issue.severity === 'ERROR' ? 'Blocking error' : issue.severity === 'CONFIGURATION' ? 'Configuration error' : humanStatus(issue.severity)}</span>
      </div>
      {isControlled && <p className="import-issue__rejected"><span>Source value</span><b>{sourceValue || 'Empty value'}</b></p>}
      <p>{issue.message}</p>
      {isControlled && <p className="import-issue__explanation">Capitalization and configured aliases are matched automatically. This value is genuinely outside the active controlled list.</p>}

      {issue.code === 'PROFILE_LOOKUP_MISSING' ? <div className="import-issue__actions">
        <button className="button" disabled={!canEdit || !onRepair} onClick={onRepair} type="button"><Settings2 size={16}/>Repair Profile</button>
      </div> : isControlled && <>
        <button className="button button--quiet import-issue__toggle" onClick={() => setShowValues((current) => !current)} type="button">
          {showValues ? 'Hide approved values' : `View approved values (${approvedValues.length})`}
        </button>
        {showValues && <div className="import-issue__approved">
          <span>Use an approved value</span>
          {approvedValues.length ? <div className="import-issue__values">
            {approvedValues.map((option) => <div className="import-approved-value" key={option.id}>
              <button disabled={busy || !canEdit || !onCorrect} onClick={() => onCorrect?.(option.label)} type="button">{option.label}</button>
              {canEdit && onBulkCorrect && <button className="button--quiet" disabled={busy} onClick={() => onBulkCorrect(option.label)} type="button">Use for all matches</button>}
            </div>)}
          </div> : <p className="import-issue__empty">No approved values are configured for this field.</p>}
        </div>}
        {!showValues && suggested.length > 0 && <div className="import-suggestions"><span>Closest matches</span>{suggested.map((value) => <button disabled={busy || !canEdit || !onCorrect} key={value} onClick={() => onCorrect?.(value)} type="button">{value}</button>)}</div>}
        {canAdd && <div className="import-issue__approval">
          <button className="button import-issue__action" disabled={busy} onClick={() => setShowApproval((current) => !current)} type="button"><CirclePlus size={16}/>Add As New Value</button>
          {showApproval && <div className="import-issue__approval-form">
            <p>Add <strong>{sourceValue}</strong> to {issue.lookupName ?? issue.fieldLabel}. Every matching row will revalidate automatically.</p>
            <label className="field"><span className="field__label">Reason *</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this an approved operational value?"/></label>
            <button className="button button--primary" disabled={busy || reason.trim().length < 3} onClick={() => onApprove?.(reason.trim())} type="button">Add Value And Revalidate</button>
          </div>}
        </div>}
        {!canApproveLookups && sourceValue && <small className="import-issue__admin-note">A Super User or Privileged Administrator can add a valid controlled value from this review.</small>}
        {issue.adminRoute && issue.code !== 'VENDOR_NOT_RECOGNIZED' && <button className="button button--quiet import-issue__action" disabled={!canEdit || !onRepair} onClick={onRepair} type="button"><Settings2 size={16}/>Manage Approved Values</button>}
      </>}

      <div className="import-issue__step"><FilePenLine aria-hidden size={17}/><span>{canEdit ? 'Correct this staged row here, or correct the source file and upload it again.' : 'This decision is read-only while you review the importer’s draft.'}</span></div>
    </div>
  </li>;
}

function MappingPanel({ session, busy, onSave }: { session: ImportSession; busy: boolean; onSave(mappings: Array<{ sourceIndex: number; fieldKey?: string; ignored?: boolean }>): void }) {
  const [choices, setChoices] = useState<Record<number, string>>(() => Object.fromEntries(session.headers.map((header) => [header.sourceIndex, header.fieldKey ?? (header.ignored ? '__ignore' : '')])));
  useEffect(() => setChoices(Object.fromEntries(session.headers.map((header) => [header.sourceIndex, header.fieldKey ?? (header.ignored ? '__ignore' : '')]))), [session]);
  const duplicateSelections = Object.values(choices).filter((value) => value && value !== '__ignore').filter((value, index, all) => all.indexOf(value) !== index);
  const undecided = session.headers.filter((header) => !choices[header.sourceIndex]);

  return <section className="import-mapping">
    <div className="import-step-heading"><div><span className="eyebrow">Match columns</span><h2>Confirm the columns we could not match</h2><p>Confident matches are already selected. Choose a destination or ignore an unused column.</p></div><span className="step-number">Only when needed</span></div>
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
    <div className="import-sticky-actions"><span>{undecided.length ? `${undecided.length} column decision${undecided.length === 1 ? '' : 's'} remaining` : duplicateSelections.length ? 'A profile field is mapped more than once' : 'Every column has a match'}</span><button className="button button--primary" disabled={busy || undecided.length > 0 || duplicateSelections.length > 0} onClick={() => onSave(session.headers.map((header) => {
      const choice = choices[header.sourceIndex];
      return choice === '__ignore' ? { sourceIndex: header.sourceIndex, ignored: true } : { sourceIndex: header.sourceIndex, fieldKey: choice };
    }))} type="button"><Check size={17}/>{busy ? 'Preparing preview...' : 'Continue to preview'}</button></div>
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

function ImportFilePicker({ file, onChange }: { file?: File; onChange(file?: File): void }) {
  const [dragging, setDragging] = useState(false);
  function choose(candidate?: File) {
    if (!candidate || !/\.(csv|xlsx)$/i.test(candidate.name) || candidate.size > 10 * 1024 * 1024) return onChange(undefined);
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
    <span><strong>{file?.name ?? 'Drop a CSV or Excel file here'}</strong><small>{file ? `${Math.ceil(file.size / 1024)} KB ready to analyze` : 'Up to 1,000 rows and 10 MB'}</small></span>
    <b>{file ? 'Change file' : 'Choose file'}</b>
    <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => choose(event.target.files?.[0])}/>
  </label>;
}

function ImportControlBanner({ control }: { control?: ImportControl }) {
  if (!control || control.mode === 'ENABLED') return null;
  const label = control.mode === 'DISABLED' ? 'Imports temporarily unavailable' : 'Limited import access';
  return <section className={`import-control-banner import-control-banner--${control.mode.toLowerCase()}`} aria-live="polite">
    <ShieldCheck size={20}/>
    <div><strong>{label}</strong><span>{control.reason}</span></div>
    <small>{control.mode === 'DISABLED' ? 'You can still upload, preview, and fix your file.' : 'Only authorized test users can import right now.'}</small>
  </section>;
}

function ImportProgress({ session }: { session?: ImportSession }) {
  const currentStep = !session || ['DRAFT', 'SOURCE_SELECTION', 'MAPPING'].includes(session.status)
    ? 0
    : session.status === 'COMPLETED' ? 2 : 1;
  const steps = [
    { label: 'Upload', icon: FileUp },
    { label: 'Preview & fix', icon: Eye },
    { label: 'Results', icon: CheckCircle2 },
  ];
  return <nav className="import-progress" aria-label="Import progress">
    {steps.map((step, index) => {
      const Icon = step.icon;
      const state = index < currentStep ? 'complete' : index === currentStep ? 'current' : 'upcoming';
      return <span className={`import-progress__step is-${state}`} aria-current={state === 'current' ? 'step' : undefined} key={step.label}><Icon size={16}/><b>{step.label}</b></span>;
    })}
  </nav>;
}

function SourceOptionsPanel({ session, busy, onApply }: {
  session: ImportSession;
  busy: boolean;
  onApply(options: { sheetName?: string; delimiter?: ',' | ';' | '\t'; encoding?: 'utf-8' | 'windows-1252' }): void;
}) {
  const delimiterCandidates = Array.isArray(session.sourceOptions.delimiterCandidates)
    ? session.sourceOptions.delimiterCandidates.map(String).filter((value): value is ',' | ';' | '\t' => [',', ';', '\t'].includes(value))
    : [];
  const [sheetName, setSheetName] = useState(session.sourceSheetName ?? session.availableSheets[0]?.name ?? '');
  const [delimiter, setDelimiter] = useState<',' | ';' | '\t'>((session.sourceDelimiter as ',' | ';' | '\t' | null) ?? delimiterCandidates[0] ?? ',');
  const [encoding, setEncoding] = useState<'utf-8' | 'windows-1252'>((session.sourceEncoding as 'utf-8' | 'windows-1252' | null) ?? 'utf-8');
  const isWorkbook = session.sourceFormat === 'XLSX';
  return <section className="import-source-options">
    <div className="import-step-heading"><div><span className="eyebrow">One choice needed</span><h2>{isWorkbook ? 'Choose the worksheet to import' : 'Confirm how this CSV is separated'}</h2><p>The file is preserved. Inventory rows will be staged only after this choice.</p></div><span className="step-number">Source</span></div>
    <div className="import-source-options__fields">
      {isWorkbook ? <label className="field"><span className="field__label">Worksheet *</span><select value={sheetName} onChange={(event) => setSheetName(event.target.value)}>{session.availableSheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name} ({sheet.rowCount} rows)</option>)}</select></label> : <>
        <label className="field"><span className="field__label">Delimiter *</span><select value={delimiter} onChange={(event) => setDelimiter(event.target.value as ',' | ';' | '\t')}><option value=",">Comma</option><option value=";">Semicolon</option><option value={'\t'}>Tab</option></select></label>
        <label className="field"><span className="field__label">Encoding *</span><select value={encoding} onChange={(event) => setEncoding(event.target.value as 'utf-8' | 'windows-1252')}><option value="utf-8">UTF-8</option><option value="windows-1252">Windows-1252</option></select></label>
      </>}
    </div>
    <div className="form-actions"><button className="button button--primary" disabled={busy || (isWorkbook && !sheetName)} onClick={() => onApply(isWorkbook ? { sheetName } : { delimiter, encoding })} type="button"><Check size={17}/>{busy ? 'Reading source...' : 'Use this source'}</button></div>
  </section>;
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

function ReviewPanel({ session, canEdit, canApproveLookups, busy, busyIssue, selectedRowId, onOpenRow, onCloseRow, onEdit, onToggle, onCorrect, onBulkCorrect, onApprove, onRepair }: {
  session: ImportSession;
  canEdit: boolean;
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
      <header><div><span className="eyebrow">Fix issues</span><h3 id="exception-center-title">Correct repeated issues once</h3><p>Matching problems are grouped so one correction can fix every affected row.</p></div><span className="status status--needs_attention">{issueGroups.length} issue group{issueGroups.length === 1 ? '' : 's'}</span></header>
      <div className="import-exception-groups">{issueGroups.map((group) => <article className="import-exception-group" key={issueGroupKey(group.issue)}>
        <div className="import-exception-group__meta"><span>{group.rows.length} affected row{group.rows.length === 1 ? '' : 's'}</span><button className="text-button" onClick={() => onOpenRow(group.rows[0]!)} type="button">View first row</button></div>
        <ul className="issue-list"><ImportIssueCard
          issue={group.issue}
          canEdit={canEdit}
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
      <header><div><span className="eyebrow">File preview</span><h3 id="row-review-title">Check the rows before import</h3></div><ListFilter aria-hidden size={18}/></header>
      <div className="import-review-filters" role="tablist" aria-label="Filter import rows">{(['ALL', 'ACTION', 'WARNING', 'READY', 'EXCLUDED'] as ReviewFilter[]).map((item) => <button aria-selected={filter === item} className={filter === item ? 'is-active' : ''} key={item} onClick={() => setFilter(item)} role="tab" type="button"><span>{reviewFilterLabel(item)}</span><b>{formatImportCount(counts[item])}</b></button>)}</div>
      <div className="import-table-wrap"><table className="import-table">
        <thead><tr><th>Source row</th><th>Product</th><th>Serial #</th><th>Model #</th><th>Asset status</th><th>Review result</th><th>Issues</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{rows.map((row) => {
          const values = { ...rawRowValues(session, row), ...row.normalized_values };
          return <tr className={!row.included ? 'is-excluded' : ''} id={`import-row-${row.id}`} key={row.id}>
            <td>{formatImportCount(row.row_number)}</td><td><strong>{displayValue(values.product_name)}</strong></td><td>{displayValue(values.serial_number)}</td><td>{displayValue(values.model_number)}</td><td>{displayValue(values.asset_status)}</td><td><span className={`status status--${row.status.toLowerCase()}`}>{humanStatus(row.status)}</span></td><td>{row.issues.length ? `${formatImportCount(row.issues.length)} issue${row.issues.length === 1 ? '' : 's'}` : 'No issues'}</td><td><button className="button button--quiet" onClick={() => onOpenRow(row)} type="button"><Eye size={15}/>{row.issues.length ? 'Fix' : 'View'}</button></td>
          </tr>;
        })}</tbody>
      </table>{rows.length === 0 && <div className="import-table-empty"><CheckCircle2 size={22}/><strong>No rows in this view</strong><span>Choose another filter to continue reviewing the batch.</span></div>}</div>
    </section>

    {selectedRow && <Overlay
      title={`Source row ${selectedRow.row_number}: ${displayValue(selectedRow.normalized_values.product_name ?? rawRowValues(session, selectedRow).product_name)}`}
      subtitle={`${humanStatus(selectedRow.status)} - ${selectedRow.issues.length} issue${selectedRow.issues.length === 1 ? '' : 's'}`}
      onClose={() => { setEditing(false); onCloseRow(); }}
      size="workspace"
      footer={canEdit && !closedStatuses.has(session.status) ? <><button className="button button--quiet" disabled={busy} onClick={() => onToggle(selectedRow, !selectedRow.included)} type="button">{selectedRow.included ? <><Trash2 size={15}/>Exclude Row</> : <><RotateCcw size={15}/>Restore Row</>}</button><button className="button button--primary" onClick={() => setEditing((current) => !current)} type="button"><Pencil size={15}/>{editing ? 'Close Editor' : 'Edit Row'}</button></> : undefined}
    >
      {editing && <RowEditor session={session} row={selectedRow} busy={busy} onSave={(values) => { onEdit(selectedRow, values); setEditing(false); }} onCancel={() => setEditing(false)}/>}
      {session.mode === 'UPDATE' && selectedRow.before_values && <div className="import-diff"><strong>Proposed changes</strong><div>{session.fields.filter((field) => selectedRow.before_values?.[field.fieldKey] !== selectedRow.after_values?.[field.fieldKey]).map((field) => <span key={field.id}><b>{field.label}</b><s>{displayFieldValue(field, selectedRow.before_values?.[field.fieldKey])}</s><i aria-hidden>to</i><em className={selectedRow.after_values?.[field.fieldKey] == null ? 'will-clear' : ''}>{selectedRow.after_values?.[field.fieldKey] == null ? 'Will clear existing value' : displayFieldValue(field, selectedRow.after_values?.[field.fieldKey])}</em></span>)}</div></div>}
      <dl className="import-row__fields">{session.fields.map((field) => <div key={field.id}><dt>{field.label}{field.required ? ' *' : ''}</dt><dd>{displayFieldValue(field, selectedRow.normalized_values[field.fieldKey] ?? rawRowValues(session, selectedRow)[field.fieldKey])}</dd></div>)}</dl>
      {selectedRow.issues.length > 0 && <ul className="issue-list">{selectedRow.issues.map((issue, index) => <ImportIssueCard anchorId={`import-row-${selectedRow.id}-field-${issue.fieldKey ?? issue.code}`} issue={issue} canEdit={canEdit} canApproveLookups={canEdit && canApproveLookups} busy={busyIssue === `${selectedRow.id}:${issue.fieldKey}`} onCorrect={canEdit ? (value) => onCorrect(selectedRow, issue, value) : undefined} onBulkCorrect={canEdit && issue.sourceValue ? (value) => onBulkCorrect(issue, value) : undefined} onApprove={canEdit ? (reason) => onApprove(issue, reason) : undefined} onRepair={canEdit ? () => onRepair(issue) : undefined} key={`${issue.fieldKey ?? issue.code}-${index}`}/>)}</ul>}
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
  const [importControl, setImportControl] = useState<ImportControl>();
  const [recent, setRecent] = useState<ImportSessionSummary[]>([]);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyIssue, setBusyIssue] = useState('');
  const [error, setError] = useState('');
  const category = useMemo(() => appSession?.categories.find((item) => item.profileId === profileId), [appSession, profileId]);
  const canApproveLookups = Boolean(appSession?.permissions['import.lookup.resolve']);

  async function refreshRecent() {
    const [sessions, control] = await Promise.all([api.imports(), api.importControl()]);
    setRecent(sessions);
    setImportControl(control);
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
    if (next) setImportControl(next.importControl);
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
    if (!file) { setError('Choose a completed CSV or XLSX file.'); return; }
    setBusy(true); setError('');
    try {
      const draft = await api.createImportSession(profileId, mode);
      useSession(draft);
      const next = await api.uploadImportFile(draft.id, file);
      useSession(next);
      await refreshRecent();
      notify(next.status === 'SOURCE_SELECTION'
        ? 'File uploaded. Choose the worksheet or delimiter to continue.'
        : next.status === 'MAPPING'
          ? 'File analyzed. Review the columns that could not be matched safely.'
          : `Preview ready. ${next.invalidRows ? `${next.invalidRows} row${next.invalidRows === 1 ? '' : 's'} need attention.` : 'All included rows are ready to import.'}`);
    } catch (failure) {
      setError((failure as Error).message);
      notify((failure as Error).message, 'error');
    } finally { setBusy(false); }
  }

  async function upload() {
    if (!importSession || !file) { setError('Choose a completed CSV or XLSX file.'); return; }
    await run(async () => {
      const next = await api.uploadImportFile(importSession.id, file);
      return next;
    }, 'File analyzed. Confident columns were mapped automatically.');
  }

  async function importRows() {
    if (!importSession) return;
    setBusy(true); setError('');
    try {
      if (!importSession.draftHash) throw new Error('Refresh the preview before importing.');
      const result = await api.commitImport(importSession.id, { draftRevision: importSession.draftRevision, draftHash: importSession.draftHash, idempotencyKey: importSession.idempotencyKey });
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
  const attentionSessions = recent.filter((item) => ['SOURCE_SELECTION', 'MAPPING', 'NEEDS_ATTENTION', 'DECLINED', 'NEEDS_REVALIDATION', 'FAILED', 'VERIFICATION_FAILED'].includes(item.status)).length;
  const currentUserId = appSession?.user.id ?? 0;
  const isOwner = Boolean(importSession && importSession.createdByUserId === currentUserId);
  const canCommitInMode = importSession?.importControl.mode === 'ENABLED'
    || (importSession?.importControl.mode === 'CANARY' && Boolean(appSession?.permissions['admin.system']));
  const canCommit = Boolean(importSession && isOwner && importSession.status === 'READY' && importSession.invalidRows === 0 && includedRows > 0 && importSession.draftHash && canCommitInMode);

  return <>
    <PageHeader eyebrow="Inventory Import" title="Import inventory" description="Upload a CSV or Excel file, check the preview, fix highlighted rows, and import." />
    <ImportControlBanner control={importSession?.importControl ?? importControl}/>
    <div className="import-shell">
      <aside className="import-sidebar surface">
        <div className="import-mode-heading"><span className="eyebrow">Import sessions</span>{importSession && <button className="icon-button" aria-label="Start a new import" onClick={() => useSession(undefined)}><CirclePlus size={18}/></button>}</div>
        <div className="import-session-health" aria-label="Import session summary"><span><strong>{formatImportCount(activeSessions)}</strong>Active</span><span className={attentionSessions ? 'has-attention' : ''}><strong>{formatImportCount(attentionSessions)}</strong>Need attention</span></div>
        <div className="recent-list"><h3>Recent sessions</h3>{recent.length ? recent.map((item) => <button className={item.id === importSession?.id ? 'is-active' : ''} key={item.id} onClick={() => setSearchParams({ session: item.id })}><span>{item.file_name ?? `${item.category_name} ${item.mode === 'CREATE' ? 'create' : 'update'}`}</span><small>{formatImportCount(item.total_rows)} rows - {humanStatus(item.status)}</small></button>) : <p>No import sessions yet.</p>}</div>
      </aside>

      <main className="import-workspace surface">
        <ImportProgress session={importSession}/>
        {error && <div className="form-alert" role="alert"><TriangleAlert size={18}/><span>{error}</span></div>}
        {!importSession ? <section className="import-start">
          <div className="import-step-heading"><div><span className="eyebrow">Step 1</span><h2>Choose what you are importing</h2><p>Select the asset category and file. Known columns match automatically.</p></div><span className="step-number">Upload</span></div>
          <div className="import-start-grid">
            <label className="field"><span className="field__label">Asset category *</span><select value={profileId} onChange={(event) => setProfileId(Number(event.target.value))}>{appSession?.categories.map((item) => <option key={item.id} value={item.profileId}>{item.name}</option>)}</select></label>
            <fieldset className="mode-picker"><legend>Import mode *</legend><button className={mode === 'CREATE' ? 'is-active' : ''} onClick={() => setMode('CREATE')} type="button"><CirclePlus/><span><strong>Create Assets</strong><small>New serials only</small></span></button><button className={mode === 'UPDATE' ? 'is-active' : ''} onClick={() => setMode('UPDATE')} type="button"><RefreshCw/><span><strong>Update Existing</strong><small>Exact Serial # match</small></span></button></fieldset>
          </div>
          <div className="import-contract-summary"><FileSpreadsheet size={22}/><div><strong>{category?.name ?? 'Profile'} contract</strong><p>Required blanks block; optional blanks are accepted. The profile and controlled values are pinned for a repeatable result.</p></div><div className="import-contract-actions"><button className="button" disabled={!profileId} onClick={() => download(api.importTemplateUrl(profileId, 'csv'), `${category?.key?.toLowerCase() ?? 'inventory'}-import.csv`)} type="button"><Download size={16}/>CSV template</button><button className="button" disabled={!profileId} onClick={() => download(api.importTemplateUrl(profileId, 'xlsx'), `${category?.key?.toLowerCase() ?? 'inventory'}-import.xlsx`)} type="button"><Download size={16}/>Excel template</button><button className="button button--quiet" onClick={() => setInstructionsOpen((current) => !current)} type="button">{instructionsOpen ? 'Hide guide' : 'Field guide'}</button></div></div>
          {instructionsOpen && <div className="import-instructions"><h3>What happens next</h3><ol><li>Upload a CSV or Excel file.</li><li>Check the preview and fix highlighted rows.</li><li>Select Import and see the result.</li></ol><p><strong>Update Existing:</strong> blank optional mapped cells clear existing values. Blank required cells always block.</p></div>}
          <ImportFilePicker file={file} onChange={(next) => { setFile(next); setError(next ? '' : 'Choose a CSV or XLSX file up to 10 MB.'); }}/>
          <div className="import-analysis-note"><CheckCircle2 size={18}/><span><strong>Preview is safe.</strong> Inventory changes only after you select Import. All included rows save together or none do.</span></div>
          <div className="form-actions"><button className="button button--primary" disabled={busy || !profileId || !file} onClick={start} type="button"><FileSpreadsheet size={17}/>{busy ? 'Preparing preview...' : 'Preview file'}</button></div>
        </section> : <>
          <header className="import-session-header"><div><button className="text-button" onClick={() => useSession(undefined)} type="button"><ArrowLeft size={15}/>All sessions</button><span className="eyebrow">{importSession.categoryName} - {importSession.mode === 'CREATE' ? 'Create Assets' : 'Update Existing'}</span><h2>{importSession.fileName ?? 'Upload source data'}</h2><p>Created by {importSession.createdBy}</p>{importSession.sourceFormat && <small>{importSession.sourceFormat}{importSession.sourceSheetName ? ` - ${importSession.sourceSheetName}` : ''}{importSession.fileSizeBytes ? ` - ${Math.ceil(importSession.fileSizeBytes / 1024)} KB` : ''}</small>}</div><span className={`status status--${importSession.status.toLowerCase()}`}>{humanStatus(importSession.status)}</span></header>

          {importSession.status === 'DRAFT' && <section className="import-upload-step">
            <div className="import-step-heading"><div><span className="eyebrow">Step 1</span><h2>Choose CSV or Excel data</h2><p>Your file stays with this import session so you can leave and return.</p></div><span className="step-number">Upload</span></div>
            <div className="import-template-actions"><button className="button" onClick={() => download(api.importTemplateUrl(importSession.profileId, 'csv'), `${importSession.categoryKey.toLowerCase()}-import.csv`)} type="button"><Download size={17}/>CSV template</button><button className="button" onClick={() => download(api.importTemplateUrl(importSession.profileId, 'xlsx'), `${importSession.categoryKey.toLowerCase()}-import.xlsx`)} type="button"><Download size={17}/>Excel template</button><button className="button" onClick={() => setInstructionsOpen((current) => !current)} type="button">{instructionsOpen ? 'Hide Field Guide' : 'View Field Guide'}</button></div>
            {instructionsOpen && <div className="field-guide">{importSession.fields.map((field) => <article key={field.id}><strong>{field.label}{field.required ? ' *' : ''}</strong><span>{field.fieldKey}</span><p>{field.definition || field.helpText}</p><small>{field.required ? 'Required' : 'Optional'} - {humanStatus(field.dataType)}</small></article>)}</div>}
            <ImportFilePicker file={file} onChange={(next) => { setFile(next); setError(next ? '' : 'Choose a CSV or XLSX file up to 10 MB.'); }}/>
            <div className="form-actions"><button className="button button--primary" disabled={busy || !file} onClick={upload} type="button"><FileSpreadsheet size={17}/>{busy ? 'Preparing preview...' : 'Preview file'}</button></div>
          </section>}

          {importSession.status === 'SOURCE_SELECTION' && (
            <SourceOptionsPanel session={importSession} busy={busy} onApply={(options) => void run(() => api.applyImportSourceOptions(importSession.id, options), 'Source selected. The file was analyzed and staged safely.')}/>
          )}

          {importSession.status === 'MAPPING' && (isOwner ? <MappingPanel session={importSession} busy={busy} onSave={(mappings) => void run(() => api.saveImportMappings(importSession.id, mappings), 'Column decisions saved. The complete batch was validated.')}/> : <p className="import-review-note">The importer is still choosing column mappings.</p>)}

          {!['DRAFT', 'SOURCE_SELECTION', 'MAPPING'].includes(importSession.status) && <section className="import-review">
            <div className="import-step-heading"><div><span className="eyebrow">Step 2</span><h2>{formatImportCount(importSession.totalRows)} source row{importSession.totalRows === 1 ? '' : 's'}, {formatImportCount(includedRows)} included</h2><p>Check the preview and fix highlighted rows. Warnings can import; blocked rows cannot.</p></div><span className="step-number">{importSession.invalidRows ? 'Fix issues' : importSession.status === 'COMPLETED' ? 'Results' : 'Ready to import'}</span></div>
            <div className="batch-kpis"><span><strong>{formatImportCount(importSession.validRows)}</strong>Valid</span><span><strong>{formatImportCount(importSession.warningRows)}</strong>Warnings</span><span><strong>{formatImportCount(importSession.invalidRows)}</strong>Blocked</span><span><strong>{formatImportCount(importSession.rows.filter((row) => !row.included).length)}</strong>Excluded</span></div>
            {importSession.failureMessage && <p className="form-alert">{importSession.failureMessage}</p>}
            {importSession.status === 'COMPLETED' ? <div className="import-complete"><CheckCircle2 size={34}/><div><h3>Import completed</h3><p>{formatImportCount(importSession.results.length)} asset{importSession.results.length === 1 ? '' : 's'} saved successfully. Inventory, reports, activity, and category totals are refreshed.</p></div><div className="import-result-links">{importSession.results.map((result) => <button className="button" key={result.import_row_id} onClick={() => navigate(`/assets/${Number(result.asset_id)}`, { state: { backgroundLocation: location } })} type="button"><Link2 size={15}/>{result.product_name} - {result.serial_number}</button>)}<button className="button button--primary" onClick={() => { setFile(undefined); useSession(undefined); }} type="button"><FileUp size={15}/>Import another file</button></div></div> : <>
            {importSession.invalidRows > 0 && <div className="import-correction-summary"><TriangleAlert size={21}/><div><strong>{formatImportCount(importSession.invalidRows)} included row{importSession.invalidRows === 1 ? '' : 's'} need attention</strong><p>Each issue below links to its field and offers the corrections permitted by your role.</p></div>{firstIssue && <button className="button" onClick={() => setSearchParams({ session: importSession.id, row: firstIssue.row.id, field: firstIssue.issue.fieldKey ?? firstIssue.issue.code })} type="button">Review First Issue</button>}</div>}
              <div className="import-review-actions">{isOwner && ['NEEDS_ATTENTION', 'NEEDS_REVALIDATION', 'FAILED', 'VERIFICATION_FAILED'].includes(importSession.status) && <button className="button" disabled={busy} onClick={() => void run(() => api.validateImport(importSession.id), 'Session revalidated against the current profile and controlled values.')} type="button"><RefreshCw size={16}/>Revalidate</button>}<button className="button" onClick={() => download(api.importValidationUrl(importSession.id), `${importSession.fileName ?? 'import'}-validation.csv`)} type="button"><Download size={16}/>Validation Report</button>{isOwner && <button className="button button--danger" disabled={busy} onClick={() => void run(() => api.cancelImport(importSession.id), 'Import session cancelled.')} type="button">Cancel Session</button>}</div>
              <ReviewPanel
                session={importSession}
                canEdit={isOwner}
                canApproveLookups={isOwner && canApproveLookups}
                busy={busy}
                busyIssue={busyIssue}
                selectedRowId={requestedRowId}
                onOpenRow={(row) => setSearchParams({ session: importSession.id, row: row.id })}
                onCloseRow={() => setSearchParams({ session: importSession.id })}
                onEdit={(row, values) => void run(() => api.updateImportRow(importSession.id, row.id, { values }), `Source row ${row.row_number} saved and revalidated.`)}
                onToggle={(row, included) => void run(() => api.updateImportRow(importSession.id, row.id, { included }), `Source row ${row.row_number} ${included ? 'restored' : 'excluded'}.`)}
                onCorrect={(row, issue, value) => void correctRow(row, issue, value)}
                onBulkCorrect={(issue, value) => void bulkCorrect(issue, value)}
                onApprove={(issue, reason) => void approveLookup(issue, reason)}
                onRepair={(issue) => navigate(issue.adminRoute ?? '/admin')}
              />
              {isOwner && <div className="import-sticky-actions"><span>{importSession.invalidRows ? 'Fix the highlighted rows before importing.' : !canCommitInMode ? 'Imports are temporarily unavailable. Your preview is saved.' : `${formatImportCount(includedRows)} included row${includedRows === 1 ? '' : 's'} will save together.`}</span><button className="button button--primary" disabled={busy || !canCommit} onClick={importRows} type="button"><CheckCircle2 size={17}/>{busy ? 'Importing...' : `Import ${formatImportCount(includedRows)} Asset${includedRows === 1 ? '' : 's'}`}</button></div>}
            </>}
          </section>}
        </>}
      </main>
    </div>
  </>;
}
