import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { extname, resolve } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { pool, withTransaction, type DbClient } from './db.js';
import { AppError } from './errors.js';
import { recordActivity, type ActivityChange } from './activity.js';
import { authenticate, requirePermission, verifyCsrf } from './auth.js';
import { canonicalizeValues, loadProfileFields, validateValues } from './registry.js';
import { appendRegistryFilters } from './filtering.js';
import { normalizeNVBugs, referenceInsertionOrder, splitReferences } from './references.js';
import type { AuthenticatedRequest, FieldDefinition, SessionUser } from './types.js';
import {
  appendLifecycleFilter,
  assertOperationStatus,
  lifecycleGroups,
  lifecycleOperations,
  statusById,
  statusByKey,
  type AssetOperation,
} from './lifecycle.js';

type Values = Record<string, unknown>;

const standardColumns: Record<string, string> = {
  date_received: 'a.date_received',
  serial_number: 'a.serial_number',
  asset_tag: 'a.asset_tag',
  milestone: 'a.milestone',
  project: 'a.project',
  pool_team: 'a.pool_team',
  notes: 'a.notes',
  model_number: 'am.model_number',
  product_name: 'am.product_name',
  board_sku: 'am.board_sku',
  gpu_sku: 'am.gpu_sku',
  board_architecture: 'am.board_architecture',
  gpu_class: 'am.gpu_class',
  gpu_chip: 'am.gpu_chip',
  gpu_name_vrl: 'am.gpu_name_vrl',
  gpu_name_market: 'am.gpu_name_market',
};

function valueAsId(values: Values, key: string, required = false): number | null {
  const raw = values[key];
  if (raw === '' || raw === null || raw === undefined) {
    if (required) throw new AppError(422, 'VALIDATION_FAILED', `${key} is required.`);
    return null;
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new AppError(422, 'VALIDATION_FAILED', `${key} must reference a valid record.`);
  return id;
}

function valueAsBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw new AppError(422, 'VALIDATION_FAILED', 'Enter a valid true or false value.');
}

function referenceEntries(values: Values): Array<[string, Array<{ value:string; normalized:string }>]> {
  return [
    ['NVBUG', normalizeNVBugs(values.nvbugs).map((value) => ({ value, normalized:value }))],
    ['MRS_ORDER', splitReferences(values.mrs_order).map((value) => ({ value, normalized:value.toLocaleUpperCase() }))],
    ['CAPACITY_REQUEST', splitReferences(values.capacity_request).map((value) => ({ value, normalized:value.toLocaleUpperCase() }))],
  ];
}

function canonicalizeReferenceValues(values: Values): Values {
  const next = { ...values };
  for (const [type, entries] of referenceEntries(values)) {
    const key = type === 'NVBUG' ? 'nvbugs' : type === 'MRS_ORDER' ? 'mrs_order' : 'capacity_request';
    next[key] = entries.map((entry) => entry.value).join(', ');
  }
  return next;
}

async function syncReferences(client: DbClient, assetId: number, values: Values): Promise<void> {
  for (const [type, desired] of referenceEntries(values)) {
    const typeResult = await client.query<{ id:string }>('SELECT id FROM external_reference_types WHERE reference_type_key=$1', [type]);
    const typeId = Number(typeResult.rows[0]?.id);
    if (!typeId) throw new AppError(500, 'REFERENCE_TYPE_MISSING', `Reference type ${type} is not configured.`);
    const existing = await client.query<{ id:string; reference_value:string; normalized_value:string }>(
      'SELECT id,reference_value,normalized_value FROM asset_external_references WHERE asset_id=$1 AND reference_type_id=$2 ORDER BY created_at DESC,id DESC',
      [assetId, typeId],
    );
    const desiredByNormalized = new Map(desired.map((entry) => [entry.normalized, entry]));
    const removeIds = existing.rows.filter((entry) => !desiredByNormalized.has(entry.normalized_value)).map((entry) => Number(entry.id));
    if (removeIds.length) await client.query('DELETE FROM asset_external_references WHERE asset_id=$1 AND id=ANY($2::bigint[])', [assetId, removeIds]);
    const existingByNormalized = new Map(existing.rows.map((entry) => [entry.normalized_value, entry]));
    // New references share a transaction timestamp, so insert oldest-first and
    // let the id DESC tie-break preserve the user's newest-first entry order.
    for (const entry of referenceInsertionOrder(desired)) {
      const current = existingByNormalized.get(entry.normalized);
      if (current) {
        if (current.reference_value !== entry.value) await client.query('UPDATE asset_external_references SET reference_value=$2 WHERE id=$1', [Number(current.id), entry.value]);
        continue;
      }
      await client.query(
        'INSERT INTO asset_external_references(asset_id,reference_type_id,reference_value,normalized_value) VALUES($1,$2,$3,$4)',
        [assetId, typeId, entry.value, entry.normalized],
      );
    }
  }
}

async function saveDynamicValues(client: DbClient, assetId: number, fields: FieldDefinition[], values: Values): Promise<void> {
  const coreTargets = ['assets.', 'asset_models.', 'external_reference:'];
  for (const field of fields.filter((item) => !coreTargets.some((prefix) => item.storageTarget.startsWith(prefix)))) {
    const value = values[field.fieldKey];
    await client.query('DELETE FROM asset_field_values WHERE asset_id=$1 AND field_definition_id=$2', [assetId, field.id]);
    if (value === undefined || value === null || String(value).trim() === '') continue;
    const columns = field.dataType === 'date' ? ['date_value', String(value)]
      : field.dataType === 'number' ? ['number_value', Number(value)]
      : field.dataType === 'boolean' ? ['boolean_value', valueAsBoolean(value)]
      : ['text_value', String(value)];
    const safeColumn = columns[0];
    await client.query(`INSERT INTO asset_field_values(asset_id,field_definition_id,${safeColumn}) VALUES($1,$2,$3)`, [assetId, field.id, columns[1]]);
  }
}

