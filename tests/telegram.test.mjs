import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/worker.js';
import {ensureAccess} from '../src/access.js';
import {telegramInput,telegramSnapshot,telegramText,TELEGRAM_CHANNEL} from '../src/telegram.js';
import {readCarHash,carHash} from '../src/car-navigation.js';
const sql=new DatabaseSync(':memory:');
class Statement{constructor(q){this.q=q;this.args=[];}bind(...a){this.args=a;return this;}async first(){return sql.prepare(this.q).get(...this.args)||null;}async all(){return {results:sql.prepare(this.q).all(...this.args)};}async run(){return {meta:{changes:Number(sql.prepare(this.q).run(...this.args).changes)}};}}
const db={prepare:q=>new Statement(q),batch:async list=>{sql.exec('BEGIN');try{const r=[];for(const s of list)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const env={DB:db,ASSETS:{fetch:async()=>new Response('site')},TELEGRAM_BOT_TOKEN:'',OPENAI_API_KEY:''};await ensureAccess(db);for(const role of ['owner','editor','viewer'])await db.prepare('INSERT INTO crm_users(id,name,email,role) VALUES(?,?,?,?)').bind(role,role,role+'@example.test',role).run();
async function call(path,method='GET',body,user='owner',origin='https://crm.test'){const r=await worker.fetch(new Request('https://crm.test/api'+path,{method,headers:{Origin:origin,...(user?{'oai-authenticated-user-id':user}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env);return {status:r.status,data:await r.json()};}
const draft=c=>({revision:c.revision,description:'Панорамная крыша.',contact:'@sales_example',photoIds:c.files.filter(f=>f.id.endsWith('car1')||f.id.endsWith('car2')).map(f=>f.id),sold:false});
async function makeCar(){let c=(await call('/cars','POST',{brand:'BMW',model:'X7',year:2025,price:15000000,mileage:23000})).data;const files=[1,2].map(i=>({id:c.id+'-car'+i,category:'Фото',mime:'image/jpeg',size:4,name:'car'+i+'.jpg'}));c={...c,files:[...files,{id:c.id+'-passport',name:'PRIVATE PASSPORT',category:'Фото',partyRole:'buyer',mime:'image/jpeg',size:4}],buyer:{fullName:'PRIVATE PERSON',passportNumber:'987654'},costs:[{description:'PRIVATE COST',amount:100,currency:'RUB',rate:1}]};sql.prepare('UPDATE cars SET data=? WHERE id=?').run(JSON.stringify(c),c.id);for(const f of files)sql.prepare('INSERT INTO file_chunks VALUES(?,0,?)').run(f.id,'AQIDBA==');return c;}
async function save(c,extra={}){const r=await call('/cars/'+c.id+'/telegram','PATCH',{...draft(c),...extra});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
async function preview(c,operation='publish'){const r=await call('/cars/'+c.id+'/telegram/preview','POST',{revision:c.revision,operation});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
const channelId=-1001234567890,token='123456:abcdefghijklmnopqrstuvwxyz_TEST';let failure='',calls=[],permissions=true;
const original=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 assert.ok(String(url).startsWith('https://api.telegram.org/bot'+token+'/'));const method=String(url).split('/').at(-1);calls.push(method);assert.equal(options.redirect,'manual');
 if(method==='getMe')return Response.json({ok:true,result:{id:123456,is_bot:true,username:'boom_test_bot'}});
 if(method==='getChat')return Response.json({ok:true,result:{id:channelId,type:'channel',username:TELEGRAM_CHANNEL,title:'Бум Авто'}});
 if(method==='getChatMember')return Response.json({ok:true,result:{status:'administrator',can_post_messages:permissions}});
 if(failure===method+'-unknown')throw new Error('Sensitive network failure '+token);
 if(failure===method+'-400')return Response.json({ok:false,error_code:400,description:'Bad request'}, {status:400});
 if(['sendMediaGroup','sendPhoto'].includes(method)){assert.ok(options.body instanceof FormData);assert.equal(options.body.get('chat_id'),String(channelId));const files=[...options.body].filter(([k,v])=>v instanceof Blob);assert.equal(files.length,method==='sendPhoto'?1:2);for(const [,f] of files)assert.deepEqual(new Uint8Array(await f.arrayBuffer()),new Uint8Array([1,2,3,4]));const rows=files.map((_,i)=>({message_id:100+i,chat:{id:channelId}}));return Response.json({ok:true,result:method==='sendPhoto'?rows[0]:rows});}
 const b=JSON.parse(options.body);assert.equal(b.chat_id,channelId);assert.doesNotMatch(b.text,/PRIVATE|987654|passport|tokenHash/);assert.equal(b.parse_mode,undefined);
 if(method==='sendMessage')return Response.json({ok:true,result:{message_id:110,chat:{id:channelId}}});
 if(method==='editMessageText'){assert.equal(b.message_id,110);return Response.json({ok:true,result:{message_id:110,chat:{id:channelId}}});}
 throw new Error('Unexpected outbound call '+method);
};
test.after(()=>{globalThis.fetch=original;});
let car;
test('Telegram saves private drafts without credentials; cannot select passport or foreign files',async()=>{
 car=await makeCar();const before=calls.length;car=await save(car);assert.equal(calls.length,before);assert.equal(car.price,15000000);assert.equal(car.buyer.passportNumber,'987654');assert.throws(()=>telegramInput(car,{...draft(car),photoIds:[car.id+'-passport']}),/фотографий/);assert.throws(()=>telegramInput(car,{...draft(car),photoIds:['foreign']}),/фотографий/);
 const p=await preview(car);assert.doesNotMatch(JSON.stringify(p),/987654|PRIVATE|passport/);assert.match(p.snapshot.text,/15 000 000 ₽/);assert.equal((await call('/cars/'+car.id+'/telegram/publish','POST',{revision:car.revision,previewId:p.id,confirm:'publish'})).status,503);assert.equal(calls.length,before);
});
test('connection verifies the exact channel and posting permission without sending messages or exposing secrets',async()=>{
 env.TELEGRAM_BOT_TOKEN=token;permissions=false;assert.equal((await call('/telegram/check','POST',{})).status,403);permissions=true;const r=await call('/telegram/check','POST',{});assert.equal(r.status,200);assert.equal(r.data.connected,true);assert.doesNotMatch(JSON.stringify(r.data),new RegExp(token));assert.equal(calls.some(m=>m.startsWith('send')),false);
});
test('reviewed publication sends only selected photos and text once, even under concurrent clicks',async()=>{
 const p=await preview(car),b={revision:car.revision,previewId:p.id,confirm:'publish'};const before=calls.filter(x=>x==='sendMediaGroup').length;
 const r=await Promise.all([call('/cars/'+car.id+'/telegram/publish','POST',b),call('/cars/'+car.id+'/telegram/publish','POST',b)]);assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);const ok=r.find(x=>x.status===200).data;assert.equal(ok.post.state,'published');assert.equal(ok.post.textUrl,'https://t.me/boom_avto_vrn/110');assert.equal(calls.filter(x=>x==='sendMediaGroup').length,before+1);assert.equal(calls.filter(x=>x==='sendMessage').length,1);car=ok.car;assert.equal(car.history[0].title,'Опубликовано в Telegram');
 assert.equal((await call('/cars/'+car.id+'/telegram/preview','POST',{revision:car.revision})).status,409);
});
test('manual price and sold edits update the same message after preview, even if original photos are deleted',async()=>{
 const r=await call('/cars/'+car.id,'PATCH',{...car,price:14500000,revision:car.revision});assert.equal(r.status,200);car=r.data;
 car.files=car.files.filter(f=>f.partyRole);sql.prepare('UPDATE cars SET data=? WHERE id=?').run(JSON.stringify(car),car.id);
 const result=await call('/cars/'+car.id+'/telegram','PATCH',{...car.telegram,revision:car.revision,sold:true});assert.equal(result.status,200,JSON.stringify(result.data));car=result.data;
 const before=calls.filter(x=>x.startsWith('send')).length,p=await preview(car,'update');assert.match(p.snapshot.text,/ПРОДАНО/);const updated=await call('/cars/'+car.id+'/telegram/update','POST',{revision:car.revision,previewId:p.id,confirm:'update'});assert.equal(updated.data.post.state,'published');assert.equal(updated.data.post.sold,true);assert.equal(calls.filter(x=>x.startsWith('send')).length,before);assert.equal(calls.filter(x=>x==='editMessageText').length,1);
});
test('stale previews, editor publication, viewer writes, anonymous reads and cross-site requests are denied',async()=>{
 let c=await save(await makeCar()),p=await preview(c);c=await save(c,{description:'Новое описание'});assert.equal((await call('/cars/'+c.id+'/telegram/publish','POST',{revision:c.revision,previewId:p.id,confirm:'publish'})).status,409);
 assert.equal((await call('/cars/'+c.id+'/telegram/preview','POST',{revision:c.revision},'editor')).status,403);assert.equal((await call('/cars/'+c.id+'/telegram','PATCH',draft(c),'viewer')).status,403);assert.equal((await call('/telegram/config','GET',undefined,'')).status,401);assert.equal((await call('/cars/'+c.id+'/telegram','PATCH',draft(c),'owner','https://evil.test')).status,403);assert.equal((await call('/assistant/execute','POST',{})).status,403);assert.deepEqual(readCarHash('#'+carHash(c.id,'telegram')),{id:c.id,tab:'telegram'});
});
test('uncertain delivery is persisted and blocks duplicate sends; partial delivery records album links',async()=>{
 let c=await save(await makeCar()),p=await preview(c);failure='sendMediaGroup-unknown';const r=await call('/cars/'+c.id+'/telegram/publish','POST',{revision:c.revision,previewId:p.id,confirm:'publish'});assert.equal(r.data.post.state,'unknown');assert.doesNotMatch(JSON.stringify(r.data),new RegExp(token));const count=calls.filter(x=>x==='sendMediaGroup').length;assert.equal((await call('/cars/'+c.id+'/telegram/publish','POST',{revision:c.revision,previewId:p.id,confirm:'publish'})).status,409);assert.equal(calls.filter(x=>x==='sendMediaGroup').length,count);
 c=await save(await makeCar());p=await preview(c);failure='sendMessage-400';const partial=await call('/cars/'+c.id+'/telegram/publish','POST',{revision:c.revision,previewId:p.id,confirm:'publish'});assert.equal(partial.data.post.state,'partial');assert.ok(partial.data.post.url.endsWith('/100'));assert.equal((await call('/cars/'+c.id+'/telegram/status')).data.post.state,'partial');failure='';
});
test('definite photo rejection leaves a retryable draft and supports the single-photo path',async()=>{
 let c=await makeCar();c=await save(c,{photoIds:[c.files[0].id]});let p=await preview(c);failure='sendPhoto-400';const r=await call('/cars/'+c.id+'/telegram/publish','POST',{revision:c.revision,previewId:p.id,confirm:'publish'});assert.equal(r.data.post.state,'failed');assert.deepEqual(r.data.post.sentPhotos,[]);failure='';p=await preview(c);const retry=await call('/cars/'+c.id+'/telegram/publish','POST',{revision:c.revision,previewId:p.id,confirm:'publish'});assert.equal(retry.data.post.state,'published');
 assert.throws(()=>telegramSnapshot({...c,isDemo:true}),/Тестовые/);assert.throws(()=>telegramSnapshot({...c,status:'Продан'}),/Проданный/);assert.throws(()=>telegramSnapshot({...c,telegram:{...c.telegram,description:'Я'.repeat(4096)}}),/3000/);
});
