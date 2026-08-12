import type {
  ApiError,
  ActivityEvent,
  ActivityResponse,
  AppSession,
  AssetDetail,
  AssetSummary,
  AssetSummaryCounts,
  AuthState,
  FieldDefinition,
  ImportCommitResult,
  ImportHeader,
  ImportIssue,
  ImportMappingIssue,
  ImportMode,
  ImportRow,
  ImportSession,
  ImportSessionStatus,
  ImportSessionSummary,
  LabelData,
  LookupOption,
  Lookups,
  Profile,
  ReportResult,
  UserSummary,
  VersionContract,
} from './types';

const API = '/api/v1';

export interface AssetListResponse {
  assets: AssetSummary[];
  total: number;
  page: number;
  limit: number;
  summary: AssetSummaryCounts;
}

function count(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? fallback : String(value);
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : text(value);
}

function boolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeLookupOption(value: unknown): LookupOption {
  const data = object(value);
  return {
    id: count(data.id),
    value: text(data.value ?? data.label),
    label: text(data.label ?? data.value),
    description: nullableText(data.description) ?? undefined,
    aliases: list(data.aliases).map((item) => text(item)).filter(Boolean),
  };
}

function normalizeFieldDefinition(value: unknown): FieldDefinition {
  const data = object(value);
  return {
    id: count(data.id),
    fieldKey: text(data.fieldKey ?? data.field_key),
    label: text(data.label),
    definition: text(data.definition),
    helpText: text(data.helpText ?? data.help_text),
    dataType: text(data.dataType ?? data.data_type, 'text') as FieldDefinition['dataType'],
    lookupKey: nullableText(data.lookupKey ?? data.lookup_key) ?? undefined,
    lookupName: nullableText(data.lookupName ?? data.lookup_name) ?? undefined,
    storageTarget: text(data.storageTarget ?? data.storage_target),
    aliases: list(data.aliases).map((item) => text(item)).filter(Boolean),
    validationRules: object(data.validationRules ?? data.validation_rules),
    uniqueWhenPopulated: boolean(data.uniqueWhenPopulated ?? data.unique_when_populated),
    required: boolean(data.required),
    displayOrder: count(data.displayOrder ?? data.display_order),
    surfaces: object(data.surfaces) as Record<string, boolean>,
    options: list(data.options).map(normalizeLookupOption),
  };
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item).trim()).filter(Boolean);
  return nullableText(value)?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
}

function normalizeAssetSummary(value: unknown): AssetSummary {
  const data = object(value);
  const category = object(data.category);
  const model = object(data.model);
  const references = object(data.references);
  const nvbugs = stringList(references.nvbugs ?? data.nvbugs);
  return {
    id: count(data.id),
    revision: count(data.revision),
    serialNumber: text(data.serialNumber ?? data.serial_number),
    assetTag: nullableText(data.assetTag ?? data.asset_tag),
    dateReceived: text(data.dateReceived ?? data.date_received),
    category: { key:text(category.key ?? data.category_key), name:text(category.name ?? data.category_name) },
    model: {
      modelNumber:text(model.modelNumber ?? model.model_number ?? data.model_number),
      productName:text(model.productName ?? model.product_name ?? data.product_name),
      imagePath:nullableText(model.imagePath ?? model.image_path ?? data.image_path),
    },
    status:text(data.status),
    location:nullableText(data.location),
    owner:text(data.owner, 'Unassigned'),
    vendor:text(data.vendor),
    nvbugs,
    references:{
      nvbugs,
      mrsOrders:stringList(references.mrsOrders ?? references.mrs_orders ?? data.mrsOrders ?? data.mrs_orders),
      capacityRequests:stringList(references.capacityRequests ?? references.capacity_requests ?? data.capacityRequests ?? data.capacity_requests),
    },
  };
}

