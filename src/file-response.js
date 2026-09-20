export async function fileResponse(req,db,f){
 const query=new URL(req.url).searchParams;const inline=query.get('download')!=='1'&&(['Фото','Видео'].includes(f.category)||(query.get('preview')==='1'&&['image/jpeg','image/png','image/webp','application/pdf'].includes(f.mime)));
 const headers={'Content-Type':f.mime,'Accept-Ranges':'bytes','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Content-Disposition':(inline?'inline':'attachment')+"; filename*=UTF-8''"+encodeURIComponent(f.name)};
 let start=0,end=f.size-1,status=200;
 const range=req.headers.get('Range');
 if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{...headers,'Content-Range':'bytes */'+f.size}});
 if(!m[1]){start=Math.max(0,f.size-Number(m[2]));}else{start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}
 if(start>end||start>=f.size)return new Response(null,{status:416,headers:{...headers,'Content-Range':'bytes */'+f.size}});
 status=206;headers['Content-Range']='bytes '+start+'-'+end+'/'+f.size;}
 headers['Content-Length']=String(end-start+1);
 if(req.method==='HEAD')return new Response(null,{status,headers});
 const chunkSize=180000,first=Math.floor(start/chunkSize),last=Math.floor(end/chunkSize);
 let next=first,rows=[];
 const stream=new ReadableStream({async pull(controller){
  try{
   if(!rows.length){if(next>last){controller.close();return}const batchEnd=Math.min(next+19,last);const {results}=await db.prepare('SELECT part,data FROM file_chunks WHERE file_id=? AND part BETWEEN ? AND ? ORDER BY part').bind(f.id,next,batchEnd).all();if(results.length!==batchEnd-next+1)throw new Error('Файл сохранён не полностью');rows=results;next=batchEnd+1;}
   const row=rows.shift(),raw=atob(row.data),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));controller.enqueue(bytes.subarray(Math.max(0,start-row.part*chunkSize),Math.min(bytes.length,end-row.part*chunkSize+1)));
  }catch(error){controller.error(error)}
 },cancel(){rows=[];next=last+1}});
 return new Response(stream,{status,headers});
}
