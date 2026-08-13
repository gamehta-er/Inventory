import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from './config.js';

export interface MaintenanceState {
  enabled: boolean;
  enabledAt: string | null;
  enabledBy: string | null;
  reason: string | null;
  source: 'application' | 'operations' | 'update' | null;
}

const inactiveState = (): MaintenanceState => ({
  enabled: false,
  enabledAt: null,
  enabledBy: null,
  reason: null,
  source: null,
});

export async function readMaintenanceState(path = config.maintenanceFlagPath): Promise<MaintenanceState> {
  try {
    const [content, file] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    try {
      const value = JSON.parse(content) as Partial<MaintenanceState>;
      return {
        enabled: true,
        enabledAt: typeof value.enabledAt === 'string' ? value.enabledAt : file.mtime.toISOString(),
        enabledBy: typeof value.enabledBy === 'string' ? value.enabledBy : null,
        reason: typeof value.reason === 'string' ? value.reason : null,
        source: value.source === 'application' || value.source === 'operations' || value.source === 'update'
          ? value.source
          : 'operations',
      };
    } catch {
      return { ...inactiveState(), enabled: true, enabledAt: file.mtime.toISOString(), source: 'operations' };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return inactiveState();
    throw error;
  }
}

export async function writeMaintenanceState(
  state: MaintenanceState,
  path = config.maintenanceFlagPath,
): Promise<void> {
  if (!state.enabled) {
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function maintenanceErrorMessage(state: MaintenanceState): string {
  return state.reason
    ? `Inventory Project is in maintenance mode: ${state.reason}`
    : 'Inventory Project is temporarily in maintenance mode.';
}