export function normalizeAssetDetailResponse(payload: unknown): AssetDetail {
  const envelope = object(payload);
  const data = object(envelope.asset ?? payload);
  const category = object(data.category);
  const model = object(data.model);
  const status = object(data.status);
  const location = data.location === null ? null : object(data.location);
  const owner = object(data.owner);
  const vendor = object(data.vendor);
  const references = object(data.references);
  return {
    id:count(data.id), profileId:count(data.profileId ?? data.profile_id), revision:count(data.revision), archived:boolean(data.archived),
    createdAt:text(data.createdAt ?? data.created_at), updatedAt:text(data.updatedAt ?? data.updated_at),
    category:{id:count(category.id),key:text(category.key),name:text(category.name)},
    model:{id:count(model.id),modelNumber:text(model.modelNumber ?? model.model_number),productName:text(model.productName ?? model.product_name),boardSku:nullableText(model.boardSku ?? model.board_sku)??undefined,gpuSku:nullableText(model.gpuSku ?? model.gpu_sku)??undefined,boardArchitecture:nullableText(model.boardArchitecture ?? model.board_architecture)??undefined,imagePath:nullableText(model.imagePath ?? model.image_path)},
    serialNumber:text(data.serialNumber ?? data.serial_number),assetTag:nullableText(data.assetTag ?? data.asset_tag),dateReceived:text(data.dateReceived ?? data.date_received),
    status:{id:count(status.id),value:text(status.value),label:text(status.label ?? status.value)},
    location:location && Object.keys(location).length ? {id:count(location.id),path:text(location.path ?? location.full_path)} : null,
    owner:{id:count(owner.id),name:text(owner.name ?? owner.display_name,'Unassigned')},vendor:{id:count(vendor.id),name:text(vendor.name ?? vendor.vendor_name)},
    milestone:nullableText(data.milestone)??undefined,poolTeam:nullableText(data.poolTeam ?? data.pool_team)??undefined,project:nullableText(data.project)??undefined,notes:nullableText(data.notes)??undefined,
    references:{nvbugs:stringList(references.nvbugs),mrsOrders:stringList(references.mrsOrders ?? references.mrs_orders),capacityRequests:stringList(references.capacityRequests ?? references.capacity_requests)},
    values:object(data.values),
  };
}

function normalizeActivityEvent(value: unknown): ActivityEvent {
  const data = object(value);
  return {
    id:count(data.id),action_key:text(data.action_key ?? data.actionKey,'ACTIVITY'),source:text(data.source,'application'),reason:text(data.reason),
    record_type:text(data.record_type ?? data.recordType),record_id:text(data.record_id ?? data.recordId),record_label:text(data.record_label ?? data.recordLabel,'Inventory record'),
    route_path:text(data.route_path ?? data.routePath),reference_value:nullableText(data.reference_value ?? data.referenceValue)??undefined,created_at:text(data.created_at ?? data.createdAt),
    actor:text(data.actor,'System'),effective_role_keys:stringList(data.effective_role_keys ?? data.effectiveRoleKeys),
    changes:list(data.changes).map((item) => { const change=object(item); return {fieldKey:text(change.fieldKey ?? change.field_key),fieldLabel:text(change.fieldLabel ?? change.field_label ?? change.fieldKey ?? change.field_key),before:change.before,after:change.after}; }),
  };
}

export function normalizeActivityResponse(payload: unknown): ActivityResponse {
  const data=object(payload); const events=list(data.events ?? data.activity).map(normalizeActivityEvent);
  return {events,total:count(data.total,events.length),page:Math.max(1,count(data.page,1)),limit:Math.max(1,count(data.limit,40))};
}

export function normalizeReportResponse(payload: unknown): ReportResult {
  const data=object(payload); const rawDimensions=object(data.dimensions); const dimensions:ReportResult['dimensions']={};
  for (const [key,values] of Object.entries(rawDimensions)) dimensions[key]=list(values).map((item)=>{const row=object(item);return{key:text(row.key),label:text(row.label),value:count(row.value)};});
  const rows=list(data.rows).map((row)=>object(row));
  return {
    reportId:text(data.reportId ?? data.report_id,'inventory'),kpis:Object.fromEntries(Object.entries(object(data.kpis)).map(([key,value])=>[key,count(value)])),dimensions,
    trends:list(data.trends).map((item)=>{const row=object(item);return{month:text(row.month),value:count(row.value)};}),rows,
    page:Math.max(1,count(data.page,1)),limit:Math.max(1,count(data.limit,50)),total:count(data.total,rows.length),
  };
}

export function normalizeVersionResponse(payload: unknown): VersionContract {
  const data = object(payload);
  return {
    packageVersion: text(data.packageVersion ?? data.package_version),
    webVersion: text(data.webVersion ?? data.web_version),
    apiVersion: text(data.apiVersion ?? data.api_version),
    schemaVersion: text(data.schemaVersion ?? data.schema_version),
    importContractVersion: text(data.importContractVersion ?? data.import_contract_version),
    compatible: boolean(data.compatible),
  };
}

