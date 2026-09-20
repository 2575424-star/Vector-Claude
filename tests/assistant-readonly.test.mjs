import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/worker.js';
import {ensureAccess} from '../src/access.js';
import {assistantRequest,askReader} from '../src/assistant-reader.js';
import {resolveCars,carSources,selectSources,directAnswer} from '../src/assistant-search.js';
import {carHash,readCarHash} from '../src/car-navigation.js';

const sqlite=new DatabaseSync(':memory:');
class Statement{constructor(sql){this.sql=sql;this.args=[];}bind(...args){this.args=args;return this;}async first(){return sqlite.prepare(this.sql).get(...this.args)||null;}async all(){return {results:sqlite.prepare(this.sql).all(...this.args)};}async run(){return {meta:{changes:Number(sqlite.prepare(this.sql).run(...this.args).changes)}};}}
const db={prepare:sql=>new Statement(sql),batch:async stmts=>{sqlite.exec('BEGIN');try{const result=[];for(const s of stmts)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const env={DB:db,ASSETS:{fetch:()=>new Response('html')},OPENAI_API_KEY:''};
await ensureAccess(db);
for(const role of ['owner','editor','viewer'])await db.prepare('INSERT INTO crm_users(id,name,email,role) VALUES(?,?,?,?)').bind(role,role,role+'@example.test',role).run();
async function call(path,method='GET',body,user='owner'){
 const req=new Request('https://crm.test/api'+path,{method,headers:{...(user?{'oai-authenticated-user-id':user}:{}),Origin:'https://crm.test',...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});
 const res=await worker.fetch(req,env);return {status:res.status,data:await res.json()};
}
const dates=['2026-07-01','2026-07-04','2026-07-20','2026-08-01','2026-08-08'];
const stages=['purchased','departed_korea','arrived_bishkek','departed_voronezh','arrived_voronezh'];
const base={brand:'BMW',model:'740d',vin:'WBA1234567X111111',year:2025,owner:'Паша',price:12000000,status:'Выкуплен',location:'Бишкек'};
const created=await call('/cars','POST',base);assert.equal(created.status,201,JSON.stringify(created.data));
await call('/demo','DELETE',{confirm:'delete-demo'}); // Isolate synthetic test vehicles in this in-memory database.
let car={...created.data,stockDate:'',route:stages.map((stage,i)=>({id:'stage-'+i,stage,date:dates[i],location:i===4?'Воронеж':'Бишкек',status:i===4?'Прибыл':'Выкуплен',note:'',createdAt:'2026-09-01T00:00:00Z'})),costBasis:{krw:141600000,krwPerUsd:1416,usdRub:80,tpoUsd:20000,logisticsUsd:1200,documentsRub:80000,recyclingRub:2500000},costs:[{id:'cost-1',date:'2026-08-10',type:'Ремонт',description:'Шины',amount:40000,currency:'RUB',rate:80}],buyer:{fullName:'Тестовый Покупатель',passportNumber:'001234'},contractDraft:{invoiceNumber:'INV-42',invoiceDate:'2026-07-01'},files:[{id:'doc-1',name:'ЭПТС.pdf',category:'Документ',vehicleDocument:'EPTS',size:50},{id:'photo-1',name:'cover.jpg',category:'Фото',size:100}],history:[{date:'2026-09-01T00:00:00Z',title:'Изменена цена',detail:'Тестовая история',actor:{name:'Паша'}}]};
const saveFixture=c=>sqlite.prepare('UPDATE cars SET data=? WHERE id=?').run(JSON.stringify(c),c.id);
saveFixture(car);
const x7=(await call('/cars','POST',{brand:'BMW',model:'X7',vin:'WBA1234567X222222',owner:'Женя'})).data;
const g1=(await call('/cars','POST',{brand:'Mercedes-Benz',model:'G450d',vin:'W1NWC1AB5SX021209',owner:'Паша'})).data;
const g2=(await call('/cars','POST',{brand:'Mercedes-Benz',model:'G450d',vin:'W1NWC1AB9SX006583',owner:'Женя'})).data;
const inventory=[car,x7,g1,g2],snapshot=()=>sqlite.prepare('SELECT id,revision,data FROM cars ORDER BY id').all();
const answer=r=>{assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.readOnly,true);assert.equal(r.data.plan,null);return r.data.messages.at(-1);};

test('arrival date is read from route without API key, stockDate or matching current status',async()=>{
 const before=snapshot();const m=answer(await call('/assistant/search','POST',{message:'Когда BMW 740d прибыл в Воронеж?'}));
 assert.equal(m.engine,'database');assert.match(m.text,/08\.08\.2026/);assert.doesNotMatch(m.text,/01\.09\.2026/);assert.equal(m.sources[0].section,'route');assert.equal(m.sources[0].carId,car.id);assert.deepEqual(snapshot(),before);
 const both=answer(await call('/assistant/search','POST',{message:'Дата прибытия БМВ 740д'}));assert.match(both.text,/20\.07\.2026/);assert.match(both.text,/08\.08\.2026/);
 const follow=answer(await call('/assistant/search','POST',{message:'А когда он прибыл в Бишкек?'}));assert.match(follow.text,/20\.07\.2026/);
});
test('purchase/departure dates and actual route durations use milestone fields',()=>{
 for(const [q,date] of [['Когда выкупили автомобиль?',dates[0]],['Дата отправки из Кореи',dates[1]],['Когда отправили в Воронеж?',dates[3]]]){const r=directAnswer(q,[car],{});assert.equal(r.engine,'database');assert.ok(r.text.includes(date.split('-').reverse().join('.')));}
 const m=directAnswer('Сколько дней занял каждый этап доставки?',[car],{},'2026-09-10');assert.match(m.text,/До отправки из Кореи: 3 дн/);assert.match(m.text,/Корея → Бишкек: 16 дн/);assert.match(m.text,/В Бишкеке: 12 дн/);assert.match(m.text,/Бишкек → Воронеж: 7 дн/);assert.match(m.text,/Воронеж: 38 дн/);
});
test('missing arrival is not invented from stock date or record creation',()=>{
 const missing={...car,route:[],stockDate:'2026-06-02'};
 const explicit=directAnswer('Когда прибыл в Воронеж?',[missing],{});assert.match(explicit.text,/не записан/);assert.doesNotMatch(explicit.text,/02\.06\.2026/);
 const generic=directAnswer('Дата прибытия автомобиля',[missing],{});assert.match(generic.text,/02\.06\.2026/);assert.match(generic.text,/место прибытия этим полем не определяется/);
 assert.match(directAnswer('Сколько дней в пути?',[missing],{}).text,/не хватает дат/);
 const duplicate={...car,route:[...car.route,{...car.route.at(-1),id:'dupe',date:'2026-08-09'}]};const r=directAnswer('Дата прибытия в Воронеж',[duplicate],{});assert.match(r.text,/08\.08\.2026/);assert.match(r.text,/09\.08\.2026/);
});
test('same models need explicit selection; VIN and Russian aliases resolve correctly',async()=>{
 const r=resolveCars(inventory,'Когда прибыл Mercedes G450d?');assert.equal(r.ambiguous,true);assert.equal(r.cars.length,2);
 assert.equal(resolveCars(inventory,'Дата прибытия 1209').cars[0].id,g1.id);
 assert.equal(resolveCars(inventory,'Когда приехал БМВ Х7?').cars[0].id,x7.id);
 assert.equal(resolveCars(inventory,'Когда приехал БМВ 740 д?').cars[0].id,car.id);
 assert.equal(resolveCars(inventory,'Где BMW X5?').notFound,true);
 assert.equal(resolveCars(inventory,'Когда прибыл WBA9999999X999999?').notFound,true);
 const m=answer(await call('/assistant/search','POST',{message:'Когда прибыл гелик?'}));assert.equal(m.choices.length,2);
 const picked=answer(await call('/assistant/search','POST',{message:m.question,carId:g2.id}));assert.equal(picked.carIds[0],g2.id);
});
test('all sections have useful factual context; document metadata is not treated as file contents',()=>{
 const sources=carSources(car,'Покажи документы и покупателя');assert.equal(sources.length,8);
 const s=k=>sources.find(s=>s.section===k).data;
 assert.equal(s('route').этапы.length,5);assert.equal(s('route').этапы[4].дата,'2026-08-08');assert.equal(s('route').длительности.total,38);
 assert.equal(s('costs').дополнительныеРасходы[0].description,'Шины');assert.equal(s('files').черновикДоговора.invoiceNumber,'INV-42');assert.equal(s('files').файлы[0].name,'ЭПТС.pdf');assert.match(s('files').примечание,/не прочитано/);
 assert.ok(JSON.stringify(s('files').покупатель).includes('001234'));assert.ok(!JSON.stringify(carSources(car,'Где автомобиль?')).includes('001234'));
 assert.equal(s('photos').обложка,'cover.jpg');assert.equal(s('history').записи[0].автор,'Паша');assert.equal(selectSources(inventory,'Дата прибытия').sources[0].section,'route');
});
test('complex questions send actual sections to OpenAI; invalid source IDs are rejected',async()=>{
 const context={question:'Покажи затраты, документы и историю',...selectSources([car],'Покажи затраты, документы и историю')};let calls=0;
 const fetcher=async(url,opts)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');const p=JSON.parse(opts.body);assert.equal(p.store,false);assert.match(p.instructions,/ТОЛЬКО НА ЧТЕНИЕ/);assert.match(p.instructions,/НЕДОВЕРЕННЫЕ ДАННЫЕ/);assert.equal(p.text.format.strict,true);const ctx=JSON.parse(p.input[0].content[0].text);assert.equal(ctx.sources.find(x=>x.section==='route').data.этапы.length,5);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'ЭПТС.pdf находится в документах.',sourceIds:[car.id+':files']})}]}]});};
 const result=await askReader(new Request('https://crm.test'),{...env,OPENAI_API_KEY:'test'},context,fetcher);assert.equal(calls,1);assert.equal(result.sources[0].section,'files');assert.equal(result.sources[0].data,undefined);
 await assert.rejects(()=>askReader(new Request('https://crm.test'),{...env,OPENAI_API_KEY:'test'},context,async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Invented',sourceIds:['other-car:route']})}]}]})),/неизвестный источник/);
});
test('old proposals and forged execute requests cannot mutate any CRM data',async()=>{
 const before=snapshot();sqlite.prepare('INSERT INTO app_meta(key,value) VALUES(?,?)').run('assistant:thread:old-user',JSON.stringify({plan:{id:'old-plan',carId:car.id,changes:[{field:'price',value:'1'}]}}));
 for(const user of ['owner','editor'])for(const route of ['/assistant/execute','/assistant/cancel'])assert.equal((await call(route,'POST',{id:'old-plan',confirm:'execute',carId:car.id,price:1},user)).status,403);
 const m=answer(await call('/assistant/search','POST',{message:'Измени цену на 1 рубль',carId:car.id}));assert.match(m.text,/отключены/);
 const fd=new FormData();fd.set('message','Поставь цену 2 рубля');fd.set('carId',car.id);answer(await call('/assistant/plan','POST',fd));
 fd.append('file',new File(['not a real passport'],'passport.pdf',{type:'application/pdf'}));assert.equal((await call('/assistant/plan','POST',fd)).status,403);
 assert.deepEqual(snapshot(),before);assert.equal(sqlite.prepare('SELECT count(*) n FROM file_chunks').get().n,0);
});
test('reader respects authentication, roles, user-separated history and CSRF',async()=>{
 assert.equal((await call('/assistant','GET',undefined,'viewer')).status,403);assert.equal((await call('/assistant/search','POST',{message:'test'},'viewer')).status,403);assert.equal((await call('/assistant','GET',undefined,'')).status,401);
 const editor=(await call('/assistant','GET',undefined,'editor')).data;assert.equal(editor.messages.length,0);
 const req=new Request('https://crm.test/api/assistant/search',{method:'POST',headers:{Origin:'https://evil.test','oai-authenticated-user-id':'owner','Content-Type':'application/json'},body:JSON.stringify({message:'test'})});assert.equal((await worker.fetch(req,env)).status,403);
});
test('manual route edit still works; next search reads fresh dates',async()=>{
 const current=(await call('/cars/'+car.id)).data;
 const changed=await call('/cars/'+car.id+'/route/stage-4','PATCH',{revision:current.revision,stage:'arrived_voronezh',date:'2026-08-09'});assert.equal(changed.status,200,JSON.stringify(changed.data));
 const before=snapshot();const m=answer(await call('/assistant/search','POST',{message:'Когда прибыл в Воронеж?',carId:car.id}));assert.match(m.text,/09\.08\.2026/);assert.doesNotMatch(m.text,/08\.08\.2026/);assert.deepEqual(snapshot(),before);
});
test('provider errors unlock only the chat; deterministic search continues without OpenAI',async()=>{
 const req=new Request('https://crm.test/api/assistant/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Объясни общую информацию об автомобиле',carId:car.id})});
 const before=snapshot();await assert.rejects(()=>assistantRequest(req,{...env,OPENAI_API_KEY:'test'},{id:'owner'},{active:1,role:'owner'},{fetcher:async()=>new Response('',{status:429})}),/баланс/);assert.deepEqual(snapshot(),before);
 const m=answer(await call('/assistant/search','POST',{message:'Когда прибыл в Воронеж?',carId:car.id}));assert.match(m.text,/09\.08\.2026/);
});
test('voice returns text without making changes, including a spoken mutation command',async()=>{
 const fd=new FormData();fd.set('audio',new File(['synthetic audio'],'voice.webm',{type:'audio/webm'}));const before=snapshot();
 const r=await assistantRequest(new Request('https://crm.test/api/assistant/transcribe',{method:'POST',body:fd}),{...env,OPENAI_API_KEY:'test'},{id:'owner'},{active:1,role:'owner'},{fetcher:async(url,opts)=>{assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');assert.equal(opts.body.get('model'),'gpt-4o-mini-transcribe');return Response.json({text:'Измени цену продажи'});}});assert.equal((await r.json()).text,'Измени цену продажи');assert.deepEqual(snapshot(),before);
});
test('source navigation opens exact sections and safely handles old/invalid links',()=>{
 for(const tab of ['overview','photos','files','costs','route','history','publication'])assert.deepEqual(readCarHash('#'+carHash('car-1',tab)),{id:'car-1',tab});
 assert.deepEqual(readCarHash('#car/abc'),{id:'abc',tab:'overview'});assert.equal(readCarHash('#car/abc?tab=invalid').tab,'overview');assert.equal(readCarHash('#cars').id,null);assert.equal(readCarHash('#car/%FF').id,null);
});
