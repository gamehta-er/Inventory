import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { pool, withTransaction, type DbClient } from './db.js';
import { AppError } from './errors.js';
import { requirePermission, verifyCsrf } from './auth.js';
import { canonicalizeFieldValue, loadProfileFields, lookupOptionForValue, lookupStoresReferenceId } from './registry.js';
import { assetInternals } from './assets.js';
import { normalizeNVBugs } from './references.js';
import { recordActivity } from './activity.js';
import type { AuthenticatedRequest, FieldDefinition, SessionUser } from './types.js';
import { matchLookupOption } from './lookupMatching.js';
import { normalizeImportHeader } from './importSourceValues.js';
import { canonicalDateText } from './databaseValues.js';
import { csvCell } from './csvSafety.js';
import {
  buildImportWorkbook,
  importSourceSchemaVersion,
  inspectCsvSource,
  inspectImportSource,
  type ImportSourceOptions,
  type ParsedImportSource,
} from './importSources.js';
import {
  disableImportsAfterVerificationFailure,
  loadImportControl,
  recordImportStage,
  requireImportCommitAllowed,
  type ImportMismatchField,
} from './importGovernance.js';

type Values = Record<string, unknown>;
type ImportMode = 'CREATE' | 'UPDATE';
type SessionStatus = 'DRAFT' | 'SOURCE_SELECTION' | 'MAPPING' | 'VALIDATING' | 'NEEDS_ATTENTION' | 'AWAITING_APPROVAL' | 'DECLINED' | 'APPROVED' | 'READY' | 'COMMITTING' | 'COMPLETED' | 'FAILED' | 'VERIFICATION_FAILED' | 'CANCELLED' | 'NEEDS_REVALIDATION';
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

interface PreparedImportRow {
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
}

const modelFieldColumns: Record<string, string> = {
  model_number: 'model_number',
  product_name: 'product_name',
  board_sku: 'board_sku',
  gpu_sku: 'gpu_sku',
  board_architecture: 'board_architecture',
  gpu_class: 'gpu_class',
  gpu_chip: 'gpu_chip',
  gpu_name_vrl: 'gpu_name_vrl',
  gpu_name_market: 'gpu_name_market',
};

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\u00a0/g, ' ').trim();
}

function normalizedValue(value: unknown): string {
  return cleanText(value).toLocaleLowerCase().replace(/\s+/g, ' ');
}

function buildImportTemplate(fields: FieldDefinition[]): string {
  return `\uFEFF${fields.map((field) => csvCell(field.label)).join(',')}\r\n`;
}

function serializeImportHeaders(headers: string[]): string {
  return JSON.stringify(headers);
}

function serializeImportIssueSuggestions(values: string[] | undefined): string {
  return JSON.stringify(values ?? []);
}