function normalizeProfile(payload: unknown): Profile {
  const envelope=object(payload); const data=object(envelope.profile ?? payload);
  return {id:count(data.id),profile_key:nullableText(data.profile_key ?? data.profileKey)??undefined,profile_name:nullableText(data.profile_name ?? data.profileName)??undefined,description:text(data.description),version:count(data.version,1),fields:list(data.fields).map(normalizeFieldDefinition)};
}

function normalizeLookups(payload: unknown): Lookups {
  const data=object(payload);
  return {
    lookups:list(data.lookups).map((item)=>{const row=object(item);return{id:count(row.id),lookup_key:text(row.lookup_key ?? row.lookupKey),lookup_name:text(row.lookup_name ?? row.lookupName),values:list(row.values).map(normalizeLookupOption)};}),
    locations:list(data.locations).map((item)=>{const row=object(item);return{id:count(row.id),parent_id:row.parent_id===null?null:count(row.parent_id ?? row.parentId)||null,location_key:text(row.location_key ?? row.locationKey),location_name:text(row.location_name ?? row.locationName),full_path:text(row.full_path ?? row.fullPath)};}),
    users:list(data.users).map((item)=>{const row=object(item);return{id:count(row.id),display_name:text(row.display_name ?? row.displayName),initials:text(row.initials)};}),
    vendors:list(data.vendors).map((item)=>{const row=object(item);return{id:count(row.id),vendor_name:text(row.vendor_name ?? row.vendorName)};}),
  };
}

function normalizeAppSession(payload: unknown): AppSession {
  const data=object(payload); const user=object(data.user); const lifecycle=object(data.lifecycle); const operations=object(lifecycle.operations); const groups=object(lifecycle.groups);
  return {
    user:{id:count(user.id),displayName:text(user.displayName ?? user.display_name),initials:text(user.initials),roles:stringList(user.roles),permissions:stringList(user.permissions)},
    permissions:Object.fromEntries(Object.entries(object(data.permissions)).map(([key,value])=>[key,boolean(value)])),
    categories:list(data.categories).map((item)=>{const row=object(item);return{id:count(row.id),key:text(row.key),name:text(row.name),description:text(row.description),icon:text(row.icon,'box'),profileId:count(row.profileId ?? row.profile_id),profileKey:text(row.profileKey ?? row.profile_key),profileName:text(row.profileName ?? row.profile_name),version:count(row.version,1),assetCount:count(row.assetCount ?? row.asset_count)};}),
    statuses:list(data.statuses).map((item)=>{const row=object(item);return{id:count(row.id),value_key:text(row.value_key ?? row.valueKey),display_value:text(row.display_value ?? row.displayValue),description:text(row.description)};}),
    health:Object.fromEntries(Object.entries(object(data.health)).map(([key,value])=>[key,count(value)])),
    lifecycle:{
      groups:{available:stringList(groups.available),unavailable:stringList(groups.unavailable),exceptions:stringList(groups.exceptions)},
      operations:Object.fromEntries(Object.entries(operations).map(([key,value])=>{const row=object(value);return[key,{label:text(row.label,key),requiresStatus:boolean(row.requiresStatus ?? row.requires_status),requiresOwner:boolean(row.requiresOwner ?? row.requires_owner),allowedStatuses:stringList(row.allowedStatuses ?? row.allowed_statuses)}];})),
    },
  };
}

function normalizeAuthState(payload: unknown): AuthState {
  const data = object(payload);
  const user = object(data.user);
  const authenticated = boolean(data.authenticated) && count(user.id) > 0;
  return {
    authenticated,
    user: authenticated ? {
      id: count(user.id),
      displayName: text(user.displayName ?? user.display_name),
      initials: text(user.initials),
      roles: stringList(user.roles),
      permissions: stringList(user.permissions),
    } : null,
  };
}

