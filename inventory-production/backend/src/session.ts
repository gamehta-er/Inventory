import type { FastifyInstance } from 'fastify';
import { authenticate } from './auth.js';
import { pool } from './db.js';
import type { AuthenticatedRequest } from './types.js';
import { lifecycleGroups, lifecycleOperations } from './lifecycle.js';

export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/session', { preHandler: authenticate }, async (request) => {
    const user = (request as AuthenticatedRequest).inventoryUser;
    const [categories, statuses, health] = await Promise.all([
      pool.query(`SELECT c.id,c.category_key,c.category_name,c.description,c.icon_key,c.display_order,
        ap.id profile_id,ap.profile_key,ap.profile_name,ap.version,count(a.id)::int asset_count
        FROM categories c JOIN asset_profiles ap ON ap.category_id=c.id AND ap.active
        LEFT JOIN asset_models am ON am.category_id=c.id LEFT JOIN assets a ON a.asset_model_id=am.id AND a.archived_at IS NULL
        WHERE c.active GROUP BY c.id,ap.id ORDER BY c.display_order`),
      pool.query(`SELECT lv.id,lv.value_key,lv.display_value,lv.description,lv.display_order
        FROM lookup_values lv JOIN lookup_lists ll ON ll.id=lv.lookup_list_id
        WHERE ll.lookup_key='ASSET_STATUS' AND lv.active ORDER BY lv.display_order`),
      pool.query(`SELECT
        (SELECT count(*)::int FROM assets WHERE archived_at IS NULL) assets,
        (SELECT count(*)::int FROM categories WHERE active) categories,
        (SELECT count(*)::int FROM application_users WHERE active) users,
        (SELECT count(*)::int FROM import_batches WHERE status='FAILED') failed_imports,
        (SELECT count(*)::int FROM assets WHERE location_id IS NULL) missing_locations`),
    ]);
    return {
      user,
      permissions: Object.fromEntries(user.permissions.map((key) => [key, true])),
      categories: categories.rows.map((row) => ({
        id: Number(row.id), key: row.category_key, name: row.category_name, description: row.description,
        icon: row.icon_key, profileId: Number(row.profile_id), profileKey: row.profile_key,
        profileName: row.profile_name, version: row.version, assetCount: row.asset_count,
      })),
      statuses: statuses.rows,
      lifecycle: { groups: lifecycleGroups, operations: lifecycleOperations },
      health: health.rows[0],
    };
  });
}
