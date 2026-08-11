import type { DbClient } from './db.js';
import type { SessionUser } from './types.js';

export interface ActivityChange {
  fieldKey: string;
  fieldLabel: string;
  before: unknown;
  after: unknown;
}

export async function recordActivity(
  client: DbClient,
  input: {
    user: SessionUser;
    actionKey: string;
    source: string;
    reason?: string | undefined;
    recordType: string;
    recordId: string | number;
    recordLabel: string;
    routePath: string;
    referenceValue?: string | undefined;
    parentEventId?: number | undefined;
    parentImportBatchId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    changes?: ActivityChange[] | undefined;
  },
): Promise<number> {
  const event = await client.query<{ id: string }>(
    `INSERT INTO activity_events(
       actor_user_id,effective_role_keys,action_key,source,reason,record_type,record_id,
       record_label,route_path,reference_value,parent_event_id,parent_import_batch_id,metadata
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [
      input.user.id,
      input.user.roles,
      input.actionKey,
      input.source,
      input.reason ?? null,
      input.recordType,
      String(input.recordId),
      input.recordLabel,
      input.routePath,
      input.referenceValue ?? null,
      input.parentEventId ?? null,
      input.parentImportBatchId ?? null,
      input.metadata ?? {},
    ],
  );
  const eventId = Number(event.rows[0]!.id);
  for (const change of input.changes ?? []) {
    await client.query(
      `INSERT INTO activity_field_changes(activity_event_id,field_key,field_label,before_value,after_value)
       VALUES($1,$2,$3,$4,$5)`,
      [eventId, change.fieldKey, change.fieldLabel, JSON.stringify(change.before ?? null), JSON.stringify(change.after ?? null)],
    );
  }
  return eventId;
}
