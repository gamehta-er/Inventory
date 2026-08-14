import bwipjs from 'bwip-js';
import type { FastifyInstance } from 'fastify';
import { pool, withTransaction } from './db.js';
import { AppError } from './errors.js';
import { requirePermission, verifyCsrf } from './auth.js';
import { recordActivity } from './activity.js';
import type { AuthenticatedRequest } from './types.js';

const labelFields = [
  'productName', 'modelNumber', 'boardSku', 'gpuSku', 'boardArchitecture', 'assetTag', 'serialNumber',
] as const;
const defaultLabelFields = ['productName', 'modelNumber', 'assetTag', 'serialNumber'] as const;
type LabelField = typeof labelFields[number];

function svg(value: string): string {
  return bwipjs.toSVG({ bcid: 'code128', text: value, scale: 2, height: 10, includetext: false, backgroundcolor: 'FFFFFF' });
}

function assetIds(value: unknown): number[] {
  const ids = [...new Set(Array.isArray(value) ? value.map(Number) : [])]
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length || ids.length > 200) throw new AppError(422, 'ASSETS_REQUIRED', 'Select between 1 and 200 assets.');
  return ids;
}

function selectedFields(value: unknown): LabelField[] {
  if (value === undefined) return [...defaultLabelFields];
  if (!Array.isArray(value) || value.some((field) => !labelFields.includes(field as LabelField))) {
    throw new AppError(422, 'LABEL_FIELDS_INVALID', 'One or more selected label fields are not supported.');
  }
  return [...new Set(value)] as LabelField[];
}

async function loadLabels(ids: number[]) {
  const rows = await pool.query(
    `SELECT a.id,a.asset_tag,a.serial_number,am.product_name,am.model_number,
            am.board_sku,am.gpu_sku,am.board_architecture
       FROM assets a
       JOIN asset_models am ON am.id=a.asset_model_id
      WHERE a.id=ANY($1::bigint[])
      ORDER BY array_position($1::bigint[],a.id)`,
    [ids],
  );
  if (rows.rowCount !== ids.length) throw new AppError(404, 'ASSET_NOT_FOUND', 'One or more selected assets were not found.');
  return rows.rows.map((row) => {
    const barcode = String(row.asset_tag || row.serial_number);
    return {
      assetId: Number(row.id), productName: row.product_name, modelNumber: row.model_number,
      boardSku: row.board_sku, gpuSku: row.gpu_sku, boardArchitecture: row.board_architecture,
      assetTag: row.asset_tag, serialNumber: row.serial_number, barcodeValue: barcode, barcodeSvg: svg(barcode),
    };
  });
}

export async function registerLabelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/assets/:id/label', { preHandler: requirePermission('label.print') }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    const labels = await loadLabels(assetIds([id]));
    return { label: labels[0] };
  });

  app.post('/api/v1/labels/preview', { preHandler: requirePermission('label.print') }, async (request) => {
    await verifyCsrf(request);
    const body = request.body as { assetIds?: unknown };
    return { labels: await loadLabels(assetIds(body.assetIds)) };
  });

  app.post('/api/v1/labels/print', { preHandler: requirePermission('label.print') }, async (request) => {
    await verifyCsrf(request);
    const user = (request as AuthenticatedRequest).inventoryUser;
    const body = request.body as { assetIds?: unknown; fields?: unknown };
    const ids = assetIds(body.assetIds);
    const fields = selectedFields(body.fields);
    const labels = await loadLabels(ids);

    if (body.fields !== undefined && !user.roles.some((role) => role === 'super_user' || role === 'privileged_administrator')) {
      throw new AppError(403, 'LABEL_LAYOUT_FORBIDDEN', 'Custom label fields require Super User or Privileged Administrator access.');
    }

    await withTransaction(async (client) => {
      const parent = await recordActivity(client, {
        user, actionKey: 'LABEL_JOB_CREATED', source: 'labels', reason: 'Asset labels submitted to the browser print dialog.',
        recordType: 'label-job', recordId: Date.now(), recordLabel: `${ids.length} asset labels`, routePath: '/inventory',
        metadata: { assetIds: ids, fields, labelCount: ids.length },
      });
      for (const label of labels) await recordActivity(client, {
        user, actionKey: 'LABEL_PRINTED', source: 'labels', reason: 'Asset label included in a browser print job.',
        recordType: 'asset', recordId: label.assetId, recordLabel: label.productName, routePath: `/assets/${label.assetId}`,
        parentEventId: parent, metadata: { fields },
      });
    });
    return { labels };
  });
}
