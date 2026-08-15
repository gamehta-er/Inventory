export type PermissionMap = Record<string, boolean>;

export interface UserSummary {
  id: number;
  displayName: string;
  initials: string;
  roles: string[];
}

export interface SessionUser extends UserSummary {
  permissions: string[];
}

export interface AuthState {
  authenticated: boolean;
  user: SessionUser | null;
}

export interface Category {
  id: number;
  key: string;
  name: string;
  description: string;
  icon: string;
  profileId: number;
  profileKey: string;
  profileName: string;
  version: number;
  assetCount: number;
}

export interface LookupOption {
  id: number;
  value: string;
  label: string;
  description?: string;
  aliases?: string[];
}

export interface FieldDefinition {
  id: number;
  fieldKey: string;
  label: string;
  definition: string;
  helpText: string;
  dataType: 'text' | 'number' | 'date' | 'long_text' | 'lookup' | 'entity' | 'multi_reference' | 'boolean';
  lookupKey?: string;
  lookupName?: string;
  storageTarget: string;
  aliases: string[];
  validationRules: Record<string, unknown>;
  uniqueWhenPopulated: boolean;
  required: boolean;
  displayOrder: number;
  surfaces: Record<string, boolean>;
  options: LookupOption[];
}

export interface Profile {
  id: number;
  profile_key?: string;
  profile_name?: string;
  description: string;
  version: number;
  fields: FieldDefinition[];
}

export interface Lookups {
  lookups: Array<{ id: number; lookup_key: string; lookup_name: string; values: LookupOption[] }>;
  locations: Array<{
    id: number;
    parent_id: number | null;
    location_key: string;
    location_name: string;
    full_path: string;
    type_key: string;
    type_name: string;
    level_order: number;
  }>;
  users: Array<{ id: number; display_name: string; initials: string }>;
  vendors: Array<{ id: number; vendor_name: string }>;
}

export interface AppSession {
  user: SessionUser;
  permissions: PermissionMap;
  categories: Category[];
  statuses: Array<{ id: number; value_key: string; display_value: string; description: string }>;
  health: Record<string, number>;
  lifecycle: {
    groups: Record<'available' | 'unavailable' | 'exceptions', string[]>;
    operations: Record<string, {
      label: string;
      requiresStatus: boolean;
      requiresOwner: boolean;
      allowedStatuses: string[];
    }>;
  };
}

export interface AssetSummaryCounts {
  total: number;
  available: number;
  unavailable: number;
  exceptions: number;
}

export interface AssetSummary {
  id: number;
  revision: number;
  serialNumber: string;
  assetTag: string | null;
  dateReceived: string;
  category: { key: string; name: string };
  model: { modelNumber: string; productName: string; imagePath: string | null };
  status: string;
  location: string | null;
  owner: string;
  vendor: string;
  nvbugs: string[];
  references: { nvbugs: string[]; mrsOrders: string[]; capacityRequests: string[] };
}

export interface AssetDetail {
  id: number;
  profileId: number;
  revision: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  category: { id: number; key: string; name: string };
  model: { id: number; modelNumber: string; productName: string; boardSku?: string; gpuSku?: string; boardArchitecture?: string; imagePath: string | null };
  serialNumber: string;
  assetTag: string | null;
  dateReceived: string;
  status: { id: number; value: string; label: string };
  location: { id: number; path: string } | null;
  owner: { id: number; name: string };
  vendor: { id: number; name: string };
  milestone?: string;
  poolTeam?: string;
  project?: string;
  notes?: string;
  references: { nvbugs: string[]; mrsOrders: string[]; capacityRequests: string[] };
  values: Record<string, unknown>;
}

export interface ActivityEvent {
  id: number;
  action_key: string;
  source: string;
  reason: string;
  record_type: string;
  record_id: string;
  record_label: string;
  route_path: string;
  reference_value?: string;
  created_at: string;
  actor: string;
  effective_role_keys: string[];
  changes: Array<{ fieldKey: string; fieldLabel: string; before: unknown; after: unknown }>;
}

export interface ActivityResponse {
  events: ActivityEvent[];
  total: number;
  page: number;
  limit: number;
}

export interface ReportResult {
  reportId: string;
  kpis: Record<string, number>;
  dimensions: Record<string, Array<{ key: string; label: string; value: number }>>;
  trends: Array<{ month: string; value: number }>;
  quality: {
    complete: number;
    missing: number;
    issues: Array<{ key: string; label: string; value: number }>;
  };
  rows: Array<Record<string, unknown>>;
  page: number;
  limit: number;
  total: number;
}

export interface CommandCenterResult {
  generatedAt: string;
  queryTimeMs: number;
  database: { status: string };
  inventory: ReportResult;
  actionQueues: {
    rework: number;
    eWaste: number;
    metadataGaps: number;
    unassignedOwner: number;
    unassignedLocation: number;
    importsNeedingAttention: number;
  };
  imports: {
    open: number;
    needsAttention: number;
    ready: number;
    recent: ImportSessionSummary[];
  };
  recentActivity: ActivityEvent[];
}

export interface VersionContract {
  packageVersion: string;
  webVersion: string;
  apiVersion: string;
  schemaVersion: string;
  importContractVersion: string;
  compatible: boolean;
}

