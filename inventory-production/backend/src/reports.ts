import type { FastifyInstance } from 'fastify';
import { pool, withTransaction } from './db.js';
import { requirePermission } from './auth.js';
import { recordActivity } from './activity.js';
import type { AuthenticatedRequest } from './types.js';
import { appendRegistryFilters } from './filtering.js';
import { appendLifecycleFilter, lifecycleGroups } from './lifecycle.js';

type Query = Record<string, string | undefined>;

const reportJoins = `FROM assets a
  JOIN asset_models am ON am.id=a.asset_model_id
  JOIN categories c ON c.id=am.category_id
  JOIN lookup_values sv ON sv.id=a.status_value_id
  LEFT JOIN locations l ON l.id=a.location_id
  JOIN application_users u ON u.id=a.owner_user_id
  JOIN vendors v ON v.id=a.vendor_id`;

const requiredMetadataMissing = `EXISTS (
  SELECT 1
  FROM profile_fields required_pf
  JOIN field_definitions required_fd ON required_fd.id=required_pf.field_definition_id
  WHERE required_pf.profile_id=a.profile_id
    AND required_pf.required
    AND required_pf.active
    AND required_fd.active
    AND CASE
      WHEN required_fd.storage_target='assets.date_received' THEN a.date_received IS NULL
      WHEN required_fd.storage_target='assets.serial_number' THEN NULLIF(btrim(a.serial_number),'') IS NULL
      WHEN required_fd.storage_target='assets.milestone' THEN NULLIF(btrim(COALESCE(a.milestone,'')),'') IS NULL
      WHEN required_fd.storage_target='assets.location_id' THEN a.location_id IS NULL
      WHEN required_fd.storage_target='assets.status_value_id' THEN a.status_value_id IS NULL
      WHEN required_fd.storage_target='assets.pool_team' THEN NULLIF(btrim(COALESCE(a.pool_team,'')),'') IS NULL
      WHEN required_fd.storage_target='assets.project' THEN NULLIF(btrim(COALESCE(a.project,'')),'') IS NULL
      WHEN required_fd.storage_target='assets.asset_tag' THEN NULLIF(btrim(COALESCE(a.asset_tag,'')),'') IS NULL
      WHEN required_fd.storage_target='assets.owner_user_id' THEN a.owner_user_id IS NULL
      WHEN required_fd.storage_target='assets.notes' THEN NULLIF(btrim(COALESCE(a.notes,'')),'') IS NULL
      WHEN required_fd.storage_target='assets.vendor_id' THEN a.vendor_id IS NULL
      WHEN required_fd.storage_target='asset_models.board_sku' THEN NULLIF(btrim(COALESCE(am.board_sku,'')),'') IS NULL
      WHEN required_fd.storage_target='asset_models.gpu_sku' THEN NULLIF(btrim(COALESCE(am.gpu_sku,'')),'') IS NULL
      WHEN required_fd.storage_target='asset_models.model_number' THEN NULLIF(btrim(am.model_number),'') IS NULL
      WHEN required_fd.storage_target='asset_models.product_name' THEN NULLIF(btrim(am.product_name),'') IS NULL
      WHEN required_fd.storage_target='asset_models.board_architecture' THEN NULLIF(btrim(COALESCE(am.board_architecture,'')),'') IS NULL
      WHEN required_fd.storage_target LIKE 'external_reference:%' THEN NOT EXISTS (
        SELECT 1
        FROM asset_external_references required_aer
        JOIN external_reference_types required_rt ON required_rt.id=required_aer.reference_type_id
        WHERE required_aer.asset_id=a.id
          AND required_rt.reference_type_key=split_part(required_fd.storage_target,':',2)
          AND NULLIF(btrim(required_aer.normalized_value),'') IS NOT NULL
      )
      ELSE NOT EXISTS (
        SELECT 1
        FROM asset_field_values required_afv
        WHERE required_afv.asset_id=a.id
          AND required_afv.field_definition_id=required_fd.id
          AND NULLIF(btrim(COALESCE(
            required_afv.text_value,
            required_afv.number_value::text,
            required_afv.date_value::text,
            required_afv.boolean_value::text,
            required_afv.json_value::text,
            required_afv.lookup_value_id::text
          )), '') IS NOT NULL
      )
    END
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
  if (query.vendorId) add('v.id=?', Number(query.vendorId));
  if (query.model) add("am.model_number ILIKE '%'||?||'%'", query.model);
  if (query.project === '__UNASSIGNED__') where.push("NULLIF(btrim(COALESCE(a.project,'')),'') IS NULL");
  else if (query.project) add("COALESCE(a.project,'') ILIKE '%'||?||'%'", query.project);
  if (query.receivedFrom) add('a.date_received>=?::date', query.receivedFrom);
  if (query.receivedTo) add('a.date_received<=?::date', query.receivedTo);
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
  vendor: { key: 'v.id::text', label: 'v.vendor_name' },
  model: { key: 'am.model_number', label: 'am.model_number' },
  project: { key: "COALESCE(NULLIF(btrim(a.project),''),'__UNASSIGNED__')", label: "COALESCE(NULLIF(btrim(a.project),''),'Unassigned')" },
};

function csvCell(value: unknown): string {
  const normalized = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  return `"${String(normalized ?? '').replaceAll('"', '""')}"`;
}

