import type { FastifyInstance } from 'fastify';
import { pool, withTransaction, type DbClient } from './db.js';
import { requirePermission } from './auth.js';
import { recordActivity } from './activity.js';
import type { AuthenticatedRequest } from './types.js';
import { appendRegistryFilters } from './filtering.js';
import { appendLifecycleFilter, lifecycleGroups } from './lifecycle.js';
import { csvCell } from './csvSafety.js';

type Query = Record<string, string | undefined>;

const reportJoins = `FROM assets a
  JOIN asset_models am ON am.id=a.asset_model_id
  JOIN categories c ON c.id=am.category_id
  JOIN lookup_values sv ON sv.id=a.status_value_id
  LEFT JOIN locations l ON l.id=a.location_id
  LEFT JOIN application_users u ON u.id=a.owner_user_id
  LEFT JOIN vendors v ON v.id=a.vendor_id`;

function requiredValueMissing(profileFieldAlias: string, fieldDefinitionAlias: string): string {
  return `CASE
      WHEN ${fieldDefinitionAlias}.storage_target='assets.date_received' THEN a.date_received IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='assets.serial_number' THEN NULLIF(btrim(a.serial_number),'') IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='assets.milestone' THEN NULLIF(btrim(COALESCE(a.milestone,'')),'') IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='assets.location_id' THEN a.location_id IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='assets.status_value_id' THEN a.status_value_id IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='assets.pool_team' THEN NULLIF(btrim(COALESCE(a.pool_team,'')),'') IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='assets.project' THEN NULLIF(btrim(COALESCE(a.project,'')),'') IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='assets.asset_tag' THEN NULLIF(btrim(COALESCE(a.asset_tag,'')),'') IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='assets.owner_user_id' THEN a.owner_user_id IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='assets.notes' THEN NULLIF(btrim(COALESCE(a.notes,'')),'') IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='assets.vendor_id' THEN a.vendor_id IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='asset_models.board_sku' THEN NULLIF(btrim(COALESCE(am.board_sku,'')),'') IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='asset_models.gpu_sku' THEN NULLIF(btrim(COALESCE(am.gpu_sku,'')),'') IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='asset_models.model_number' THEN NULLIF(btrim(am.model_number),'') IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='asset_models.product_name' THEN NULLIF(btrim(am.product_name),'') IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='asset_models.board_architecture' THEN NULLIF(btrim(COALESCE(am.board_architecture,'')),'') IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='asset_models.gpu_class' THEN NULLIF(btrim(COALESCE(am.gpu_class,'')),'') IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='asset_models.gpu_chip' THEN NULLIF(btrim(COALESCE(am.gpu_chip,'')),'') IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='asset_models.gpu_name_vrl' THEN NULLIF(btrim(COALESCE(am.gpu_name_vrl,'')),'') IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target='asset_models.gpu_name_market' THEN NULLIF(btrim(COALESCE(am.gpu_name_market,'')),'') IS NULL
      WHEN ${fieldDefinitionAlias}.storage_target LIKE 'external_reference:%' THEN NOT EXISTS (
        SELECT 1
        FROM asset_external_references required_aer
        JOIN external_reference_types required_rt ON required_rt.id=required_aer.reference_type_id
        WHERE required_aer.asset_id=a.id
          AND required_rt.reference_type_key=split_part(${fieldDefinitionAlias}.storage_target,':',2)
          AND NULLIF(btrim(required_aer.normalized_value),'') IS NOT NULL
      )
      ELSE NOT EXISTS (
        SELECT 1
        FROM asset_field_values required_afv
        WHERE required_afv.asset_id=a.id
          AND required_afv.field_definition_id=${fieldDefinitionAlias}.id
          AND NULLIF(btrim(COALESCE(
            required_afv.text_value,
            required_afv.number_value::text,
            required_afv.date_value::text,
            required_afv.boolean_value::text,
            required_afv.json_value::text
          )), '') IS NOT NULL
      )
    END`;
}

const requiredMetadataMissing = `EXISTS (
  SELECT 1
  FROM profile_fields required_pf
  JOIN field_definitions required_fd ON required_fd.id=required_pf.field_definition_id
  WHERE required_pf.profile_id=a.profile_id
    AND required_pf.required
    AND required_pf.active
    AND required_fd.active
    AND ${requiredValueMissing('required_pf', 'required_fd')}
)`;

