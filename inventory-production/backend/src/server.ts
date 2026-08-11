import { buildApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

const app=await buildApp();
const shutdown=async(signal:string)=>{app.log.info({signal},'Graceful shutdown started');await app.close();await pool.end();process.exit(0);};
process.on('SIGINT',()=>void shutdown('SIGINT')); process.on('SIGTERM',()=>void shutdown('SIGTERM'));
await app.listen({host:config.HOST,port:config.PORT});