function normalizeImportIssue(value: unknown): ImportIssue {
  const data = object(value);
  return {
    id: data.id === undefined ? undefined : count(data.id),
    fieldKey: nullableText(data.fieldKey ?? data.field_key) ?? undefined,
    fieldLabel: nullableText(data.fieldLabel ?? data.field_label) ?? undefined,
    fieldDefinition: nullableText(data.fieldDefinition ?? data.field_definition) ?? undefined,
    severity: text(data.severity, 'ERROR') as ImportIssue['severity'],
    code: text(data.code ?? data.issue_code, 'IMPORT_ISSUE'),
    message: text(data.message, 'This row has an import issue.'),
    sourceValue: nullableText(data.sourceValue ?? data.source_value) ?? undefined,
    suggestedValues: list(data.suggestedValues ?? data.suggested_values).map((item) => text(item)),
    resolution: data.resolution === null ? null : object(data.resolution),
    lookupKey: nullableText(data.lookupKey ?? data.lookup_key) ?? undefined,
    lookupName: nullableText(data.lookupName ?? data.lookup_name) ?? undefined,
    approvedValues: list(data.approvedValues ?? data.approved_values).map(normalizeLookupOption),
    adminRoute: nullableText(data.adminRoute ?? data.admin_route) ?? undefined,
    routePath: nullableText(data.routePath ?? data.route_path) ?? undefined,
  };
}

function normalizeImportHeader(value: unknown, fallbackIndex: number): ImportHeader {
  const data = object(value);
  return {
    sourceIndex: count(data.sourceIndex ?? data.source_index, fallbackIndex),
    header: text(data.header ?? data.source_header),
    fieldKey: nullableText(data.fieldKey ?? data.field_key) ?? undefined,
    ignored: boolean(data.ignored),
  };
}

function normalizeMappingIssue(value: unknown): ImportMappingIssue {
  const data = object(value);
  return {
    severity: text(data.severity, 'ERROR') as ImportMappingIssue['severity'],
    code: text(data.code, 'MAPPING_ISSUE'),
    message: text(data.message, 'This column mapping needs attention.'),
    sourceIndex: data.sourceIndex === undefined && data.source_index === undefined
      ? undefined
      : count(data.sourceIndex ?? data.source_index),
    sourceHeader: nullableText(data.sourceHeader ?? data.source_header) ?? undefined,
    fieldKey: nullableText(data.fieldKey ?? data.field_key) ?? undefined,
  };
}

function normalizeImportRow(value: unknown): ImportRow {
  const data = object(value);
  return {
    id: text(data.id),
    row_number: count(data.row_number ?? data.rowNumber),
    source_values: object(data.source_values ?? data.sourceValues) as Record<string, string>,
    corrected_values: object(data.corrected_values ?? data.correctedValues),
    normalized_values: object(data.normalized_values ?? data.normalizedValues),
    included: data.included === undefined ? true : boolean(data.included),
    operation: nullableText(data.operation) as ImportMode | null,
    target_asset_id: data.target_asset_id === null || data.targetAssetId === null
      ? null
      : count(data.target_asset_id ?? data.targetAssetId) || null,
    target_asset_revision: data.target_asset_revision === null || data.targetAssetRevision === null
      ? null
      : count(data.target_asset_revision ?? data.targetAssetRevision) || null,
    before_values: data.before_values === null || data.beforeValues === null
      ? null
      : object(data.before_values ?? data.beforeValues),
    after_values: data.after_values === null || data.afterValues === null
      ? null
      : object(data.after_values ?? data.afterValues),
    status: text(data.status, 'PENDING') as ImportRow['status'],
    committed_asset_id: data.committed_asset_id === null || data.committedAssetId === null
      ? null
      : count(data.committed_asset_id ?? data.committedAssetId) || null,
    issues: list(data.issues).map(normalizeImportIssue),
  };
}

function normalizeCommitResult(value: unknown): ImportCommitResult {
  const data = object(value);
  return {
    import_row_id: text(data.import_row_id ?? data.importRowId),
    asset_id: count(data.asset_id ?? data.assetId),
    operation: text(data.operation, 'CREATE') as ImportMode,
    asset_revision: count(data.asset_revision ?? data.assetRevision),
    product_name: text(data.product_name ?? data.productName),
    serial_number: text(data.serial_number ?? data.serialNumber),
  };
}

