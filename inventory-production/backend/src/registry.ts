import type { DbClient } from './db.js';
import { pool } from './db.js';
import { AppError } from './errors.js';
import type { FieldDefinition } from './types.js';
import { authenticate } from './auth.js';
import { matchLookupOption } from './lookupMatching.js';
import { lifecycleStatusKeys } from './lifecycle.js';

export function lookupOptionForValue(field: FieldDefinition, value: unknown) {
  return field.options.find((option) => String(option.id) === String(value))
    ?? matchLookupOption(field.options, value);
}

export function lookupStoresReferenceId(field: FieldDefinition): boolean {
  return field.dataType === 'lookup' && /\.[a-z0-9_]+_id$/i.test(field.storageTarget);
}

export function canonicalizeFieldValue(field: FieldDefinition, value: unknown): unknown {
  if (value === undefined || value === null || String(value).trim() === '') return value;
  if (field.dataType !== 'lookup') return value;
  const option = lookupOptionForValue(field, value);
  if (!option) return value;
  return lookupStoresReferenceId(field) ? option.id : option.label;
}

export function canonicalizeValues(fields: FieldDefinition[], values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([fieldKey, value]) => {
    const field = fields.find((candidate) => candidate.fieldKey === fieldKey);
    return [fieldKey, field ? canonicalizeFieldValue(field, value) : value];
  }));
}

export async function loadProfileFields(profileId: number, client: DbClient | typeof pool = pool): Promise<FieldDefinition[]> {
  const result = await client.query(
    `SELECT fd.id,fd.field_key,fd.field_label,fd.definition,fd.help_text,fd.data_type,ll.lookup_key,ll.lookup_name,fd.storage_target,
       fd.import_aliases,fd.validation_rules,fd.unique_when_populated,pf.required,pf.display_order,
       pf.visible_add,pf.visible_update,pf.visible_filter,pf.visible_detail,pf.visible_import,pf.visible_report,pf.visible_export,
       COALESCE(jsonb_agg(jsonb_build_object('id',lv.id,'value',lv.value_key,'label',lv.display_value,'description',lv.description,'aliases',lv.aliases)
         ORDER BY lv.display_order) FILTER (WHERE lv.id IS NOT NULL),'[]'::jsonb) options
     FROM profile_fields pf JOIN field_definitions fd ON fd.id=pf.field_definition_id
     LEFT JOIN lookup_lists ll ON ll.id=fd.lookup_list_id
     LEFT JOIN lookup_values lv ON lv.lookup_list_id=fd.lookup_list_id AND lv.active
     WHERE pf.profile_id=$1 AND pf.active AND fd.active
     GROUP BY fd.id,pf.id,ll.lookup_key,ll.lookup_name ORDER BY pf.display_order`,
    [profileId],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    fieldKey: row.field_key,
    label: row.field_label,
    definition: row.definition,
    helpText: row.help_text,
    dataType: row.data_type,
    lookupKey: row.lookup_key ?? undefined,
    lookupName: row.lookup_name ?? undefined,
    storageTarget: row.storage_target,
    aliases: row.import_aliases,
    validationRules: row.validation_rules,
    uniqueWhenPopulated: row.unique_when_populated,
    required: row.required,
    displayOrder: row.display_order,
    surfaces: {
      add: row.visible_add, update: row.visible_update, filter: row.visible_filter, detail: row.visible_detail,
      import: row.visible_import, report: row.visible_report, export: row.visible_export,
    },
    options: row.options,
  }));
}