async function exportFields(profileIds: number[]) {
  if (!profileIds.length) return [];
  const result = await pool.query(`SELECT fd.field_key,fd.field_label,min(pf.display_order)::int display_order
    FROM profile_fields pf JOIN field_definitions fd ON fd.id=pf.field_definition_id
    WHERE pf.profile_id=ANY($1::bigint[]) AND pf.active AND fd.active AND pf.visible_export
    GROUP BY fd.field_key,fd.field_label ORDER BY display_order,fd.field_label`, [profileIds]);
  return result.rows as Array<{ field_key: string; field_label: string }>;
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

  app.get('/api/v1/reports/:id/results', { preHandler: requirePermission('report.view') }, async (request) => {
    const reportId = (request.params as { id: string }).id;
    const query = request.query as Query;
    const base = reportWhere(query);
    const where = [base.where];
    applyReportScope(reportId, where);
    const scopedWhere = where.join(' AND ');
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

    const total = await pool.query(`SELECT count(*)::int total ${reportJoins} WHERE ${scopedWhere}`, base.params);
    const rowParams = [...base.params, limit, (page - 1) * limit];
    const rows = await pool.query(`${assetSelect} WHERE ${scopedWhere} ORDER BY a.date_received DESC,a.id DESC LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`, rowParams);
    const kpiParams = [...base.params, lifecycleGroups.available, lifecycleGroups.unavailable, lifecycleGroups.exceptions];
    const kpis = await pool.query(`SELECT count(*)::int total,
      count(*) FILTER(WHERE sv.value_key=ANY($${base.params.length + 1}::text[]))::int available,
      count(*) FILTER(WHERE sv.value_key=ANY($${base.params.length + 2}::text[]))::int unavailable,
      count(*) FILTER(WHERE sv.value_key=ANY($${base.params.length + 3}::text[]))::int exceptions,
      count(*) FILTER(WHERE ${requiredMetadataMissing})::int missing_metadata
      ${reportJoins} WHERE ${scopedWhere}`, kpiParams);

    const groupedDimensions: Record<string, unknown[]> = {};
    for (const [dimension, expression] of Object.entries(dimensions)) {
      const grouped = await pool.query(`SELECT ${expression.key} key,${expression.label} label,count(*)::int value
        ${reportJoins} WHERE ${scopedWhere}
        GROUP BY ${expression.key},${expression.label} ORDER BY value DESC,label LIMIT 12`, base.params);
      groupedDimensions[dimension] = grouped.rows;
    }
    const trends = await pool.query(`SELECT to_char(date_trunc('month',a.date_received),'YYYY-MM') month,count(*)::int value
      ${reportJoins} WHERE ${scopedWhere} GROUP BY date_trunc('month',a.date_received) ORDER BY month`, base.params);
    return { reportId, filters: query, kpis: kpis.rows[0], dimensions: groupedDimensions, trends: trends.rows, rows: rows.rows, page, limit, total: total.rows[0].total };
  });

  app.get('/api/v1/reports/:id/export', { preHandler: requirePermission('report.export') }, async (request, reply) => {
    const reportId = (request.params as { id: string }).id;
    const query = request.query as Query;
    const base = reportWhere(query);
    const where = [base.where];
    applyReportScope(reportId, where);
    const result = await pool.query(`SELECT ${assetColumns},
      COALESCE((SELECT jsonb_object_agg(fd.field_key,COALESCE(afv.text_value,afv.number_value::text,afv.date_value::text,afv.boolean_value::text,afv.json_value::text,lv.display_value))
        FROM asset_field_values afv JOIN field_definitions fd ON fd.id=afv.field_definition_id LEFT JOIN lookup_values lv ON lv.id=afv.lookup_value_id WHERE afv.asset_id=a.id),'{}'::jsonb) dynamic_values,
      am.board_sku,am.gpu_sku,am.board_architecture,a.milestone,a.pool_team,a.notes
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
