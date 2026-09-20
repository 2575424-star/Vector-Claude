import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {unzipSync,strFromU8} from 'fflate';
import worker from '../src/worker.js';
import {ensureAccess} from '../src/access.js';
import {avitoInput,avitoCheck,avitoFields,avitoRow,AVITO_TEMPLATE} from '../src/avito.js';
import {adFacts,avitoAI,marketResult} from '../src/avito-ai.js';
import {makeAvitoWorkbook,buildAvitoBundle} from '../src/avito-export.js';
import {readCarHash,carHash} from '../src/car-navigation.js';

const sql=new DatabaseSync(':memory:');
class Statement{constructor(query){this.query=query;this.args=[];}bind(...args){this.args=args;return this;}async first(){return sql.prepare(this.query).get(...this.args)||null;}async all(){return {results:sql.prepare(this.query).all(...this.args)};}async run(){return {meta:{changes:Number(sql.prepare(this.query).run(...this.args).changes)}};}}
const db={prepare:s=>new Statement(s),batch:async list=>{sql.exec('BEGIN');try{const results=[];for(const stmt of list)results.push(await stmt.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const env={DB:db,ASSETS:{fetch:async()=>new Response('site')},OPENAI_API_KEY:''};await ensureAccess(db);for(const role of ['owner','editor','viewer'])await db.prepare('INSERT INTO crm_users(id,name,email,role) VALUES(?,?,?,?)').bind(role,role,role+'@example.test',role).run();
async function call(path,method='GET',body,user='owner',origin='https://crm.test'){const res=await worker.fetch(new Request('https://crm.test/api'+path,{method,headers:{Origin:origin,...(user?{'oai-authenticated-user-id':user}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env);return {status:res.status,data:await res.json()};}
let c=(await call('/cars','POST',{brand:'BMW',model:'740d'})).data;
const photo={id:'photo-1',name:'car.jpg',category:'Фото',mime:'image/jpeg',size:4};
const secret={id:'passport',name:'passport.jpg',category:'Фото',partyRole:'buyer',mime:'image/jpeg',size:100};
c={...c,vin:'WBA1234567X111111',year:2025,mileage:23000,price:12000000,color:'Чёрный',files:[photo,secret,{id:'doc',name:'contract.pdf',category:'Договор',mime:'application/pdf',size:10}],buyer:{fullName:'PRIVATE PERSON',passportNumber:'987654'},costs:[{description:'PRIVATE COST',amount:100,currency:'RUB',rate:1}]};sql.prepare('UPDATE cars SET data=? WHERE id=?').run(JSON.stringify(c),c.id);
function draft(car=c){return {state:'preparing',title:'BMW 740d',selected:true,catalogConfirmed:true,photoIds:[photo.id],listingUrl:'',fields:{...avitoFields(car),Address:'Воронеж, тестовый адрес',Description:'Сохранённые характеристики автомобиля.',Accident:'Не битый',Owners:'1',GenerationId:'test-generation',ModificationId:'test-modification',FuelType:'Дизель',Transmission:'Автомат',Doors:4,BodyType:'Седан',DriveType:'Полный',WheelType:'Левый'}};}
const snapshot=()=>sql.prepare('SELECT * FROM cars WHERE id=?').get(c.id);

test('minimal cards and incomplete Avito drafts save; only preparation requires full fields',async()=>{
 assert.equal((await call('/cars','POST',{brand:'Test',model:'Minimal'})).status,201);
 const result=await call('/cars/'+c.id+'/avito','PATCH',{revision:c.revision,state:'draft',fields:{Description:''},photoIds:[],selected:false});assert.equal(result.status,200,JSON.stringify(result.data));c=result.data;assert.equal(c.buyer.passportNumber,'987654');assert.equal(c.files.length,3);assert.equal(c.avito.state,'draft');assert.equal(avitoCheck(c).ready,false);
 assert.equal((await call('/avito/prepare','POST',{cars:[{id:c.id,revision:c.revision}]})).status,400);
});
test('Avito fields persist with revision guard; linked price changes in main card without exposing data',async()=>{
 const input=draft();input.fields.Price=13500000;const old=c.revision;const result=await call('/cars/'+c.id+'/avito','PATCH',{...input,revision:c.revision});assert.equal(result.status,200,JSON.stringify(result.data));c=result.data;assert.equal(c.price,13500000);assert.equal(c.avito.fields.Price,undefined);assert.equal(c.avito.fields.GenerationId,'test-generation');assert.equal(c.publication,undefined);assert.equal(c.history[0].title,'Обновлена подготовка Авито');assert.equal(c.buyer.fullName,'PRIVATE PERSON');
 assert.equal((await call('/cars/'+c.id+'/avito','PATCH',{...input,revision:old})).status,409);
 const reload=(await call('/cars/'+c.id)).data;assert.equal(avitoFields(reload).Price,13500000);assert.equal(avitoCheck(reload).ready,true,JSON.stringify(avitoCheck(reload).errors));
 assert.equal(avitoRow({...reload,price:13600000}).row.Price,13600000);
});
test('prepare exports whitelisted fields and selected photo names, never private documents',async()=>{
 const before=snapshot(),r=await call('/avito/prepare','POST',{cars:[{id:c.id,revision:c.revision}]});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.publishes,false);const row=r.data.cars[0];assert.equal(row.row.Id,c.id);assert.equal(row.row.Price,13500000);assert.equal(row.images.length,1);assert.equal(row.images[0].id,photo.id);assert.ok(row.row.ImageNames.endsWith('_01.jpg'));assert.equal(row.row.ImageUrls,undefined);assert.equal(row.row.Title,undefined);assert.doesNotMatch(JSON.stringify(r.data),/987654|PRIVATE PERSON|PRIVATE COST|passport|contract\.pdf/);assert.deepEqual(snapshot(),before);
 assert.equal((await call('/avito/verify','POST',{cars:[{id:c.id,revision:c.revision-1}]})).status,409);
});
test('required template fields, non-guessed catalog, enum and image safeguards reject bad exports',()=>{
 const d=draft();assert.throws(()=>avitoInput(c,{...d,photoIds:['passport']}),/фотографии/);assert.throws(()=>avitoInput(c,{...d,photoIds:['foreign-photo']}),/фотографии/);assert.equal(avitoCheck(c,{...d,catalogConfirmed:false}).ready,false);assert.equal(avitoCheck(c,{...d,fields:{...d.fields,GenerationId:''}}).ready,false);assert.equal(avitoCheck(c,{...d,fields:{...d.fields,Accident:'Unknown'}}).ready,false);
 assert.equal(avitoCheck({...c,soldDate:'2026-09-01'}).ready,false);assert.throws(()=>avitoInput(c,{...d,state:'published'}),/реального объявления/);assert.throws(()=>avitoInput(c,{...d,listingUrl:'https://evil.test/a'}),/Авито/);
 const required=AVITO_TEMPLATE.fields.filter(f=>f.required).map(f=>f.key);assert.ok(required.includes('GenerationId'));assert.ok(required.includes('ModificationId'));assert.ok(!required.includes('ContactPhone'));
 assert.ok(avitoCheck(c,{...d,fields:{...d.fields,DateBegin:'2026-02-31'}}).errors.some(e=>e.field==='DateBegin'));
});
test('Excel export preserves instruction sheet, original header rows and dictionaries; text stays text',()=>{
 const source=new Uint8Array(readFileSync(new URL('../public/templates/avito-used-cars-2026-09-10.xlsx',import.meta.url)));const row=avitoRow(c).row;row.Description='=HYPERLINK("https://evil.test") <&>';const out=makeAvitoWorkbook(source,[row,{...row,Id:'second-car'}]);const before=unzipSync(source),after=unzipSync(out),sheet='xl/worksheets/sheet2.xml';assert.deepEqual(Object.keys(after).sort(),Object.keys(before).sort());for(const key of Object.keys(before))if(key!==sheet)assert.deepEqual(after[key],before[key],key);
 const a=strFromU8(before[sheet]),b=strFromU8(after[sheet]);for(let i=1;i<=4;i++){const re=new RegExp('<row\\b[^>]*\\br="'+i+'"[\\s\\S]*?</row>');assert.equal(b.match(re)?.[0],a.match(re)?.[0]);}assert.match(b,/r="O5" t="n"><v>13500000/);assert.match(b,/inlineStr/);assert.match(b,/&lt;&amp;&gt;/);assert.doesNotMatch(b,/<f>/);assert.match(b,/<row r="6">/);assert.ok(out.length>source.length);
});
test('download bundle matches ImageNames and verifies current revisions before providing files',async()=>{
 const original=globalThis.fetch,source=readFileSync(new URL('../public/templates/avito-used-cars-2026-09-10.xlsx',import.meta.url)),row=avitoRow(c),bytes=new Uint8Array([1,2,3,4]),seen=[];let verified=false;
 globalThis.fetch=async url=>{seen.push(url);if(url==='/templates/test.xlsx')return new Response(source);assert.equal(url,row.images[0].url);return new Response(bytes);};
 try{const prepared={template:'/templates/test.xlsx',cars:[row]},result=await buildAvitoBundle(prepared,async()=>{verified=true;});assert.equal(verified,true);assert.equal(result.count,1);const archive=unzipSync(new Uint8Array(await result.photos.arrayBuffer()));assert.deepEqual(Object.keys(archive),[row.row.ImageNames]);assert.deepEqual(archive[row.row.ImageNames],bytes);assert.ok(result.xlsx.size>0);assert.equal(seen.length,2);await assert.rejects(buildAvitoBundle(prepared,async()=>{throw new Error('stale revision');}),/stale revision/);}finally{globalThis.fetch=original;}
});
test('AI generation is a reviewed proposal only and never sends private fields',async()=>{
 const before=snapshot(),d=draft(),facts=adFacts(c,d);assert.doesNotMatch(JSON.stringify(facts),/VIN|passport|987654|PRIVATE|Price|Address|ContactPhone/);
 const r=await avitoAI({...env,OPENAI_API_KEY:'test-only'}, {id:'editor'},c,d,'text',async(url,opts)=>{assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(opts.body);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.doesNotMatch(body.input,/987654|PRIVATE|WBA/);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({title:'BMW 740d 2025',description:'Дизельный седан, пробег 23 000 км.',advantages:['Полный привод']})}]}]});});assert.equal(r.needsReview,true);assert.deepEqual(snapshot(),before);
 assert.equal((await call('/cars/'+c.id+'/avito/generate','POST',{...d,revision:c.revision})).status,503);
});
test('market estimate requires grounded distinct sources and at least three comparable full cash prices',()=>{
 const facts={Make:'BMW',Model:'740d',Year:2025,Kilometrage:23000,FuelType:'Дизель',Transmission:'Автомат'};
 const offers=[1,2,3,4].map(i=>({url:'https://auto.ru/cars/used/sale/bmw/7er/'+i+'-test/',title:'BMW 740d '+i,make:'BMW',model:'740d',year:2025,priceRub:10000000+i*1000000,mileage:23000,fuel:'Дизель',transmission:'Автомат',onOrder:false,priceKind:'cash_full_rub'}));
 const response={output:[{type:'web_search_call',action:{sources:offers.slice(0,3).map(o=>({url:o.url}))}}]};let r=marketResult(response,{offers},facts,14000000);assert.equal(r.offers.length,3);assert.equal(r.average,12000000);assert.equal(r.median,12000000);
 r=marketResult(response,{offers:[offers[0],offers[0],{...offers[1],priceKind:'other'},{...offers[2],model:'X7'}]},facts,14000000);assert.equal(r.average,null);assert.equal(r.offers.length,1);assert.match(r.recommendation,/минимум три/);
});
test('Avito respects roles, cross-site checks, and the global assistant remains read-only',async()=>{
 assert.equal((await call('/cars/'+c.id+'/avito','GET',undefined,'viewer')).status,200);assert.equal((await call('/cars/'+c.id+'/avito','PATCH',{...draft(),revision:c.revision},'viewer')).status,403);assert.equal((await call('/avito/prepare','POST',{cars:[{id:c.id,revision:c.revision}]},'viewer')).status,403);assert.equal((await call('/avito/config','GET',undefined,'')).status,401);
 assert.equal((await call('/cars/'+c.id+'/avito','PATCH',{...draft(),revision:c.revision},'editor','https://evil.test')).status,403);assert.equal((await call('/assistant/execute','POST',{id:'old-plan',confirm:'execute'})).status,403);assert.deepEqual(readCarHash('#'+carHash(c.id,'avito')),{id:c.id,tab:'avito'});
});
