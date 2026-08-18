import type { Pool } from 'pg';
import type { DbClient } from './db.js';
import { pool } from './db.js';
import { AppError } from './errors.js';
import type { SessionUser } from './types.js';

export type ImportModeControl = 'DISABLED' | 'CANARY' | 'ENABLED';

export interface ImportControl {
  mode: ImportModeControl;
  reason: string;
  changedAt: string;
  changedByUserId: number | null;
  changedByName: string | null;
  changeSource: string;
}

type Queryable = Pick<DbClient, 'query'> | Pick<Pool, 'query'>;

export async function loadImportControl(client: Queryable = pool): Promise<ImportControl> {
  const result = await client.query(
    `SELECT control.mode,control.reason,control.changed_at,control.changed_by_user_id,
            control.change_source,user_account.display_name AS changed_by_name
     FROM import_runtime_control control
     LEFT JOIN application_users user_account ON user_account.id=control.changed_by_user_id
     WHERE control.control_key='GLOBAL'`,
  );
  const row = result.rows[0];
  if (!row) throw new AppError(503, 'IMPORT_CONTROL_MISSING', 'Import safety control is unavailable. Inventory commits remain unavailable.');
  return {
    mode: row.mode as ImportModeControl,
    reason: String(row.reason),
    changedAt: new Date(row.changed_at).toISOString(),
    changedByUserId: row.changed_by_user_id === null ? null : Number(row.changed_by_user_id),
    changedByName: row.changed_by_name === null ? null : String(row.changed_by_name),
    changeSource: String(row.change_source),
  };
}

export async function setImportControl(
  client: Queryable,
  input: { mode: ImportModeControl; reason: string; changedByUserId?: number | null; changeSource: string },
): Promise<ImportControl> {
  const reason = input.reason.trim();
  if (!reason) throw new AppError(400, 'IMPORT_CONTROL_REASON_REQUIRED', 'Enter a reason for changing import availability.');
  await client.query(
    `INSERT INTO import_runtime_control(control_key,mode,reason,changed_by_user_id,change_source,changed_at)
     VALUES('GLOBAL',$1,$2,$3,$4,now())
     ON CONFLICT(control_key) DO UPDATE
     SET mode=EXCLUDED.mode,reason=EXCLUDED.reason,changed_by_user_id=EXCLUDED.changed_by_user_id,
         change_source=EXCLUDED.change_source,changed_at=EXCLUDED.changed_at`,
    [input.mode, reason, input.changedByUserId ?? null, input.changeSource],
  );
  return loadImportControl(client);
}

export function requireImportCommitAllowed(control: ImportControl, user: SessionUser): void {
  if (control.mode === 'DISABLED') {
    throw new AppError(423, 'IMPORT_COMMITS_DISABLED', `Import commits are temporarily locked. ${control.reason}`, { importControl: control });
  }
  if (control.mode === 'CANARY' && !user.permissions.includes('admin.system')) {
    throw new AppError(423, 'IMPORT_CANARY_RESTRICTED', 'Import commits are in a controlled canary. A Privileged Administrator must run the approved canary import.', { importControl: control });
  }
}

export interface ImportMismatchField {
  fieldKey: string;
  expectedType: string;
  actualType: string;
}

export async function recordImportStage(
  client: Queryable,
  input: {
    batchId?: string | null;
    stage: string;
    eventKey: string;
    draftRevision?: number | null;
    rowNumber?: number | null;
    durationMs?: number | null;
    rowCount?: number | null;
    mismatchFields?: ImportMismatchField[];
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO import_stage_events(
       batch_id,stage,event_key,draft_revision,row_number,duration_ms,row_count,mismatch_fields,metadata
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,
    [
      input.batchId ?? null,
      input.stage,
      input.eventKey,
      input.draftRevision ?? null,
      input.rowNumber ?? null,
      input.durationMs ?? null,
      input.rowCount ?? null,
      JSON.stringify(input.mismatchFields ?? []),
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function disableImportsAfterVerificationFailure(input: {
  batchId: string;
  draftRevision: number;
  rowNumber: number;
  mismatches: ImportMismatchField[];
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setImportControl(client, {
      mode: 'DISABLED',
      reason: `Automatic lock after persistence verification failed for import ${input.batchId}.`,
      changedByUserId: null,
      changeSource: 'verification-watchdog',
    });
    await client.query(
      `UPDATE import_batches
       SET status='VERIFICATION_FAILED',verification_status='FAILED',
            verification_details=$2::jsonb,failure_message='Stored values did not match the import preview.',updated_at=now()
      WHERE id=$1 AND status<>'COMPLETED'`,
      [input.batchId, JSON.stringify({ rowNumber: input.rowNumber, mismatchFields: input.mismatches })],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await recordImportStage(pool, {
    batchId: input.batchId,
    stage: 'COMMIT',
    eventKey: 'PERSISTENCE_VERIFICATION_FAILED',
    draftRevision: input.draftRevision,
    rowNumber: input.rowNumber,
    mismatchFields: input.mismatches,
  });
}
