// Owner-authenticated by Sites. Replacement is explicit, atomic and idempotent.
// File chunks are retained; backup metadata keeps their original associations.
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
export async function inventoryRequest(req,db,makeCar){
 const u=new URL(req.url);
 if(u.pathname==='/api/inventory-replace'&&req.method==='POST'){
  const b=await req.json();
  if(b.confirm!=='replace-inventory-with-backup'||!/^[-a-zA-Z0-9]{8,80}$/.test(b.batchId||'')||!Array.isArray(b.cars)||!b.cars.length||b.cars.length>100||!Array.isArray(b.expected))fail('Проверьте параметры замены');
  const previous=await db.prepare('SELECT value FROM app_meta WHERE key=?').bind('inventory-backup:'+b.batchId).first();
  if(previous)return json({...JSON.parse(previous.value),alreadyApplied:true});
  const next=b.cars.map(makeCar),vins=next.map(c=>c.vin).filter(Boolean);
  if(new Set(vins).size!==vins.length)fail('В таблице повторяется VIN');
  const meta={id:b.batchId,date:new Date().toISOString(),previousCount:b.expected.length,createdCount:next.length};
  const expected=JSON.stringify(b.expected);
  // A NULL guard value violates app_meta.value NOT NULL and rolls back the entire batch
  // if a concurrent add/edit/delete changed the inventory after the caller's read.
  const guard=db.prepare("INSERT INTO app_meta(key,value) SELECT ?, CASE WHEN (SELECT COUNT(*) FROM cars)=? AND (SELECT COUNT(*) FROM cars c JOIN json_each(?) e ON c.id=json_extract(e.value,'$.id') AND c.revision=json_extract(e.value,'$.revision'))=? THEN ? ELSE NULL END").bind('inventory-backup:'+b.batchId,b.expected.length,expected,b.expected.length,JSON.stringify(meta));
  try{await db.batch([guard,db.prepare('INSERT INTO inventory_backup_cars(backup_id,id,data) SELECT ?,id,data FROM cars').bind(b.batchId),db.prepare('DELETE FROM cars'),...next.map(c=>db.prepare('INSERT INTO cars(id,vin,revision,data) VALUES(?,?,?,?)').bind(c.id,c.vin||'draft:'+c.id,1,JSON.stringify(c)))]);}
  catch(e){if(String(e.message).includes('NOT NULL')||String(e.message).includes('app_meta.key'))fail('Склад изменился. Обновите данные перед заменой.',409);throw e}
  return json(meta,201);
 }
 if(u.pathname==='/api/inventory-backups'&&req.method==='GET'){const {results}=await db.prepare("SELECT value FROM app_meta WHERE key LIKE 'inventory-backup:%'").all();return json({backups:results.map(r=>JSON.parse(r.value))});}
 const m=u.pathname.match(/^\/api\/inventory-backups\/([-a-zA-Z0-9]+)(?:\/files\/([-a-zA-Z0-9]+))?$/);
 if(m&&req.method==='GET'){
  const {results}=await db.prepare('SELECT data FROM inventory_backup_cars WHERE backup_id=?').bind(m[1]).all();const cars=results.map(r=>JSON.parse(r.data));
  if(m[2]){
   const f=cars.flatMap(c=>c.files).find(f=>f.id===m[2]);if(!f)fail('Файл резервной копии не найден',404);
   const parts=await db.prepare('SELECT data FROM file_chunks WHERE file_id=? ORDER BY part').bind(f.id).all();
   const raw=atob(parts.results.map(r=>r.data).join(''));const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
   return new Response(bytes,{headers:{'Content-Type':f.mime,'Cache-Control':'private, no-store','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(f.name),'X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
  }
  return json({backupId:m[1],cars:cars.map(c=>({...c,files:c.files.map(f=>({...f,backupDownload:'/api/inventory-backups/'+m[1]+'/files/'+f.id}))}))});
 }
 return null;
}
