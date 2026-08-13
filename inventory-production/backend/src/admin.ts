import type { FastifyInstance } from 'fastify';
import { requirePermission, verifyCsrf } from './auth.js';
import { pool, withTransaction, type DbClient } from './db.js';
import { AppError } from './errors.js';
import { recordActivity } from './activity.js';
import { loadProfileFields } from './registry.js';
import type { AuthenticatedRequest, SessionUser } from './types.js';
import { readMaintenanceState, writeMaintenanceState, type MaintenanceState } from './maintenance.js';
import { isLifecycleStatusKey } from './lifecycle.js';

const keyPattern = /^[A-Z][A-Z0-9_]{1,63}$/;
const fieldKeyPattern = /^[a-z][a-z0-9_]{1,63}$/;
const locationPathTypes = ['BUILDING', 'LAB_ROOM', 'RACK', 'RU', 'CABINET_STORAGE'] as const;
const requiredReason = (value: unknown) => {
  const reason = String(value ?? '').trim();
  if (reason.length < 3) throw new AppError(422, 'REASON_REQUIRED', 'A reason of at least 3 characters is required.');
  return reason;
};

function requiredLocationPart(value: unknown, label: string): string {
  const part = String(value ?? '').trim();
  if (!part) throw new AppError(422, 'LOCATION_PATH_INCOMPLETE', `${label} is required.`);
  return part;
}

function locationKey(parts: string[]): string {
  const normalized = parts.join('_').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized.slice(0, 64).replace(/_+$/g, '');
}

function labelledLocation(prefix: string, value: string): string {
  return value.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()) ? value : `${prefix} ${value}`;
}

async function profileSnapshot(client: DbClient, profileId: number, user: SessionUser, reason: string): Promise<void> {
  const profile = await client.query('SELECT * FROM asset_profiles WHERE id=$1 FOR UPDATE', [profileId]);
  if (!profile.rows[0]) throw new AppError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
  const fields = await loadProfileFields(profileId, client);
  const version = Number(profile.rows[0].version) + 1;
  await client.query('UPDATE asset_profiles SET version=$2,updated_at=now() WHERE id=$1', [profileId, version]);
  await client.query(
    `INSERT INTO profile_versions(profile_id,version,snapshot,reason,actor_user_id) VALUES($1,$2,$3,$4,$5)`,
    [profileId, version, JSON.stringify({ profile: profile.rows[0], fields }), reason, user.id],
  );
}