export async function validateValues(profileId: number, values: Record<string, unknown>, client?: DbClient, excludeAssetId?: number): Promise<FieldDefinition[]> {
  const database = client ?? pool;
  const fields = await loadProfileFields(profileId, database);
  if (!fields.length) throw new AppError(400, 'PROFILE_EMPTY', 'The selected profile has no active fields.');
  const errors: Array<{ fieldKey: string; message: string }> = [];
  for (const field of fields) {
    const value = values[field.fieldKey];
    const canonicalValue = canonicalizeFieldValue(field, value);
    const empty = value === undefined || value === null || String(value).trim() === '';
    if (field.required && empty) errors.push({ fieldKey: field.fieldKey, message: `${field.label} is required.` });
    if (!empty && field.dataType === 'date' && Number.isNaN(Date.parse(String(value)))) errors.push({ fieldKey: field.fieldKey, message: `${field.label} must be a valid date.` });
    if (!empty && field.dataType === 'number' && !Number.isFinite(Number(value))) errors.push({ fieldKey: field.fieldKey, message: `${field.label} must be a number.` });
    if (!empty && field.dataType === 'boolean' && !['true','false','1','0','yes','no'].includes(String(value).toLowerCase())) errors.push({ fieldKey: field.fieldKey, message: `${field.label} must be true or false.` });
    if (!empty && field.dataType === 'lookup' && !lookupOptionForValue(field, value)) errors.push({ fieldKey: field.fieldKey, message: `${field.label} must use an active dropdown value.` });
    const minLength = field.validationRules.minLength;
    if (!empty && typeof minLength === 'number' && String(value).length < minLength) errors.push({ fieldKey: field.fieldKey, message: `${field.label} must contain at least ${minLength} characters.` });
    const maxLength = field.validationRules.maxLength;
    if (!empty && typeof maxLength === 'number' && String(value).length > maxLength) errors.push({ fieldKey: field.fieldKey, message: `${field.label} cannot exceed ${maxLength} characters.` });
    const minimum = field.validationRules.minimum ?? field.validationRules.min;
    if (!empty && field.dataType === 'number' && typeof minimum === 'number' && Number(value) < minimum) errors.push({ fieldKey: field.fieldKey, message: `${field.label} must be at least ${minimum}.` });
    const maximum = field.validationRules.maximum ?? field.validationRules.max;
    if (!empty && field.dataType === 'number' && typeof maximum === 'number' && Number(value) > maximum) errors.push({ fieldKey: field.fieldKey, message: `${field.label} cannot exceed ${maximum}.` });
    const pattern = field.validationRules.pattern;
    if (!empty && typeof pattern === 'string') {
      try { if (!new RegExp(pattern).test(String(value))) errors.push({ fieldKey: field.fieldKey, message: `${field.label} has an invalid format.` }); }
      catch { throw new AppError(500, 'PROFILE_VALIDATION_INVALID', `${field.label} has an invalid administrator-configured validation pattern.`); }
    }
    if (!empty && field.uniqueWhenPopulated && field.storageTarget.startsWith('asset_field_values:')) {
      const duplicate = await database.query(
        `SELECT 1 FROM asset_field_values
          WHERE field_definition_id=$1
            AND asset_id<>COALESCE($2,-1)
            AND COALESCE(text_value,number_value::text,date_value::text,boolean_value::text,json_value::text)=$3
          LIMIT 1`,
        [field.id, excludeAssetId ?? null, String(canonicalValue)],
      );
      if (duplicate.rows[0]) errors.push({ fieldKey: field.fieldKey, message: `${field.label} must be unique.` });
    }
  }
  if (errors.length) throw new AppError(422, 'VALIDATION_FAILED', 'Correct the highlighted fields.', { fields: errors });
  return fields;
}

export async function registerRegistryRoutes(app: import('fastify').FastifyInstance): Promise<void> {
  app.get('/api/v1/categories', { preHandler: authenticate }, async () => {
    const result = await pool.query(
      `SELECT c.id,c.category_key,c.category_name,c.description,c.icon_key,c.display_order,
              ap.id profile_id,ap.profile_key,ap.profile_name,ap.version,
              count(a.id)::int asset_count
       FROM categories c JOIN asset_profiles ap ON ap.category_id=c.id AND ap.active
       LEFT JOIN asset_models am ON am.category_id=c.id LEFT JOIN assets a ON a.asset_model_id=am.id AND a.archived_at IS NULL
       WHERE c.active
         AND NOT (upper(regexp_replace(c.category_key,'[^A-Za-z0-9]+','_','g'))=ANY($1::text[])
           OR upper(regexp_replace(c.category_name,'[^A-Za-z0-9]+','_','g'))=ANY($1::text[]))
       GROUP BY c.id,ap.id ORDER BY c.display_order`,
      [[...lifecycleStatusKeys]],
    );
    return { categories: result.rows.map((r) => ({ id:Number(r.id), key:r.category_key, name:r.category_name, description:r.description, icon:r.icon_key, profileId:Number(r.profile_id), profileKey:r.profile_key, profileName:r.profile_name, version:r.version, assetCount:r.asset_count })) };
  });

  app.get('/api/v1/profiles/:id', { preHandler: authenticate }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    const profile = await pool.query('SELECT id,profile_key,profile_name,description,version FROM asset_profiles WHERE id=$1 AND active', [id]);
    if (!profile.rows[0]) throw new AppError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
    return { profile: { ...profile.rows[0], id, fields: await loadProfileFields(id) } };
  });

  app.get('/api/v1/lookups', { preHandler: authenticate }, async () => {
    const [lookups, locations, users, vendors] = await Promise.all([
      pool.query(`SELECT ll.id, ll.lookup_key,ll.lookup_name,jsonb_agg(jsonb_build_object('id',lv.id,'value',lv.value_key,'label',lv.display_value,'description',lv.description,'aliases',lv.aliases) ORDER BY lv.display_order) values FROM lookup_lists ll JOIN lookup_values lv ON lv.lookup_list_id=ll.id AND lv.active WHERE ll.active GROUP BY ll.id ORDER BY ll.lookup_name`),
      pool.query(`SELECT l.id,l.parent_id,l.location_key,l.location_name,l.full_path,
        lt.type_key,lt.type_name,lt.level_order
        FROM locations l JOIN location_types lt ON lt.id=l.location_type_id
        WHERE l.active ORDER BY l.full_path`),
      pool.query(`SELECT id,display_name,initials FROM application_users WHERE active ORDER BY display_name`),
      pool.query(`SELECT id,vendor_name FROM vendors WHERE active ORDER BY vendor_name`),
    ]);
    return { lookups: lookups.rows, locations: locations.rows, users: users.rows, vendors: vendors.rows };
  });
}