function reportWhere(query: Query) {
  const params: unknown[] = [];
  const where = ['a.archived_at IS NULL'];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (query.category) add('c.category_key=?', query.category);
  if (query.status) add('sv.value_key=?', query.status);
  if (query.ownerId === '__UNASSIGNED__') where.push('a.owner_user_id IS NULL');
  else if (query.ownerId) add('u.id=?', Number(query.ownerId));
  if (query.vendorId === '__UNASSIGNED__') where.push('a.vendor_id IS NULL');
  else if (query.vendorId) add('v.id=?', Number(query.vendorId));
  if (query.model) add("am.model_number ILIKE '%'||?||'%'", query.model);
  if (query.project === '__UNASSIGNED__') where.push("NULLIF(btrim(COALESCE(a.project,'')),'') IS NULL");
  else if (query.project) add("COALESCE(a.project,'') ILIKE '%'||?||'%'", query.project);
  if (query.receivedFrom) add('a.date_received>=?::date', query.receivedFrom);
  if (query.receivedTo) add('a.date_received<=?::date', query.receivedTo);
  if (query.receivedMonth) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(query.receivedMonth)) {
      const error = new Error('Received month must use YYYY-MM format.') as Error & { statusCode?: number };
      error.statusCode = 400;
      throw error;
    }
    add("date_trunc('month',a.date_received)=?::date", `${query.receivedMonth}-01`);
  }
  if (query.locationId === '__UNASSIGNED__') where.push('a.location_id IS NULL');
  else if (query.locationId) {
    params.push(Number(query.locationId));
    const p = `$${params.length}`;
    where.push(`(l.id=${p} OR l.full_path LIKE (SELECT full_path||'%' FROM locations WHERE id=${p}))`);
  }
  if (query.nvbug) {
    params.push(query.nvbug.replace(/\D/g, ''));
    where.push(`EXISTS(SELECT 1 FROM asset_external_references aer JOIN external_reference_types rt ON rt.id=aer.reference_type_id WHERE aer.asset_id=a.id AND rt.reference_type_key='NVBUG' AND aer.normalized_value=$${params.length})`);
  }
  if (query.missingField) {
    params.push(query.missingField);
    where.push(`EXISTS (
      SELECT 1
      FROM profile_fields missing_pf
      JOIN field_definitions missing_fd ON missing_fd.id=missing_pf.field_definition_id
      WHERE missing_pf.profile_id=a.profile_id
        AND missing_pf.required
        AND missing_pf.active
        AND missing_fd.active
        AND missing_fd.field_key=$${params.length}
        AND ${requiredValueMissing('missing_pf', 'missing_fd')}
    )`);
  }
  appendLifecycleFilter(query.availability, params, where);
  appendRegistryFilters(query, params, where, 'report');
  return { where: where.join(' AND '), params };
}

function applyReportScope(reportId: string, where: string[]): void {
  if (reportId === 'rework') where.push("sv.value_key='REWORK'");
  else if (reportId === 'e-waste') where.push("sv.value_key='E_WASTE'");
  else if (reportId === 'missing-metadata') where.push(requiredMetadataMissing);
  else if (!['inventory', 'aging'].includes(reportId)) {
    const error = new Error('Report not found.') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }
}

const assetColumns = `a.id,a.profile_id,a.revision,a.serial_number,a.asset_tag,a.date_received,a.project,
  c.category_key,c.category_name,am.model_number,am.product_name,sv.value_key status,sv.display_value status_label,
  l.full_path location,u.display_name owner,v.vendor_name vendor,
  (SELECT string_agg(aer.reference_value,', ' ORDER BY aer.created_at DESC,aer.id DESC) FROM asset_external_references aer JOIN external_reference_types rt ON rt.id=aer.reference_type_id WHERE aer.asset_id=a.id AND rt.reference_type_key='NVBUG') nvbugs,
  (SELECT string_agg(aer.reference_value,', ' ORDER BY aer.created_at DESC,aer.id DESC) FROM asset_external_references aer JOIN external_reference_types rt ON rt.id=aer.reference_type_id WHERE aer.asset_id=a.id AND rt.reference_type_key='MRS_ORDER') mrs_order,
  (SELECT string_agg(aer.reference_value,', ' ORDER BY aer.created_at DESC,aer.id DESC) FROM asset_external_references aer JOIN external_reference_types rt ON rt.id=aer.reference_type_id WHERE aer.asset_id=a.id AND rt.reference_type_key='CAPACITY_REQUEST') capacity_request`;

const assetSelect = `SELECT ${assetColumns} ${reportJoins}`;