export function normalizeImportSessionResponse(payload: unknown): ImportSession {
  const envelope = object(payload);
  const data = object(envelope.session ?? payload);
  if (!data.id) throw new Error('The server returned an incomplete import session. Refresh the page and try again.');

  return {
    id: text(data.id),
    profileId: count(data.profileId ?? data.profile_id),
    profileVersion: count(data.profileVersion ?? data.profile_version),
    currentProfileVersion: count(data.currentProfileVersion ?? data.current_profile_version),
    profileName: text(data.profileName ?? data.profile_name),
    categoryName: text(data.categoryName ?? data.category_name),
    categoryKey: text(data.categoryKey ?? data.category_key),
    mode: text(data.mode, 'CREATE') as ImportMode,
    fileName: nullableText(data.fileName ?? data.file_name),
    status: text(data.status, 'DRAFT') as ImportSessionStatus,
    totalRows: count(data.totalRows ?? data.total_rows),
    validRows: count(data.validRows ?? data.valid_rows),
    warningRows: count(data.warningRows ?? data.warning_rows),
    invalidRows: count(data.invalidRows ?? data.invalid_rows),
    createdBy: text(data.createdBy ?? data.created_by),
    createdAt: text(data.createdAt ?? data.created_at),
    updatedAt: text(data.updatedAt ?? data.updated_at),
    validatedAt: nullableText(data.validatedAt ?? data.validated_at),
    completedAt: nullableText(data.completedAt ?? data.completed_at),
    failureMessage: nullableText(data.failureMessage ?? data.failure_message),
    headers: list(data.headers).map(normalizeImportHeader),
    mappingIssues: list(data.mappingIssues ?? data.mapping_issues).map(normalizeMappingIssue),
    fields: list(data.fields).map(normalizeFieldDefinition),
    rows: list(data.rows).map(normalizeImportRow),
    results: list(data.results).map(normalizeCommitResult),
  };
}

function normalizeImportSummary(value: unknown): ImportSessionSummary {
  const data = object(value);
  return {
    id: text(data.id),
    mode: text(data.mode, 'CREATE') as ImportMode,
    file_name: nullableText(data.file_name ?? data.fileName),
    status: text(data.status, 'DRAFT') as ImportSessionStatus,
    total_rows: count(data.total_rows ?? data.totalRows),
    valid_rows: count(data.valid_rows ?? data.validRows),
    warning_rows: count(data.warning_rows ?? data.warningRows),
    invalid_rows: count(data.invalid_rows ?? data.invalidRows),
    category_name: text(data.category_name ?? data.categoryName),
    profile_name: text(data.profile_name ?? data.profileName),
    created_by: text(data.created_by ?? data.createdBy),
    created_at: text(data.created_at ?? data.createdAt),
    updated_at: text(data.updated_at ?? data.updatedAt),
  };
}

export function normalizeImportSessionListResponse(payload: unknown): ImportSessionSummary[] {
  const data = object(payload);
  const sessions = Array.isArray(payload)
    ? payload
    : data.sessions ?? data.imports ?? data.batches;
  return list(sessions).map(normalizeImportSummary).filter((session) => Boolean(session.id));
}

export function normalizeAssetListResponse(payload: unknown): AssetListResponse {
  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const assets = list(data.assets).map(normalizeAssetSummary);
  const rawSummary = data.summary && typeof data.summary === 'object'
    ? data.summary as Record<string, unknown>
    : {};
  const total = count(data.total, count(rawSummary.total, assets.length));

  return {
    assets,
    total,
    page: Math.max(1, count(data.page, 1)),
    limit: Math.max(1, count(data.limit, 50)),
    summary: {
      total: count(rawSummary.total, total),
      available: count(rawSummary.available),
      unavailable: count(rawSummary.unavailable),
      exceptions: count(rawSummary.exceptions),
    },
  };
}

function cookie(name: string): string {
  return document.cookie.split('; ').find((item) => item.startsWith(`${name}=`))?.split('=').slice(1).join('=') ?? '';
}

async function parse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const data = typeof payload === 'object' && payload ? payload as Record<string, unknown> : {};
    const error = new Error(String(data.message ?? `Request failed with status ${response.status}.`)) as ApiError;
    error.status = response.status;
    error.code = String(data.code ?? 'REQUEST_FAILED');
    error.details = data.details as ApiError['details'];
    error.latest = data.latest as AssetDetail | undefined;
    error.requestId = String(data.requestId ?? '');
    throw error;
  }
  return payload as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  if (init?.method && !['GET', 'HEAD'].includes(init.method)) headers.set('x-csrf-token', decodeURIComponent(cookie('inventory_csrf')));
  return parse<T>(await fetch(`${API}${path}`, { credentials: 'include', ...init, headers }));
}

