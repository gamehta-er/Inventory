import bwipjs from 'bwip-js';
import type { FastifyInstance } from 'fastify';
import { pool, withTransaction } from './db.js';
import { AppError } from './errors.js';
import { requirePermission, verifyCsrf } from './auth.js';
import { recordActivity } from './activity.js';
import type { AuthenticatedRequest } from './types.js';

function svg(value:string):string { return bwipjs.toSVG({bcid:'code128',text:value,scale:2,height:10,includetext:false,backgroundcolor:'FFFFFF'}); }

export async function registerLabelRoutes(app:FastifyInstance):Promise<void>{
  app.get('/api/v1/assets/:id/label',{preHandler:requirePermission('label.print')},async(request)=>{
    const id=Number((request.params as {id:string}).id); const result=await pool.query(`SELECT a.id,a.asset_tag,a.serial_number,am.product_name,am.model_number FROM assets a JOIN asset_models am ON am.id=a.asset_model_id WHERE a.id=$1`,[id]);
    if(!result.rows[0])throw new AppError(404,'ASSET_NOT_FOUND','Asset not found.'); const row=result.rows[0]; const barcode=String(row.asset_tag||row.serial_number);
    return {label:{assetId:id,productName:row.product_name,modelNumber:row.model_number,assetTag:row.asset_tag,serialNumber:row.serial_number,barcodeValue:barcode,barcodeSvg:svg(barcode)}};
  });
  app.post('/api/v1/labels/print',{preHandler:requirePermission('label.print')},async(request)=>{
    await verifyCsrf(request); const user=(request as AuthenticatedRequest).inventoryUser; const body=request.body as {assetIds?:number[]}; const ids=[...new Set(body.assetIds??[])].filter((id)=>Number.isInteger(id)&&id>0);
    if(!ids.length||ids.length>200)throw new AppError(422,'ASSETS_REQUIRED','Select between 1 and 200 assets.');
    const rows=await pool.query(`SELECT a.id,a.asset_tag,a.serial_number,am.product_name,am.model_number FROM assets a JOIN asset_models am ON am.id=a.asset_model_id WHERE a.id=ANY($1::bigint[]) ORDER BY a.id`,[ids]);
    if(rows.rowCount!==ids.length)throw new AppError(404,'ASSET_NOT_FOUND','One or more selected assets were not found.');
    await withTransaction(async(client)=>{const parent=await recordActivity(client,{user,actionKey:'LABEL_JOB_CREATED',source:'labels',reason:'Asset labels prepared for browser printing.',recordType:'label-job',recordId:Date.now(),recordLabel:`${ids.length} asset labels`,routePath:'/search',metadata:{assetIds:ids}});for(const row of rows.rows)await recordActivity(client,{user,actionKey:'LABEL_PRINTED',source:'labels',reason:'Asset label prepared for printing.',recordType:'asset',recordId:row.id,recordLabel:row.product_name,routePath:`/assets/${row.id}`,parentEventId:parent});});
    return {labels:rows.rows.map((row)=>{const barcode=String(row.asset_tag||row.serial_number);return{assetId:Number(row.id),productName:row.product_name,modelNumber:row.model_number,assetTag:row.asset_tag,serialNumber:row.serial_number,barcodeValue:barcode,barcodeSvg:svg(barcode)}})};
  });
}