const dimensions: Record<string, { key: string; label: string }> = {
  category: { key: 'c.category_key', label: 'c.category_name' },
  status: { key: 'sv.value_key', label: 'sv.display_value' },
  location: { key: "COALESCE(l.id::text,'__UNASSIGNED__')", label: "COALESCE(l.full_path,'Unassigned')" },
  owner: { key: "COALESCE(u.id::text,'__UNASSIGNED__')", label: "COALESCE(u.display_name,'Unassigned')" },
  vendor: { key: "COALESCE(v.id::text,'__UNASSIGNED__')", label: "COALESCE(v.vendor_name,'Unassigned')" },
  model: { key: 'am.model_number', label: 'am.model_number' },
  project: { key: "COALESCE(NULLIF(btrim(a.project),''),'__UNASSIGNED__')", label: "COALESCE(NULLIF(btrim(a.project),''),'Unassigned')" },
};

async function exportFields(profileIds: number[]) {
  if (!profileIds.length) return [];
  const result = await pool.query(`SELECT fd.field_key,fd.field_label,min(pf.display_order)::int display_order
    FROM profile_fields pf JOIN field_definitions fd ON fd.id=pf.field_definition_id
    WHERE pf.profile_id=ANY($1::bigint[]) AND pf.active AND fd.active AND pf.visible_export
    GROUP BY fd.field_key,fd.field_label ORDER BY display_order,fd.field_label`, [profileIds]);
  return result.rows as Array<{ field_key: string; field_label: string }>;
}