async function loadAsset(assetId: number, client: DbClient | typeof pool = pool) {
  const result = await client.query(
    `SELECT a.id,a.profile_id,a.revision,a.archived_at,a.created_at,a.updated_at,
       c.id category_id,c.category_key,c.category_name,
       am.id model_id,am.model_number,am.product_name,am.board_sku,am.gpu_sku,am.board_architecture,
       am.gpu_class,am.gpu_chip,am.gpu_name_vrl,am.gpu_name_market,am.image_path,
       a.serial_number,a.asset_tag,a.date_received,a.milestone,a.pool_team,a.project,a.notes,
       sv.id status_id,sv.value_key status,sv.display_value status_label,
       l.id location_id,l.full_path location,
       u.id owner_id,u.display_name owner,
       v.id vendor_id,v.vendor_name vendor,
       COALESCE((SELECT jsonb_object_agg(rt.reference_type_key,refs.values)
         FROM (SELECT aer.reference_type_id,jsonb_agg(aer.reference_value ORDER BY aer.created_at DESC,aer.id DESC) values
               FROM asset_external_references aer WHERE aer.asset_id=a.id GROUP BY aer.reference_type_id) refs
         JOIN external_reference_types rt ON rt.id=refs.reference_type_id),'{}'::jsonb) references,
       COALESCE((SELECT jsonb_object_agg(fd.field_key,
          COALESCE(to_jsonb(afv.text_value),to_jsonb(afv.number_value),to_jsonb(afv.date_value),to_jsonb(afv.boolean_value),afv.json_value))
          FROM asset_field_values afv JOIN field_definitions fd ON fd.id=afv.field_definition_id WHERE afv.asset_id=a.id),'{}'::jsonb) dynamic_values
     FROM assets a JOIN asset_models am ON am.id=a.asset_model_id JOIN categories c ON c.id=am.category_id
     JOIN lookup_values sv ON sv.id=a.status_value_id
     LEFT JOIN locations l ON l.id=a.location_id JOIN application_users u ON u.id=a.owner_user_id JOIN vendors v ON v.id=a.vendor_id
     WHERE a.id=$1`,
    [assetId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
  const references = row.references as Record<string, string[]>;
  return {
    id: Number(row.id), profileId: Number(row.profile_id), revision: row.revision, archived: Boolean(row.archived_at),
    createdAt: row.created_at, updatedAt: row.updated_at,
    category: { id:Number(row.category_id), key:row.category_key, name:row.category_name },
    model: {
      id:Number(row.model_id), modelNumber:row.model_number, productName:row.product_name,
      boardSku:row.board_sku, gpuSku:row.gpu_sku, boardArchitecture:row.board_architecture,
      gpuClass:row.gpu_class, gpuChip:row.gpu_chip, gpuNameVrl:row.gpu_name_vrl,
      gpuNameMarket:row.gpu_name_market, imagePath:row.image_path,
    },
    serialNumber: row.serial_number, assetTag: row.asset_tag, dateReceived: row.date_received,
    status: { id:Number(row.status_id), value:row.status, label:row.status_label },
    location: row.location_id ? { id:Number(row.location_id), path:row.location } : null,
    owner: { id:Number(row.owner_id), name:row.owner }, vendor: { id:Number(row.vendor_id), name:row.vendor },
    milestone:row.milestone,poolTeam:row.pool_team,project:row.project,notes:row.notes,
    references: { nvbugs:references.NVBUG ?? [], mrsOrders:references.MRS_ORDER ?? [], capacityRequests:references.CAPACITY_REQUEST ?? [] },
    values: {
      mrs_order:(references.MRS_ORDER ?? []).join(', '), nvbugs:(references.NVBUG ?? []).join(', '), capacity_request:(references.CAPACITY_REQUEST ?? []).join(', '),
      date_received:row.date_received, board_sku:row.board_sku, gpu_sku:row.gpu_sku, model_number:row.model_number,
      serial_number:row.serial_number,milestone:row.milestone,product_name:row.product_name,location:row.location_id,
      asset_status:row.status_id,board_architecture:row.board_architecture,gpu_class:row.gpu_class,
      gpu_chip:row.gpu_chip,gpu_name_vrl:row.gpu_name_vrl,gpu_name_market:row.gpu_name_market,
      pool_team:row.pool_team,project:row.project,
      asset_tag:row.asset_tag,owner:row.owner_id,notes:row.notes,vendor:row.vendor_id,...row.dynamic_values,
    },
  };
}

async function ensureReferencesExist(client: DbClient, values: Values): Promise<void> {
  const checks: Array<[string, number | null, string]> = [
    ['application_users', valueAsId(values, 'owner', true), 'Owner / Assignee'],
    ['vendors', valueAsId(values, 'vendor', true), 'Vendor'],
    ['lookup_values', valueAsId(values, 'asset_status', true), 'Status'],
    ['locations', valueAsId(values, 'location'), 'Location'],
  ];
  for (const [table, id, label] of checks) {
    if (id === null) continue;
    const found = await client.query(`SELECT 1 FROM ${table} WHERE id=$1 AND active`, [id]);
    if (!found.rowCount) throw new AppError(422, 'INVALID_REFERENCE', `${label} is not available.`);
  }
}

async function resolveModel(client: DbClient, profileId: number, values: Values): Promise<number> {
  const profile = await client.query('SELECT category_id FROM asset_profiles WHERE id=$1 AND active', [profileId]);
  if (!profile.rows[0]) throw new AppError(422, 'PROFILE_NOT_FOUND', 'The selected profile is unavailable.');
  const categoryId = Number(profile.rows[0].category_id);
  const existing = await client.query('SELECT id FROM asset_models WHERE category_id=$1 AND lower(model_number)=lower($2)', [categoryId, String(values.model_number)]);
  if (existing.rows[0]) {
    const modelId = Number(existing.rows[0].id);
    await client.query(
      `UPDATE asset_models SET
         product_name=COALESCE(NULLIF(product_name,''),NULLIF($2,'')),
         board_sku=COALESCE(NULLIF(board_sku,''),NULLIF($3,'')),
         gpu_sku=COALESCE(NULLIF(gpu_sku,''),NULLIF($4,'')),
         board_architecture=COALESCE(NULLIF(board_architecture,''),NULLIF($5,'')),
         gpu_class=COALESCE(NULLIF(gpu_class,''),NULLIF($6,'')),
         gpu_chip=COALESCE(NULLIF(gpu_chip,''),NULLIF($7,'')),
         gpu_name_vrl=COALESCE(NULLIF(gpu_name_vrl,''),NULLIF($8,'')),
         gpu_name_market=COALESCE(NULLIF(gpu_name_market,''),NULLIF($9,'')),
         updated_at=CASE
           WHEN (NULLIF(product_name,'') IS NULL AND NULLIF($2,'') IS NOT NULL)
             OR (NULLIF(board_sku,'') IS NULL AND NULLIF($3,'') IS NOT NULL)
             OR (NULLIF(gpu_sku,'') IS NULL AND NULLIF($4,'') IS NOT NULL)
             OR (NULLIF(board_architecture,'') IS NULL AND NULLIF($5,'') IS NOT NULL)
             OR (NULLIF(gpu_class,'') IS NULL AND NULLIF($6,'') IS NOT NULL)
             OR (NULLIF(gpu_chip,'') IS NULL AND NULLIF($7,'') IS NOT NULL)
             OR (NULLIF(gpu_name_vrl,'') IS NULL AND NULLIF($8,'') IS NOT NULL)
             OR (NULLIF(gpu_name_market,'') IS NULL AND NULLIF($9,'') IS NOT NULL)
           THEN now() ELSE updated_at END
       WHERE id=$1`,
      [
        modelId, values.product_name ?? '', values.board_sku ?? '', values.gpu_sku ?? '',
        values.board_architecture ?? '', values.gpu_class ?? '', values.gpu_chip ?? '',
        values.gpu_name_vrl ?? '', values.gpu_name_market ?? '',
      ],
    );
    return modelId;
  }
  const created = await client.query<{ id: string }>(
    `INSERT INTO asset_models(
       category_id,model_number,product_name,board_sku,gpu_sku,board_architecture,
       gpu_class,gpu_chip,gpu_name_vrl,gpu_name_market
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      categoryId, values.model_number, values.product_name, values.board_sku || null,
      values.gpu_sku || null, values.board_architecture || null, values.gpu_class || null,
      values.gpu_chip || null, values.gpu_name_vrl || null, values.gpu_name_market || null,
    ],
  );
  return Number(created.rows[0]!.id);
}

async function createAsset(client: DbClient, profileId: number, values: Values, user: SessionUser, reason: string, source = 'asset-form', parentImportBatchId?: string) {
  const fields = await validateValues(profileId, values, client);
  const canonicalValues = canonicalizeReferenceValues(canonicalizeValues(fields, values));
  await ensureReferencesExist(client, canonicalValues);
  const modelId = await resolveModel(client, profileId, canonicalValues);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO assets(asset_model_id,profile_id,serial_number,asset_tag,date_received,status_value_id,location_id,owner_user_id,vendor_id,milestone,pool_team,project,notes)
     VALUES($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8,$9,NULLIF($10,''),NULLIF($11,''),NULLIF($12,''),NULLIF($13,'')) RETURNING id`,
    [modelId, profileId, canonicalValues.serial_number, canonicalValues.asset_tag ?? '', canonicalValues.date_received, valueAsId(canonicalValues,'asset_status',true), valueAsId(canonicalValues,'location'), valueAsId(canonicalValues,'owner',true), valueAsId(canonicalValues,'vendor',true), canonicalValues.milestone ?? '', canonicalValues.pool_team ?? '', canonicalValues.project ?? '', canonicalValues.notes ?? ''],
  );
  const assetId = Number(inserted.rows[0]!.id);
  await syncReferences(client, assetId, canonicalValues);
  await saveDynamicValues(client, assetId, fields, canonicalValues);
  const initialStatusId = valueAsId(canonicalValues, 'asset_status', true)!;
  const initialStatus = await statusById(client, initialStatusId);
  if (initialStatus.key === 'IN_USE') {
    await client.query(
      'INSERT INTO asset_assignments(asset_id,assignee_user_id,location_id,reason,actor_user_id) VALUES($1,$2,$3,$4,$5)',
      [assetId, valueAsId(canonicalValues, 'owner', true), valueAsId(canonicalValues, 'location'), reason, user.id],
    );
  }
  await client.query(
    'INSERT INTO asset_status_events(asset_id,from_status_value_id,to_status_value_id,reason,actor_user_id) VALUES($1,NULL,$2,$3,$4)',
    [assetId, initialStatusId, reason, user.id],
  );
  const created = await loadAsset(assetId, client);
  await recordActivity(client, { user, actionKey:'ASSET_CREATED', source, reason, recordType:'asset', recordId:assetId, recordLabel:String(canonicalValues.product_name), routePath:`/assets/${assetId}`, referenceValue:created.references.nvbugs[0], parentImportBatchId, changes:fields.map((field) => ({ fieldKey:field.fieldKey, fieldLabel:field.label, before:null, after:created.values[field.fieldKey] ?? null })) });
  return created;
}

async function updateAsset(
  client: DbClient,
  id: number,
  revision: number,
  values: Values,
  user: SessionUser,
  reason: string,
  source = 'asset-form',
  parentImportBatchId?: string,
) {
  const locked = await client.query('SELECT revision FROM assets WHERE id=$1 FOR UPDATE', [id]);
  if (!locked.rows[0]) throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
  if (Number(locked.rows[0].revision) !== revision) {
    throw new AppError(409, 'REVISION_CONFLICT', 'Another user changed this asset.', { latest: await loadAsset(id, client) });
  }

  const before = await loadAsset(id, client);
  const fields = await validateValues(before.profileId, values, client, id);
  const canonicalValues = canonicalizeReferenceValues(canonicalizeValues(fields, values));
  await ensureReferencesExist(client, canonicalValues);
  const modelId = await resolveModel(client, before.profileId, canonicalValues);
  await client.query(
    `UPDATE assets SET asset_model_id=$2,serial_number=$3,asset_tag=NULLIF($4,''),date_received=$5,status_value_id=$6,location_id=$7,
      owner_user_id=$8,vendor_id=$9,milestone=NULLIF($10,''),pool_team=NULLIF($11,''),project=NULLIF($12,''),notes=NULLIF($13,''),revision=revision+1,updated_at=now() WHERE id=$1`,
    [id, modelId, canonicalValues.serial_number, canonicalValues.asset_tag ?? '', canonicalValues.date_received, valueAsId(canonicalValues, 'asset_status', true), valueAsId(canonicalValues, 'location'), valueAsId(canonicalValues, 'owner', true), valueAsId(canonicalValues, 'vendor', true), canonicalValues.milestone ?? '', canonicalValues.pool_team ?? '', canonicalValues.project ?? '', canonicalValues.notes ?? ''],
  );
  await syncReferences(client, id, canonicalValues);
  await saveDynamicValues(client, id, fields, canonicalValues);

  const nextStatusId = valueAsId(canonicalValues, 'asset_status', true)!;
  if (nextStatusId !== before.status.id) {
    const nextStatus = await statusById(client, nextStatusId);
    if (nextStatus.key === 'IN_USE') {
      const active = await client.query('SELECT 1 FROM asset_assignments WHERE asset_id=$1 AND returned_at IS NULL', [id]);
      if (!active.rows[0]) {
        await client.query(
          'INSERT INTO asset_assignments(asset_id,assignee_user_id,location_id,reason,actor_user_id) VALUES($1,$2,$3,$4,$5)',
          [id, valueAsId(canonicalValues, 'owner', true), valueAsId(canonicalValues, 'location'), reason, user.id],
        );
      }
    } else {
      await client.query('UPDATE asset_assignments SET returned_at=now() WHERE asset_id=$1 AND returned_at IS NULL', [id]);
    }
    await client.query(
      'INSERT INTO asset_status_events(asset_id,from_status_value_id,to_status_value_id,reason,actor_user_id) VALUES($1,$2,$3,$4,$5)',
      [id, before.status.id, nextStatusId, reason, user.id],
    );
  } else if (before.status.value === 'IN_USE') {
    const active = await client.query('SELECT id FROM asset_assignments WHERE asset_id=$1 AND returned_at IS NULL FOR UPDATE', [id]);
    if (active.rows[0]) {
      await client.query(
        'UPDATE asset_assignments SET assignee_user_id=$2,location_id=$3 WHERE id=$1',
        [active.rows[0].id, valueAsId(canonicalValues, 'owner', true), valueAsId(canonicalValues, 'location')],
      );
    } else {
      await client.query(
        'INSERT INTO asset_assignments(asset_id,assignee_user_id,location_id,reason,actor_user_id) VALUES($1,$2,$3,$4,$5)',
        [id, valueAsId(canonicalValues, 'owner', true), valueAsId(canonicalValues, 'location'), reason, user.id],
      );
    }
  }

  const after = await loadAsset(id, client);
  await recordActivity(client, {
    user,
    actionKey: 'ASSET_UPDATED',
    source,
    reason,
    recordType: 'asset',
    recordId: id,
    recordLabel: String(canonicalValues.product_name),
    routePath: `/assets/${id}`,
    referenceValue: after.references.nvbugs[0],
    parentImportBatchId,
    changes: changesFrom(before.values, after.values, fields),
  });
  return after;
}

function changesFrom(oldValues: Values, nextValues: Values, fields: FieldDefinition[]): ActivityChange[] {
  return fields.flatMap((field) => {
    const before = oldValues[field.fieldKey] ?? null;
    const after = nextValues[field.fieldKey] ?? null;
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ fieldKey:field.fieldKey, fieldLabel:field.label, before, after }];
  });
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function registerAssetRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/assets', { preHandler: requirePermission('asset.view') }, async (request) => {
    const query = request.query as Record<string,string|undefined>;
    const parameters: unknown[] = [];
    const where = ['a.archived_at IS NULL'];
    const add = (clause:string,value:unknown) => { parameters.push(value); where.push(clause.replace('?',`$${parameters.length}`)); };
    if (query.category) add('c.category_key=?', query.category);
    if (query.status) add('sv.value_key=?', query.status);
    if (query.locationId) {
      parameters.push(Number(query.locationId));
      const p = `$${parameters.length}`;
      where.push(`(l.id=${p} OR l.full_path LIKE (SELECT full_path || '%' FROM locations WHERE id=${p}))`);
    }
    if (query.ownerId) add('u.id=?', Number(query.ownerId));
    if (query.vendorId) add('v.id=?', Number(query.vendorId));
    appendLifecycleFilter(query.availability, parameters, where);
    if (query.q?.trim()) {
      parameters.push(query.q.trim());
      const p = `$${parameters.length}`;
      where.push(`(
        (EXISTS(SELECT 1 FROM categories exact WHERE lower(exact.category_key)=lower(${p}) OR lower(exact.category_name)=lower(${p})) AND (lower(c.category_key)=lower(${p}) OR lower(c.category_name)=lower(${p})))
        OR (NOT EXISTS(SELECT 1 FROM categories exact WHERE lower(exact.category_key)=lower(${p}) OR lower(exact.category_name)=lower(${p})) AND
          (lower(a.serial_number)=lower(${p}) OR lower(COALESCE(a.asset_tag,''))=lower(${p}) OR am.model_number ILIKE '%'||${p}||'%' OR am.product_name ILIKE '%'||${p}||'%' OR u.display_name ILIKE '%'||${p}||'%' OR COALESCE(l.full_path,'') ILIKE '%'||${p}||'%'
           OR EXISTS(SELECT 1 FROM asset_external_references search_ref WHERE search_ref.asset_id=a.id AND search_ref.reference_value ILIKE '%'||${p}||'%')))
      )`);
    }
    appendRegistryFilters(query, parameters, where, 'filter');
    const countParameters = [...parameters];
    const summary = await pool.query(
      `SELECT count(*)::int total,
              count(*) FILTER(WHERE sv.value_key=ANY($${countParameters.length + 1}::text[]))::int available,
              count(*) FILTER(WHERE sv.value_key=ANY($${countParameters.length + 2}::text[]))::int unavailable,
              count(*) FILTER(WHERE sv.value_key=ANY($${countParameters.length + 3}::text[]))::int exceptions
         FROM assets a JOIN asset_models am ON am.id=a.asset_model_id JOIN categories c ON c.id=am.category_id
         JOIN lookup_values sv ON sv.id=a.status_value_id LEFT JOIN locations l ON l.id=a.location_id
         JOIN application_users u ON u.id=a.owner_user_id JOIN vendors v ON v.id=a.vendor_id
        WHERE ${where.join(' AND ')}`,
      [...countParameters, [...lifecycleGroups.available], [...lifecycleGroups.unavailable], [...lifecycleGroups.exceptions]],
    );
    const limit = Math.min(Math.max(Number(query.limit) || 50,1),200);
    const page = Math.max(Number(query.page) || 1,1);
    parameters.push(limit, (page-1)*limit);
    const result = await pool.query(
      `SELECT a.id,a.revision,a.serial_number,a.asset_tag,a.date_received,c.category_key,c.category_name,
              am.model_number,am.product_name,am.image_path,sv.value_key status,l.full_path location,u.display_name owner,v.vendor_name vendor,
              COALESCE((SELECT jsonb_agg(aer.reference_value ORDER BY aer.created_at DESC,aer.id DESC) FROM asset_external_references aer JOIN external_reference_types rt ON rt.id=aer.reference_type_id WHERE aer.asset_id=a.id AND rt.reference_type_key='NVBUG'),'[]'::jsonb) nvbugs,
              COALESCE((SELECT jsonb_agg(aer.reference_value ORDER BY aer.created_at DESC,aer.id DESC) FROM asset_external_references aer JOIN external_reference_types rt ON rt.id=aer.reference_type_id WHERE aer.asset_id=a.id AND rt.reference_type_key='MRS_ORDER'),'[]'::jsonb) mrs_orders,
              COALESCE((SELECT jsonb_agg(aer.reference_value ORDER BY aer.created_at DESC,aer.id DESC) FROM asset_external_references aer JOIN external_reference_types rt ON rt.id=aer.reference_type_id WHERE aer.asset_id=a.id AND rt.reference_type_key='CAPACITY_REQUEST'),'[]'::jsonb) capacity_requests,
              count(*) OVER()::int total
       FROM assets a JOIN asset_models am ON am.id=a.asset_model_id JOIN categories c ON c.id=am.category_id
       JOIN lookup_values sv ON sv.id=a.status_value_id LEFT JOIN locations l ON l.id=a.location_id
       JOIN application_users u ON u.id=a.owner_user_id JOIN vendors v ON v.id=a.vendor_id
       WHERE ${where.join(' AND ')} ORDER BY a.updated_at DESC,a.id DESC LIMIT $${parameters.length-1} OFFSET $${parameters.length}`,
      parameters,
    );
    const counts = summary.rows[0] ?? { total:0, available:0, unavailable:0, exceptions:0 };
    return {
      assets:result.rows.map((r) => ({
        id:Number(r.id),revision:r.revision,serialNumber:r.serial_number,assetTag:r.asset_tag,dateReceived:r.date_received,
        category:{key:r.category_key,name:r.category_name},model:{modelNumber:r.model_number,productName:r.product_name,imagePath:r.image_path},
        status:r.status,location:r.location,owner:r.owner,vendor:r.vendor,nvbugs:r.nvbugs ?? [],
        references:{nvbugs:r.nvbugs ?? [],mrsOrders:r.mrs_orders ?? [],capacityRequests:r.capacity_requests ?? []},
      })),
      page,
      limit,
      total:Number(counts.total) || 0,
      summary:{
        total:Number(counts.total) || 0,
        available:Number(counts.available) || 0,
        unavailable:Number(counts.unavailable) || 0,
        exceptions:Number(counts.exceptions) || 0,
      },
    };
  });

  app.post('/api/v1/assets/export', { preHandler: requirePermission('report.export') }, async (request, reply) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const assetIds = [...new Set(((request.body as { assetIds?: unknown[] })?.assetIds ?? []).map(Number))]
      .filter((id) => Number.isInteger(id) && id > 0);
    if (!assetIds.length || assetIds.length > 200) throw new AppError(422, 'ASSET_SELECTION_INVALID', 'Select between 1 and 200 assets to export.');
    const csv = await withTransaction(async (client) => {
      const rows = await client.query(
        `SELECT a.id,c.category_name,am.product_name,am.model_number,a.serial_number,a.asset_tag,
                sv.display_value status,COALESCE(l.full_path,'') location,u.display_name owner,
                v.vendor_name,a.date_received,a.project,a.pool_team,
                COALESCE((SELECT string_agg(aer.reference_value,', ' ORDER BY aer.created_at DESC,aer.id DESC)
                  FROM asset_external_references aer JOIN external_reference_types rt ON rt.id=aer.reference_type_id
                  WHERE aer.asset_id=a.id AND rt.reference_type_key='NVBUG'),'') nvbugs,
                COALESCE((SELECT string_agg(aer.reference_value,', ' ORDER BY aer.created_at DESC,aer.id DESC)
                  FROM asset_external_references aer JOIN external_reference_types rt ON rt.id=aer.reference_type_id
                  WHERE aer.asset_id=a.id AND rt.reference_type_key='MRS_ORDER'),'') mrs_orders,
                COALESCE((SELECT string_agg(aer.reference_value,', ' ORDER BY aer.created_at DESC,aer.id DESC)
                  FROM asset_external_references aer JOIN external_reference_types rt ON rt.id=aer.reference_type_id
                  WHERE aer.asset_id=a.id AND rt.reference_type_key='CAPACITY_REQUEST'),'') capacity_requests
         FROM assets a JOIN asset_models am ON am.id=a.asset_model_id JOIN categories c ON c.id=am.category_id
         JOIN lookup_values sv ON sv.id=a.status_value_id LEFT JOIN locations l ON l.id=a.location_id
         JOIN application_users u ON u.id=a.owner_user_id JOIN vendors v ON v.id=a.vendor_id
         WHERE a.id=ANY($1::bigint[]) ORDER BY c.category_name,am.product_name,a.serial_number`,
        [assetIds],
      );
      if (rows.rowCount !== assetIds.length) throw new AppError(422, 'ASSET_SELECTION_INVALID', 'One or more selected assets are unavailable.');
      await recordActivity(client, {
        user, actionKey:'ASSETS_EXPORTED', source:'selected-assets', reason:'Selected inventory assets exported.',
        recordType:'asset_export', recordId:randomUUID(), recordLabel:`${assetIds.length} selected assets`, routePath:'/',
        metadata:{ assetIds },
      });
      const headers = ['Category','Product Name','Model #','Serial #','Asset Tag #','Status','Location','Owner / Assignee','Vendor','Date Received','Project','Pool/Team','NVBugs #','MRS order #','Capacity Request #'];
      return [headers, ...rows.rows.map((row) => [row.category_name,row.product_name,row.model_number,row.serial_number,row.asset_tag,row.status,row.location,row.owner,row.vendor,row.date_received,row.project,row.pool_team,row.nvbugs,row.mrs_orders,row.capacity_requests])]
        .map((row) => row.map(csvCell).join(',')).join('\r\n');
    });
    reply.header('content-type','text/csv; charset=utf-8');
    reply.header('content-disposition',`attachment; filename="inventory-assets-${new Date().toISOString().slice(0,10)}.csv"`);
    return reply.send(csv);
  });

  app.get('/api/v1/assets/:id', { preHandler: requirePermission('asset.view') }, async (request) => ({ asset: await loadAsset(Number((request.params as {id:string}).id)) }));

  app.post('/api/v1/assets', { preHandler: requirePermission('asset.create') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const body = request.body as { profileId:number; values:Values; reason?:string };
    if (!body.reason?.trim()) throw new AppError(422,'REASON_REQUIRED','Reason is required.');
    try {
      return { asset: await withTransaction((client) => createAsset(client,Number(body.profileId),body.values ?? {},user,body.reason!.trim())) };
    } catch (error: unknown) {
      if ((error as {code?:string}).code === '23505') throw new AppError(409,'DUPLICATE_ASSET','Serial # or Asset Tag # already exists.');
      throw error;
    }
  });

  app.patch('/api/v1/assets/:id', { preHandler: requirePermission('asset.update') }, async (request) => {
    await verifyCsrf(request);
    const id = Number((request.params as {id:string}).id);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const body = request.body as { revision:number; values:Values; reason?:string };
    if (!Number.isInteger(body.revision)) throw new AppError(400,'REVISION_REQUIRED','Asset revision is required.');
    if (!body.reason?.trim()) throw new AppError(422,'REASON_REQUIRED','Reason is required.');
    return { asset: await withTransaction((client) => updateAsset(client, id, body.revision, body.values, user, body.reason!.trim())) };
  });

  app.post('/api/v1/assets/:id/operations', { preHandler: requirePermission('asset.operate') }, async (request) => {
    await verifyCsrf(request);
    const id=Number((request.params as {id:string}).id); const user=(request as AuthenticatedRequest).inventoryUser;
    const body=request.body as { operation:string;revision:number;reason?:string;statusId?:number;ownerId?:number;locationId?:number|null;referenceValue?:string };
    if(!body.reason?.trim()) throw new AppError(422,'REASON_REQUIRED','Reason is required.');
    const allowed=Object.keys(lifecycleOperations) as AssetOperation[];
    if(!allowed.includes(body.operation as AssetOperation)) throw new AppError(400,'INVALID_OPERATION','Select a valid asset operation.');
    return withTransaction(async(client)=>{
      const lock=await client.query('SELECT revision FROM assets WHERE id=$1 FOR UPDATE',[id]);
      if(!lock.rows[0]) throw new AppError(404,'ASSET_NOT_FOUND','Asset not found.');
      const before=await loadAsset(id,client);
      if(lock.rows[0].revision!==body.revision) throw new AppError(409,'REVISION_CONFLICT','Another user changed this asset.',{latest:before});
      const operation=body.operation as AssetOperation;
      let statusId=body.statusId??before.status.id; let ownerId=body.ownerId??before.owner.id; let locationId=body.locationId===undefined?(before.location?.id??null):body.locationId; let archivedAt:Date|null=before.archived?new Date():null;
      if(body.operation==='ASSIGN'&&!body.ownerId) throw new AppError(422,'OWNER_REQUIRED','Owner / Assignee is required.');
      if(body.operation==='TRANSFER'&&body.ownerId===undefined&&body.locationId===undefined) throw new AppError(422,'TRANSFER_TARGET_REQUIRED','Choose a new owner or location.');
      if(operation==='ASSIGN') statusId=(await statusByKey(client,'IN_USE')).id;
      if(operation==='ARCHIVE'){statusId=(await statusByKey(client,'ARCHIVE')).id;archivedAt=new Date();}
      if(operation==='RESTORE') archivedAt=null;
      const targetStatus=await statusById(client,statusId);
      assertOperationStatus(operation,targetStatus.key);
      const activeAssignment=await client.query('SELECT id FROM asset_assignments WHERE asset_id=$1 AND returned_at IS NULL FOR UPDATE',[id]);
      if(operation==='ASSIGN'&&activeAssignment.rows[0]) throw new AppError(409,'ASSET_ALREADY_ASSIGNED','Return the current assignment before assigning this asset again.');
      if(operation==='RETURN'&&!activeAssignment.rows[0]) throw new AppError(409,'ASSET_NOT_ASSIGNED','This asset does not have an active assignment to return.');
      if(operation==='TRANSFER'&&before.status.value==='IN_USE'&&!activeAssignment.rows[0]) throw new AppError(409,'ASSIGNMENT_STATE_INVALID','This in-use asset has no active assignment. Return or correct its status before transfer.');
      if(operation==='CHANGE_STATUS'&&targetStatus.key==='IN_USE') throw new AppError(422,'USE_ASSIGN_OPERATION','Use Assign to place an asset in use.');
      await client.query('UPDATE assets SET status_value_id=$2,owner_user_id=$3,location_id=$4,archived_at=$5,revision=revision+1,updated_at=now() WHERE id=$1',[id,statusId,ownerId,locationId,archivedAt]);
      if(body.operation==='ASSIGN') await client.query('INSERT INTO asset_assignments(asset_id,assignee_user_id,location_id,reason,actor_user_id) VALUES($1,$2,$3,$4,$5)',[id,ownerId,locationId,body.reason,user.id]);
      if(['RETURN','CHANGE_STATUS','ARCHIVE'].includes(operation)) await client.query('UPDATE asset_assignments SET returned_at=now() WHERE asset_id=$1 AND returned_at IS NULL',[id]);
      if(body.operation==='TRANSFER') {
        await client.query('INSERT INTO asset_transfers(asset_id,from_owner_user_id,to_owner_user_id,from_location_id,to_location_id,reason,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,before.owner.id,ownerId,before.location?.id??null,locationId,body.reason,user.id]);
        if(activeAssignment.rows[0]) await client.query('UPDATE asset_assignments SET assignee_user_id=$2,location_id=$3 WHERE id=$1',[activeAssignment.rows[0].id,ownerId,locationId]);
      }
      if(statusId!==before.status.id) await client.query('INSERT INTO asset_status_events(asset_id,from_status_value_id,to_status_value_id,reason,actor_user_id) VALUES($1,$2,$3,$4,$5)',[id,before.status.id,statusId,body.reason,user.id]);
      const after=await loadAsset(id,client);
      await recordActivity(client,{user,actionKey:`ASSET_${body.operation}`,source:'asset-operation',reason:body.reason!.trim(),recordType:'asset',recordId:id,recordLabel:after.model.productName,routePath:`/assets/${id}`,referenceValue:body.referenceValue,changes:[{fieldKey:'asset_status',fieldLabel:'Status',before:before.status.value,after:after.status.value},{fieldKey:'owner',fieldLabel:'Owner / Assignee',before:before.owner.name,after:after.owner.name},{fieldKey:'location',fieldLabel:'Location',before:before.location?.path??null,after:after.location?.path??null}].filter(c=>c.before!==c.after)});
      return {asset:after};
    });
  });

  app.post('/api/v1/assets/:id/relationships', { preHandler: requirePermission('asset.relationship') }, async(request)=>{
    await verifyCsrf(request); const parentId=Number((request.params as {id:string}).id); const user=(request as AuthenticatedRequest).inventoryUser;
    const body=request.body as {childAssetId:number;relationshipType:string;notes?:string;reason?:string};
    if(!body.reason?.trim()) throw new AppError(422,'REASON_REQUIRED','Reason is required.');
    return withTransaction(async(client)=>{const row=await client.query<{id:string}>('INSERT INTO asset_relationships(parent_asset_id,child_asset_id,relationship_type,notes,created_by_user_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[parentId,body.childAssetId,body.relationshipType,body.notes??null,user.id]);await recordActivity(client,{user,actionKey:'RELATIONSHIP_CREATED',source:'asset-relationship',reason:body.reason!,recordType:'asset',recordId:parentId,recordLabel:`Asset ${parentId}`,routePath:`/assets/${parentId}`,metadata:{relationshipId:row.rows[0]!.id,childAssetId:body.childAssetId,type:body.relationshipType}});return{relationshipId:Number(row.rows[0]!.id)};});
  });

  app.delete('/api/v1/assets/:id/relationships/:relationshipId', { preHandler: requirePermission('asset.relationship') }, async(request)=>{
    await verifyCsrf(request); const params=request.params as {id:string;relationshipId:string}; const user=(request as AuthenticatedRequest).inventoryUser;
    return withTransaction(async(client)=>{const deleted=await client.query('DELETE FROM asset_relationships WHERE id=$1 AND parent_asset_id=$2 RETURNING id,child_asset_id,relationship_type',[params.relationshipId,params.id]);if(!deleted.rows[0])throw new AppError(404,'RELATIONSHIP_NOT_FOUND','Relationship not found.');await recordActivity(client,{user,actionKey:'RELATIONSHIP_REMOVED',source:'asset-relationship',reason:'Relationship removed.',recordType:'asset',recordId:params.id,recordLabel:`Asset ${params.id}`,routePath:`/assets/${params.id}`,metadata:deleted.rows[0]});return{removed:true};});
  });

  app.post('/api/v1/models/:id/image', { preHandler: requirePermission('model.image') }, async(request)=>{
    await verifyCsrf(request); const user=(request as AuthenticatedRequest).inventoryUser; const modelId=Number((request.params as {id:string}).id); const file=await request.file({limits:{fileSize:config.MAX_IMAGE_BYTES,files:1}});if(!file)throw new AppError(400,'IMAGE_REQUIRED','Choose an image.');
    const allowed=new Map([['image/png','.png'],['image/jpeg','.jpg'],['image/webp','.webp']]);const extension=allowed.get(file.mimetype);if(!extension)throw new AppError(415,'IMAGE_TYPE_INVALID','Use PNG, JPG, JPEG, or WebP.');const data=await file.toBuffer();if(data.length>config.MAX_IMAGE_BYTES)throw new AppError(413,'IMAGE_TOO_LARGE','Image must be 5 MB or smaller.');
    const uploadRoot=resolve(config.UPLOAD_ROOT,'models');await mkdir(uploadRoot,{recursive:true});const name=`model-${modelId}-${createHash('sha256').update(data).digest('hex').slice(0,16)}${extension}`;await writeFile(resolve(uploadRoot,name),data);
    return withTransaction(async(client)=>{const old=await client.query('SELECT image_path FROM asset_models WHERE id=$1 FOR UPDATE',[modelId]);if(!old.rows[0])throw new AppError(404,'MODEL_NOT_FOUND','Model not found.');await client.query('UPDATE asset_models SET image_path=$2,updated_at=now() WHERE id=$1',[modelId,`/uploads/models/${name}`]);await recordActivity(client,{user,actionKey:'MODEL_IMAGE_UPDATED',source:'model-image',reason:'Model image updated.',recordType:'model',recordId:modelId,recordLabel:`Model ${modelId}`,routePath:`/admin/models/${modelId}`,changes:[{fieldKey:'image_path',fieldLabel:'Model image',before:old.rows[0].image_path,after:`/uploads/models/${name}`}]});return{imagePath:`/uploads/models/${name}`};});
  });

  app.delete('/api/v1/models/:id/image', { preHandler: requirePermission('model.image') }, async(request)=>{
    await verifyCsrf(request);const user=(request as AuthenticatedRequest).inventoryUser;const modelId=Number((request.params as {id:string}).id);
    return withTransaction(async(client)=>{const old=await client.query('SELECT image_path FROM asset_models WHERE id=$1 FOR UPDATE',[modelId]);if(!old.rows[0])throw new AppError(404,'MODEL_NOT_FOUND','Model not found.');await client.query('UPDATE asset_models SET image_path=NULL,updated_at=now() WHERE id=$1',[modelId]);const path=old.rows[0].image_path as string|null;if(path?.startsWith('/uploads/models/'))await unlink(resolve(config.UPLOAD_ROOT,path.replace('/uploads/',''))).catch(()=>undefined);await recordActivity(client,{user,actionKey:'MODEL_IMAGE_REMOVED',source:'model-image',reason:'Model image removed.',recordType:'model',recordId:modelId,recordLabel:`Model ${modelId}`,routePath:`/admin/models/${modelId}`,changes:[{fieldKey:'image_path',fieldLabel:'Model image',before:path,after:null}]});return{removed:true};});
  });
}

export const assetInternals = { createAsset, updateAsset, loadAsset };