async function adminEvent(client: DbClient, user: SessionUser, input: { action: string; type: string; id: string | number; label: string; reason: string; before?: unknown; after?: unknown }): Promise<void> {
  await recordActivity(client, {
    user, actionKey: input.action, source: 'admin', reason: input.reason, recordType: input.type,
    recordId: input.id, recordLabel: input.label, routePath: `/admin/${input.type}/${input.id}`,
    changes: [{ fieldKey: 'configuration', fieldLabel: 'Configuration', before: input.before ?? null, after: input.after ?? null }],
  });
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/admin/health', { preHandler: requirePermission('admin.system') }, async () => {
    const [counts, incomplete, dependencies, maintenance] = await Promise.all([
      pool.query(`SELECT
        (SELECT count(*)::int FROM categories WHERE active) categories,
        (SELECT count(*)::int FROM asset_profiles WHERE active) profiles,
        (SELECT count(*)::int FROM field_definitions WHERE active) fields,
        (SELECT count(*)::int FROM lookup_values WHERE active) dropdown_values,
        (SELECT count(*)::int FROM application_users WHERE active) users`),
      pool.query(`SELECT ap.id,ap.profile_name,count(pf.id)::int field_count,
        count(pf.id) FILTER(WHERE pf.required)::int required_count
        FROM asset_profiles ap LEFT JOIN profile_fields pf ON pf.profile_id=ap.id AND pf.active
        WHERE ap.active GROUP BY ap.id HAVING count(pf.id)=0 ORDER BY ap.profile_name`),
      pool.query(`SELECT fd.id,fd.field_key,fd.field_label,count(pf.id)::int profile_count
        FROM field_definitions fd LEFT JOIN profile_fields pf ON pf.field_definition_id=fd.id
        GROUP BY fd.id ORDER BY fd.field_key`),
      readMaintenanceState(),
    ]);
    return { counts: counts.rows[0], incompleteProfiles: incomplete.rows, fieldUsage: dependencies.rows, maintenance };
  });

  app.post('/api/v1/admin/maintenance', { preHandler: requirePermission('admin.system') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const body = request.body as { enabled?: unknown; reason?: unknown };
    if (typeof body.enabled !== 'boolean') throw new AppError(422, 'MAINTENANCE_STATE_REQUIRED', 'Choose whether maintenance mode should be enabled or disabled.');
    const reason = requiredReason(body.reason);

    const before = await readMaintenanceState();
    try {
      return await withTransaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('inventory-project-maintenance'))");
        const current = await readMaintenanceState();
        if (current.enabled !== before.enabled) throw new AppError(409, 'MAINTENANCE_STATE_CHANGED', 'Maintenance mode changed in another session. Refresh System Health and try again.');
        if (before.enabled === body.enabled) return { maintenance: before, changed: false };
        const after: MaintenanceState = body.enabled
          ? { enabled: true, enabledAt: new Date().toISOString(), enabledBy: user.displayName, reason, source: 'application' }
          : { enabled: false, enabledAt: null, enabledBy: null, reason: null, source: null };

        await writeMaintenanceState(after);
        await recordActivity(client, {
          user,
          actionKey: body.enabled ? 'MAINTENANCE_ENABLED' : 'MAINTENANCE_DISABLED',
          source: 'admin',
          reason,
          recordType: 'system',
          recordId: 'maintenance',
          recordLabel: 'Maintenance mode',
          routePath: '/admin?tab=health',
          changes: [{ fieldKey: 'maintenance', fieldLabel: 'Maintenance mode', before, after }],
        });
        return { maintenance: after, changed: true };
      });
    } catch (error) {
      await writeMaintenanceState(before);
      throw error;
    }
  });

  app.get('/api/v1/admin/profiles', { preHandler: requirePermission('admin.profile') }, async () => {
    const profiles = await pool.query(`SELECT ap.id,ap.profile_key,ap.profile_name,ap.description,ap.version,ap.active,
      c.id category_id,c.category_key,c.category_name,count(pf.id)::int field_count
      FROM asset_profiles ap JOIN categories c ON c.id=ap.category_id
      LEFT JOIN profile_fields pf ON pf.profile_id=ap.id AND pf.active
      GROUP BY ap.id,c.id ORDER BY c.display_order,ap.profile_name`);
    return { profiles: await Promise.all(profiles.rows.map(async (row) => ({ ...row, id:Number(row.id), category_id:Number(row.category_id), fields: await loadProfileFields(Number(row.id)) }))) };
  });

  app.post('/api/v1/admin/categories', { preHandler: requirePermission('admin.profile') }, async (request) => {
    await verifyCsrf(request);
    const user=(request as AuthenticatedRequest).inventoryUser;
    const body=request.body as Record<string,unknown>; const key=String(body.key??'').trim().toUpperCase();
    const name=String(body.name??'').trim(); const description=String(body.description??'').trim(); const reason=requiredReason(body.reason);
    if(!keyPattern.test(key)||!name||!description) throw new AppError(422,'CATEGORY_INVALID','Category key, name, and definition are required.');
    if(isLifecycleStatusKey(key)||isLifecycleStatusKey(name)) throw new AppError(422,'CATEGORY_LIFECYCLE_RESERVED','Lifecycle statuses cannot be created as asset categories. Add or update the value under the Status dropdown instead.');
    return withTransaction(async(client)=>{
      const category=await client.query(`INSERT INTO categories(category_key,category_name,description,icon_key,display_order)
        VALUES($1,$2,$3,$4,COALESCE((SELECT max(display_order)+10 FROM categories),10)) RETURNING *`,[key,name,description,String(body.icon??'box')]);
      const profile=await client.query(`INSERT INTO asset_profiles(category_id,profile_key,profile_name,description)
        VALUES($1,$2,$3,$4) RETURNING *`,[category.rows[0].id,`${key}_ASSET`,`${name} Asset`,description]);
      if(body.copyStandardFields!==false) await client.query(`INSERT INTO profile_fields(profile_id,field_definition_id,required,display_order,visible_add,visible_update,visible_filter,visible_detail,visible_import,visible_report,visible_export)
        SELECT $1,pf.field_definition_id,pf.required,pf.display_order,pf.visible_add,pf.visible_update,pf.visible_filter,pf.visible_detail,pf.visible_import,pf.visible_report,pf.visible_export
        FROM profile_fields pf JOIN asset_profiles source ON source.id=pf.profile_id WHERE source.profile_key='GPU_ASSET' AND pf.active`,[profile.rows[0].id]);
      await client.query(`INSERT INTO import_profiles(profile_id,import_profile_key,import_profile_name) VALUES($1,$2,$3)`,[profile.rows[0].id,`${key}_ASSET_CSV`,`${name} Asset CSV`]);
      await adminEvent(client,user,{action:'CATEGORY_CREATED',type:'category',id:category.rows[0].id,label:name,reason,after:category.rows[0]});
      return {category:category.rows[0],profile:profile.rows[0]};
    });
  });

  app.post('/api/v1/admin/profiles/:profileId/fields', { preHandler: requirePermission('admin.profile') }, async (request) => {
    await verifyCsrf(request); const user=(request as AuthenticatedRequest).inventoryUser; const profileId=Number((request.params as {profileId:string}).profileId);
    const body=request.body as Record<string,unknown>; const fieldKey=String(body.fieldKey??'').trim(); const label=String(body.label??'').trim();
    const definition=String(body.definition??'').trim(); const helpText=String(body.helpText??'').trim(); const dataType=String(body.dataType??'text'); const reason=requiredReason(body.reason);
    if(!fieldKeyPattern.test(fieldKey)||!label||!definition||!helpText)throw new AppError(422,'FIELD_INVALID','Field key, label, definition, and help text are required.');
    return withTransaction(async(client)=>{
      const profile=await client.query('SELECT profile_name FROM asset_profiles WHERE id=$1 AND active FOR UPDATE',[profileId]);
      if(!profile.rows[0])throw new AppError(404,'PROFILE_NOT_FOUND','Profile not found.');
      const lookupListId=body.lookupListId?Number(body.lookupListId):null;
      const field=await client.query(`INSERT INTO field_definitions(field_key,field_label,definition,help_text,data_type,lookup_list_id,storage_target,import_aliases,validation_rules,unique_when_populated)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[fieldKey,label,definition,helpText,dataType,lookupListId,`asset_field_values:${fieldKey}`,body.aliases??[label,fieldKey],JSON.stringify(body.validationRules??{}),Boolean(body.uniqueWhenPopulated)]);
      const order=Number(body.displayOrder)||Number((await client.query('SELECT COALESCE(max(display_order),0)+10 value FROM profile_fields WHERE profile_id=$1',[profileId])).rows[0].value);
      await client.query(`INSERT INTO profile_fields(profile_id,field_definition_id,required,display_order,visible_add,visible_update,visible_filter,visible_detail,visible_import,visible_report,visible_export)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[profileId,field.rows[0].id,Boolean(body.required),order,body.visibleAdd!==false,body.visibleUpdate!==false,body.visibleFilter!==false,body.visibleDetail!==false,body.visibleImport!==false,body.visibleReport!==false,body.visibleExport!==false]);
      await profileSnapshot(client,profileId,user,reason); await adminEvent(client,user,{action:'PROFILE_FIELD_CREATED',type:'profile',id:profileId,label:profile.rows[0].profile_name,reason,after:field.rows[0]});
      return {field:(await loadProfileFields(profileId,client)).find((item)=>item.fieldKey===fieldKey)};
    });
  });

  app.patch('/api/v1/admin/profiles/:profileId/fields/:fieldId', { preHandler: requirePermission('admin.profile') }, async (request) => {
    await verifyCsrf(request); const user=(request as AuthenticatedRequest).inventoryUser; const p=request.params as {profileId:string;fieldId:string}; const profileId=Number(p.profileId); const fieldId=Number(p.fieldId); const body=request.body as Record<string,unknown>; const reason=requiredReason(body.reason);
    return withTransaction(async(client)=>{
      const before=await client.query(`SELECT pf.*,fd.field_key,fd.field_label,fd.definition,fd.help_text,fd.validation_rules FROM profile_fields pf JOIN field_definitions fd ON fd.id=pf.field_definition_id WHERE pf.profile_id=$1 AND fd.id=$2 FOR UPDATE`,[profileId,fieldId]);
      if(!before.rows[0])throw new AppError(404,'FIELD_NOT_FOUND','Profile field not found.');
      await client.query(`UPDATE field_definitions SET field_label=COALESCE($2,field_label),definition=COALESCE($3,definition),help_text=COALESCE($4,help_text),import_aliases=COALESCE($5,import_aliases),validation_rules=COALESCE($6,validation_rules),unique_when_populated=COALESCE($7,unique_when_populated),active=COALESCE($8,active),deprecated_at=CASE WHEN $8=false THEN now() ELSE deprecated_at END,updated_at=now() WHERE id=$1`,[fieldId,body.label??null,body.definition??null,body.helpText??null,body.aliases??null,body.validationRules?JSON.stringify(body.validationRules):null,body.uniqueWhenPopulated??null,body.active??null]);
      await client.query(`UPDATE profile_fields SET required=COALESCE($3,required),display_order=COALESCE($4,display_order),visible_add=COALESCE($5,visible_add),visible_update=COALESCE($6,visible_update),visible_filter=COALESCE($7,visible_filter),visible_detail=COALESCE($8,visible_detail),visible_import=COALESCE($9,visible_import),visible_report=COALESCE($10,visible_report),visible_export=COALESCE($11,visible_export),active=COALESCE($12,active),updated_at=now() WHERE profile_id=$1 AND field_definition_id=$2`,[profileId,fieldId,body.required??null,body.displayOrder??null,body.visibleAdd??null,body.visibleUpdate??null,body.visibleFilter??null,body.visibleDetail??null,body.visibleImport??null,body.visibleReport??null,body.visibleExport??null,body.active??null]);
      await profileSnapshot(client,profileId,user,reason); const after=(await loadProfileFields(profileId,client)).find((item)=>item.id===fieldId);
      await adminEvent(client,user,{action:'PROFILE_FIELD_UPDATED',type:'field',id:fieldId,label:String(before.rows[0].field_label),reason,before:before.rows[0],after}); return {field:after};
    });
  });

  app.post('/api/v1/admin/lookups/:lookupKey/values', { preHandler: requirePermission('admin.lookup') }, async (request) => {
    await verifyCsrf(request); const user=(request as AuthenticatedRequest).inventoryUser; const lookupKey=(request.params as {lookupKey:string}).lookupKey; const body=request.body as Record<string,unknown>; const reason=requiredReason(body.reason);
    const valueKey=String(body.valueKey??'').trim().toUpperCase(); const displayValue=String(body.displayValue??'').trim(); if(!keyPattern.test(valueKey)||!displayValue)throw new AppError(422,'LOOKUP_VALUE_INVALID','Value key and display value are required.');
    return withTransaction(async(client)=>{const result=await client.query(`INSERT INTO lookup_values(lookup_list_id,value_key,display_value,description,aliases,display_order)
      SELECT id,$2,$3,$4,$5,COALESCE((SELECT max(display_order)+10 FROM lookup_values WHERE lookup_list_id=lookup_lists.id),10) FROM lookup_lists WHERE lookup_key=$1 AND active RETURNING *`,[lookupKey,valueKey,displayValue,String(body.description??''),body.aliases??[]]);
      if(!result.rows[0])throw new AppError(404,'LOOKUP_NOT_FOUND','Dropdown list not found.'); await adminEvent(client,user,{action:'LOOKUP_VALUE_CREATED',type:'lookup',id:result.rows[0].id,label:displayValue,reason,after:result.rows[0]}); return {value:result.rows[0]};});
  });

  app.post('/api/v1/admin/locations', { preHandler: requirePermission('admin.location') }, async (request) => {
    await verifyCsrf(request); const user=(request as AuthenticatedRequest).inventoryUser; const body=request.body as Record<string,unknown>; const reason=requiredReason(body.reason); const name=String(body.name??'').trim(); const key=String(body.key??'').trim().toUpperCase();
    if(!name||!keyPattern.test(key))throw new AppError(422,'LOCATION_INVALID','Location key and name are required.');
    return withTransaction(async(client)=>{const type=await client.query('SELECT id FROM location_types WHERE type_key=$1',[body.typeKey]);if(!type.rows[0])throw new AppError(422,'LOCATION_TYPE_INVALID','Select a valid location type.'); const parentId=body.parentId?Number(body.parentId):null;
      const parent=parentId?await client.query('SELECT full_path FROM locations WHERE id=$1 AND active',[parentId]):null;if(parentId&&!parent?.rows[0])throw new AppError(422,'LOCATION_PARENT_INVALID','Select an active parent location.'); const fullPath=parent?.rows[0]?`${parent.rows[0].full_path} / ${name}`:name;
      const result=await client.query('INSERT INTO locations(parent_id,location_type_id,location_key,location_name,full_path) VALUES($1,$2,$3,$4,$5) RETURNING *',[parentId,type.rows[0].id,key,name,fullPath]);await adminEvent(client,user,{action:'LOCATION_CREATED',type:'location',id:result.rows[0].id,label:fullPath,reason,after:result.rows[0]});return{location:result.rows[0]};});
  });

  app.post('/api/v1/admin/location-paths', { preHandler: requirePermission('admin.location') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const body = request.body as Record<string, unknown>;
    const reason = requiredReason(body.reason);
    const building = requiredLocationPart(body.building, 'Building');
    const roomName = requiredLocationPart(body.roomName, 'Room name');
    const roomNumber = requiredLocationPart(body.roomNumber, 'Room number');
    const binRow = requiredLocationPart(body.binRow, 'Bin row');
    const rackLocation = requiredLocationPart(body.rackLocation, 'Rack location');
    const binLocation = requiredLocationPart(body.binLocation, 'Bin location');
    const binId = requiredLocationPart(body.binId, 'Bin ID').toUpperCase();
    if (!keyPattern.test(binId)) throw new AppError(422, 'BIN_ID_INVALID', 'Bin ID must begin with a letter and use only letters, numbers, or underscores.');

    return withTransaction(async (client) => {
      const typeRows = await client.query(
        'SELECT id,type_key,level_order FROM location_types WHERE type_key=ANY($1::text[]) ORDER BY level_order',
        [locationPathTypes],
      );
      const typeIds = new Map(typeRows.rows.map((row) => [String(row.type_key), Number(row.id)]));
      if (locationPathTypes.some((typeKey) => !typeIds.has(typeKey))) {
        throw new AppError(500, 'LOCATION_TYPES_INCOMPLETE', 'The location hierarchy is incomplete. Contact an administrator.');
      }

      const created: Array<Record<string, unknown>> = [];
      const findOrCreate = async (typeKey: typeof locationPathTypes[number], parentId: number | null, name: string, preferredKey?: string) => {
        const existing = await client.query(
          `SELECT l.* FROM locations l
           WHERE l.location_type_id=$1 AND l.parent_id IS NOT DISTINCT FROM $2
             AND lower(l.location_name)=lower($3) AND l.active
           LIMIT 1`,
          [typeIds.get(typeKey), parentId, name],
        );
        if (existing.rows[0]) {
          if (preferredKey && existing.rows[0].location_key !== preferredKey) {
            throw new AppError(409, 'LOCATION_ID_CONFLICT', `${name} already exists with Bin ID ${existing.rows[0].location_key}.`);
          }
          return existing.rows[0];
        }

        const parent = parentId
          ? await client.query('SELECT full_path FROM locations WHERE id=$1 AND active', [parentId])
          : null;
        if (parentId && !parent?.rows[0]) throw new AppError(409, 'LOCATION_PARENT_CHANGED', 'A parent location changed while this path was being created.');
        const key = preferredKey ?? locationKey([typeKey, String(parentId ?? 'ROOT'), name]);
        const keyOwner = await client.query('SELECT id,full_path FROM locations WHERE location_key=$1', [key]);
        if (keyOwner.rows[0]) throw new AppError(409, 'LOCATION_KEY_CONFLICT', `Location key ${key} is already used by ${keyOwner.rows[0].full_path}.`);
        const fullPath = parent?.rows[0] ? `${parent.rows[0].full_path} / ${name}` : name;
        const inserted = await client.query(
          `INSERT INTO locations(parent_id,location_type_id,location_key,location_name,full_path)
           VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [parentId, typeIds.get(typeKey), key, name, fullPath],
        );
        created.push(inserted.rows[0]);
        return inserted.rows[0];
      };

      const buildingNode = await findOrCreate('BUILDING', null, building);
      const roomNode = await findOrCreate('LAB_ROOM', Number(buildingNode.id), `${roomName} (Room ${roomNumber})`);
      const rowNode = await findOrCreate('RACK', Number(roomNode.id), labelledLocation('Row', binRow));
      const rackNode = await findOrCreate('RU', Number(rowNode.id), labelledLocation('Rack', rackLocation));
      const binNode = await findOrCreate('CABINET_STORAGE', Number(rackNode.id), labelledLocation('Bin', binLocation), binId);

      if (created.length) {
        await adminEvent(client, user, {
          action: 'LOCATION_PATH_CREATED',
          type: 'location',
          id: binNode.id,
          label: binNode.full_path,
          reason,
          after: { path: binNode.full_path, binId, createdNodes: created },
        });
      }
      return { location: binNode, createdCount: created.length, path: binNode.full_path };
    });
  });

  app.get('/api/v1/admin/users', { preHandler: requirePermission('admin.identity') }, async () => {
    const [users,roles]=await Promise.all([pool.query(`SELECT u.id,u.display_name,u.email,u.initials,u.active,COALESCE(array_agg(r.role_key ORDER BY r.role_key) FILTER(WHERE r.id IS NOT NULL),'{}') roles FROM application_users u LEFT JOIN application_user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id GROUP BY u.id ORDER BY u.display_name`),pool.query('SELECT id,role_key,role_name,description,active FROM roles ORDER BY id')]); return {users:users.rows,roles:roles.rows};
  });

  app.patch('/api/v1/admin/users/:id/roles', { preHandler: requirePermission('admin.identity') }, async(request)=>{
    await verifyCsrf(request); const user=(request as AuthenticatedRequest).inventoryUser; const targetId=Number((request.params as {id:string}).id); const body=request.body as {roles?:string[];reason?:string}; const reason=requiredReason(body.reason); const roles=[...new Set(body.roles??[])]; if(!roles.includes('user'))throw new AppError(422,'USER_ROLE_REQUIRED','Every active user must retain the User role.');
    return withTransaction(async(client)=>{const target=await client.query('SELECT display_name FROM application_users WHERE id=$1 FOR UPDATE',[targetId]);if(!target.rows[0])throw new AppError(404,'USER_NOT_FOUND','User not found.');const before=await client.query(`SELECT array_agg(r.role_key ORDER BY r.role_key) roles FROM application_user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1`,[targetId]);await client.query('DELETE FROM application_user_roles WHERE user_id=$1',[targetId]);const inserted=await client.query(`INSERT INTO application_user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE role_key=ANY($2::text[]) AND active RETURNING role_id`,[targetId,roles]);if(inserted.rowCount!==roles.length)throw new AppError(422,'ROLE_INVALID','One or more roles are invalid.');await adminEvent(client,user,{action:'USER_ROLES_UPDATED',type:'user',id:targetId,label:target.rows[0].display_name,reason,before:before.rows[0]?.roles??[],after:roles});return{userId:targetId,roles};});
  });

  for (const entity of ['vendors','manufacturers'] as const) {
    const permission='admin.lookup';
    app.post(`/api/v1/admin/${entity}`, { preHandler: requirePermission(permission) }, async(request)=>{
      await verifyCsrf(request); const user=(request as AuthenticatedRequest).inventoryUser;const body=request.body as Record<string,unknown>;const reason=requiredReason(body.reason);const label=String(body.name??'').trim();if(!label)throw new AppError(422,'NAME_REQUIRED','Name is required.');const table=entity==='vendors'?'vendors':'manufacturers';const column=entity==='vendors'?'vendor_name':'manufacturer_name';
      return withTransaction(async(client)=>{const result=await client.query(`INSERT INTO ${table}(${column}) VALUES($1) RETURNING *`,[label]);await adminEvent(client,user,{action:`${entity.slice(0,-1).toUpperCase()}_CREATED`,type:entity.slice(0,-1),id:result.rows[0].id,label,reason,after:result.rows[0]});return{record:result.rows[0]};});
    });
  }
}