async function buildReportResult(db: Pick<DbClient, 'query'>, reportId: string, query: Query) {
  const base = reportWhere(query);
  const where = [base.where];
  applyReportScope(reportId, where);
  const scopedWhere = where.join(' AND ');
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const total = await db.query(`SELECT count(*)::int total ${reportJoins} WHERE ${scopedWhere}`, base.params);
  const rowParams = [...base.params, limit, (page - 1) * limit];
  const rows = await db.query(`${assetSelect} WHERE ${scopedWhere} ORDER BY a.date_received DESC,a.id DESC LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`, rowParams);
  const kpiParams = [...base.params, lifecycleGroups.available, lifecycleGroups.unavailable, lifecycleGroups.exceptions];
  const kpis = await db.query(`SELECT count(*)::int total,
    count(*) FILTER(WHERE sv.value_key=ANY($${base.params.length + 1}::text[]))::int available,
    count(*) FILTER(WHERE sv.value_key=ANY($${base.params.length + 2}::text[]))::int unavailable,
    count(*) FILTER(WHERE sv.value_key=ANY($${base.params.length + 3}::text[]))::int exceptions,
    count(*) FILTER(WHERE sv.value_key='AVAILABLE')::int available_now,
    count(*) FILTER(WHERE sv.value_key='GPU_READY')::int gpu_ready,
    count(*) FILTER(WHERE sv.value_key='IN_USE')::int in_use,
    count(*) FILTER(WHERE sv.value_key='REWORK')::int rework,
    count(*) FILTER(WHERE sv.value_key='E_WASTE')::int e_waste,
    count(*) FILTER(WHERE sv.value_key='ARCHIVE')::int archive,
    count(*) FILTER(WHERE ${requiredMetadataMissing})::int missing_metadata,
    count(*) FILTER(WHERE a.owner_user_id IS NULL)::int unassigned_owner,
    count(*) FILTER(WHERE a.location_id IS NULL)::int unassigned_location,
    count(*) FILTER(WHERE a.vendor_id IS NULL)::int unassigned_vendor,
    count(*) FILTER(WHERE a.date_received>=current_date-29)::int received_30_days,
    count(*) FILTER(WHERE a.date_received BETWEEN current_date-59 AND current_date-30)::int received_previous_30_days
    ${reportJoins} WHERE ${scopedWhere}`, kpiParams);

  const groupedDimensions: Record<string, unknown[]> = {};
  for (const [dimension, expression] of Object.entries(dimensions)) {
    const grouped = await db.query(`SELECT ${expression.key} key,${expression.label} label,count(*)::int value
      ${reportJoins} WHERE ${scopedWhere}
      GROUP BY ${expression.key},${expression.label} ORDER BY value DESC,label LIMIT 12`, base.params);
    groupedDimensions[dimension] = grouped.rows;
  }
  const trends = await db.query(`SELECT to_char(date_trunc('month',a.date_received),'YYYY-MM') AS report_month,count(*)::int value
    ${reportJoins} WHERE ${scopedWhere} GROUP BY date_trunc('month',a.date_received) ORDER BY date_trunc('month',a.date_received)`, base.params);
  const qualityIssues = await db.query(`SELECT quality_fd.field_key key,quality_fd.field_label label,count(DISTINCT a.id)::int value
    ${reportJoins}
    JOIN profile_fields quality_pf ON quality_pf.profile_id=a.profile_id
    JOIN field_definitions quality_fd ON quality_fd.id=quality_pf.field_definition_id
    WHERE ${scopedWhere}
      AND quality_pf.required
      AND quality_pf.active
      AND quality_fd.active
      AND ${requiredValueMissing('quality_pf', 'quality_fd')}
    GROUP BY quality_fd.field_key,quality_fd.field_label
    ORDER BY value DESC,quality_fd.field_label`, base.params);
  const kpiRow = kpis.rows[0] as Record<string, number>;
  return {
    reportId,
    filters: query,
    kpis: kpiRow,
    dimensions: groupedDimensions,
    trends: trends.rows.map((row) => ({ month: row.report_month, value: row.value })),
    quality: {
      complete: Math.max(Number(kpiRow.total) - Number(kpiRow.missing_metadata), 0),
      missing: Number(kpiRow.missing_metadata),
      issues: qualityIssues.rows,
    },
    rows: rows.rows,
    page,
    limit,
    total: total.rows[0].total,
  };
}

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/reports', { preHandler: requirePermission('report.view') }, async () => ({
    reports: [
      { id: 'inventory', name: 'Inventory Overview', description: 'Authoritative inventory totals, lifecycle, ownership, location, model, project, and data quality.' },
      { id: 'rework', name: 'Rework Queue', description: 'Assets currently requiring corrective work.' },
      { id: 'e-waste', name: 'E-Waste Queue', description: 'Assets classified for electronic disposition.' },
      { id: 'missing-metadata', name: 'Required Metadata Gaps', description: 'Assets missing fields currently marked required by their active profile.' },
      { id: 'aging', name: 'Inventory Aging', description: 'Date-received aging and intake trends.' },
    ],
  }));

  app.get('/api/v1/reports/command-center', { preHandler: requirePermission('report.view') }, async (request) => {
    const user = (request as AuthenticatedRequest).inventoryUser;
    const query = request.query as Query;
    const startedAt = Date.now();
    return withTransaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const inventory = await buildReportResult(client, 'inventory', { ...query, page: '1', limit: '8' });
      const canViewImports = user.permissions.includes('import.execute');
      const canViewActivity = user.permissions.includes('activity.view');
      const canManageImports = user.permissions.includes('import.review') || user.permissions.includes('admin.profile');

      const importCounts = canViewImports ? await client.query(`SELECT
          count(*) FILTER(WHERE b.status IN ('DRAFT','SOURCE_SELECTION','MAPPING','VALIDATING','NEEDS_ATTENTION','AWAITING_APPROVAL','DECLINED','APPROVED','READY','COMMITTING','FAILED','VERIFICATION_FAILED','NEEDS_REVALIDATION'))::int open,
          count(*) FILTER(WHERE b.status IN ('NEEDS_ATTENTION','DECLINED','FAILED','VERIFICATION_FAILED','NEEDS_REVALIDATION'))::int needs_attention,
          count(*) FILTER(WHERE b.status='APPROVED')::int ready
        FROM import_batches b
        WHERE b.created_by_user_id=$1 OR $2::boolean`, [user.id, canManageImports]) : { rows: [{ open: 0, needs_attention: 0, ready: 0 }] };
      const recentImports = canViewImports ? await client.query(`SELECT b.id,b.mode,b.file_name,b.status,b.total_rows,b.valid_rows,b.warning_rows,b.invalid_rows,b.created_at,b.updated_at,
          c.category_name,ap.profile_name,u.display_name created_by
        FROM import_batches b
        JOIN import_profiles ip ON ip.id=b.import_profile_id
        JOIN asset_profiles ap ON ap.id=ip.profile_id
        JOIN categories c ON c.id=ap.category_id
        JOIN application_users u ON u.id=b.created_by_user_id
        WHERE b.created_by_user_id=$1 OR $2::boolean
        ORDER BY b.updated_at DESC LIMIT 6`, [user.id, canManageImports]) : { rows: [] };
      const recentActivity = canViewActivity ? await client.query(`SELECT e.id,e.action_key,e.source,e.reason,e.record_type,e.record_id,e.record_label,e.route_path,e.reference_value,e.created_at,
          u.display_name actor,e.effective_role_keys,
          COALESCE(jsonb_agg(jsonb_build_object('fieldKey',c.field_key,'fieldLabel',c.field_label,'before',c.before_value,'after',c.after_value) ORDER BY c.id) FILTER(WHERE c.id IS NOT NULL),'[]') changes
        FROM activity_events e
        JOIN application_users u ON u.id=e.actor_user_id
        LEFT JOIN activity_field_changes c ON c.activity_event_id=e.id
        GROUP BY e.id,u.display_name
        ORDER BY e.created_at DESC,e.id DESC LIMIT 8`) : { rows: [] };
      const kpis = inventory.kpis as Record<string, number>;
      const importRow = importCounts.rows[0] as Record<string, number>;

      return {
        generatedAt: new Date().toISOString(),
        queryTimeMs: Date.now() - startedAt,
        database: { status: 'ready' },
        inventory,
        actionQueues: {
          rework: Number(kpis.rework ?? 0),
          eWaste: Number(kpis.e_waste ?? 0),
          metadataGaps: Number(kpis.missing_metadata ?? 0),
          unassignedOwner: Number(kpis.unassigned_owner ?? 0),
          unassignedLocation: Number(kpis.unassigned_location ?? 0),
          importsNeedingAttention: Number(importRow.needs_attention ?? 0),
        },
        imports: {
          open: Number(importRow.open ?? 0),
          needsAttention: Number(importRow.needs_attention ?? 0),
          ready: Number(importRow.ready ?? 0),
          recent: recentImports.rows,
        },
        recentActivity: recentActivity.rows,
      };
    });
  });

  app.get('/api/v1/reports/:id/results', { preHandler: requirePermission('report.view') }, async (request) => {
    const reportId = (request.params as { id: string }).id;
    const query = request.query as Query;
    return buildReportResult(pool, reportId, query);
  });

  app.get('/api/v1/reports/:id/export', { preHandler: requirePermission('report.export') }, async (request, reply) => {
    const reportId = (request.params as { id: string }).id;
    const query = request.query as Query;
    const base = reportWhere(query);
    const where = [base.where];
    applyReportScope(reportId, where);
    const result = await pool.query(`SELECT ${assetColumns},
      COALESCE((SELECT jsonb_object_agg(fd.field_key,COALESCE(afv.text_value,afv.number_value::text,afv.date_value::text,afv.boolean_value::text,afv.json_value::text))
        FROM asset_field_values afv JOIN field_definitions fd ON fd.id=afv.field_definition_id WHERE afv.asset_id=a.id),'{}'::jsonb) dynamic_values,
      am.board_sku,am.gpu_sku,am.board_architecture,am.gpu_class,am.gpu_chip,am.gpu_name_vrl,am.gpu_name_market,
      a.milestone,a.pool_team,a.notes
      ${reportJoins} WHERE ${where.join(' AND ')} ORDER BY a.id`, base.params);

    const fields = await exportFields([...new Set(result.rows.map((row) => Number(row.profile_id)))]);
    const headers = ['Asset ID', 'Category', ...fields.map((field) => field.field_label)];
    const lines = [headers.map(csvCell).join(',')];
    for (const row of result.rows) {
      const values: Record<string, unknown> = {
        mrs_order: row.mrs_order,
        nvbugs: row.nvbugs,
        capacity_request: row.capacity_request,
        date_received: row.date_received,
        board_sku: row.board_sku,
        gpu_sku: row.gpu_sku,
        model_number: row.model_number,
        serial_number: row.serial_number,
        milestone: row.milestone,
        product_name: row.product_name,
        location: row.location,
        asset_status: row.status_label,
        board_architecture: row.board_architecture,
        gpu_class: row.gpu_class,
        gpu_chip: row.gpu_chip,
        gpu_name_vrl: row.gpu_name_vrl,
        gpu_name_market: row.gpu_name_market,
        pool_team: row.pool_team,
        project: row.project,
        asset_tag: row.asset_tag,
        owner: row.owner,
        notes: row.notes,
        vendor: row.vendor,
        ...(row.dynamic_values ?? {}),
      };
      lines.push([row.id, row.category_name, ...fields.map((field) => values[field.field_key])].map(csvCell).join(','));
    }
    const user = (request as AuthenticatedRequest).inventoryUser;
    await withTransaction((client) => recordActivity(client, {
      user,
      actionKey: 'REPORT_EXPORTED',
      source: 'reports',
      reason: 'Report exported to CSV.',
      recordType: 'report',
      recordId: reportId,
      recordLabel: reportId,
      routePath: `/reports/${reportId}`,
      metadata: { filters: query, rows: result.rowCount, columns: fields.map((field) => field.field_key) },
    }));
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="inventory-${reportId}.csv"`);
    return lines.join('\r\n');
  });
}