export interface LabelData {
  assetId: number;
  productName: string;
  modelNumber: string;
  boardSku: string | null;
  gpuSku: string | null;
  boardArchitecture: string | null;
  assetTag: string | null;
  serialNumber: string;
  barcodeValue: string;
  barcodeSvg: string;
}

export type LabelFieldKey =
  | 'productName'
  | 'modelNumber'
  | 'boardSku'
  | 'gpuSku'
  | 'boardArchitecture'
  | 'assetTag'
  | 'serialNumber';

export type ImportMode = 'CREATE' | 'UPDATE';

export type ImportSessionStatus =
  | 'DRAFT'
  | 'SOURCE_SELECTION'
  | 'MAPPING'
  | 'VALIDATING'
  | 'NEEDS_ATTENTION'
  | 'AWAITING_APPROVAL'
  | 'DECLINED'
  | 'APPROVED'
  | 'READY'
  | 'COMMITTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'VERIFICATION_FAILED'
  | 'CANCELLED'
  | 'NEEDS_REVALIDATION';

export interface ImportControl {
  mode: 'DISABLED' | 'CANARY' | 'ENABLED';
  reason: string;
  changedAt: string;
  changedByUserId: number | null;
  changedByName: string | null;
  changeSource: string;
}

export interface ImportReview {
  id: number;
  draftRevision: number;
  draftHash: string;
  reviewerUserId: number;
  reviewerName: string;
  decision: 'ACCEPT' | 'DECLINE';
  reason: string | null;
  createdAt: string;
}

export interface ImportMappingIssue {
  severity: 'WARNING' | 'ERROR';
  code: string;
  message: string;
  sourceIndex?: number;
  sourceHeader?: string;
  fieldKey?: string;
}

export interface ImportIssue {
  id?: number;
  fieldKey?: string;
  fieldLabel?: string;
  fieldDefinition?: string;
  severity: 'WARNING' | 'ERROR' | 'CONFIGURATION';
  code: string;
  message: string;
  sourceValue?: string;
  suggestedValues?: string[];
  resolution?: Record<string, unknown> | null;
  lookupKey?: string;
  lookupName?: string;
  approvedValues?: LookupOption[];
  adminRoute?: string;
  routePath?: string;
}

export interface ImportHeader {
  sourceIndex: number;
  header: string;
  fieldKey?: string;
  ignored: boolean;
}

export interface ImportRow {
  id: string;
  row_number: number;
  source_values: Record<string, string>;
  corrected_values: Record<string, unknown>;
  normalized_values: Record<string, unknown>;
  included: boolean;
  operation: ImportMode | null;
  target_asset_id: number | null;
  target_asset_revision: number | null;
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown> | null;
  status: 'PENDING' | 'VALID' | 'WARNING' | 'BLOCKED' | 'CONFIGURATION_ERROR' | 'EXCLUDED' | 'COMMITTED';
  committed_asset_id: number | null;
  issues: ImportIssue[];
}

export interface ImportCommitResult {
  import_row_id: string;
  asset_id: number;
  operation: ImportMode;
  asset_revision: number;
  product_name: string;
  serial_number: string;
}

export interface ImportSession {
  id: string;
  profileId: number;
  profileVersion: number;
  currentProfileVersion: number;
  profileName: string;
  categoryName: string;
  categoryKey: string;
  mode: ImportMode;
  fileName: string | null;
  fileSha256: string | null;
  fileSizeBytes: number | null;
  sourceFormat: 'CSV' | 'XLSX' | null;
  sourceSheetName: string | null;
  sourceEncoding: string | null;
  sourceDelimiter: string | null;
  sourceSchemaVersion: string;
  sourceOptions: Record<string, unknown>;
  availableSheets: Array<{ name: string; rowCount: number }>;
  draftRevision: number;
  draftHash: string | null;
  idempotencyKey: string;
  verificationStatus: 'NOT_RUN' | 'PENDING' | 'PASSED' | 'FAILED';
  verificationDetails: Record<string, unknown>;
  status: ImportSessionStatus;
  totalRows: number;
  validRows: number;
  warningRows: number;
  invalidRows: number;
  createdBy: string;
  createdByUserId: number;
  createdAt: string;
  updatedAt: string;
  validatedAt: string | null;
  completedAt: string | null;
  failureMessage: string | null;
  headers: ImportHeader[];
  mappingIssues: ImportMappingIssue[];
  fields: FieldDefinition[];
  rows: ImportRow[];
  results: ImportCommitResult[];
  reviews: ImportReview[];
  approvalProgress: { accepted: number; declined: number; required: number };
  reviewSummary: { includedRows: number; excludedRows: number; createRows: number; updateRows: number; warningRows: number; changedFields: number };
  stageEvents: Array<Record<string, unknown>>;
  importControl: ImportControl;
}

export interface ImportSessionSummary {
  id: string;
  mode: ImportMode;
  file_name: string | null;
  status: ImportSessionStatus;
  total_rows: number;
  valid_rows: number;
  warning_rows: number;
  invalid_rows: number;
  category_name: string;
  profile_name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ApiError extends Error {
  status?: number;
  code?: string;
  details?: { fields?: Array<{ fieldKey: string; message: string }> } & Record<string, unknown>;
  latest?: AssetDetail;
  requestId?: string;
}
