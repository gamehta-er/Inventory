import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import type { FastifyInstance } from 'fastify';
import { pool, withTransaction, type DbClient } from './db.js';
import { AppError } from './errors.js';
import { requirePermission, verifyCsrf } from './auth.js';
import { canonicalizeFieldValue, loadProfileFields, lookupOptionForValue } from './registry.js';
import { assetInternals } from './assets.js';
import { normalizeNVBugs } from './references.js';
import { recordActivity } from './activity.js';
import type { AuthenticatedRequest, FieldDefinition, SessionUser } from './types.js';
import { matchLookupOption } from './lookupMatching.js';
import { normalizeImportHeader } from './importSourceValues.js';

type Values = Record<string, unknown>;
type ImportMode = 'CREATE' | 'UPDATE';
type SessionStatus = 'DRAFT' | 'MAPPING' | 'VALIDATING' | 'NEEDS_ATTENTION' | 'READY' | 'COMMITTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'NEEDS_REVALIDATION';
type IssueSeverity = 'WARNING' | 'ERROR' | 'CONFIGURATION';
type ImportRowStatus = 'VALID' | 'WARNING' | 'BLOCKED' | 'CONFIGURATION_ERROR';

const importRefreshTargets = ['search', 'inventory', 'reports', 'activity', 'imports', 'categories'] as const;

function parseValidatedTarget(assetIdValue: unknown, revisionValue: unknown): { assetId: number; revision: number } | null {
  const assetId = Number(assetIdValue);
  const revision = Number(revisionValue);
  if (!Number.isSafeInteger(assetId) || assetId < 1 || !Number.isSafeInteger(revision) || revision < 1) return null;
  return { assetId, revision };
}

interface Issue {
  fieldKey?: string;
  severity: IssueSeverity;
  code: string;
  message: string;
  sourceValue?: string;
  suggestedValues?: string[];
}

function classifyImportRow(issues: Issue[]): ImportRowStatus {
  if (issues.some((issue) => issue.severity === 'CONFIGURATION')) return 'CONFIGURATION_ERROR';
  if (issues.some((issue) => issue.severity === 'ERROR')) return 'BLOCKED';
  if (issues.some((issue) => issue.severity === 'WARNING')) return 'WARNING';
  return 'VALID';
}

function importIssueRoute(batchId: string, rowId: string, fieldKey?: string): string {
  const search = new URLSearchParams({ session: batchId, row: rowId });
  if (fieldKey) search.set('field', fieldKey);
  return `/import?${search.toString()}`;
}

interface MappingIssue {
  severity: 'WARNING' | 'ERROR';
  code: string;
  message: string;
  sourceIndex?: number;
  sourceHeader?: string;
  fieldKey?: string;
}

interface MappingInput {
  sourceIndex: number;
  fieldKey?: string;
  ignored?: boolean;
}

interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\u00a0/g, ' ').trim();
}

function normalizedValue(value: unknown): string {
  return cleanText(value).toLocaleLowerCase().replace(/\s+/g, ' ');
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildImportTemplate(fields: FieldDefinition[]): string {
  return `\uFEFF${fields.map((field) => csvCell(field.label)).join(',')}\r\n`;
}

function parseCsv(contents: Buffer): ParsedCsv {
  let records: string[][];
  try {
    records = parse(contents, {
      bom: true,
      columns: false,
      relax_column_count: false,
      skip_empty_lines: true,
      trim: false,
    }) as string[][];
  } catch (error) {
    throw new AppError(422, 'CSV_INVALID', 'The CSV could not be read. Confirm the file uses the generated template and valid quoted CSV values.', {
      parserMessage: error instanceof Error ? error.message : 'CSV parsing failed.',
    });
  }
  if (!records.length) throw new AppError(422, 'CSV_EMPTY', 'The CSV contains no header or inventory rows.');
  const headers = records[0]!.map((value) => String(value).replace(/^\uFEFF/, '').trim());
  if (!headers.length || headers.every((header) => !header)) throw new AppError(422, 'CSV_HEADER_EMPTY', 'The CSV header row is empty.');
  const rows = records.slice(1).filter((row) => row.some((value) => cleanText(value) !== ''));
  if (!rows.length) throw new AppError(422, 'CSV_EMPTY', 'The CSV contains no inventory rows.');
  return { headers, rows };
}

function fieldTokens(field: FieldDefinition): Set<string> {
  return new Set([field.fieldKey, field.label, ...field.aliases].map(normalizeImportHeader).filter(Boolean));
}

function autoMappings(headers: string[], fields: FieldDefinition[]): MappingInput[] {
  const used = new Set<string>();
  const result: MappingInput[] = [];
  headers.forEach((header, sourceIndex) => {
    const token = normalizeImportHeader(header);
    const matches = fields.filter((field) => fieldTokens(field).has(token));
    if (matches.length === 1 && !used.has(matches[0]!.fieldKey)) {
      used.add(matches[0]!.fieldKey);
      result.push({ sourceIndex, fieldKey: matches[0]!.fieldKey });
    }
  });
  return result;
}

function mappingAssessment(headers: string[], fields: FieldDefinition[], mappings: MappingInput[]): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const seenHeaders = new Map<string, number[]>();
  headers.forEach((header, index) => {
    const token = normalizeImportHeader(header);
    seenHeaders.set(token, [...(seenHeaders.get(token) ?? []), index]);
  });
  for (const indexes of seenHeaders.values()) {
    if (indexes.length > 1) {
      for (const sourceIndex of indexes) {
        const sourceHeader = headers[sourceIndex];
        issues.push({
          severity: 'ERROR',
          code: 'DUPLICATE_HEADER',
          sourceIndex,
          ...(sourceHeader === undefined ? {} : { sourceHeader }),
          message: `The header "${sourceHeader ?? ''}" appears more than once.`,
        });
      }
    }
  }

  const mappedFields = new Map<string, number[]>();
  for (const mapping of mappings) {
    if (mapping.fieldKey) mappedFields.set(mapping.fieldKey, [...(mappedFields.get(mapping.fieldKey) ?? []), mapping.sourceIndex]);
  }
  for (const [fieldKey, indexes] of mappedFields) {
    if (indexes.length > 1) issues.push({ severity: 'ERROR', code: 'DUPLICATE_MAPPING', fieldKey, message: `${fields.find((field) => field.fieldKey === fieldKey)?.label ?? fieldKey} is mapped more than once.` });
  }
  for (const field of fields.filter((item) => item.required)) {
    if (!mappedFields.has(field.fieldKey)) issues.push({ severity: 'ERROR', code: 'REQUIRED_FIELD_UNMAPPED', fieldKey: field.fieldKey, message: `${field.label} must be mapped before validation.` });
  }
  headers.forEach((header, sourceIndex) => {
    const mapping = mappings.find((item) => item.sourceIndex === sourceIndex);
    if (!mapping) issues.push({ severity: 'ERROR', code: 'COLUMN_DECISION_REQUIRED', sourceIndex, sourceHeader: header, message: `Map or ignore the column "${header}".` });
    else if (mapping.ignored) issues.push({ severity: 'WARNING', code: 'COLUMN_IGNORED', sourceIndex, sourceHeader: header, message: `The column "${header}" will be ignored.` });
  });
  return issues;
}

type EntityOptions = Record<string, Array<{ id: number; value: string; label: string }>>;

function contractFingerprint(profileVersion: number, fields: FieldDefinition[], entities: EntityOptions = {}): string {
  return createHash('sha256').update(JSON.stringify({
    profileVersion,
    fields: fields.map((field) => ({
      id: field.id,
      key: field.fieldKey,
      label: field.label,
      type: field.dataType,
      required: field.required,
      aliases: field.aliases,
      rules: field.validationRules,
      import: field.surfaces.import,
      lookupKey: field.lookupKey,
      options: field.options.map((option) => ({ id: option.id, value: option.value, label: option.label, aliases: option.aliases })),
    })),
    entities: Object.fromEntries(fields
      .filter((field) => field.dataType === 'entity')
      .map((field): [string, Array<{ id: number; value: string; label: string }>] => [field.fieldKey, (entities[field.fieldKey] ?? []).map((option) => ({ id: option.id, value: option.value, label: option.label }))])
      .sort(([left], [right]) => left.localeCompare(right))),
  })).digest('hex');
}

