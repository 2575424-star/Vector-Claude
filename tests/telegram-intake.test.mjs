import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/worker.js';
import {ensureAccess} from '../src/access.js';
import {sanitizeExtraction,matchCars} from '../src/telegram-intake.js';
const sql=new DatabaseSync(':memory:');
class Statement{constructor(q){this.q=q;this.args=[]}bind(...a){this.args=a;return this}async first(){return sql.prepare(this.q).get(...this.args)||null}async all(){return {results:sql.prepare(this.q).all(...this.args)}}async run(){return {meta:{changes:Number(sql.prepare(this.q).run(...this.args).changes)}}}}
const db={prepare:q=>new Statement(q),batch:async list=>{sql.exec('BEGIN');try{const r=[];for(const s of list)r.push(await s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
const env={DB:db,TELEGRAM_BOT_TOKEN:'123456:abcdefghijklmnopqrstuvwxyz_TEST',ASSETS:{fetch:async()=>new Response('site')}};
await ensureAccess(db);for(const role of ['owner','editor'])await db.prepare('INSERT INTO crm_users(id,name,email,role) VALUES(?,?,?,?)').bind(role,role,role+'@test.invalid',role).run();
async function call(path,method='GET',body,user='owner',extra={}){const r=await worker.fetch(new Request('https://crm.test/api'+path,{method,headers:{'Content-Type':'application/json',...(user?{'oai-authenticated-user-id':user,Origin:'https://crm.test'}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)}),env);return {status:r.status,data:await r.json()}}
const calls=[];let externalWebhook='',nextId=500;
const original=globalThis.fetch;
globalThis.fetch=async(url,o)=>{if(String(url).includes('/file/bot'))return new Response(new Uint8Array([255,216,255,1,2,3]));const m=String(url).split('/').at(-1);const b=o.body instanceof FormData?o.body:JSON.parse(o.body||'{}');calls.push({m,b});if(m==='getFile')return Response.json({ok:true,result:{file_path:'photos/file.jpg',file_size:6}});if(m==='getMe')return Response.json({ok:true,result:{id:123456,username:'test_bot',is_bot:true}});if(m==='getWebhookInfo')return Response.json({ok:true,result:{url:externalWebhook}});if(m==='setWebhook')return Response.json({ok:true,result:true});if(m==='sendMessage')return Response.json({ok:true,result:{message_id:nextId++,chat:{id:b.chat_id}}});if(m==='answerCallbackQuery')return Response.json({ok:true,result:true});throw new Error('Unexpected call '+m)};
test.after(()=>globalThis.fetch=original);
let secret,car,job,linked;
const meta=k=>JSON.parse(sql.prepare('SELECT value FROM app_meta WHERE key=?').get(k).value);
const hook=(data,valid=true)=>call('/telegram/intake/webhook','POST',data,null,valid?{'X-Telegram-Bot-Api-Secret-Token':secret}:{});
test('owner-only setup preserves another webhook, then securely pairs a private chat',async()=>{
 assert.equal((await call('/telegram/intake','GET',undefined,'editor')).status,403);
 externalWebhook='https://other.test/hook';assert.equal((await call('/telegram/intake/connect','POST',{})).status,409);assert.equal(calls.filter(x=>x.m==='setWebhook').length,0);
 externalWebhook='';const r=await call('/telegram/intake/connect','POST',{});assert.equal(r.status,200);assert.ok(r.data.url);secret=meta('tg-in:config').secret;assert.equal((await call('/telegram/intake')).data.paired,false);
 const token=new URL(r.data.url).searchParams.get('start');const data={update_id:1,message:{message_id:1,chat:{id:77,type:'private'},from:{id:77},text:'/start '+token}};
 assert.equal((await hook(data,false)).status,403);assert.equal((await hook(data)).status,200);assert.equal(meta('tg-in:config').telegramId,77);linked=77;
 await hook({...data,update_id:2,message:{...data.message,chat:{id:88,type:'private'},from:{id:88}}});assert.equal(meta('tg-in:config').telegramId,77);
 assert.doesNotMatch(JSON.stringify((await call('/telegram/intake')).data),new RegExp(secret));
});
test('unapproved groups are ignored, only the paired user can enable receipt',async()=>{
 const message={message_id:10,date:100,chat:{id:-10044,title:'Работа',type:'supergroup'},from:{id:88},text:'VIN WBA12345678901234'};
 await hook({update_id:3,message});assert.equal((await call('/telegram/intake')).data.jobs.length,0);
 await hook({update_id:4,message:{...message,text:'/vector_on'}});assert.equal((await call('/telegram/intake')).data.groups.length,0);
 await hook({update_id:5,message:{...message,from:{id:linked},text:'/vector_on'}});assert.equal((await call('/telegram/intake')).data.groups[0].enabled,true);
});
test('received material creates a proposal without modifying the car; duplicate delivery is harmless',async()=>{
 const c=await call('/cars','POST',{brand:'BMW',model:'740d',vin:'WBA12345678901234'});assert.equal(c.status,201);car=c.data;
 const msg={message_id:11,date:101,chat:{id:-10044,title:'Работа',type:'supergroup'},from:{id:88},text:'VIN WBA12345678901234. Цена уточняется.'};
 assert.equal((await hook({update_id:6,message:msg})).status,200);const jobs=(await call('/telegram/intake')).data.jobs;assert.equal(jobs.length,1);job=jobs[0];assert.equal(job.state,'pending');assert.equal(job.carId,car.id);
 assert.equal(JSON.parse(sql.prepare('SELECT data FROM cars WHERE id=?').get(car.id).data).revision,car.revision);
 const count=calls.length;await hook({update_id:6,message:msg});assert.equal(calls.length,count);assert.equal((await call('/telegram/intake')).data.jobs.length,1);
});
test('strangers cannot approve; owner approval writes exactly once',async()=>{
 const cb={id:'cb',from:{id:88},message:{chat:{id:77}},data:'ti:add:'+job.id+':'+job.version};await hook({update_id:7,callback_query:cb});assert.equal(meta('tg-in:job:'+job.id).state,'pending');
 const r=await call('/telegram/intake/'+job.id+'/apply','POST',{version:job.version});assert.equal(r.status,200);assert.equal(r.data.car.revision,car.revision+1);assert.match(r.data.car.notes,/Цена уточняется/);assert.equal(meta('tg-in:job:'+job.id).state,'done');
 const repeat=await call('/telegram/intake/'+job.id+'/apply','POST',{version:job.version});assert.equal(repeat.data.already,true);assert.equal(JSON.parse(sql.prepare('SELECT data FROM cars WHERE id=?').get(car.id).data).revision,car.revision+1);
});
test('revision conflicts and changed source block approval',async()=>{
 const msg={message_id:12,date:102,chat:{id:-10044,title:'Работа',type:'supergroup'},from:{id:88},text:'WBA12345678901234. Прибыл.'};await hook({update_id:8,message:msg});const j=(await call('/telegram/intake')).data.jobs.find(x=>x.state==='pending');
 sql.prepare('UPDATE cars SET data=json_set(data,\'$.revision\',99),revision=99 WHERE id=?').run(car.id);
 assert.equal((await call('/telegram/intake/'+j.id+'/apply','POST',{version:j.version})).status,409);
 const p=await call('/telegram/intake/'+j.id+'/prepare','POST',{carId:car.id,summary:'Проверено',fields:{mileage:12345}});assert.equal(p.status,200);
 sql.prepare("UPDATE app_meta SET value=json_set(value,'$.text','Изменено') WHERE key LIKE ?").run('tg-in:message:'+j.id+':%');
 assert.equal((await call('/telegram/intake/'+j.id+'/apply','POST',{version:p.data.version})).status,409);
 assert.equal(JSON.parse(sql.prepare('SELECT data FROM cars WHERE id=?').get(car.id).data).mileage,null);
});
test('untrusted extraction cannot assign roles or files, guess a partial VIN, or inject nonfinite prices',()=>{
 const e=sanitizeExtraction({vin:'7612',fields:{price:Infinity,mileage:-1,role:'owner',files:[],location:'Бишкек'},categories:{x:'Паспорт'}});assert.equal(e.vin,'');assert.deepEqual(e.fields,{location:'Бишкек'});assert.deepEqual(e.categories,{});
 assert.deepEqual(matchCars([{vin:'WBA12345678901234'}],{vin:'7612'}),[]);
});

test('photo attachment is saved atomically with its category and readable original bytes',async()=>{
 const msg={message_id:13,date:103,chat:{id:-10044,title:'Работа',type:'supergroup'},from:{id:88},caption:'WBA12345678901234',photo:[{file_id:'photo-test',file_unique_id:'unique-photo',file_size:6,width:640,height:480}]};
 await hook({update_id:9,message:msg});const j=(await call('/telegram/intake')).data.jobs.find(x=>x.state==='pending'&&x.attachments?.length===1);
 assert.equal(j.attachments[0].category,'Документ'); // Without AI, no assumption that an image is a car photo.
 const prepared=await call('/telegram/intake/'+j.id+'/prepare','POST',{carId:car.id,fields:{},summary:'Фотография автомобиля проверена',attachments:j.attachments.map(f=>({...f,category:'Фото'}))});assert.equal(prepared.status,200);
 const applied=await call('/telegram/intake/'+j.id+'/apply','POST',{version:prepared.data.version});assert.equal(applied.status,200);const f=applied.data.car.files.find(x=>x.telegramUniqueId==='unique-photo');assert.equal(f.category,'Фото');assert.equal(f.size,6);
 const response=await worker.fetch(new Request('https://crm.test/api/cars/'+car.id+'/files/'+f.id,{headers:{'oai-authenticated-user-id':'owner'}}),env);assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([255,216,255,1,2,3]));
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM file_chunks WHERE file_id LIKE 'pending:%'").get().n,0);
});