async function downloadRequest(path: string, init: RequestInit, fallbackName: string): Promise<void> {
  const headers = new Headers(init.headers);
  headers.set('x-csrf-token', decodeURIComponent(cookie('inventory_csrf')));
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(`${API}${path}`, { credentials: 'include', ...init, headers });
  if (!response.ok) await parse(response);
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function query(values: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (key === 'fieldValues' && typeof value === 'object') {
      Object.entries(value as Record<string, unknown>).forEach(([fieldKey, fieldValue]) => {
        if (fieldValue !== undefined && fieldValue !== null && fieldValue !== '') params.set(`field_${fieldKey}`, String(fieldValue));
      });
      return;
    }
    params.set(key, String(value));
  });
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export const api = {
  version: async () => normalizeVersionResponse(await request<unknown>('/version')),
  users: async () => list(object(await request<unknown>('/auth/users')).users).map((item) => {
    const data = object(item);
    return {
      id: count(data.id),
      displayName: text(data.displayName ?? data.display_name),
      initials: text(data.initials),
      roles: stringList(data.roles),
    } satisfies UserSummary;
  }),
  authSession: async () => normalizeAuthState(await request<unknown>('/auth/session')),
  login: (userId: number) => request<{ authenticated: true }>('/auth/login', { method: 'POST', body: JSON.stringify({ userId }) }),
  logout: () => request('/auth/logout', { method: 'POST', body: '{}' }),
  session: async () => normalizeAppSession(await request<unknown>('/session')),
  profile: async (id: number) => normalizeProfile(await request<unknown>(`/profiles/${id}`)),
  lookups: async () => normalizeLookups(await request<unknown>('/lookups')),
  assets: async (values: Record<string, unknown>) => normalizeAssetListResponse(await request<unknown>(`/assets${query(values)}`)),
  asset: async (id: number) => normalizeAssetDetailResponse(await request<unknown>(`/assets/${id}`)),
  createAsset: async (body: unknown) => normalizeAssetDetailResponse(await request<unknown>('/assets', { method: 'POST', body: JSON.stringify(body) })),
  updateAsset: async (id: number, body: unknown) => normalizeAssetDetailResponse(await request<unknown>(`/assets/${id}`, { method: 'PATCH', body: JSON.stringify(body) })),
  operateAsset: async (id: number, body: unknown) => normalizeAssetDetailResponse(await request<unknown>(`/assets/${id}/operations`, { method: 'POST', body: JSON.stringify(body) })),
  assetActivity: async (id: number) => normalizeActivityResponse(await request<unknown>(`/assets/${id}/activity`)),
  activity: async (values: Record<string, unknown>) => normalizeActivityResponse(await request<unknown>(`/activity${query(values)}`)),
  labels: async (assetIds: number[]) => list(object(await request<unknown>('/labels/print', { method: 'POST', body: JSON.stringify({ assetIds }) })).labels).map((item) => object(item) as unknown as LabelData),
  exportAssets: (assetIds: number[]) => downloadRequest('/assets/export', { method: 'POST', body: JSON.stringify({ assetIds }) }, 'inventory-assets.csv'),
  imports: async () => normalizeImportSessionListResponse(await request<unknown>('/imports')),
  importSession: async (id: string) => normalizeImportSessionResponse(await request<unknown>(`/imports/${id}`)),
  createImportSession: async (profileId: number, mode: ImportMode) =>
    normalizeImportSessionResponse(await request<unknown>('/imports', { method: 'POST', body: JSON.stringify({ profileId, mode }) })),
  uploadImportFile: async (id: string, file: File) => {
    const form = new FormData(); form.set('file', file);
    return normalizeImportSessionResponse(await request<unknown>(`/imports/${id}/file`, { method: 'POST', body: form }));
  },
  saveImportMappings: async (id: string, mappings: Array<{ sourceIndex: number; fieldKey?: string; ignored?: boolean }>) =>
    normalizeImportSessionResponse(await request<unknown>(`/imports/${id}/mappings`, { method: 'PUT', body: JSON.stringify({ mappings }) })),
  validateImport: async (id: string) =>
    normalizeImportSessionResponse(await request<unknown>(`/imports/${id}/validate`, { method: 'POST', body: '{}' })),
  updateImportRow: async (batchId: string, rowId: string, body: { values?: Record<string, unknown>; fieldKey?: string; value?: unknown; included?: boolean }) =>
    normalizeImportSessionResponse(await request<unknown>(`/imports/${batchId}/rows/${rowId}`, { method: 'PATCH', body: JSON.stringify(body) })),
  bulkCorrectImport: async (batchId: string, fieldKey: string, sourceValue: string, value: unknown) => {
    const response = await request<unknown>(`/imports/${batchId}/corrections/bulk`, { method: 'POST', body: JSON.stringify({ fieldKey, sourceValue, value }) });
    return { session: normalizeImportSessionResponse(response), changed: count(object(response).changed) };
  },
  addImportLookup: async (batchId: string, fieldKey: string, value: string, reason: string) =>
    normalizeImportSessionResponse(await request<unknown>(`/imports/${batchId}/lookups`, { method: 'POST', body: JSON.stringify({ fieldKey, value, reason }) })),
  commitImport: async (id: string) => {
    const response = await request<unknown>(`/imports/${id}/commit`, { method: 'POST', body: '{}' });
    const data = object(response);
    return {
      session: normalizeImportSessionResponse(response),
      idempotent: boolean(data.idempotent),
      refresh: list(data.refresh).map((item) => text(item)),
    };
  },
  cancelImport: async (id: string) => normalizeImportSessionResponse(await request<unknown>(`/imports/${id}/cancel`, { method: 'POST', body: '{}' })),
  importValidationUrl: (id: string) => `${API}/imports/${id}/validation.csv`,
  importTemplateUrl: (profileId: number) => `${API}/profiles/${profileId}/import-template.csv`,
  reports: async () => list(object(await request<unknown>('/reports')).reports).map((item) => {
    const data = object(item);
    return { id: text(data.id), name: text(data.name), description: text(data.description) };
  }),
  report: async (id: string, values: Record<string, unknown>) => normalizeReportResponse(await request<unknown>(`/reports/${id}/results${query(values)}`)),
  reportExportUrl: (id: string, values: Record<string, unknown>) => `${API}/reports/${id}/export${query(values)}`,
  adminHealth: async () => object(await request<unknown>('/admin/health')),
  adminProfiles: async () => list(object(await request<unknown>('/admin/profiles')).profiles).map(object),
  adminUsers: async () => {
    const data = object(await request<unknown>('/admin/users'));
    return { users: list(data.users).map(object), roles: list(data.roles).map(object) };
  },
  updateUserRoles: (userId: number, roles: string[], reason: string) => request(`/admin/users/${userId}/roles`, { method: 'PATCH', body: JSON.stringify({ roles, reason }) }),
  createCategory: (body: unknown) => request('/admin/categories', { method: 'POST', body: JSON.stringify(body) }),
  addProfileField: (profileId: number, body: unknown) => request(`/admin/profiles/${profileId}/fields`, { method: 'POST', body: JSON.stringify(body) }),
  updateProfileField: (profileId: number, fieldId: number, body: unknown) => request(`/admin/profiles/${profileId}/fields/${fieldId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  addLookupValue: (lookupKey: string, body: unknown) => request(`/admin/lookups/${lookupKey}/values`, { method: 'POST', body: JSON.stringify(body) }),
  addLocation: (body: unknown) => request('/admin/locations', { method: 'POST', body: JSON.stringify(body) }),
  addVendor: (body: unknown) => request('/admin/vendors', { method: 'POST', body: JSON.stringify(body) }),
  addManufacturer: (body: unknown) => request('/admin/manufacturers', { method: 'POST', body: JSON.stringify(body) }),
  uploadModelImage: async (modelId: number, file: File) => {
    const form = new FormData(); form.set('file', file);
    return request<{ imagePath: string }>(`/models/${modelId}/image`, { method: 'POST', body: form });
  },
  removeModelImage: (modelId: number) => request(`/models/${modelId}/image`, { method: 'DELETE' }),
};

export function download(url: string, filename?: string): void {
  const link = document.createElement('a'); link.href = url; if (filename) link.download = filename; link.click();
}
