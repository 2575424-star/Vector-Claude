export async function importCars(req,db,makeCar){
 const b=await req.json();
 if(!Array.isArray(b.cars)||!b.cars.length||b.cars.length>100||JSON.stringify(b).length>600000)throw new Error('Импорт: от 1 до 100 автомобилей');
 const prepared=[];
 for(const row of b.cars){
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(row.importKey||''))throw new Error('Не указан идентификатор строки импорта');
  const c=makeCar(row);c.id='import-'+row.importKey;c.importKey=row.importKey;
  prepared.push(c);
 }
 const statements=prepared.map(c=>db.prepare('INSERT INTO cars(id,vin,revision,data) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(c.id,c.vin||'draft:'+c.id,1,JSON.stringify(c)));
 const results=await db.batch(statements);
 return Response.json({created:results.filter(r=>r.meta.changes).length,skipped:results.filter(r=>!r.meta.changes).length},{headers:{'Cache-Control':'no-store'}});
}