async function currentContractFingerprint(client: DbClient, profileVersion: number, fields: FieldDefinition[]): Promise<string> {
  return contractFingerprint(profileVersion, fields, await entityOptions(client));
}

function distance(left: string, right: string): number {
  const a = normalizedValue(left);
  const b = normalizedValue(right);
  const matrix = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i]![0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return matrix[a.length]![b.length]!;
}

function closestOptions(field: FieldDefinition, source: string): string[] {
  return [...field.options]
    .sort((left, right) => distance(source, left.label) - distance(source, right.label))
    .slice(0, 5)
    .map((option) => option.label);
}

function normalizeDate(value: string): string | null {
  const source = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(source);
  const match = iso ?? us;
  if (!match) return null;

  const year = Number(iso ? match[1] : match[3]);
  const month = Number(iso ? match[2] : match[1]);
  const day = Number(iso ? match[3] : match[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function resolveEntity(client: DbClient, field: FieldDefinition, source: string): Promise<{ value: unknown; issue?: Issue }> {
  if (field.fieldKey === 'location') {
    const rows = await client.query('SELECT id,full_path label FROM locations WHERE active ORDER BY full_path');
    const row = rows.rows.find((item) => normalizedValue(item.label) === normalizedValue(source));
    return row
      ? { value: Number(row.id) }
      : { value: null, issue: { fieldKey: field.fieldKey, severity: 'WARNING', code: 'LOCATION_NOT_RECOGNIZED', sourceValue: source, suggestedValues: closestLabels(rows.rows, source), message: `Location "${source}" is not recognized. This optional value will be left blank unless you select an approved location.` } };
  }
  if (field.fieldKey === 'owner') {
    const rows = await client.query('SELECT id,display_name label FROM application_users WHERE active ORDER BY display_name');
    const row = rows.rows.find((item) => normalizedValue(item.label) === normalizedValue(source));
    return row
      ? { value: Number(row.id) }
      : { value: null, issue: { fieldKey: field.fieldKey, severity: 'ERROR', code: 'OWNER_NOT_RECOGNIZED', sourceValue: source, suggestedValues: closestLabels(rows.rows, source), message: `Owner / Assignee "${source}" is not an active application user.` } };
  }
  if (field.fieldKey === 'vendor') {
    const rows = await client.query('SELECT id,vendor_name label FROM vendors WHERE active ORDER BY vendor_name');
    const row = rows.rows.find((item) => normalizedValue(item.label) === normalizedValue(source));
    return row
      ? { value: Number(row.id) }
      : { value: null, issue: { fieldKey: field.fieldKey, severity: 'ERROR', code: 'VENDOR_NOT_RECOGNIZED', sourceValue: source, suggestedValues: closestLabels(rows.rows, source), message: `Vendor "${source}" is not an active vendor.` } };
  }
  return { value: source };
}

function closestLabels(rows: Array<{ label: string }>, source: string): string[] {
  return [...rows]
    .sort((left, right) => distance(source, left.label) - distance(source, right.label))
    .slice(0, 5)
    .map((row) => row.label);
}

async function entityOptions(client: DbClient): Promise<Record<string, Array<{ id: number; value: string; label: string }>>> {
  const [locations, owners, vendors] = await Promise.all([
    client.query('SELECT id,full_path label FROM locations WHERE active ORDER BY full_path'),
    client.query('SELECT id,display_name label FROM application_users WHERE active ORDER BY display_name'),
    client.query('SELECT id,vendor_name label FROM vendors WHERE active ORDER BY vendor_name'),
  ]);
  const convert = (rows: Array<{ id: number; label: string }>) => rows.map((row) => ({ id: Number(row.id), value: row.label, label: row.label }));
  return { location: convert(locations.rows), owner: convert(owners.rows), vendor: convert(vendors.rows) };
}

function validationRuleIssues(field: FieldDefinition, source: string, value: unknown): Issue[] {
  const issues: Issue[] = [];
  const minLength = field.validationRules.minLength;
  const maxLength = field.validationRules.maxLength;
  const minimum = field.validationRules.minimum ?? field.validationRules.min;
  const maximum = field.validationRules.maximum ?? field.validationRules.max;
  const pattern = field.validationRules.pattern;

  if (typeof minLength === 'number' && source.length < minLength) {
    issues.push({ fieldKey: field.fieldKey, severity: 'ERROR', code: 'VALUE_TOO_SHORT', sourceValue: source, message: `${field.label} must contain at least ${minLength} characters.` });
  }
  if (typeof maxLength === 'number' && source.length > maxLength) {
    issues.push({ fieldKey: field.fieldKey, severity: 'ERROR', code: 'VALUE_TOO_LONG', sourceValue: source, message: `${field.label} cannot exceed ${maxLength} characters.` });
  }
  if (field.dataType === 'number' && typeof value === 'number') {
    if (typeof minimum === 'number' && value < minimum) {
      issues.push({ fieldKey: field.fieldKey, severity: 'ERROR', code: 'NUMBER_BELOW_MINIMUM', sourceValue: source, message: `${field.label} must be at least ${minimum}.` });
    }
    if (typeof maximum === 'number' && value > maximum) {
      issues.push({ fieldKey: field.fieldKey, severity: 'ERROR', code: 'NUMBER_ABOVE_MAXIMUM', sourceValue: source, message: `${field.label} cannot exceed ${maximum}.` });
    }
  }
  if (typeof pattern === 'string') {
    try {
      if (!new RegExp(pattern).test(source)) {
        issues.push({ fieldKey: field.fieldKey, severity: 'ERROR', code: 'VALUE_FORMAT_INVALID', sourceValue: source, message: `${field.label} has an invalid format.` });
      }
    } catch {
      issues.push({ fieldKey: field.fieldKey, severity: 'CONFIGURATION', code: 'PROFILE_VALIDATION_PATTERN_INVALID', sourceValue: source, message: `${field.label} has an invalid administrator-configured validation pattern.` });
    }
  }
  return issues;
}

async function normalizeField(client: DbClient, field: FieldDefinition, raw: unknown): Promise<{ value: unknown; issues: Issue[] }> {
  const source = cleanText(raw);
  if (!source) {
    return {
      value: null,
      issues: field.required ? [{ fieldKey: field.fieldKey, severity: 'ERROR', code: 'REQUIRED_VALUE_MISSING', sourceValue: '', message: `${field.label} is required.` }] : [],
    };
  }

  if (field.fieldKey === 'nvbugs') {
    const bugs = normalizeNVBugs(source);
    return bugs.length
      ? { value: bugs.join(', '), issues: validationRuleIssues(field, bugs.join(', '), bugs.join(', ')) }
      : { value: null, issues: [{ fieldKey: field.fieldKey, severity: 'ERROR', code: 'NVBUG_INVALID', sourceValue: source, message: 'NVBugs # must contain at least one numeric bug number.' }] };
  }
  if (field.dataType === 'date') {
    const value = normalizeDate(source);
    return value
      ? { value, issues: validationRuleIssues(field, source, value) }
      : { value: null, issues: [{ fieldKey: field.fieldKey, severity: 'ERROR', code: 'DATE_INVALID', sourceValue: source, message: `${field.label} must be a valid date.` }] };
  }
  if (field.dataType === 'number') {
    return Number.isFinite(Number(source))
      ? { value: Number(source), issues: validationRuleIssues(field, source, Number(source)) }
      : { value: null, issues: [{ fieldKey: field.fieldKey, severity: 'ERROR', code: 'NUMBER_INVALID', sourceValue: source, message: `${field.label} must be a number.` }] };
  }
  if (field.dataType === 'boolean') {
    const token = source.toLowerCase();
    if (['true', '1', 'yes'].includes(token)) return { value: true, issues: validationRuleIssues(field, source, true) };
    if (['false', '0', 'no'].includes(token)) return { value: false, issues: validationRuleIssues(field, source, false) };
    return { value: null, issues: [{ fieldKey: field.fieldKey, severity: 'ERROR', code: 'BOOLEAN_INVALID', sourceValue: source, message: `${field.label} must be Yes or No.` }] };
  }
  if (field.dataType === 'entity') {
    const resolved = await resolveEntity(client, field, source);
    return {
      value: resolved.value,
      issues: [...validationRuleIssues(field, source, resolved.value), ...(resolved.issue ? [resolved.issue] : [])],
    };
  }
  if (field.dataType === 'lookup') {
    if (!field.lookupKey) {
      return { value: null, issues: [{ fieldKey: field.fieldKey, severity: 'CONFIGURATION', code: 'PROFILE_LOOKUP_MISSING', sourceValue: source, message: `${field.label} is configured as a controlled value but is not connected to a controlled list.` }] };
    }
    const option = lookupOptionForValue(field, source);
    return option
      ? { value: canonicalizeFieldValue(field, option.id), issues: validationRuleIssues(field, source, canonicalizeFieldValue(field, option.id)) }
      : { value: null, issues: [{ fieldKey: field.fieldKey, severity: 'ERROR', code: 'LOOKUP_VALUE_UNRECOGNIZED', sourceValue: source, suggestedValues: closestOptions(field, source), message: `"${source}" is not an approved ${field.lookupName ?? field.label} value.` }] };
  }
  if (field.dataType === 'multi_reference') {
    const value = source.split(/[,;\r\n]+/).map(cleanText).filter(Boolean).join(', ');
    return { value, issues: validationRuleIssues(field, value, value) };
  }
  return { value: source, issues: validationRuleIssues(field, source, source) };
}

async function loadSessionContext(client: DbClient, batchId: string, lock = false) {
  const result = await client.query(
    `SELECT b.*,ip.profile_id,ip.import_profile_name,ap.profile_name,ap.profile_key,ap.version current_profile_version,
            c.category_name,c.category_key,u.display_name created_by
       FROM import_batches b
       JOIN import_profiles ip ON ip.id=b.import_profile_id
       JOIN asset_profiles ap ON ap.id=ip.profile_id
       JOIN categories c ON c.id=ap.category_id
       JOIN application_users u ON u.id=b.created_by_user_id
      WHERE b.id=$1 ${lock ? 'FOR UPDATE OF b' : ''}`,
    [batchId],
  );
  if (!result.rows[0]) throw new AppError(404, 'IMPORT_NOT_FOUND', 'Import session not found.');
  return result.rows[0];
}

function requireSessionAccess(user: SessionUser, batch: { created_by_user_id: number | string }): void {
  const ownsSession = Number(batch.created_by_user_id) === Number(user.id);
  const canManageAllSessions = user.permissions.includes('admin.profile');
  if (!ownsSession && !canManageAllSessions) {
    throw new AppError(403, 'FORBIDDEN', 'You cannot access another user\'s import session.');
  }
}

async function loadMappings(client: DbClient, batchId: string): Promise<MappingInput[]> {
  const result = await client.query(
    `SELECT m.source_index,fd.field_key,m.ignored
       FROM import_column_mappings m
       LEFT JOIN field_definitions fd ON fd.id=m.field_definition_id
      WHERE m.batch_id=$1 ORDER BY m.source_index`,
    [batchId],
  );
  return result.rows.map((row) => ({ sourceIndex: Number(row.source_index), fieldKey: row.field_key ?? undefined, ignored: row.ignored }));
}

async function markStaleIfNeeded(client: DbClient, batchId: string): Promise<boolean> {
  const batch = await loadSessionContext(client, batchId, true);
  if (['COMPLETED', 'CANCELLED'].includes(batch.status)) return false;
  const fields = (await loadProfileFields(Number(batch.profile_id), client)).filter((field) => field.surfaces.import);
  const fingerprint = await currentContractFingerprint(client, Number(batch.current_profile_version), fields);
  if (batch.contract_fingerprint !== fingerprint) {
    await client.query(
      `UPDATE import_batches SET status='NEEDS_REVALIDATION',failure_message=NULL,updated_at=now() WHERE id=$1`,
      [batchId],
    );
    await client.query(
      `DELETE FROM import_validation_issues WHERE import_row_id IN (SELECT id FROM import_batch_rows WHERE batch_id=$1)`,
      [batchId],
    );
    await client.query(`UPDATE import_batch_rows SET status=CASE WHEN included THEN 'PENDING' ELSE 'EXCLUDED' END,updated_at=now() WHERE batch_id=$1`, [batchId]);
    return true;
  }
  return false;
}

async function validateSession(client: DbClient, batchId: string): Promise<void> {
  const batch = await loadSessionContext(client, batchId, true);
  if (['COMPLETED', 'CANCELLED'].includes(batch.status)) throw new AppError(409, 'IMPORT_SESSION_CLOSED', 'This import session is closed.');
  if (!batch.original_csv) throw new AppError(422, 'IMPORT_FILE_REQUIRED', 'Upload a CSV before validation.');

  const fields = (await loadProfileFields(Number(batch.profile_id), client)).filter((field) => field.surfaces.import);
  if (!fields.length) throw new AppError(422, 'IMPORT_PROFILE_EMPTY', 'The selected profile has no enabled import fields.');
  const headers: string[] = Array.isArray(batch.original_headers) ? batch.original_headers.map(String) : [];
  const mappings = await loadMappings(client, batchId);
  const mappingIssues = mappingAssessment(headers, fields, mappings);
  const fingerprint = await currentContractFingerprint(client, Number(batch.current_profile_version), fields);
  if (mappingIssues.some((issue) => issue.severity === 'ERROR')) {
    await client.query(
      `UPDATE import_batches SET status='MAPPING',profile_version=$2,contract_fingerprint=$3,validated_at=NULL,updated_at=now() WHERE id=$1`,
      [batchId, batch.current_profile_version, fingerprint],
    );
    return;
  }

  await client.query(`UPDATE import_batches SET status='VALIDATING',failure_message=NULL,updated_at=now() WHERE id=$1`, [batchId]);
  const mappingByField = new Map(mappings.filter((item) => item.fieldKey).map((item) => [item.fieldKey!, item.sourceIndex]));
  const rows = await client.query<{
    id: string;
    row_number: number;
    source_values: Record<string, string>;
    corrected_values: Values;
    included: boolean;
  }>(`SELECT id,row_number,source_values,corrected_values,included FROM import_batch_rows WHERE batch_id=$1 ORDER BY row_number FOR UPDATE`, [batchId]);

  const prepared: Array<{
    id: string;
    rowNumber: number;
    source: Record<string, string>;
    corrected: Values;
    included: boolean;
    values: Values;
    issues: Issue[];
    targetAssetId: number | null;
    targetRevision: number | null;
    beforeValues: Values | null;
  }> = [];

  for (const staged of rows.rows) {
    if (!staged.included) {
      prepared.push({ ...staged, rowNumber: staged.row_number, source: staged.source_values, corrected: staged.corrected_values, values: {}, issues: [], targetAssetId: null, targetRevision: null, beforeValues: null });
      continue;
    }
    const rawByField: Values = {};
    for (const field of fields) {
      const sourceIndex = mappingByField.get(field.fieldKey);
      if (sourceIndex !== undefined) rawByField[field.fieldKey] = staged.source_values[String(sourceIndex)] ?? '';
      if (Object.prototype.hasOwnProperty.call(staged.corrected_values, field.fieldKey)) rawByField[field.fieldKey] = staged.corrected_values[field.fieldKey];
    }

    const serial = cleanText(rawByField.serial_number);
    let targetAssetId: number | null = null;
    let targetRevision: number | null = null;
    let beforeValues: Values | null = null;
    const issues: Issue[] = [];
    if (batch.mode === 'UPDATE' && serial) {
      const target = await client.query<{ id: string; revision: number; profile_id: string }>(
        `SELECT id,revision,profile_id FROM assets WHERE archived_at IS NULL AND lower(serial_number)=lower($1)`,
        [serial],
      );
      if (target.rowCount !== 1) {
        issues.push({ fieldKey: 'serial_number', severity: 'ERROR', code: 'UPDATE_TARGET_NOT_FOUND', sourceValue: serial, message: `Serial # "${serial}" does not match one active asset.` });
      } else if (Number(target.rows[0]!.profile_id) !== Number(batch.profile_id)) {
        issues.push({ fieldKey: 'serial_number', severity: 'ERROR', code: 'UPDATE_PROFILE_MISMATCH', sourceValue: serial, message: 'The matching asset belongs to a different category profile.' });
      } else {
        const asset = await assetInternals.loadAsset(Number(target.rows[0]!.id), client);
        targetAssetId = asset.id;
        targetRevision = asset.revision;
        beforeValues = asset.values;
      }
    }

    const values: Values = {};
    for (const field of fields) {
      if (!mappingByField.has(field.fieldKey) && !Object.prototype.hasOwnProperty.call(staged.corrected_values, field.fieldKey)) {
        if (field.required) issues.push({ fieldKey: field.fieldKey, severity: 'ERROR', code: 'REQUIRED_FIELD_UNMAPPED', message: `${field.label} is required and is not mapped.` });
        else if (batch.mode === 'UPDATE' && beforeValues) values[field.fieldKey] = beforeValues[field.fieldKey] ?? null;
        else values[field.fieldKey] = null;
        continue;
      }
      const normalized = await normalizeField(client, field, rawByField[field.fieldKey]);
      values[field.fieldKey] = normalized.value;
      issues.push(...normalized.issues);
    }

    prepared.push({
      id: staged.id,
      rowNumber: staged.row_number,
      source: staged.source_values,
      corrected: staged.corrected_values,
      included: true,
      values,
      issues,
      targetAssetId,
      targetRevision,
      beforeValues,
    });
  }

  const serialRows = new Map<string, typeof prepared>();
  const tagRows = new Map<string, typeof prepared>();
  for (const row of prepared.filter((item) => item.included)) {
    const serial = normalizedValue(row.values.serial_number);
    const tag = normalizedValue(row.values.asset_tag);
    if (serial) serialRows.set(serial, [...(serialRows.get(serial) ?? []), row]);
    if (tag) tagRows.set(tag, [...(tagRows.get(tag) ?? []), row]);
  }
  for (const duplicateRows of serialRows.values()) {
    if (duplicateRows.length > 1) duplicateRows.forEach((row) => row.issues.push({ fieldKey: 'serial_number', severity: 'ERROR', code: 'DUPLICATE_SERIAL_IN_FILE', sourceValue: cleanText(row.values.serial_number), message: 'Serial # is repeated in this import session.' }));
  }
  for (const duplicateRows of tagRows.values()) {
    if (duplicateRows.length > 1) duplicateRows.forEach((row) => row.issues.push({ fieldKey: 'asset_tag', severity: 'ERROR', code: 'DUPLICATE_ASSET_TAG_IN_FILE', sourceValue: cleanText(row.values.asset_tag), message: 'Asset Tag # is repeated in this import session.' }));
  }

  for (const field of fields.filter((item) => item.uniqueWhenPopulated && !['serial_number', 'asset_tag'].includes(item.fieldKey))) {
    const valueRows = new Map<string, typeof prepared>();
    for (const row of prepared.filter((item) => item.included)) {
      const value = normalizedValue(row.values[field.fieldKey]);
      if (value) valueRows.set(value, [...(valueRows.get(value) ?? []), row]);
    }
    for (const duplicateRows of valueRows.values()) {
      if (duplicateRows.length > 1) {
        duplicateRows.forEach((row) => row.issues.push({
          fieldKey: field.fieldKey,
          severity: 'ERROR',
          code: 'DUPLICATE_UNIQUE_VALUE_IN_FILE',
          sourceValue: cleanText(row.values[field.fieldKey]),
          message: `${field.label} must be unique and is repeated in this import session.`,
        }));
      }
    }
  }

  for (const row of prepared.filter((item) => item.included)) {
    const serial = cleanText(row.values.serial_number);
    const tag = cleanText(row.values.asset_tag);
    if (batch.mode === 'CREATE' && serial) {
      const duplicate = await client.query('SELECT 1 FROM assets WHERE lower(serial_number)=lower($1)', [serial]);
      if (duplicate.rowCount) row.issues.push({ fieldKey: 'serial_number', severity: 'ERROR', code: 'SERIAL_ALREADY_EXISTS', sourceValue: serial, message: `Serial # "${serial}" already exists in inventory.` });
    }
    if (tag) {
      const duplicate = await client.query('SELECT 1 FROM assets WHERE lower(asset_tag)=lower($1) AND id<>COALESCE($2,-1)', [tag, row.targetAssetId]);
      if (duplicate.rowCount) row.issues.push({ fieldKey: 'asset_tag', severity: 'ERROR', code: 'ASSET_TAG_ALREADY_EXISTS', sourceValue: tag, message: `Asset Tag # "${tag}" already exists in inventory.` });
    }
    for (const field of fields.filter((item) => item.uniqueWhenPopulated && item.storageTarget.startsWith('asset_field_values:'))) {
      const value = cleanText(row.values[field.fieldKey]);
      if (!value) continue;
      const duplicate = await client.query(
        `SELECT 1
           FROM asset_field_values
          WHERE field_definition_id=$1
            AND asset_id<>COALESCE($2,-1)
            AND lower(btrim(COALESCE(text_value,number_value::text,date_value::text,boolean_value::text,json_value::text)))=lower(btrim($3))
          LIMIT 1`,
        [field.id, row.targetAssetId, value],
      );
      if (duplicate.rowCount) row.issues.push({ fieldKey: field.fieldKey, severity: 'ERROR', code: 'UNIQUE_VALUE_ALREADY_EXISTS', sourceValue: value, message: `${field.label} must be unique and already exists in inventory.` });
    }
  }

  const counts = { valid: 0, warning: 0, invalid: 0 };
  for (const row of prepared) {
    await client.query('DELETE FROM import_validation_issues WHERE import_row_id=$1', [row.id]);
    if (!row.included) {
      await client.query(`UPDATE import_batch_rows SET status='EXCLUDED',normalized_values='{}'::jsonb,operation=NULL,target_asset_id=NULL,target_asset_revision=NULL,before_values=NULL,after_values=NULL,updated_at=now() WHERE id=$1`, [row.id]);
      continue;
    }
    const status = classifyImportRow(row.issues);
    if (status === 'VALID') counts.valid++;
    else if (status === 'WARNING') counts.warning++;
    else counts.invalid++;
    await client.query(
      `UPDATE import_batch_rows SET normalized_values=$2,status=$3,operation=$4,target_asset_id=$5,target_asset_revision=$6,before_values=$7,after_values=$8,updated_at=now() WHERE id=$1`,
      [row.id, row.values, status, batch.mode, row.targetAssetId, row.targetRevision, row.beforeValues, row.values],
    );
    for (const issue of row.issues) {
      await client.query(
        `INSERT INTO import_validation_issues(import_row_id,field_key,severity,issue_code,message,source_value,suggested_values)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, issue.fieldKey ?? null, issue.severity, issue.code, issue.message, issue.sourceValue ?? null, issue.suggestedValues ?? []],
      );
    }
  }

  const status: SessionStatus = counts.invalid > 0 ? 'NEEDS_ATTENTION' : 'READY';
  await client.query(
    `UPDATE import_batches SET status=$2,profile_version=$3,contract_fingerprint=$4,total_rows=$5,valid_rows=$6,warning_rows=$7,invalid_rows=$8,validated_at=now(),updated_at=now(),failure_message=NULL WHERE id=$1`,
    [batchId, status, batch.current_profile_version, fingerprint, rows.rowCount, counts.valid, counts.warning, counts.invalid],
  );
}

async function sessionDetail(client: DbClient, batchId: string) {
  const batch = await loadSessionContext(client, batchId);
  const fields = (await loadProfileFields(Number(batch.profile_id), client)).filter((field) => field.surfaces.import);
  const mappings = await loadMappings(client, batchId);
  const headers: string[] = Array.isArray(batch.original_headers) ? batch.original_headers.map(String) : [];
  const mappingIssues = mappingAssessment(headers, fields, mappings);
  const mappingByIndex = new Map(mappings.map((mapping) => [mapping.sourceIndex, mapping]));
  const rows = await client.query(
    `SELECT r.id,r.row_number,r.source_values,r.corrected_values,r.normalized_values,r.included,r.operation,r.target_asset_id,
            r.target_asset_revision,r.before_values,r.after_values,r.status,r.committed_asset_id,
            COALESCE(jsonb_agg(jsonb_build_object(
              'id',i.id,'fieldKey',i.field_key,'severity',i.severity,'code',i.issue_code,'message',i.message,
              'sourceValue',i.source_value,'suggestedValues',i.suggested_values,'resolution',i.resolution
            ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL),'[]'::jsonb) issues
       FROM import_batch_rows r
       LEFT JOIN import_validation_issues i ON i.import_row_id=r.id
      WHERE r.batch_id=$1 GROUP BY r.id ORDER BY r.row_number`,
    [batchId],
  );
  const results = await client.query(
    `SELECT cr.import_row_id,cr.asset_id,cr.operation,cr.asset_revision,am.product_name,a.serial_number
       FROM import_commit_results cr JOIN assets a ON a.id=cr.asset_id JOIN asset_models am ON am.id=a.asset_model_id
      WHERE cr.batch_id=$1 ORDER BY cr.id`,
    [batchId],
  );
  const fieldsByKey = new Map(fields.map((field) => [field.fieldKey, field]));
  const entities = await entityOptions(client);
  const sessionFields = fields.map((field) => field.dataType === 'entity'
    ? { ...field, options: entities[field.fieldKey] ?? [] }
    : field);
  return {
    id: batch.id,
    profileId: Number(batch.profile_id),
    profileVersion: Number(batch.profile_version),
    currentProfileVersion: Number(batch.current_profile_version),
    profileName: batch.profile_name,
    categoryName: batch.category_name,
    categoryKey: batch.category_key,
    mode: batch.mode,
    fileName: batch.file_name,
    status: batch.status,
    totalRows: Number(batch.total_rows),
    validRows: Number(batch.valid_rows),
    warningRows: Number(batch.warning_rows),
    invalidRows: Number(batch.invalid_rows),
    createdBy: batch.created_by,
    createdAt: batch.created_at,
    updatedAt: batch.updated_at,
    validatedAt: batch.validated_at,
    completedAt: batch.completed_at,
    failureMessage: batch.failure_message,
    headers: headers.map((header, sourceIndex) => ({ sourceIndex, header, ...mappingByIndex.get(sourceIndex) })),
    mappingIssues,
    fields: sessionFields,
    rows: rows.rows.map((row) => ({
      ...row,
      issues: (Array.isArray(row.issues) ? row.issues : []).map((issue: Issue) => {
        const field = issue.fieldKey ? fieldsByKey.get(issue.fieldKey) : undefined;
        return {
          ...issue,
          routePath: importIssueRoute(batchId, String(row.id), issue.fieldKey),
          fieldLabel: field?.label,
          fieldDefinition: field?.definition,
          lookupKey: field?.lookupKey,
          lookupName: field?.lookupName,
          approvedValues: field?.dataType === 'entity'
            ? entities[field.fieldKey] ?? []
            : field?.options.map((option) => ({ id: option.id, value: option.value, label: option.label })) ?? [],
          adminRoute: issue.code === 'PROFILE_LOOKUP_MISSING' && field
            ? `/admin?tab=profiles&profile=${batch.profile_id}&field=${field.id}`
            : issue.code === 'LOOKUP_VALUE_UNRECOGNIZED' && field?.lookupKey
              ? `/admin?tab=lookups&lookup=${encodeURIComponent(field.lookupKey)}`
            : issue.code === 'OWNER_NOT_RECOGNIZED'
              ? '/admin?tab=users'
              : issue.code === 'VENDOR_NOT_RECOGNIZED'
                ? '/admin?tab=vendors'
                : issue.code === 'LOCATION_NOT_RECOGNIZED'
                  ? '/admin?tab=locations'
                  : undefined,
        };
      }),
    })),
    results: results.rows,
  };
}

function lookupValueKey(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const prefixed = /^[A-Z]/.test(normalized) ? normalized : `VALUE_${normalized}`;
  return (prefixed || 'VALUE').slice(0, 64);
}

async function saveMappings(client: DbClient, batchId: string, mappings: MappingInput[]): Promise<void> {
  const batch = await loadSessionContext(client, batchId, true);
  if (['COMPLETED', 'CANCELLED'].includes(batch.status)) throw new AppError(409, 'IMPORT_SESSION_CLOSED', 'This import session is closed.');
  const headers = Array.isArray(batch.original_headers) ? batch.original_headers.map(String) : [];
  const fields = (await loadProfileFields(Number(batch.profile_id), client)).filter((field) => field.surfaces.import);
  if (mappings.length !== headers.length) throw new AppError(422, 'MAPPING_INCOMPLETE', 'Choose a field or Ignore for every CSV column.');
  const sourceIndexes = mappings.map((mapping) => mapping.sourceIndex);
  if (sourceIndexes.some((sourceIndex) => !Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= headers.length)) {
    throw new AppError(422, 'MAPPING_SOURCE_INVALID', 'One or more column mappings refer to a source column that does not exist.');
  }
  if (new Set(sourceIndexes).size !== sourceIndexes.length) {
    throw new AppError(422, 'MAPPING_SOURCE_DUPLICATE', 'Each CSV column must have exactly one mapping decision.');
  }
  for (const mapping of mappings) {
    if (Boolean(mapping.ignored) === Boolean(mapping.fieldKey)) {
      throw new AppError(422, 'MAPPING_DECISION_INVALID', 'Each CSV column must be mapped to one field or explicitly ignored.');
    }
  }
  const assessment = mappingAssessment(headers, fields, mappings);
  const errors = assessment.filter((issue) => issue.severity === 'ERROR');
  if (errors.length) throw new AppError(422, 'MAPPING_INVALID', 'Correct the column mappings before validation.', { mappingIssues: errors });
  await client.query('DELETE FROM import_column_mappings WHERE batch_id=$1', [batchId]);
  for (const mapping of mappings) {
    const field = mapping.fieldKey ? fields.find((item) => item.fieldKey === mapping.fieldKey) : undefined;
    if (!mapping.ignored && !field) throw new AppError(422, 'MAPPING_FIELD_INVALID', 'A mapped field is not enabled for this profile.');
    await client.query(
      `INSERT INTO import_column_mappings(batch_id,source_header,source_index,field_definition_id,ignored)
       VALUES($1,$2,$3,$4,$5)`,
      [batchId, headers[mapping.sourceIndex], mapping.sourceIndex, field?.id ?? null, Boolean(mapping.ignored)],
    );
  }
  await client.query(`UPDATE import_batches SET status='NEEDS_REVALIDATION',mapping_revision=mapping_revision+1,updated_at=now() WHERE id=$1`, [batchId]);
}

function requireModePermission(user: SessionUser, mode: ImportMode): void {
  const permission = mode === 'CREATE' ? 'asset.create' : 'asset.update';
  if (!user.permissions.includes(permission)) throw new AppError(403, 'FORBIDDEN', `Your role cannot use ${mode === 'CREATE' ? 'Create Assets' : 'Update Existing'} import mode.`);
}

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/imports', { preHandler: requirePermission('import.execute') }, async (request) => {
    const user = (request as AuthenticatedRequest).inventoryUser;
    const result = await pool.query(
      `SELECT b.id,b.mode,b.file_name,b.status,b.total_rows,b.valid_rows,b.warning_rows,b.invalid_rows,b.created_at,b.updated_at,b.completed_at,
              c.category_name,ap.profile_name,u.display_name created_by
         FROM import_batches b JOIN import_profiles ip ON ip.id=b.import_profile_id JOIN asset_profiles ap ON ap.id=ip.profile_id
         JOIN categories c ON c.id=ap.category_id JOIN application_users u ON u.id=b.created_by_user_id
        WHERE b.created_by_user_id=$1 OR $2::boolean
        ORDER BY b.updated_at DESC LIMIT 100`,
      [user.id, user.permissions.includes('admin.profile')],
    );
    return { sessions: result.rows };
  });

  const templateHandler = async (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    const params = request.params as { id?: string };
    const query = request.query as { profileId?: string };
    const profileId = Number(params.id ?? query.profileId);
    const fields = (await loadProfileFields(profileId)).filter((field) => field.surfaces.import);
    if (!fields.length) throw new AppError(404, 'PROFILE_NOT_FOUND', 'Import profile not found or it has no enabled import fields.');
    const profile = await pool.query('SELECT profile_key,version FROM asset_profiles WHERE id=$1 AND active', [profileId]);
    if (!profile.rows[0]) throw new AppError(404, 'PROFILE_NOT_FOUND', 'Import profile not found.');
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${profile.rows[0].profile_key.toLowerCase()}-v${profile.rows[0].version}-import.csv"`);
    return reply.send(buildImportTemplate(fields));
  };
  app.get('/api/v1/profiles/:id/import-template.csv', { preHandler: requirePermission('import.execute') }, templateHandler);
  app.get('/api/v1/imports/template', { preHandler: requirePermission('import.execute') }, templateHandler);

  app.post('/api/v1/imports', { preHandler: requirePermission('import.execute') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const body = request.body as { profileId?: unknown; mode?: unknown };
    const profileId = Number(body.profileId);
    const mode = String(body.mode ?? '').toUpperCase() as ImportMode;
    if (!Number.isInteger(profileId) || profileId < 1) throw new AppError(422, 'PROFILE_REQUIRED', 'Select an import profile.');
    if (!['CREATE', 'UPDATE'].includes(mode)) throw new AppError(422, 'IMPORT_MODE_REQUIRED', 'Choose Create Assets or Update Existing.');
    requireModePermission(user, mode);
    return withTransaction(async (client) => {
      const profile = await client.query(
        `SELECT ip.id import_profile_id,ap.version FROM import_profiles ip JOIN asset_profiles ap ON ap.id=ip.profile_id
          WHERE ip.profile_id=$1 AND ip.active AND ap.active ORDER BY ip.id LIMIT 1`,
        [profileId],
      );
      if (!profile.rows[0]) throw new AppError(404, 'IMPORT_PROFILE_NOT_FOUND', 'No active import profile exists for this category.');
      const fields = (await loadProfileFields(profileId, client)).filter((field) => field.surfaces.import);
      const created = await client.query<{ id: string }>(
        `INSERT INTO import_batches(import_profile_id,mode,profile_version,contract_fingerprint,status,created_by_user_id)
         VALUES($1,$2,$3,$4,'DRAFT',$5) RETURNING id`,
        [profile.rows[0].import_profile_id, mode, profile.rows[0].version, await currentContractFingerprint(client, Number(profile.rows[0].version), fields), user.id],
      );
      await recordActivity(client, { user, actionKey: 'IMPORT_SESSION_CREATED', source: 'csv-import', reason: `${mode === 'CREATE' ? 'Create Assets' : 'Update Existing'} import session started.`, recordType: 'import', recordId: created.rows[0]!.id, recordLabel: 'New import session', routePath: `/import?session=${created.rows[0]!.id}`, parentImportBatchId: created.rows[0]!.id, metadata: { profileId, mode } });
      return { session: await sessionDetail(client, created.rows[0]!.id) };
    });
  });

  app.post('/api/v1/imports/:id/file', { preHandler: requirePermission('import.execute') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const batchId = (request.params as { id: string }).id;
    let fileName = '';
    let contents: Buffer | undefined;
    for await (const part of request.parts({ limits: { files: 1, fileSize: 10 * 1024 * 1024, fields: 2 } })) {
      if (part.type === 'file') {
        fileName = part.filename;
        contents = await part.toBuffer();
      }
    }
    if (!contents || !/\.csv$/i.test(fileName)) throw new AppError(415, 'CSV_REQUIRED', 'Choose a CSV file.');
    const parsed = parseCsv(contents);
    return withTransaction(async (client) => {
      const batch = await loadSessionContext(client, batchId, true);
      requireSessionAccess(user, batch);
      if (['COMPLETED', 'CANCELLED'].includes(batch.status)) throw new AppError(409, 'IMPORT_SESSION_CLOSED', 'This import session is closed.');
      const fields = (await loadProfileFields(Number(batch.profile_id), client)).filter((field) => field.surfaces.import);
      await client.query('DELETE FROM import_batch_rows WHERE batch_id=$1', [batchId]);
      await client.query('DELETE FROM import_column_mappings WHERE batch_id=$1', [batchId]);
      for (let index = 0; index < parsed.rows.length; index++) {
        const source = Object.fromEntries(parsed.headers.map((_header, sourceIndex) => [String(sourceIndex), parsed.rows[index]![sourceIndex] ?? '']));
        await client.query(
          `INSERT INTO import_batch_rows(batch_id,row_number,source_values,normalized_values,status) VALUES($1,$2,$3,'{}'::jsonb,'PENDING')`,
          [batchId, index + 2, source],
        );
      }
      for (const mapping of autoMappings(parsed.headers, fields)) {
        const field = fields.find((item) => item.fieldKey === mapping.fieldKey)!;
        await client.query(
          `INSERT INTO import_column_mappings(batch_id,source_header,source_index,field_definition_id,ignored) VALUES($1,$2,$3,$4,false)`,
          [batchId, parsed.headers[mapping.sourceIndex], mapping.sourceIndex, field.id],
        );
      }
      await client.query(
        `UPDATE import_batches SET file_name=$2,file_sha256=$3,original_csv=$4,original_headers=$5,status='MAPPING',total_rows=$6,valid_rows=0,warning_rows=0,invalid_rows=0,validated_at=NULL,updated_at=now(),failure_message=NULL WHERE id=$1`,
        [batchId, fileName, createHash('sha256').update(contents).digest('hex'), contents, parsed.headers, parsed.rows.length],
      );
      await recordActivity(client, { user, actionKey: 'IMPORT_FILE_UPLOADED', source: 'csv-import', reason: 'CSV uploaded and staged for column mapping.', recordType: 'import', recordId: batchId, recordLabel: fileName, routePath: `/import?session=${batchId}`, parentImportBatchId: batchId, metadata: { rows: parsed.rows.length, columns: parsed.headers.length } });
      return { session: await sessionDetail(client, batchId) };
    });
  });

  app.put('/api/v1/imports/:id/mappings', { preHandler: requirePermission('import.execute') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const batchId = (request.params as { id: string }).id;
    const body = request.body as { mappings?: MappingInput[] };
    if (!Array.isArray(body.mappings)) throw new AppError(422, 'MAPPINGS_REQUIRED', 'Column mappings are required.');
    return withTransaction(async (client) => {
      requireSessionAccess(user, await loadSessionContext(client, batchId, true));
      await saveMappings(client, batchId, body.mappings!);
      await validateSession(client, batchId);
      const batch = await loadSessionContext(client, batchId);
      await recordActivity(client, { user, actionKey: 'IMPORT_MAPPING_SAVED', source: 'csv-import', reason: 'CSV column mapping saved and validated.', recordType: 'import', recordId: batchId, recordLabel: batch.file_name ?? 'Import session', routePath: `/import?session=${batchId}`, parentImportBatchId: batchId, metadata: { mappings: body.mappings } });
      return { session: await sessionDetail(client, batchId) };
    });
  });

  app.post('/api/v1/imports/:id/validate', { preHandler: requirePermission('import.execute') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const batchId = (request.params as { id: string }).id;
    return withTransaction(async (client) => {
      requireSessionAccess(user, await loadSessionContext(client, batchId, true));
      await validateSession(client, batchId);
      const batch = await loadSessionContext(client, batchId);
      await recordActivity(client, { user, actionKey: 'IMPORT_VALIDATED', source: 'csv-import', reason: 'Import session fully revalidated.', recordType: 'import', recordId: batchId, recordLabel: batch.file_name ?? 'Import session', routePath: `/import?session=${batchId}`, parentImportBatchId: batchId, metadata: { status: batch.status } });
      return { session: await sessionDetail(client, batchId) };
    });
  });

  app.get('/api/v1/imports/:id', { preHandler: requirePermission('import.execute') }, async (request) => {
    const user = (request as AuthenticatedRequest).inventoryUser;
    const batchId = (request.params as { id: string }).id;
    return withTransaction(async (client) => {
      requireSessionAccess(user, await loadSessionContext(client, batchId, true));
      await markStaleIfNeeded(client, batchId);
      const current = await loadSessionContext(client, batchId);
      if (current.original_csv && !['COMPLETED', 'CANCELLED', 'DRAFT'].includes(current.status)) await validateSession(client, batchId);
      return { session: await sessionDetail(client, batchId) };
    });
  });

  app.patch('/api/v1/imports/:id/rows/:rowId', { preHandler: requirePermission('import.execute') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const { id: batchId, rowId } = request.params as { id: string; rowId: string };
    const body = request.body as { values?: Values; fieldKey?: unknown; value?: unknown; included?: unknown };
    return withTransaction(async (client) => {
      const batch = await loadSessionContext(client, batchId, true);
      requireSessionAccess(user, batch);
      if (['COMPLETED', 'CANCELLED'].includes(batch.status)) throw new AppError(409, 'IMPORT_SESSION_CLOSED', 'This import session is closed.');
      const row = await client.query<{ corrected_values: Values; row_number: number; included: boolean }>('SELECT corrected_values,row_number,included FROM import_batch_rows WHERE id=$1 AND batch_id=$2 FOR UPDATE', [rowId, batchId]);
      if (!row.rows[0]) throw new AppError(404, 'IMPORT_ROW_NOT_FOUND', 'Staged row not found.');
      const fields = (await loadProfileFields(Number(batch.profile_id), client)).filter((field) => field.surfaces.import);
      const patchValues = body.values && typeof body.values === 'object' ? body.values : body.fieldKey ? { [String(body.fieldKey)]: body.value ?? '' } : {};
      for (const fieldKey of Object.keys(patchValues)) {
        if (!fields.some((field) => field.fieldKey === fieldKey)) throw new AppError(422, 'IMPORT_FIELD_INVALID', `Field "${fieldKey}" is not enabled for this import profile.`);
      }
      const corrected = { ...row.rows[0].corrected_values, ...patchValues };
      const included = body.included === undefined ? row.rows[0].included : Boolean(body.included);
      await client.query('UPDATE import_batch_rows SET corrected_values=$2,included=$3,status=$4,updated_at=now() WHERE id=$1', [rowId, corrected, included, included ? 'PENDING' : 'EXCLUDED']);
      await validateSession(client, batchId);
      await recordActivity(client, { user, actionKey: included ? 'IMPORT_ROW_CORRECTED' : 'IMPORT_ROW_EXCLUDED', source: 'csv-import', reason: included ? 'Staged row corrected during review.' : 'Staged row excluded from commit.', recordType: 'import', recordId: batchId, recordLabel: batch.file_name ?? 'Import session', routePath: `/import?session=${batchId}&row=${rowId}`, parentImportBatchId: batchId, metadata: { rowId, rowNumber: row.rows[0].row_number, fields: Object.keys(patchValues), included } });
      return { session: await sessionDetail(client, batchId) };
    });
  });

  app.post('/api/v1/imports/:id/corrections/bulk', { preHandler: requirePermission('import.execute') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const batchId = (request.params as { id: string }).id;
    const body = request.body as { fieldKey?: unknown; sourceValue?: unknown; value?: unknown };
    const fieldKey = cleanText(body.fieldKey);
    const sourceValue = cleanText(body.sourceValue);
    if (!fieldKey) throw new AppError(422, 'IMPORT_FIELD_REQUIRED', 'Choose the field to correct.');
    return withTransaction(async (client) => {
      const batch = await loadSessionContext(client, batchId, true);
      requireSessionAccess(user, batch);
      const fields = (await loadProfileFields(Number(batch.profile_id), client)).filter((field) => field.surfaces.import);
      if (!fields.some((field) => field.fieldKey === fieldKey)) throw new AppError(422, 'IMPORT_FIELD_INVALID', 'This field is not enabled for the import profile.');
      const mappings = await loadMappings(client, batchId);
      const sourceIndex = mappings.find((mapping) => mapping.fieldKey === fieldKey)?.sourceIndex;
      const rows = await client.query<{ id: string; source_values: Record<string, string>; corrected_values: Values }>('SELECT id,source_values,corrected_values FROM import_batch_rows WHERE batch_id=$1 AND included FOR UPDATE', [batchId]);
      let changed = 0;
      for (const row of rows.rows) {
        const current = Object.prototype.hasOwnProperty.call(row.corrected_values, fieldKey)
          ? row.corrected_values[fieldKey]
          : sourceIndex === undefined ? undefined : row.source_values[String(sourceIndex)];
        if (normalizedValue(current) !== normalizedValue(sourceValue)) continue;
        await client.query('UPDATE import_batch_rows SET corrected_values=corrected_values || $2::jsonb,status=\'PENDING\',updated_at=now() WHERE id=$1', [row.id, { [fieldKey]: body.value ?? '' }]);
        changed++;
      }
      if (!changed) throw new AppError(404, 'IMPORT_MATCHING_ROWS_NOT_FOUND', 'No included rows contain that source value.');
      await validateSession(client, batchId);
      await recordActivity(client, { user, actionKey: 'IMPORT_ROWS_BULK_CORRECTED', source: 'csv-import', reason: 'A repeated staged value was corrected across the import session.', recordType: 'import', recordId: batchId, recordLabel: batch.file_name ?? 'Import session', routePath: `/import?session=${batchId}`, parentImportBatchId: batchId, metadata: { fieldKey, sourceValue, value: body.value ?? '', changed } });
      return { session: await sessionDetail(client, batchId), changed };
    });
  });

  app.post('/api/v1/imports/:id/lookups', { preHandler: requirePermission('import.lookup.resolve') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const batchId = (request.params as { id: string }).id;
    const body = request.body as { fieldKey?: unknown; value?: unknown; reason?: unknown };
    const fieldKey = cleanText(body.fieldKey);
    const displayValue = cleanText(body.value);
    const reason = cleanText(body.reason);
    if (!fieldKey || !displayValue) throw new AppError(422, 'LOOKUP_VALUE_REQUIRED', 'Field and new approved value are required.');
    if (reason.length < 3) throw new AppError(422, 'REASON_REQUIRED', 'Explain why this controlled value should be added.');
    return withTransaction(async (client) => {
      const batch = await loadSessionContext(client, batchId, true);
      requireSessionAccess(user, batch);
      const fields = (await loadProfileFields(Number(batch.profile_id), client)).filter((field) => field.surfaces.import);
      const field = fields.find((item) => item.fieldKey === fieldKey);
      if (!field) throw new AppError(422, 'IMPORT_FIELD_INVALID', 'This field is not enabled for the import profile.');
      if (field.dataType === 'entity' && field.fieldKey === 'vendor') {
        const existing = await client.query<{ id: string }>('SELECT id FROM vendors WHERE lower(vendor_name)=lower($1)', [displayValue]);
        let vendorId = Number(existing.rows[0]?.id);
        let actionKey = 'VENDOR_REUSED';
        if (!vendorId) {
          const inserted = await client.query<{ id: string }>('INSERT INTO vendors(vendor_name) VALUES($1) RETURNING id', [displayValue]);
          vendorId = Number(inserted.rows[0]!.id);
          actionKey = 'VENDOR_CREATED';
        } else {
          await client.query('UPDATE vendors SET active=true WHERE id=$1', [vendorId]);
        }
        await recordActivity(client, { user, actionKey, source: 'csv-import', reason, recordType: 'vendor', recordId: vendorId, recordLabel: displayValue, routePath: '/admin?tab=vendors', parentImportBatchId: batchId, metadata: { batchId, fieldKey } });
        await validateSession(client, batchId);
        return { session: await sessionDetail(client, batchId) };
      }
      if (field.dataType !== 'lookup' || !field.lookupKey) throw new AppError(422, 'PROFILE_LOOKUP_MISSING', 'Use the linked Admin workflow to manage this relationship safely.');
      const existing = matchLookupOption(field.options, displayValue);
      let valueId = existing?.id;
      let actionKey = 'LOOKUP_VALUE_REUSED';
      if (!valueId) {
        let valueKey = lookupValueKey(displayValue);
        const collision = await client.query(`SELECT 1 FROM lookup_values lv JOIN lookup_lists ll ON ll.id=lv.lookup_list_id WHERE ll.lookup_key=$1 AND lv.value_key=$2`, [field.lookupKey, valueKey]);
        if (collision.rowCount) valueKey = `${valueKey.slice(0, 55)}_${createHash('sha256').update(displayValue).digest('hex').slice(0, 8).toUpperCase()}`;
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO lookup_values(lookup_list_id,value_key,display_value,description,display_order)
           SELECT id,$2,$3,$4,COALESCE((SELECT max(display_order)+10 FROM lookup_values WHERE lookup_list_id=lookup_lists.id),10)
             FROM lookup_lists WHERE lookup_key=$1 AND active RETURNING id`,
          [field.lookupKey, valueKey, displayValue, `Approved from import session ${batchId}.`],
        );
        if (!inserted.rows[0]) throw new AppError(404, 'LOOKUP_NOT_FOUND', 'The controlled list is unavailable.');
        valueId = Number(inserted.rows[0].id);
        actionKey = 'LOOKUP_VALUE_CREATED';
        await client.query('UPDATE lookup_lists SET version=version+1,updated_at=now() WHERE lookup_key=$1', [field.lookupKey]);
      }
      await recordActivity(client, { user, actionKey, source: 'csv-import', reason, recordType: 'lookup', recordId: valueId!, recordLabel: displayValue, routePath: `/admin?tab=lookups&lookup=${encodeURIComponent(field.lookupKey)}`, parentImportBatchId: batchId, metadata: { batchId, fieldKey, lookupKey: field.lookupKey } });
      await validateSession(client, batchId);
      return { session: await sessionDetail(client, batchId) };
    });
  });

  app.get('/api/v1/imports/:id/validation.csv', { preHandler: requirePermission('import.execute') }, async (request, reply) => {
    const user = (request as AuthenticatedRequest).inventoryUser;
    const batchId = (request.params as { id: string }).id;
    await withTransaction(async (client) => {
      requireSessionAccess(user, await loadSessionContext(client, batchId));
    });
    const result = await pool.query(
      `SELECT r.id row_id,r.row_number,i.field_key,i.source_value,i.severity,i.issue_code,i.message,i.resolution
         FROM import_batch_rows r JOIN import_validation_issues i ON i.import_row_id=r.id
        WHERE r.batch_id=$1 ORDER BY r.row_number,i.id`,
      [batchId],
    );
    const headers = ['Row', 'Field Key', 'Source Value', 'Severity', 'Issue Code', 'Message', 'Resolution', 'Record Link'];
    const csv = [headers, ...result.rows.map((row) => [row.row_number, row.field_key, row.source_value, row.severity, row.issue_code, row.message, row.resolution ? JSON.stringify(row.resolution) : '', importIssueRoute(batchId, String(row.row_id), row.field_key ?? undefined)])]
      .map((row) => row.map(csvCell).join(',')).join('\r\n');
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="import-${batchId}-validation.csv"`);
    return reply.send(`\uFEFF${csv}`);
  });

  app.post('/api/v1/imports/:id/commit', { preHandler: requirePermission('import.execute') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const batchId = (request.params as { id: string }).id;
    try {
      return await withTransaction(async (client) => {
        requireSessionAccess(user, await loadSessionContext(client, batchId, true));
        await markStaleIfNeeded(client, batchId);
        let batch = await loadSessionContext(client, batchId, true);
        requireModePermission(user, batch.mode as ImportMode);
        if (batch.status === 'COMPLETED') return { session: await sessionDetail(client, batchId), idempotent: true, refresh: importRefreshTargets };
        if (batch.status === 'NEEDS_REVALIDATION') {
          await validateSession(client, batchId);
          batch = await loadSessionContext(client, batchId, true);
        }
        if (batch.status !== 'READY') throw new AppError(422, 'IMPORT_NOT_READY', 'Resolve all mapping, configuration, and blocking row issues before commit.');
        await client.query(`UPDATE import_batches SET status='COMMITTING',updated_at=now() WHERE id=$1`, [batchId]);
        const rows = await client.query(
          `SELECT id,row_number,normalized_values,operation,target_asset_id,target_asset_revision
             FROM import_batch_rows WHERE batch_id=$1 AND included AND status IN ('VALID','WARNING') ORDER BY row_number FOR UPDATE`,
          [batchId],
        );
        if (!rows.rowCount) throw new AppError(422, 'IMPORT_NO_INCLUDED_ROWS', 'Include at least one valid row before commit.');
        const parentEventId = await recordActivity(client, { user, actionKey: 'IMPORT_COMMIT_STARTED', source: 'csv-import', reason: `${batch.mode === 'CREATE' ? 'Create Assets' : 'Update Existing'} batch commit.`, recordType: 'import', recordId: batchId, recordLabel: batch.file_name, routePath: `/import?session=${batchId}`, parentImportBatchId: batchId, metadata: { rows: rows.rowCount, mode: batch.mode, idempotencyKey: batch.idempotency_key } });
        for (const row of rows.rows) {
          let asset;
          if (batch.mode === 'CREATE') {
            asset = await assetInternals.createAsset(client, Number(batch.profile_id), row.normalized_values, user, `Created by import ${batch.file_name}.`, 'csv-import', batchId);
          } else {
            const target = parseValidatedTarget(row.target_asset_id, row.target_asset_revision);
            if (!target) {
              throw new AppError(409, 'IMPORT_TARGET_STALE', `Row ${row.row_number} must be revalidated before commit.`);
            }
            asset = await assetInternals.updateAsset(client, target.assetId, target.revision, row.normalized_values, user, `Updated by import ${batch.file_name}.`, 'csv-import', batchId);
          }
          await client.query(`UPDATE import_batch_rows SET status='COMMITTED',committed_asset_id=$2,updated_at=now() WHERE id=$1`, [row.id, asset.id]);
          await client.query(
            `INSERT INTO import_commit_results(batch_id,import_row_id,asset_id,operation,asset_revision) VALUES($1,$2,$3,$4,$5)
             ON CONFLICT (batch_id,import_row_id) DO NOTHING`,
            [batchId, row.id, asset.id, batch.mode, asset.revision],
          );
        }
        await client.query(`UPDATE import_batches SET status='COMPLETED',committed_at=now(),completed_at=now(),updated_at=now() WHERE id=$1`, [batchId]);
        await recordActivity(client, { user, actionKey: 'IMPORT_COMPLETED', source: 'csv-import', reason: 'All included rows committed in one transaction.', recordType: 'import', recordId: batchId, recordLabel: batch.file_name, routePath: `/import?session=${batchId}`, parentEventId, parentImportBatchId: batchId, metadata: { rows: rows.rowCount, mode: batch.mode } });
        return { session: await sessionDetail(client, batchId), idempotent: false, refresh: importRefreshTargets };
      });
    } catch (error) {
      const conflict = error instanceof AppError && error.statusCode === 409;
      await pool.query(
        `UPDATE import_batches SET status=$2,failure_message=$3,updated_at=now() WHERE id=$1 AND status<>'COMPLETED'`,
        [batchId, conflict ? 'NEEDS_REVALIDATION' : 'FAILED', error instanceof Error ? error.message : 'Import commit failed.'],
      ).catch(() => undefined);
      throw error;
    }
  });

  app.post('/api/v1/imports/:id/cancel', { preHandler: requirePermission('import.execute') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const batchId = (request.params as { id: string }).id;
    return withTransaction(async (client) => {
      const batch = await loadSessionContext(client, batchId, true);
      requireSessionAccess(user, batch);
      if (batch.status === 'COMPLETED') throw new AppError(409, 'IMPORT_COMPLETED', 'A completed import cannot be cancelled.');
      await client.query(`UPDATE import_batches SET status='CANCELLED',updated_at=now() WHERE id=$1`, [batchId]);
      await recordActivity(client, { user, actionKey: 'IMPORT_CANCELLED', source: 'csv-import', reason: 'Import session cancelled.', recordType: 'import', recordId: batchId, recordLabel: batch.file_name ?? 'Import session', routePath: `/import?session=${batchId}`, parentImportBatchId: batchId });
      return { session: await sessionDetail(client, batchId) };
    });
  });
}

export const importInternals = {
  parseCsv,
  autoMappings,
  mappingAssessment,
  normalizeDate,
  normalizeField,
  validationRuleIssues,
  parseValidatedTarget,
  classifyImportRow,
  importIssueRoute,
  importRefreshTargets,
  buildImportTemplate,
  requireSessionAccess,
};
