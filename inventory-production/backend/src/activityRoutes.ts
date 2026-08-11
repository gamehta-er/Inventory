import type { FastifyInstance } from 'fastify';
import { pool } from './db.js';
import { requirePermission } from './auth.js';

export async function registerActivityRoutes(app: FastifyInstance): Promise<void> {
  const handler=async(request: import('fastify').FastifyRequest,assetId?:number)=>{
    const q=request.query as Record<string,string|undefined>; const params:unknown[]=[]; const where=['1=1'];
    const add=(sql:string,value:unknown)=>{params.push(value);where.push(sql.replace('?',`$${params.length}`));};
    if(assetId)add("e.record_type='asset' AND e.record_id=?",String(assetId));
    if(q.action)add('e.action_key=?',q.action); if(q.actorId)add('e.actor_user_id=?',Number(q.actorId)); if(q.recordType)add('e.record_type=?',q.recordType);
    if(q.from)add('e.created_at>=?::timestamptz',q.from); if(q.to)add('e.created_at<=?::timestamptz',q.to);
    if(q.query?.trim()) {
      add(`(
        e.record_label ILIKE '%' || ? || '%'
        OR e.reason ILIKE '%' || $${params.length + 1} || '%'
        OR COALESCE(e.reference_value, '') ILIKE '%' || $${params.length + 1} || '%'
        OR e.action_key ILIKE '%' || $${params.length + 1} || '%'
        OR e.source ILIKE '%' || $${params.length + 1} || '%'
        OR EXISTS (
          SELECT 1 FROM application_users search_actor
          WHERE search_actor.id=e.actor_user_id
            AND search_actor.display_name ILIKE '%' || $${params.length + 1} || '%'
        )
      )`,q.query.trim());
    }
    const page=Math.max(Number(q.page)||1,1); const limit=Math.min(Math.max(Number(q.limit)||50,1),200);
    const count=await pool.query(`SELECT count(*)::int total FROM activity_events e WHERE ${where.join(' AND ')}`,params);
    params.push(limit,(page-1)*limit);
    const result=await pool.query(`SELECT e.id,e.action_key,e.source,e.reason,e.record_type,e.record_id,e.record_label,e.route_path,e.reference_value,e.parent_event_id,e.parent_import_batch_id,e.metadata,e.created_at,u.display_name actor,e.effective_role_keys,
      COALESCE(jsonb_agg(jsonb_build_object('fieldKey',c.field_key,'fieldLabel',c.field_label,'before',c.before_value,'after',c.after_value) ORDER BY c.id) FILTER(WHERE c.id IS NOT NULL),'[]') changes
      FROM activity_events e JOIN application_users u ON u.id=e.actor_user_id LEFT JOIN activity_field_changes c ON c.activity_event_id=e.id
      WHERE ${where.join(' AND ')} GROUP BY e.id,u.display_name ORDER BY e.created_at DESC,e.id DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params);
    return {events:result.rows,page,limit,total:count.rows[0].total};
  };
  app.get('/api/v1/activity',{preHandler:requirePermission('activity.view')},async(request)=>handler(request));
  app.get('/api/v1/assets/:id/activity',{preHandler:requirePermission('asset.history')},async(request)=>handler(request,Number((request.params as {id:string}).id)));
}
