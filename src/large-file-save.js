// Keep each D1 RPC well below its serialized-message limit.
// Staged chunks cannot be read through the API until the card is committed.
export async function saveLargeFile(db,car,revision,fileId,bytes,encode,persist){
 const staging='pending:'+Date.now()+':'+crypto.randomUUID();
 await db.prepare("DELETE FROM file_chunks WHERE file_id LIKE 'pending:%' AND file_id<?").bind('pending:'+(Date.now()-86400000)+':').run();
 try{
  for(let start=0;start<bytes.length;start+=180000*20){
   const batch=[];
   for(let offset=start;offset<Math.min(start+180000*20,bytes.length);offset+=180000){batch.push(db.prepare('INSERT INTO file_chunks(file_id,part,data) VALUES(?,?,?)').bind(staging,offset/180000,encode(bytes.subarray(offset,Math.min(offset+180000,bytes.length)))))}
   await db.batch(batch);
  }
  const publish=db.prepare("UPDATE file_chunks SET file_id=? WHERE file_id=? AND EXISTS(SELECT 1 FROM cars WHERE id=? AND revision=? AND json_extract(data,'$.lastWrite')=?)").bind(fileId,staging,car.id,revision+1,car.lastWrite);
  return await persist(db,car,revision,[publish]);
 }finally{await db.prepare('DELETE FROM file_chunks WHERE file_id=?').bind(staging).run()}
}