function parseCsv(contents: Buffer): Pick<ParsedImportSource, 'headers' | 'rows'> {
  const inspection = inspectCsvSource(contents);
  if (!inspection.parsed) throw new AppError(422, 'CSV_SOURCE_OPTIONS_REQUIRED', 'Choose the CSV delimiter before continuing.');
  return { headers: inspection.parsed.headers, rows: inspection.parsed.rows };
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

function canAutoValidateMappings(headers: string[], fields: FieldDefinition[], mappings: MappingInput[]): boolean {
  return headers.length > 0
    && mappings.length === headers.length
    && !mappingAssessment(headers, fields, mappings).some((issue) => issue.severity === 'ERROR');
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
  const locations = await client.query('SELECT id,full_path label FROM locations WHERE active ORDER BY full_path');
  const owners = await client.query('SELECT id,display_name label FROM application_users WHERE active ORDER BY display_name');
  const vendors = await client.query('SELECT id,vendor_name label FROM vendors WHERE active ORDER BY vendor_name');
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

function hasImportValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function comparableImportValue(value: unknown): unknown {
  if (!hasImportValue(value)) return null;
  if (Array.isArray(value)) return value.map(comparableImportValue);
  return typeof value === 'string' ? value.trim() : value;
}

function modelValueToken(value: unknown): string {
  const comparable = comparableImportValue(value);
  return typeof comparable === 'string' ? normalizedValue(comparable) : JSON.stringify(comparable);
}

function reconcileModelGroup(rows: PreparedImportRow[], modelFields: FieldDefinition[], existingModel: Values | null): void {
  const modelNumber = cleanText(rows[0]?.values.model_number);
  for (const field of modelFields) {
    const suppliedRows = rows.filter((row) => hasImportValue(row.values[field.fieldKey]));
    const suppliedValues = new Map<string, unknown>();
    for (const row of suppliedRows) suppliedValues.set(modelValueToken(row.values[field.fieldKey]), row.values[field.fieldKey]);

    if (suppliedValues.size > 1) {
      const sourceValue = [...suppliedValues.values()].map(cleanText).join(' / ');
      for (const row of rows) {
        row.issues.push({
          fieldKey: field.fieldKey,
          severity: 'ERROR',
          code: 'MODEL_VALUE_CONFLICT_IN_FILE',
          sourceValue,
          message: `${field.label} must be consistent for every row using Model # ${modelNumber}.`,
        });
      }
      continue;
    }

    const suppliedValue = suppliedValues.values().next().value as unknown;
    const storedValue = existingModel?.[field.fieldKey];
    if (hasImportValue(storedValue) && hasImportValue(suppliedValue) && modelValueToken(storedValue) !== modelValueToken(suppliedValue)) {
      for (const row of suppliedRows) {
        row.issues.push({
          fieldKey: field.fieldKey,
          severity: 'ERROR',
          code: 'MODEL_VALUE_CONFLICT_EXISTING',
          sourceValue: cleanText(row.values[field.fieldKey]),
          suggestedValues: [cleanText(storedValue)],
          message: `Model # ${modelNumber} already uses ${field.label} "${cleanText(storedValue)}". Use that shared model value or choose a different Model #.`,
        });
      }
      continue;
    }

    const effectiveValue = hasImportValue(storedValue) ? storedValue : hasImportValue(suppliedValue) ? suppliedValue : null;
    for (const row of rows) row.values[field.fieldKey] = effectiveValue;
  }
}

async function reconcileModelValues(client: DbClient, categoryId: number, fields: FieldDefinition[], rows: PreparedImportRow[]): Promise<void> {
  const modelFields = fields.filter((field) => modelFieldColumns[field.fieldKey] && field.storageTarget === `asset_models.${modelFieldColumns[field.fieldKey]}`);
  if (!modelFields.length) return;

  const rowsByModel = new Map<string, PreparedImportRow[]>();
  for (const row of rows.filter((candidate) => candidate.included)) {
    const modelNumber = normalizedValue(row.values.model_number);
    if (!modelNumber) continue;
    rowsByModel.set(modelNumber, [...(rowsByModel.get(modelNumber) ?? []), row]);
  }

  for (const group of rowsByModel.values()) {
    const modelNumber = cleanText(group[0]?.values.model_number);
    const existing = await client.query<Values>(
      `SELECT model_number,product_name,board_sku,gpu_sku,board_architecture,gpu_class,gpu_chip,gpu_name_vrl,gpu_name_market
         FROM asset_models WHERE category_id=$1 AND lower(model_number)=lower($2)`,
      [categoryId, modelNumber],
    );
    reconcileModelGroup(group, modelFields, existing.rows[0] ?? null);
  }
}

function importValueType(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return 'date';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function fieldComparableValue(field: FieldDefinition, value: unknown): unknown {
  if (field.dataType === 'date') return canonicalDateText(value);
  if (field.dataType === 'entity' || lookupStoresReferenceId(field)) {
    const comparable = comparableImportValue(value);
    if (comparable === null) return null;
    const referenceId = Number(comparable);
    return Number.isSafeInteger(referenceId) ? referenceId : comparable;
  }
  return comparableImportValue(value);
}

function committedValueMismatchDetails(fields: FieldDefinition[], expected: Values, actual: Values): ImportMismatchField[] {
  return fields.flatMap((field) => {
    const expectedValue = expected[field.fieldKey];
    const actualValue = actual[field.fieldKey];
    return JSON.stringify(fieldComparableValue(field, expectedValue)) === JSON.stringify(fieldComparableValue(field, actualValue))
      ? []
      : [{ fieldKey: field.fieldKey, expectedType: importValueType(expectedValue), actualType: importValueType(actualValue) }];
  });
}

function committedValueMismatches(fields: FieldDefinition[], expected: Values, actual: Values): string[] {
  return committedValueMismatchDetails(fields, expected, actual).map((mismatch) => mismatch.fieldKey);
}

async function loadSessionContext(client: DbClient, batchId: string, lock = false) {
  const result = await client.query(
    `SELECT b.*,ip.profile_id,ip.import_profile_name,ap.profile_name,ap.profile_key,ap.version current_profile_version,
             c.id category_id,c.category_name,c.category_key,u.display_name created_by
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
  const canManageAllSessions = user.permissions.includes('import.review') || user.permissions.includes('admin.profile');
  if (!ownsSession && !canManageAllSessions) {
    throw new AppError(403, 'FORBIDDEN', 'You cannot access another user\'s import session.');
  }
}

function requireSessionOwner(user: SessionUser, batch: { created_by_user_id: number | string }): void {
  if (Number(batch.created_by_user_id) !== Number(user.id)) {
    throw new AppError(403, 'IMPORT_OWNER_REQUIRED', 'Only the person who started this import can change or commit it.');
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function calculateDraftHash(client: DbClient, batchId: string): Promise<string> {
  const batch = await loadSessionContext(client, batchId);
  const mappings = await loadMappings(client, batchId);
  const rows = await client.query(
    `SELECT row_number,included,operation,target_asset_id,target_asset_revision,normalized_values
       FROM import_batch_rows WHERE batch_id=$1 ORDER BY row_number`,
    [batchId],
  );
  const contract = {
    fileSha256: batch.file_sha256,
    sourceFormat: batch.source_format,
    sourceSheetName: batch.source_sheet_name,
    sourceEncoding: batch.source_encoding,
    sourceDelimiter: batch.source_delimiter,
    sourceSchemaVersion: batch.source_schema_version,
    mode: batch.mode,
    profileVersion: Number(batch.profile_version),
    contractFingerprint: batch.contract_fingerprint,
    draftRevision: Number(batch.draft_revision),
    mappings: mappings.map((mapping) => ({ sourceIndex: mapping.sourceIndex, fieldKey: mapping.fieldKey ?? null, ignored: Boolean(mapping.ignored) })),
    rows: rows.rows.map((row) => ({
      rowNumber: Number(row.row_number),
      included: Boolean(row.included),
      operation: row.operation,
      targetAssetId: row.target_asset_id === null ? null : Number(row.target_asset_id),
      targetAssetRevision: row.target_asset_revision === null ? null : Number(row.target_asset_revision),
      normalizedValues: row.normalized_values,
    })),
  };
  return createHash('sha256').update(stableJson(contract)).digest('hex');
}

async function invalidateDraft(client: DbClient, batchId: string, status: SessionStatus = 'NEEDS_REVALIDATION'): Promise<number> {
  const result = await client.query<{ draft_revision: number }>(
    `UPDATE import_batches
     SET status=$2,draft_revision=draft_revision+1,draft_hash=NULL,
         verification_status='NOT_RUN',verification_details='{}'::jsonb,
         validated_at=NULL,failure_message=NULL,updated_at=now()
     WHERE id=$1
     RETURNING draft_revision`,
    [batchId, status],
  );
  return Number(result.rows[0]?.draft_revision ?? 0);
}

async function stageParsedSource(client: DbClient, batchId: string, parsed: ParsedImportSource, fields: FieldDefinition[]): Promise<MappingInput[]> {
  await client.query('DELETE FROM import_batch_rows WHERE batch_id=$1', [batchId]);
  await client.query('DELETE FROM import_column_mappings WHERE batch_id=$1', [batchId]);
  const stagedRows = parsed.rows.map((row, index) => ({
    rowNumber: parsed.rowNumbers[index] ?? index + 2,
    sourceValues: Object.fromEntries(parsed.headers.map((_header, sourceIndex) => [String(sourceIndex), row[sourceIndex] ?? ''])),
  }));
  await client.query(
    `INSERT INTO import_batch_rows(batch_id,row_number,source_values,normalized_values,status)
     SELECT $1,source.row_number,source.source_values,'{}'::jsonb,'PENDING'
       FROM jsonb_to_recordset($2::jsonb) AS source(row_number integer,source_values jsonb)
      ORDER BY source.row_number`,
    [batchId, JSON.stringify(stagedRows.map((row) => ({ row_number: row.rowNumber, source_values: row.sourceValues })))],
  );
  const automaticMappings = autoMappings(parsed.headers, fields);
  const mappedColumns = automaticMappings.map((mapping) => ({
    source_header: parsed.headers[mapping.sourceIndex],
    source_index: mapping.sourceIndex,
    field_definition_id: fields.find((item) => item.fieldKey === mapping.fieldKey)!.id,
  }));
  await client.query(
    `INSERT INTO import_column_mappings(batch_id,source_header,source_index,field_definition_id,ignored)
     SELECT $1,mapping.source_header,mapping.source_index,mapping.field_definition_id,false
       FROM jsonb_to_recordset($2::jsonb)
         AS mapping(source_header text,source_index integer,field_definition_id bigint)`,
    [batchId, JSON.stringify(mappedColumns)],
  );
  return automaticMappings;
}

async function markStaleIfNeeded(client: DbClient, batchId: string): Promise<boolean> {
  const batch = await loadSessionContext(client, batchId, true);
  if (['COMPLETED', 'CANCELLED'].includes(batch.status)) return false;
  const fields = (await loadProfileFields(Number(batch.profile_id), client)).filter((field) => field.surfaces.import);
  const fingerprint = await currentContractFingerprint(client, Number(batch.current_profile_version), fields);
  if (batch.contract_fingerprint !== fingerprint) {
    await invalidateDraft(client, batchId);
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
  const startedAt = Date.now();
  const batch = await loadSessionContext(client, batchId, true);
  if (['COMPLETED', 'CANCELLED'].includes(batch.status)) throw new AppError(409, 'IMPORT_SESSION_CLOSED', 'This import session is closed.');
  if (!batch.original_file) throw new AppError(422, 'IMPORT_FILE_REQUIRED', 'Upload a CSV or XLSX file before validation.');
  if (batch.status === 'SOURCE_SELECTION') throw new AppError(422, 'IMPORT_SOURCE_OPTIONS_REQUIRED', 'Choose the worksheet or CSV delimiter before validation.');

  const fields = (await loadProfileFields(Number(batch.profile_id), client)).filter((field) => field.surfaces.import);
  if (!fields.length) throw new AppError(422, 'IMPORT_PROFILE_EMPTY', 'The selected profile has no enabled import fields.');
  const headers: string[] = Array.isArray(batch.original_headers) ? batch.original_headers.map(String) : [];
  const mappings = await loadMappings(client, batchId);
  const mappingIssues = mappingAssessment(headers, fields, mappings);
  const fingerprint = await currentContractFingerprint(client, Number(batch.current_profile_version), fields);
  if (mappingIssues.some((issue) => issue.severity === 'ERROR')) {
    await client.query(
      `UPDATE import_batches SET status='MAPPING',profile_version=$2,contract_fingerprint=$3,draft_hash=NULL,validated_at=NULL,updated_at=now() WHERE id=$1`,
      [batchId, batch.current_profile_version, fingerprint],
    );
    await recordImportStage(client, {
      batchId,
      stage: 'VALIDATION',
      eventKey: 'MAPPING_REQUIRED',
      draftRevision: Number(batch.draft_revision),
      durationMs: Date.now() - startedAt,
      rowCount: Number(batch.total_rows),
      metadata: { mappingErrorCount: mappingIssues.filter((issue) => issue.severity === 'ERROR').length },
    });
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

  const prepared: PreparedImportRow[] = [];
  const normalizationCache = new Map<string, { value: unknown; issues: Issue[] }>();

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
      const cacheKey = `${field.id}\u0000${cleanText(rawByField[field.fieldKey])}`;
      let normalized = normalizationCache.get(cacheKey);
      if (!normalized) {
        normalized = await normalizeField(client, field, rawByField[field.fieldKey]);
        normalizationCache.set(cacheKey, normalized);
      }
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

  await reconcileModelValues(client, Number(batch.category_id), fields, prepared);

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

  await client.query(
    'DELETE FROM import_validation_issues WHERE import_row_id IN (SELECT id FROM import_batch_rows WHERE batch_id=$1)',
    [batchId],
  );
  const counts = { valid: 0, warning: 0, invalid: 0 };
  const rowUpdates: Array<Record<string, unknown>> = [];
  const issueInserts: Array<Record<string, unknown>> = [];
  for (const row of prepared) {
    if (!row.included) {
      rowUpdates.push({ id: row.id, normalized_values: {}, status: 'EXCLUDED', operation: null, target_asset_id: null, target_asset_revision: null, before_values: null, after_values: null });
      continue;
    }
    const status = classifyImportRow(row.issues);
    if (status === 'VALID') counts.valid++;
    else if (status === 'WARNING') counts.warning++;
    else counts.invalid++;
    rowUpdates.push({
      id: row.id,
      normalized_values: row.values,
      status,
      operation: batch.mode,
      target_asset_id: row.targetAssetId,
      target_asset_revision: row.targetRevision,
      before_values: row.beforeValues,
      after_values: row.values,
    });
    for (const issue of row.issues) {
      issueInserts.push({
        import_row_id: row.id,
        field_key: issue.fieldKey ?? null,
        severity: issue.severity,
        issue_code: issue.code,
        message: issue.message,
        source_value: issue.sourceValue ?? null,
        suggested_values: issue.suggestedValues ?? [],
      });
    }
  }
  await client.query(
    `UPDATE import_batch_rows AS target
        SET normalized_values=staged.normalized_values,status=staged.status,operation=staged.operation,
            target_asset_id=staged.target_asset_id,target_asset_revision=staged.target_asset_revision,
            before_values=staged.before_values,after_values=staged.after_values,updated_at=now()
       FROM jsonb_to_recordset($2::jsonb) AS staged(
         id bigint,normalized_values jsonb,status text,operation text,target_asset_id bigint,
         target_asset_revision integer,before_values jsonb,after_values jsonb
       )
      WHERE target.batch_id=$1 AND target.id=staged.id`,
    [batchId, JSON.stringify(rowUpdates)],
  );
  if (issueInserts.length) {
    await client.query(
      `INSERT INTO import_validation_issues(import_row_id,field_key,severity,issue_code,message,source_value,suggested_values)
       SELECT issue.import_row_id,issue.field_key,issue.severity,issue.issue_code,issue.message,issue.source_value,issue.suggested_values
         FROM jsonb_to_recordset($1::jsonb) AS issue(
           import_row_id bigint,field_key text,severity text,issue_code text,message text,source_value text,suggested_values jsonb
         )`,
      [JSON.stringify(issueInserts)],
    );
  }

  const status: SessionStatus = counts.invalid > 0 ? 'NEEDS_ATTENTION' : 'AWAITING_APPROVAL';
  await client.query(
    `UPDATE import_batches
     SET status=$2,profile_version=$3,contract_fingerprint=$4,total_rows=$5,valid_rows=$6,warning_rows=$7,invalid_rows=$8,
         draft_hash=NULL,verification_status='NOT_RUN',verification_details='{}'::jsonb,
         validated_at=now(),updated_at=now(),failure_message=NULL
     WHERE id=$1`,
    [batchId, status, batch.current_profile_version, fingerprint, rows.rowCount, counts.valid, counts.warning, counts.invalid],
  );
  const draftHash = counts.invalid > 0 ? null : await calculateDraftHash(client, batchId);
  if (draftHash) await client.query('UPDATE import_batches SET draft_hash=$2,updated_at=now() WHERE id=$1', [batchId, draftHash]);
  await recordImportStage(client, {
    batchId,
    stage: 'VALIDATION',
    eventKey: counts.invalid > 0 ? 'VALIDATION_BLOCKED' : 'DRAFT_READY_FOR_REVIEW',
    draftRevision: Number(batch.draft_revision),
    durationMs: Date.now() - startedAt,
    rowCount: rows.rowCount,
    metadata: { validRows: counts.valid, warningRows: counts.warning, invalidRows: counts.invalid },
  });
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
  const reviews = await client.query(
    `SELECT review.id,review.draft_revision,review.draft_hash,review.decision,review.reason,review.created_at,
            review.reviewer_user_id,user_account.display_name reviewer_name
       FROM import_reviews review
       JOIN application_users user_account ON user_account.id=review.reviewer_user_id
      WHERE review.batch_id=$1 AND review.draft_revision=$2 AND review.draft_hash=$3
      ORDER BY review.created_at`,
    [batchId, batch.draft_revision, batch.draft_hash],
  );
  const stageEvents = await client.query(
    `SELECT stage,event_key,draft_revision,row_number,duration_ms,row_count,mismatch_fields,metadata,created_at
       FROM import_stage_events WHERE batch_id=$1 ORDER BY created_at,id`,
    [batchId],
  );
  const importControl = await loadImportControl(client);
  const fieldsByKey = new Map(fields.map((field) => [field.fieldKey, field]));
  const entities = await entityOptions(client);
  const sessionFields = fields.map((field) => field.dataType === 'entity'
    ? { ...field, options: entities[field.fieldKey] ?? [] }
    : field);
  const acceptedReviews = reviews.rows.filter((review) => review.decision === 'ACCEPT').length;
  const declinedReviews = reviews.rows.filter((review) => review.decision === 'DECLINE').length;
  const includedRows = rows.rows.filter((row) => row.included);
  const changedFieldCount = includedRows.reduce((count, row) => {
    if (row.operation !== 'UPDATE' || !row.before_values || !row.after_values) return count;
    return count + fields.filter((field) => stableJson(row.before_values[field.fieldKey]) !== stableJson(row.after_values[field.fieldKey])).length;
  }, 0);
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
    fileSha256: batch.file_sha256,
    fileSizeBytes: batch.file_size_bytes === null ? null : Number(batch.file_size_bytes),
    sourceFormat: batch.source_format,
    sourceSheetName: batch.source_sheet_name,
    sourceEncoding: batch.source_encoding,
    sourceDelimiter: batch.source_delimiter,
    sourceSchemaVersion: batch.source_schema_version,
    sourceOptions: batch.source_options ?? {},
    availableSheets: Array.isArray(batch.available_sheets) ? batch.available_sheets : [],
    draftRevision: Number(batch.draft_revision),
    draftHash: batch.draft_hash,
    idempotencyKey: batch.idempotency_key,
    verificationStatus: batch.verification_status,
    verificationDetails: batch.verification_details ?? {},
    status: batch.status,
    totalRows: Number(batch.total_rows),
    validRows: Number(batch.valid_rows),
    warningRows: Number(batch.warning_rows),
    invalidRows: Number(batch.invalid_rows),
    createdBy: batch.created_by,
    createdByUserId: Number(batch.created_by_user_id),
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
    reviews: reviews.rows.map((review) => ({
      id: Number(review.id),
      draftRevision: Number(review.draft_revision),
      draftHash: review.draft_hash,
      reviewerUserId: Number(review.reviewer_user_id),
      reviewerName: review.reviewer_name,
      decision: review.decision,
      reason: review.reason,
      createdAt: review.created_at,
    })),
    approvalProgress: { accepted: acceptedReviews, declined: declinedReviews, required: 2 },
    reviewSummary: {
      includedRows: includedRows.length,
      excludedRows: rows.rows.length - includedRows.length,
      createRows: includedRows.filter((row) => row.operation === 'CREATE').length,
      updateRows: includedRows.filter((row) => row.operation === 'UPDATE').length,
      warningRows: Number(batch.warning_rows),
      changedFields: changedFieldCount,
    },
    stageEvents: stageEvents.rows,
    importControl,
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
  if (mappings.length !== headers.length) throw new AppError(422, 'MAPPING_INCOMPLETE', 'Choose a field or Ignore for every source column.');
  const sourceIndexes = mappings.map((mapping) => mapping.sourceIndex);
  if (sourceIndexes.some((sourceIndex) => !Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= headers.length)) {
    throw new AppError(422, 'MAPPING_SOURCE_INVALID', 'One or more column mappings refer to a source column that does not exist.');
  }
  if (new Set(sourceIndexes).size !== sourceIndexes.length) {
    throw new AppError(422, 'MAPPING_SOURCE_DUPLICATE', 'Each source column must have exactly one mapping decision.');
  }
  for (const mapping of mappings) {
    if (Boolean(mapping.ignored) === Boolean(mapping.fieldKey)) {
      throw new AppError(422, 'MAPPING_DECISION_INVALID', 'Each source column must be mapped to one field or explicitly ignored.');
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
  await client.query('UPDATE import_batches SET mapping_revision=mapping_revision+1 WHERE id=$1', [batchId]);
  await invalidateDraft(client, batchId);
}

function requireModePermission(user: SessionUser, mode: ImportMode): void {
  const permission = mode === 'CREATE' ? 'asset.create' : 'asset.update';
  if (!user.permissions.includes(permission)) throw new AppError(403, 'FORBIDDEN', `Your role cannot use ${mode === 'CREATE' ? 'Create Assets' : 'Update Existing'} import mode.`);
}

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/imports/control', { preHandler: requirePermission('import.execute') }, async () => ({ importControl: await loadImportControl() }));

  app.get('/api/v1/imports', { preHandler: requirePermission('import.execute') }, async (request) => {
    const user = (request as AuthenticatedRequest).inventoryUser;
    const result = await pool.query(
      `SELECT b.id,b.mode,b.file_name,b.status,b.total_rows,b.valid_rows,b.warning_rows,b.invalid_rows,b.created_at,b.updated_at,b.completed_at,
              c.category_name,ap.profile_name,u.display_name created_by
         FROM import_batches b JOIN import_profiles ip ON ip.id=b.import_profile_id JOIN asset_profiles ap ON ap.id=ip.profile_id
         JOIN categories c ON c.id=ap.category_id JOIN application_users u ON u.id=b.created_by_user_id
        WHERE b.created_by_user_id=$1 OR $2::boolean
        ORDER BY b.updated_at DESC LIMIT 100`,
      [user.id, user.permissions.includes('import.review') || user.permissions.includes('admin.profile')],
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
  app.get('/api/v1/profiles/:id/import-template.xlsx', { preHandler: requirePermission('import.execute') }, async (request, reply) => {
    const profileId = Number((request.params as { id: string }).id);
    const fields = (await loadProfileFields(profileId)).filter((field) => field.surfaces.import);
    if (!fields.length) throw new AppError(404, 'PROFILE_NOT_FOUND', 'Import profile not found or it has no enabled import fields.');
    const profile = await pool.query('SELECT profile_key,version FROM asset_profiles WHERE id=$1 AND active', [profileId]);
    if (!profile.rows[0]) throw new AppError(404, 'PROFILE_NOT_FOUND', 'Import profile not found.');
    const workbook = await buildImportWorkbook(fields);
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('content-disposition', `attachment; filename="${profile.rows[0].profile_key.toLowerCase()}-v${profile.rows[0].version}-import.xlsx"`);
    return reply.send(workbook);
  });

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
      await recordActivity(client, { user, actionKey: 'IMPORT_SESSION_CREATED', source: 'inventory-import', reason: `${mode === 'CREATE' ? 'Create Assets' : 'Update Existing'} import session started.`, recordType: 'import', recordId: created.rows[0]!.id, recordLabel: 'New import session', routePath: `/import?session=${created.rows[0]!.id}`, parentImportBatchId: created.rows[0]!.id, metadata: { profileId, mode } });
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
    if (!contents || !/\.(csv|xlsx)$/i.test(fileName)) throw new AppError(415, 'IMPORT_FILE_REQUIRED', 'Choose a CSV or XLSX inventory file.');
    const analysisStartedAt = Date.now();
    const inspection = await inspectImportSource(fileName, contents);
    const analysisDuration = Date.now() - analysisStartedAt;
    return withTransaction(async (client) => {
      const batch = await loadSessionContext(client, batchId, true);
      requireSessionOwner(user, batch);
      if (['COMPLETED', 'CANCELLED'].includes(batch.status)) throw new AppError(409, 'IMPORT_SESSION_CLOSED', 'This import session is closed.');
      const fields = (await loadProfileFields(Number(batch.profile_id), client)).filter((field) => field.surfaces.import);
      await client.query('DELETE FROM import_batch_rows WHERE batch_id=$1', [batchId]);
      await client.query('DELETE FROM import_column_mappings WHERE batch_id=$1', [batchId]);
      const nextStatus: SessionStatus = inspection.selectionRequired ? 'SOURCE_SELECTION' : 'MAPPING';
      const draftRevision = await invalidateDraft(client, batchId, nextStatus);
      const automaticMappings = inspection.parsed ? await stageParsedSource(client, batchId, inspection.parsed, fields) : [];
      const sourceOptions = {
        sheetName: inspection.sheetName,
        encoding: inspection.encoding,
        delimiter: inspection.delimiter,
        delimiterCandidates: inspection.delimiterCandidates,
      };
      await client.query(
        `UPDATE import_batches
         SET file_name=$2,file_sha256=$3,original_file=$4,original_csv=$5,source_format=$6,
             source_sheet_name=$7,source_encoding=$8,source_delimiter=$9,file_size_bytes=$10,
             source_schema_version=$11,source_options=$12::jsonb,available_sheets=$13::jsonb,
             original_headers=$14::jsonb,status=$15,total_rows=$16,valid_rows=0,warning_rows=0,invalid_rows=0,
             validated_at=NULL,updated_at=now(),failure_message=NULL
         WHERE id=$1`,
        [
          batchId,
          fileName,
          createHash('sha256').update(contents).digest('hex'),
          contents,
          inspection.format === 'CSV' ? contents : null,
          inspection.format,
          inspection.sheetName,
          inspection.encoding,
          inspection.delimiter,
          contents.length,
          importSourceSchemaVersion,
          JSON.stringify(sourceOptions),
          JSON.stringify(inspection.availableSheets),
          serializeImportHeaders(inspection.parsed?.headers ?? []),
          nextStatus,
          inspection.parsed?.rows.length ?? 0,
        ],
      );
      const mappingWasAutomatic = Boolean(inspection.parsed && canAutoValidateMappings(inspection.parsed.headers, fields, automaticMappings));
      if (mappingWasAutomatic) await validateSession(client, batchId);
      await recordImportStage(client, {
        batchId,
        stage: 'ANALYSIS',
        eventKey: inspection.selectionRequired ? 'SOURCE_SELECTION_REQUIRED' : 'SOURCE_PARSED',
        draftRevision,
        durationMs: analysisDuration,
        rowCount: inspection.parsed?.rows.length ?? 0,
        metadata: {
          format: inspection.format,
          columns: inspection.parsed?.headers.length ?? 0,
          sheetCount: inspection.availableSheets.length,
          mappingWasAutomatic,
        },
      });
      await recordActivity(client, {
        user,
        actionKey: 'IMPORT_FILE_UPLOADED',
        source: 'inventory-import',
        reason: inspection.selectionRequired
          ? `${inspection.format} uploaded. Choose the source options to continue.`
          : mappingWasAutomatic
            ? `${inspection.format} uploaded, confidently mapped, and validated automatically.`
            : `${inspection.format} uploaded. One or more column decisions require review.`,
        recordType: 'import',
        recordId: batchId,
        recordLabel: fileName,
        routePath: `/import?session=${batchId}`,
        parentImportBatchId: batchId,
        metadata: { format: inspection.format, rows: inspection.parsed?.rows.length ?? 0, columns: inspection.parsed?.headers.length ?? 0, mappingWasAutomatic, draftRevision },
      });
      return { session: await sessionDetail(client, batchId) };
    });
  });

  app.post('/api/v1/imports/:id/source-options', { preHandler: requirePermission('import.execute') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const batchId = (request.params as { id: string }).id;
    const body = request.body as { sheetName?: unknown; delimiter?: unknown; encoding?: unknown };
    const options: ImportSourceOptions = {};
    if (body.sheetName !== undefined) options.sheetName = cleanText(body.sheetName);
    if (body.delimiter !== undefined) {
      const delimiter = String(body.delimiter);
      if (![',', ';', '\t'].includes(delimiter)) throw new AppError(422, 'CSV_DELIMITER_INVALID', 'Choose comma, semicolon, or tab as the delimiter.');
      options.delimiter = delimiter as NonNullable<ImportSourceOptions['delimiter']>;
    }
    if (body.encoding !== undefined) {
      const encoding = String(body.encoding);
      if (!['utf-8', 'windows-1252'].includes(encoding)) throw new AppError(422, 'CSV_ENCODING_INVALID', 'Choose UTF-8 or Windows-1252 encoding.');
      options.encoding = encoding as NonNullable<ImportSourceOptions['encoding']>;
    }
    return withTransaction(async (client) => {
      const batch = await loadSessionContext(client, batchId, true);
      requireSessionOwner(user, batch);
      if (!batch.original_file || !batch.file_name) throw new AppError(422, 'IMPORT_FILE_REQUIRED', 'Upload a CSV or XLSX file first.');
      if (['COMPLETED', 'CANCELLED'].includes(batch.status)) throw new AppError(409, 'IMPORT_SESSION_CLOSED', 'This import session is closed.');
      const startedAt = Date.now();
      const inspection = await inspectImportSource(String(batch.file_name), batch.original_file as Buffer, options);
      const fields = (await loadProfileFields(Number(batch.profile_id), client)).filter((field) => field.surfaces.import);
      await client.query('DELETE FROM import_batch_rows WHERE batch_id=$1', [batchId]);
      await client.query('DELETE FROM import_column_mappings WHERE batch_id=$1', [batchId]);
      const nextStatus: SessionStatus = inspection.selectionRequired ? 'SOURCE_SELECTION' : 'MAPPING';
      const draftRevision = await invalidateDraft(client, batchId, nextStatus);
      const automaticMappings = inspection.parsed ? await stageParsedSource(client, batchId, inspection.parsed, fields) : [];
      await client.query(
        `UPDATE import_batches
         SET source_sheet_name=$2,source_encoding=$3,source_delimiter=$4,source_options=$5::jsonb,
             available_sheets=$6::jsonb,original_headers=$7::jsonb,status=$8,total_rows=$9,
             valid_rows=0,warning_rows=0,invalid_rows=0,updated_at=now()
         WHERE id=$1`,
        [
          batchId,
          inspection.sheetName,
          inspection.encoding,
          inspection.delimiter,
          JSON.stringify({ sheetName: inspection.sheetName, encoding: inspection.encoding, delimiter: inspection.delimiter, delimiterCandidates: inspection.delimiterCandidates }),
          JSON.stringify(inspection.availableSheets),
          serializeImportHeaders(inspection.parsed?.headers ?? []),
          nextStatus,
          inspection.parsed?.rows.length ?? 0,
        ],
      );
      const mappingWasAutomatic = Boolean(inspection.parsed && canAutoValidateMappings(inspection.parsed.headers, fields, automaticMappings));
      if (mappingWasAutomatic) await validateSession(client, batchId);
      await recordImportStage(client, {
        batchId,
        stage: 'ANALYSIS',
        eventKey: inspection.selectionRequired ? 'SOURCE_SELECTION_REQUIRED' : 'SOURCE_OPTIONS_APPLIED',
        draftRevision,
        durationMs: Date.now() - startedAt,
        rowCount: inspection.parsed?.rows.length ?? 0,
        metadata: { format: inspection.format, mappingWasAutomatic },
      });
      await recordActivity(client, {
        user,
        actionKey: 'IMPORT_SOURCE_OPTIONS_APPLIED',
        source: 'inventory-import',
        reason: 'Import source options were selected and the draft was rebuilt.',
        recordType: 'import',
        recordId: batchId,
        recordLabel: batch.file_name,
        routePath: `/import?session=${batchId}`,
        parentImportBatchId: batchId,
        metadata: { format: inspection.format, draftRevision },
      });
      return { session: await sessionDetail(client, batchId) };
    });
  });

  app.put('/api/v1/imports/:id/mappings', { preHandler: requirePermission('import.execute') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const batchId = (request.params as { id: string }).id;
    const body = request.body as { mappings?: MappingInput[] };
    if (!Array.isArray(body.mappings)) throw new AppError(422, 'MAPPINGS_REQUIRED', 'Column mappings are required.');
    const mappings = body.mappings;
    return withTransaction(async (client) => {
      requireSessionOwner(user, await loadSessionContext(client, batchId, true));
      await saveMappings(client, batchId, mappings);
      await validateSession(client, batchId);
      const batch = await loadSessionContext(client, batchId);
      await recordActivity(client, { user, actionKey: 'IMPORT_MAPPING_SAVED', source: 'inventory-import', reason: 'Source column mapping saved and validated.', recordType: 'import', recordId: batchId, recordLabel: batch.file_name ?? 'Import session', routePath: `/import?session=${batchId}`, parentImportBatchId: batchId, metadata: { mappedColumns: mappings.length } });
      return { session: await sessionDetail(client, batchId) };
    });
  });

  app.post('/api/v1/imports/:id/validate', { preHandler: requirePermission('import.execute') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const batchId = (request.params as { id: string }).id;
    return withTransaction(async (client) => {
      const current = await loadSessionContext(client, batchId, true);
      requireSessionOwner(user, current);
      if (['AWAITING_APPROVAL', 'APPROVED', 'DECLINED'].includes(current.status)) {
        throw new AppError(409, 'IMPORT_REOPEN_REQUIRED', 'Reopen this reviewed draft before revalidating it. Previous decisions must not carry into a new revision.');
      }
      await validateSession(client, batchId);
      const batch = await loadSessionContext(client, batchId);
      await recordActivity(client, { user, actionKey: 'IMPORT_VALIDATED', source: 'inventory-import', reason: 'Import session fully revalidated.', recordType: 'import', recordId: batchId, recordLabel: batch.file_name ?? 'Import session', routePath: `/import?session=${batchId}`, parentImportBatchId: batchId, metadata: { status: batch.status, draftRevision: Number(batch.draft_revision) } });
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
      const ownsSession = Number(current.created_by_user_id) === Number(user.id);
      if (ownsSession && current.original_file && ['VALIDATING', 'NEEDS_REVALIDATION'].includes(current.status)) await validateSession(client, batchId);
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
      requireSessionOwner(user, batch);
      if (['COMPLETED', 'CANCELLED'].includes(batch.status)) throw new AppError(409, 'IMPORT_SESSION_CLOSED', 'This import session is closed.');
      const row = await client.query<{ corrected_values: Values; row_number: number; included: boolean }>('SELECT corrected_values,row_number,included FROM import_batch_rows WHERE id=$1 AND batch_id=$2 FOR UPDATE', [rowId, batchId]);
      if (!row.rows[0]) throw new AppError(404, 'IMPORT_ROW_NOT_FOUND', 'Staged row not found.');
      const fields = (await loadProfileFields(Number(batch.profile_id), client)).filter((field) => field.surfaces.import);
      const patchValues = body.values && typeof body.values === 'object' && !Array.isArray(body.values) ? body.values : body.fieldKey ? { [String(body.fieldKey)]: body.value ?? '' } : {};
      for (const fieldKey of Object.keys(patchValues)) {
        if (!fields.some((field) => field.fieldKey === fieldKey)) throw new AppError(422, 'IMPORT_FIELD_INVALID', `Field "${fieldKey}" is not enabled for this import profile.`);
      }
      const corrected = { ...row.rows[0].corrected_values, ...patchValues };
      const included = body.included === undefined ? row.rows[0].included : Boolean(body.included);
      await client.query('UPDATE import_batch_rows SET corrected_values=$2,included=$3,status=$4,updated_at=now() WHERE id=$1', [rowId, corrected, included, included ? 'PENDING' : 'EXCLUDED']);
      await invalidateDraft(client, batchId);
      await validateSession(client, batchId);
      await recordActivity(client, { user, actionKey: included ? 'IMPORT_ROW_CORRECTED' : 'IMPORT_ROW_EXCLUDED', source: 'inventory-import', reason: included ? 'Staged row corrected during review.' : 'Staged row excluded from commit.', recordType: 'import', recordId: batchId, recordLabel: batch.file_name ?? 'Import session', routePath: `/import?session=${batchId}&row=${rowId}`, parentImportBatchId: batchId, metadata: { rowId, rowNumber: row.rows[0].row_number, fields: Object.keys(patchValues), included } });
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
      requireSessionOwner(user, batch);
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
      await invalidateDraft(client, batchId);
      await validateSession(client, batchId);
      await recordActivity(client, { user, actionKey: 'IMPORT_ROWS_BULK_CORRECTED', source: 'inventory-import', reason: 'A repeated staged value was corrected across the import session.', recordType: 'import', recordId: batchId, recordLabel: batch.file_name ?? 'Import session', routePath: `/import?session=${batchId}`, parentImportBatchId: batchId, metadata: { fieldKey, changed } });
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
      requireSessionOwner(user, batch);
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
        await recordActivity(client, { user, actionKey, source: 'inventory-import', reason, recordType: 'vendor', recordId: vendorId, recordLabel: displayValue, routePath: '/admin?tab=vendors', parentImportBatchId: batchId, metadata: { batchId, fieldKey } });
        await invalidateDraft(client, batchId);
        await validateSession(client, batchId);
        return { session: await sessionDetail(client, batchId) };
      }
      if (field.dataType !== 'lookup' || !field.lookupKey) throw new AppError(422, 'PROFILE_LOOKUP_MISSING', 'Use the linked Admin workflow to manage this relationship safely.');
      const existing = matchLookupOption(field.options, displayValue);
      const stored = await client.query<{ id: string }>(
        `SELECT lv.id
           FROM lookup_values lv
           JOIN lookup_lists ll ON ll.id=lv.lookup_list_id
          WHERE ll.lookup_key=$1
            AND (
              lower(lv.value_key)=lower($2)
              OR lower(lv.display_value)=lower($2)
              OR EXISTS (SELECT 1 FROM unnest(lv.aliases) alias WHERE lower(alias)=lower($2))
            )
          ORDER BY lv.active DESC,lv.id
          LIMIT 1`,
        [field.lookupKey, displayValue],
      );
      const storedId = Number(stored.rows[0]?.id);
      let valueId = existing?.id ?? (Number.isSafeInteger(storedId) && storedId > 0 ? storedId : undefined);
      let actionKey = 'LOOKUP_VALUE_REUSED';
      if (!valueId) {
        const valueKey = lookupValueKey(displayValue);
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO lookup_values(lookup_list_id,value_key,display_value,description,display_order)
           SELECT id,$2,$3,$4,COALESCE((SELECT max(display_order)+10 FROM lookup_values WHERE lookup_list_id=lookup_lists.id),10)
             FROM lookup_lists WHERE lookup_key=$1 AND active
           ON CONFLICT (lookup_list_id,value_key) DO UPDATE
             SET active=true,updated_at=now()
           RETURNING id`,
          [field.lookupKey, valueKey, displayValue, `Approved from import session ${batchId}.`],
        );
        if (!inserted.rows[0]) throw new AppError(404, 'LOOKUP_NOT_FOUND', 'The controlled list is unavailable.');
        valueId = Number(inserted.rows[0].id);
        actionKey = 'LOOKUP_VALUE_CREATED';
        await client.query('UPDATE lookup_lists SET version=version+1,updated_at=now() WHERE lookup_key=$1', [field.lookupKey]);
      } else {
        await client.query('UPDATE lookup_values SET active=true,updated_at=now() WHERE id=$1', [valueId]);
      }
      await recordActivity(client, { user, actionKey, source: 'inventory-import', reason, recordType: 'lookup', recordId: valueId!, recordLabel: displayValue, routePath: `/admin?tab=lookups&lookup=${encodeURIComponent(field.lookupKey)}`, parentImportBatchId: batchId, metadata: { batchId, fieldKey, lookupKey: field.lookupKey } });
      await invalidateDraft(client, batchId);
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

  app.post('/api/v1/imports/:id/reviews', { preHandler: requirePermission('import.review') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const batchId = (request.params as { id: string }).id;
    const body = request.body as { decision?: unknown; reason?: unknown; draftRevision?: unknown; draftHash?: unknown };
    const decision = String(body.decision ?? '').toUpperCase();
    const reason = cleanText(body.reason);
    const draftRevision = Number(body.draftRevision);
    const draftHash = cleanText(body.draftHash);
    if (!['ACCEPT', 'DECLINE'].includes(decision)) throw new AppError(422, 'IMPORT_REVIEW_DECISION_REQUIRED', 'Choose Accept or Decline.');
    if (decision === 'DECLINE' && reason.length < 3) throw new AppError(422, 'IMPORT_REVIEW_REASON_REQUIRED', 'Explain why this import should be declined.');
    if (!Number.isInteger(draftRevision) || !/^[0-9a-f]{64}$/.test(draftHash)) {
      throw new AppError(422, 'IMPORT_REVIEW_REVISION_REQUIRED', 'Refresh the import and review its current revision before deciding.');
    }
    return withTransaction(async (client) => {
      const batch = await loadSessionContext(client, batchId, true);
      requireSessionAccess(user, batch);
      if (Number(batch.created_by_user_id) === Number(user.id)) throw new AppError(403, 'IMPORT_SELF_REVIEW_BLOCKED', 'The importer cannot approve or decline their own import.');
      if (!['AWAITING_APPROVAL', 'APPROVED'].includes(batch.status)) {
        throw new AppError(409, 'IMPORT_NOT_REVIEWABLE', 'This import is not awaiting an administrator decision.');
      }
      if (Number(batch.draft_revision) !== draftRevision || batch.draft_hash !== draftHash) {
        throw new AppError(409, 'IMPORT_DRAFT_CHANGED', 'The import changed after you opened it. Refresh and review the latest revision.');
      }
      const existing = await client.query(
        'SELECT 1 FROM import_reviews WHERE batch_id=$1 AND draft_revision=$2 AND reviewer_user_id=$3',
        [batchId, draftRevision, user.id],
      );
      if (existing.rowCount) throw new AppError(409, 'IMPORT_ALREADY_REVIEWED', 'You already reviewed this draft revision.');
      await client.query(
        `INSERT INTO import_reviews(batch_id,draft_revision,draft_hash,reviewer_user_id,decision,reason)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [batchId, draftRevision, draftHash, user.id, decision, reason || null],
      );
      const counts = await client.query(
        `SELECT count(*) FILTER(WHERE decision='ACCEPT')::int accepted,
                count(*) FILTER(WHERE decision='DECLINE')::int declined
           FROM import_reviews WHERE batch_id=$1 AND draft_revision=$2 AND draft_hash=$3`,
        [batchId, draftRevision, draftHash],
      );
      const accepted = Number(counts.rows[0]?.accepted ?? 0);
      const declined = Number(counts.rows[0]?.declined ?? 0);
      const status: SessionStatus = declined > 0 ? 'DECLINED' : accepted >= 2 ? 'APPROVED' : 'AWAITING_APPROVAL';
      await client.query('UPDATE import_batches SET status=$2,updated_at=now() WHERE id=$1', [batchId, status]);
      await recordImportStage(client, {
        batchId,
        stage: 'REVIEW',
        eventKey: decision === 'ACCEPT' ? 'DRAFT_ACCEPTED' : 'DRAFT_DECLINED',
        draftRevision,
        metadata: { accepted, declined, required: 2 },
      });
      await recordActivity(client, {
        user,
        actionKey: decision === 'ACCEPT' ? 'IMPORT_REVIEW_ACCEPTED' : 'IMPORT_REVIEW_DECLINED',
        source: 'inventory-import',
        reason: reason || 'Reviewed and accepted the current import draft.',
        recordType: 'import',
        recordId: batchId,
        recordLabel: batch.file_name ?? 'Import session',
        routePath: `/import?session=${batchId}`,
        parentImportBatchId: batchId,
        metadata: { draftRevision, decision, accepted, declined },
      });
      return { session: await sessionDetail(client, batchId) };
    });
  });

  app.post('/api/v1/imports/:id/reopen', { preHandler: requirePermission('import.execute') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const batchId = (request.params as { id: string }).id;
    return withTransaction(async (client) => {
      const batch = await loadSessionContext(client, batchId, true);
      requireSessionOwner(user, batch);
      if (!['AWAITING_APPROVAL', 'DECLINED', 'APPROVED'].includes(batch.status)) {
        throw new AppError(409, 'IMPORT_REOPEN_UNAVAILABLE', 'This import does not need to be reopened.');
      }
      const draftRevision = await invalidateDraft(client, batchId);
      await validateSession(client, batchId);
      await recordActivity(client, {
        user,
        actionKey: 'IMPORT_DRAFT_REOPENED',
        source: 'inventory-import',
        reason: 'The importer reopened the draft for changes and new administrator reviews.',
        recordType: 'import',
        recordId: batchId,
        recordLabel: batch.file_name ?? 'Import session',
        routePath: `/import?session=${batchId}`,
        parentImportBatchId: batchId,
        metadata: { draftRevision },
      });
      return { session: await sessionDetail(client, batchId) };
    });
  });

  app.post('/api/v1/imports/:id/commit', { preHandler: requirePermission('import.execute') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const batchId = (request.params as { id: string }).id;
    const body = request.body as { draftRevision?: unknown; draftHash?: unknown; idempotencyKey?: unknown };
    const requestedRevision = Number(body.draftRevision);
    const requestedHash = cleanText(body.draftHash);
    const requestedIdempotencyKey = cleanText(body.idempotencyKey);
    if (!Number.isInteger(requestedRevision) || !/^[0-9a-f]{64}$/.test(requestedHash) || !requestedIdempotencyKey) {
      throw new AppError(422, 'IMPORT_COMMIT_CONTRACT_REQUIRED', 'Refresh the approved import before committing it.');
    }
    const commitStartedAt = Date.now();
    try {
      return await withTransaction(async (client) => {
        const lockedBatch = await loadSessionContext(client, batchId, true);
        requireSessionOwner(user, lockedBatch);
        if (lockedBatch.idempotency_key !== requestedIdempotencyKey) throw new AppError(409, 'IMPORT_IDEMPOTENCY_KEY_CHANGED', 'The commit key does not match this import session. Refresh before retrying.');
        if (lockedBatch.status === 'COMPLETED') {
          return { session: await sessionDetail(client, batchId), idempotent: true, refresh: importRefreshTargets };
        }
        const stale = await markStaleIfNeeded(client, batchId);
        if (stale) throw new AppError(409, 'IMPORT_CONTRACT_CHANGED', 'The import contract changed. Revalidate the new draft and obtain two new approvals.');
        const batch = await loadSessionContext(client, batchId, true);
        requireModePermission(user, batch.mode as ImportMode);
        if (Number(batch.draft_revision) !== requestedRevision || batch.draft_hash !== requestedHash) {
          throw new AppError(409, 'IMPORT_DRAFT_CHANGED', 'The import changed after it was approved. Refresh and obtain two new approvals.');
        }
        const reviews = await client.query(
          `SELECT count(*) FILTER(WHERE decision='ACCEPT')::int accepted,
                  count(*) FILTER(WHERE decision='DECLINE')::int declined,
                  count(DISTINCT reviewer_user_id) FILTER(WHERE decision='ACCEPT')::int distinct_reviewers
             FROM import_reviews WHERE batch_id=$1 AND draft_revision=$2 AND draft_hash=$3`,
          [batchId, requestedRevision, requestedHash],
        );
        if (Number(reviews.rows[0]?.accepted ?? 0) < 2
            || Number(reviews.rows[0]?.distinct_reviewers ?? 0) < 2
            || Number(reviews.rows[0]?.declined ?? 0) > 0
            || batch.status !== 'APPROVED') {
          throw new AppError(409, 'IMPORT_APPROVALS_REQUIRED', 'Two distinct Privileged Administrators must accept this exact draft before the importer can commit it.');
        }
        await client.query("SELECT control_key FROM import_runtime_control WHERE control_key='GLOBAL' FOR UPDATE");
        const importControl = await loadImportControl(client);
        requireImportCommitAllowed(importControl, user);
        await client.query(`UPDATE import_batches SET status='COMMITTING',verification_status='PENDING',verification_details='{}'::jsonb,updated_at=now() WHERE id=$1`, [batchId]);
        const rows = await client.query(
          `SELECT id,row_number,normalized_values,operation,target_asset_id,target_asset_revision
             FROM import_batch_rows WHERE batch_id=$1 AND included AND status IN ('VALID','WARNING') ORDER BY row_number FOR UPDATE`,
          [batchId],
        );
        if (!rows.rowCount) throw new AppError(422, 'IMPORT_NO_INCLUDED_ROWS', 'Include at least one valid row before commit.');
        const commitFields = (await loadProfileFields(Number(batch.profile_id), client)).filter((field) => field.surfaces.import);
        const parentEventId = await recordActivity(client, { user, actionKey: 'IMPORT_COMMIT_STARTED', source: 'inventory-import', reason: `${batch.mode === 'CREATE' ? 'Create Assets' : 'Update Existing'} batch commit.`, recordType: 'import', recordId: batchId, recordLabel: batch.file_name, routePath: `/import?session=${batchId}`, parentImportBatchId: batchId, metadata: { rows: rows.rowCount, mode: batch.mode, idempotencyKey: batch.idempotency_key, draftRevision: requestedRevision } });
        for (const row of rows.rows) {
          let asset;
          if (batch.mode === 'CREATE') {
            asset = await assetInternals.createAsset(client, Number(batch.profile_id), row.normalized_values, user, `Created by import ${batch.file_name}.`, 'inventory-import', batchId);
          } else {
            const target = parseValidatedTarget(row.target_asset_id, row.target_asset_revision);
            if (!target) {
              throw new AppError(409, 'IMPORT_TARGET_STALE', `Row ${row.row_number} must be revalidated before commit.`);
            }
            asset = await assetInternals.updateAsset(client, target.assetId, target.revision, row.normalized_values, user, `Updated by import ${batch.file_name}.`, 'inventory-import', batchId);
          }
          const mismatches = committedValueMismatchDetails(commitFields, row.normalized_values, asset.values);
          if (mismatches.length) {
            throw new AppError(409, 'IMPORT_COMMIT_VERIFICATION_FAILED', `Row ${row.row_number} did not match the staged values after storage. The entire import was rolled back and imports were locked.`, {
              mismatchFields: mismatches,
              rowNumber: Number(row.row_number),
              draftRevision: requestedRevision,
            });
          }
          await client.query(`UPDATE import_batch_rows SET status='COMMITTED',committed_asset_id=$2,updated_at=now() WHERE id=$1`, [row.id, asset.id]);
          await client.query(
            `INSERT INTO import_commit_results(batch_id,import_row_id,asset_id,operation,asset_revision) VALUES($1,$2,$3,$4,$5)
             ON CONFLICT (batch_id,import_row_id) DO NOTHING`,
            [batchId, row.id, asset.id, batch.mode, asset.revision],
          );
        }
        const durationMs = Date.now() - commitStartedAt;
        await client.query(
          `UPDATE import_batches
           SET status='COMPLETED',verification_status='PASSED',verification_details=$2::jsonb,
               committed_at=now(),completed_at=now(),updated_at=now()
           WHERE id=$1`,
          [batchId, JSON.stringify({ verifiedRows: rows.rowCount, mismatchFields: [] })],
        );
        await recordImportStage(client, { batchId, stage: 'COMMIT', eventKey: 'COMMIT_VERIFIED', draftRevision: requestedRevision, durationMs, rowCount: rows.rowCount, metadata: { mode: batch.mode } });
        await recordActivity(client, { user, actionKey: 'IMPORT_COMPLETED', source: 'inventory-import', reason: 'All included rows committed and read back in one transaction.', recordType: 'import', recordId: batchId, recordLabel: batch.file_name, routePath: `/import?session=${batchId}`, parentEventId, parentImportBatchId: batchId, metadata: { rows: rows.rowCount, mode: batch.mode, draftRevision: requestedRevision, verificationStatus: 'PASSED' } });
        return { session: await sessionDetail(client, batchId), idempotent: false, refresh: importRefreshTargets };
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'IMPORT_COMMIT_VERIFICATION_FAILED') {
        const details = error.details as { mismatchFields: ImportMismatchField[]; rowNumber: number; draftRevision: number };
        await disableImportsAfterVerificationFailure({
          batchId,
          draftRevision: details.draftRevision,
          rowNumber: details.rowNumber,
          mismatches: details.mismatchFields,
        });
      } else if (error instanceof AppError && ['IMPORT_TARGET_STALE', 'IMPORT_CONTRACT_CHANGED'].includes(error.code)) {
        await pool.query(
          `UPDATE import_batches
           SET status='NEEDS_REVALIDATION',draft_revision=draft_revision+1,draft_hash=NULL,
               verification_status='NOT_RUN',verification_details='{}'::jsonb,failure_message=$2,updated_at=now()
           WHERE id=$1 AND status NOT IN ('COMPLETED','CANCELLED')`,
          [batchId, error.message],
        ).catch(() => undefined);
      } else if (!(error instanceof AppError) || error.statusCode >= 500) {
        await pool.query(
          `UPDATE import_batches SET status='FAILED',failure_message=$2,updated_at=now()
           WHERE id=$1 AND status NOT IN ('COMPLETED','CANCELLED')`,
          [batchId, error instanceof Error ? error.message : 'Import commit failed.'],
        ).catch(() => undefined);
      }
      throw error;
    }
  });

  app.post('/api/v1/imports/:id/cancel', { preHandler: requirePermission('import.execute') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const batchId = (request.params as { id: string }).id;
    return withTransaction(async (client) => {
      const batch = await loadSessionContext(client, batchId, true);
      requireSessionOwner(user, batch);
      if (batch.status === 'COMPLETED') throw new AppError(409, 'IMPORT_COMPLETED', 'A completed import cannot be cancelled.');
      await client.query(`UPDATE import_batches SET status='CANCELLED',updated_at=now() WHERE id=$1`, [batchId]);
      await recordActivity(client, { user, actionKey: 'IMPORT_CANCELLED', source: 'inventory-import', reason: 'Import session cancelled.', recordType: 'import', recordId: batchId, recordLabel: batch.file_name ?? 'Import session', routePath: `/import?session=${batchId}`, parentImportBatchId: batchId });
      return { session: await sessionDetail(client, batchId) };
    });
  });
}

export const importInternals = {
  parseCsv,
  serializeImportHeaders,
  serializeImportIssueSuggestions,
  autoMappings,
  canAutoValidateMappings,
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
  reconcileModelGroup,
  committedValueMismatches,
  committedValueMismatchDetails,
  calculateDraftHash,
  stageParsedSource,
  stableJson,
};
