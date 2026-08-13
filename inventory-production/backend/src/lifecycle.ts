import type { DbClient } from './db.js';
import { AppError } from './errors.js';

export const lifecycleStatusKeys = [
  'IN_USE',
  'REWORK',
  'E_WASTE',
  'ARCHIVE',
  'GPU_READY',
  'AVAILABLE',
] as const;

export const lifecycleGroups = {
  available: ['AVAILABLE', 'GPU_READY'],
  unavailable: ['IN_USE', 'REWORK', 'E_WASTE'],
  exceptions: ['REWORK', 'E_WASTE'],
} as const;

export type LifecycleGroup = keyof typeof lifecycleGroups;
export type LifecycleStatusKey = typeof lifecycleStatusKeys[number];
export type AssetOperation = 'ASSIGN' | 'RETURN' | 'TRANSFER' | 'CHANGE_STATUS' | 'ARCHIVE' | 'RESTORE';

export const lifecycleOperations: Record<AssetOperation, {
  label: string;
  requiresStatus: boolean;
  requiresOwner: boolean;
  allowedStatuses: string[];
}> = {
  ASSIGN: { label: 'Assign', requiresStatus: false, requiresOwner: true, allowedStatuses: ['IN_USE'] },
  RETURN: { label: 'Return', requiresStatus: true, requiresOwner: false, allowedStatuses: ['AVAILABLE', 'GPU_READY', 'REWORK', 'E_WASTE'] },
  TRANSFER: { label: 'Transfer', requiresStatus: false, requiresOwner: false, allowedStatuses: [] },
  CHANGE_STATUS: { label: 'Change Status', requiresStatus: true, requiresOwner: false, allowedStatuses: ['AVAILABLE', 'GPU_READY', 'REWORK', 'E_WASTE'] },
  ARCHIVE: { label: 'Archive', requiresStatus: false, requiresOwner: false, allowedStatuses: ['ARCHIVE'] },
  RESTORE: { label: 'Restore', requiresStatus: true, requiresOwner: false, allowedStatuses: ['AVAILABLE', 'GPU_READY', 'REWORK', 'E_WASTE'] },
};

export function isLifecycleGroup(value: unknown): value is LifecycleGroup {
  return typeof value === 'string' && Object.hasOwn(lifecycleGroups, value);
}

export function isLifecycleStatusKey(value: unknown): value is LifecycleStatusKey {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return lifecycleStatusKeys.some((status) => status === normalized);
}

export function appendLifecycleFilter(
  group: unknown,
  parameters: unknown[],
  where: string[],
): void {
  if (group === undefined || group === '') return;
  if (!isLifecycleGroup(group)) throw new AppError(400, 'INVALID_LIFECYCLE_GROUP', 'Select a valid lifecycle summary.');
  parameters.push([...lifecycleGroups[group]]);
  where.push(`sv.value_key=ANY($${parameters.length}::text[])`);
}

export async function statusByKey(client: DbClient, key: string): Promise<{ id: number; key: string }> {
  const result = await client.query(
    `SELECT lv.id,lv.value_key
       FROM lookup_values lv
       JOIN lookup_lists ll ON ll.id=lv.lookup_list_id
      WHERE ll.lookup_key='ASSET_STATUS' AND lv.value_key=$1 AND lv.active`,
    [key],
  );
  if (!result.rows[0]) throw new AppError(422, 'STATUS_INVALID', `Status ${key} is not available.`);
  return { id: Number(result.rows[0].id), key: result.rows[0].value_key };
}

export async function statusById(client: DbClient, id: number): Promise<{ id: number; key: string }> {
  const result = await client.query(
    `SELECT lv.id,lv.value_key
       FROM lookup_values lv
       JOIN lookup_lists ll ON ll.id=lv.lookup_list_id
      WHERE ll.lookup_key='ASSET_STATUS' AND lv.id=$1 AND lv.active`,
    [id],
  );
  if (!result.rows[0]) throw new AppError(422, 'STATUS_INVALID', 'Select a valid lifecycle status.');
  return { id: Number(result.rows[0].id), key: result.rows[0].value_key };
}

export function assertOperationStatus(operation: AssetOperation, statusKey?: string): void {
  const rule = lifecycleOperations[operation];
  if (rule.requiresStatus && !statusKey) throw new AppError(422, 'STATUS_REQUIRED', 'Status is required.');
  if (statusKey && rule.allowedStatuses.length && !rule.allowedStatuses.includes(statusKey)) {
    throw new AppError(422, 'STATUS_TRANSITION_INVALID', `${rule.label} cannot set status to ${statusKey}.`);
  }
}
