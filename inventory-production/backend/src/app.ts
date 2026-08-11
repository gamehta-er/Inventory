import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { mkdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createReadStream } from 'node:fs';
import { config } from './config.js';
import { AppError } from './errors.js';
import { pool, ready } from './db.js';
import { registerAuthRoutes } from './auth.js';
import { registerSessionRoutes } from './session.js';
import { registerRegistryRoutes } from './registry.js';
import { registerAssetRoutes } from './assets.js';
import { registerImportRoutes } from './imports.js';
import { registerReportRoutes } from './reports.js';
import { registerActivityRoutes } from './activityRoutes.js';
import { registerLabelRoutes } from './labels.js';
import { registerAdminRoutes } from './admin.js';
import { releaseVersion, requiredImportContract } from './version.js';

export async function buildApp() {
  const app=Fastify({logger:{level:config.isProduction?'info':'debug'},requestIdHeader:'x-request-id',trustProxy:true});
  await app.register(cookie,{secret:config.COOKIE_SECRET,hook:'onRequest'});
  await app.register(helmet,{contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:'same-site'}});
  await app.register(rateLimit,{max:300,timeWindow:'1 minute'});
  await app.register(multipart,{limits:{fileSize:Math.max(config.MAX_IMAGE_BYTES,20*1024*1024),files:1,fields:20}});
  await mkdir(resolve(config.UPLOAD_ROOT),{recursive:true});
  app.addHook('onSend',async(_request,reply,payload)=>{reply.header('x-content-type-options','nosniff').header('referrer-policy','same-origin');return payload;});
  app.get('/api/v1/health/live',async()=>({status:'live',service:'inventory-api'}));
  app.get('/api/v1/health/ready',async(_request,reply)=>{const database=await ready();if(!database)reply.code(503);return{status:database?'ready':'not-ready',database};});
  app.get('/api/v1/version', async () => {
    const migrations = await pool.query<{ migration_key:string }>('SELECT migration_key FROM schema_migrations ORDER BY applied_at DESC, migration_key DESC');
    const keys = migrations.rows.map((row) => row.migration_key);
    const importCompatible = keys.includes(requiredImportContract);
    return {
      packageVersion: releaseVersion,
      webVersion: releaseVersion,
      apiVersion: releaseVersion,
      schemaVersion: keys[0] ?? 'uninitialized',
      importContractVersion: importCompatible ? requiredImportContract : 'missing',
      compatible: importCompatible,
    };
  });
  app.get('/uploads/*',async(request,reply)=>{const wildcard=(request.params as {'*':string})['*'];const root=resolve(config.UPLOAD_ROOT);const path=resolve(root,wildcard);if(path!==root&&!path.startsWith(root+sep))throw new AppError(404,'FILE_NOT_FOUND','File not found.');reply.header('cache-control','public, max-age=3600').type(path.endsWith('.png')?'image/png':path.endsWith('.webp')?'image/webp':'image/jpeg');return reply.send(createReadStream(path));});
  await registerAuthRoutes(app); await registerSessionRoutes(app); await registerRegistryRoutes(app); await registerAssetRoutes(app);
  await registerImportRoutes(app); await registerReportRoutes(app); await registerActivityRoutes(app); await registerLabelRoutes(app); await registerAdminRoutes(app);
  app.setNotFoundHandler((request)=>{throw new AppError(404,'ROUTE_NOT_FOUND',`Route not found: ${request.method} ${request.url}`);});
  app.setErrorHandler((error,request,reply)=>{const known=error instanceof AppError;const status=known?error.statusCode:500;if(!known)request.log.error(error);reply.code(status).send({code:known?error.code:'INTERNAL_ERROR',message:known?error.message:'An unexpected server error occurred.',details:known?error.details:undefined,requestId:request.id});});
  return app;
}
