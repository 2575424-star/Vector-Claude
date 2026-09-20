import {ensureAccess} from '../src/access.js';
import test from 'node:test';import assert from 'node:assert/strict';import{DatabaseSync}from'node:sqlite';import worker from'../src/worker.js';import{costTotal,daysInStock,validateCar,today}from'../src/domain.js';import{seedCars}from'../src/seed.js';
import{unzipSync,strFromU8}from'fflate';
const sqlite=new DatabaseSync(':memory:');class Statement{constructor(sql){this.sql=sql;this.args=[]}bind(...args){this.args=args;return this}async first(){return sqlite.prepare(this.sql).get(...this.args)||null}async all(){return{results:sqlite.prepare(this.sql).all(...this.args)}}async run(){const r=sqlite.prepare(this.sql).run(...this.args);return{meta:{changes:Number(r.changes)}}}}const db={prepare:s=>new Statement(s),batch:async stmts=>{sqlite.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sqlite.exec('COMMIT');return out}catch(e){sqlite.exec('ROLLBACK');throw e}}};const env={DB:db,ASSETS:{fetch:()=>new Response('html')}};
await ensureAccess(db);await db.prepare("INSERT INTO crm_users(id,name,email,role) VALUES('test-owner','Test Owner','test@example.test','owner')").run();
async function call(path,method='GET',body,headers={}){const request=new Request('https://vector.test/api'+path,{method,headers:{'oai-authenticated-user-id':'test-owner','oai-authenticated-user-email':'test@example.test',...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});const r=await worker.fetch(request,env);return{status:r.status,data:r.headers.get('Content-Type')?.includes('json')?await r.json():await r.arrayBuffer(),headers:r.headers}}
let c;
test('demo VINs and fields satisfy the same validation as real cars',()=>{for(const c of seedCars())assert.deepEqual(validateCar(c),[],c.vin)});
test('complete CRM workflow persists data and rejects conflicts',async()=>{
let r=await call('/cars');assert.equal(r.status,200);assert.equal(r.data.cars.length,6);
const input={brand:'Test',model:'Persistence',vin:'WBA1234567X999999',year:2026,status:'На складе',location:'Москва',stockDate:'2026-09-01',soldDate:'',purchaseDate:'2026-08-01',price:1000000,mileage:0,notes:'Проверка',country:'Германия'};
r=await call('/cars','POST',input);assert.equal(r.status,201,JSON.stringify(r.data));c=r.data;
assert.equal((await call('/cars','POST',input)).status,409);
const stale=c.revision;r=await call('/cars/'+c.id,'PATCH',{...c,location:'Склад 2',notes:'Сохранено'});assert.equal(r.status,200);c=r.data;assert.equal(c.route.at(-1).location,'Склад 2');assert.equal((await call('/cars/'+c.id,'PATCH',{...c,revision:stale,notes:'Lost update'})).status,409);
r=await call('/cars/'+c.id+'/costs','POST',{revision:c.revision,type:'Покупка',description:'Test USD',amount:1000,currency:'USD',rate:90.1234,date:'2026-08-01'});assert.equal(r.status,200);c=r.data;assert.equal(costTotal(c),90123.4);
r=await call('/cars/'+c.id+'/costs/'+c.costs[0].id,'PATCH',{...c.costs[0],revision:c.revision,amount:2000});assert.equal(r.status,200);c=r.data;assert.equal(costTotal(c),180246.8);
r=await call('/cars/'+c.id+'/route','POST',{revision:c.revision,date:today(),location:'Клиент',status:'Продан',note:'Выдан'});assert.equal(r.status,200);c=r.data;assert.equal(c.status,'Продан');assert.equal(daysInStock(c,'2026-12-31'),daysInStock(c));
const fd=new FormData();const data=new Uint8Array(8384001);for(let i=0;i<data.length;i++)data[i]=i%255;fd.set('file',new File([data],'test-document.pdf',{type:'application/pdf'}));fd.set('category','Документ');fd.set('revision',c.revision);r=await call('/cars/'+c.id+'/files','POST',fd);assert.equal(r.status,200,JSON.stringify(r.data));c=r.data;const f=c.files[0];r=await call('/cars/'+c.id+'/files/'+f.id);assert.equal(r.status,200);assert.deepEqual(new Uint8Array(r.data),data);
const again=(await call('/cars/'+c.id)).data;assert.equal(again.files[0].name,'test-document.pdf');assert.equal(again.notes,'Сохранено');assert.ok(again.history.some(h=>h.title==='Добавлен файл'));
r=await call('/cars/'+c.id+'/files/'+f.id,'DELETE',{revision:c.revision});assert.equal(r.status,200);c=r.data;assert.equal((await call('/cars/'+c.id+'/files/'+f.id)).status,404);
r=await call('/cars/'+c.id+'/archive','POST',{revision:c.revision,archived:true});assert.equal(r.status,200);c=r.data;assert.equal(c.archived,true);r=await call('/cars/'+c.id+'/archive','POST',{revision:c.revision,archived:false});c=r.data;assert.equal(c.archived,false);
assert.equal((await call('/cars','POST',input,{Origin:'https://evil.example'})).status,403);
r=await call('/demo','DELETE',{confirm:'delete-demo'});assert.equal(r.status,200);r=await call('/cars');assert.equal(r.data.cars.length,1);assert.equal(r.data.cars[0].id,c.id);
});

test('unknown imported mileage and status are preserved instead of invented',async()=>{
 const input={brand:'Mercedes-Benz',model:'G 450 d',vin:'WBA1234567X999997',year:2024,status:'Не уточнён',location:'',stockDate:'',soldDate:'',purchaseDate:'',price:0,mileage:null};
 const r=await call('/cars','POST',input);assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.mileage,null);assert.equal(r.data.status,'Не уточнён');assert.equal(r.data.purchaseDate,'');
 const again=await call('/cars/'+r.data.id);assert.equal(again.data.mileage,null);assert.equal(again.data.stockDate,'');
});

test('buyer and seller save independently, survive car edits, and reject stale or invalid changes',async()=>{
 const input={brand:'Test',model:'Parties',vin:'WBA1234567X999996',year:2024,status:'Не уточнён',location:'Бишкек',mileage:23000,notes:'Keep source documents',price:0};
 let car=(await call('/cars','POST',input)).data;
 const path='/cars/'+car.id;const oldRevision=car.revision;
 let r=await call(path+'/parties/buyer','PATCH',{revision:car.revision,party:{fullName:'  Тестовый Покупатель  ',passportSeries:'0012',passportNumber:'000456',birthDate:'1990-05-06',passportIssueDate:'2020-06-01',address:'Тестовый адрес',email:'remove@example.com',inn:'123',birthPlace:'Не хранить',citizenship:'Не хранить'}});
 assert.equal(r.status,200,JSON.stringify(r.data));car=r.data;
 assert.equal(car.buyer.fullName,'Тестовый Покупатель');assert.equal(car.buyer.passportSeries,'0012');assert.equal(car.buyer.passportNumber,'000456');assert.equal(car.seller,undefined);
 assert.equal(car.buyer.email,undefined);assert.equal(car.buyer.inn,undefined);assert.equal(car.buyer.birthPlace,undefined);assert.equal(car.buyer.citizenship,undefined);
 assert.equal(car.mileage,23000);assert.equal(car.location,'Бишкек');assert.equal(car.history[0].title,'Добавлен покупатель');
 assert.equal((await call(path+'/parties/seller','PATCH',{revision:oldRevision,party:{fullName:'Устаревшие данные'}})).status,409);
 r=await call(path+'/parties/seller','PATCH',{revision:car.revision,party:{fullName:'Тестовый Продавец',passportNumber:'ID0012345'}});assert.equal(r.status,200);car=r.data;
 r=await call(path,'PATCH',{...car,mileage:24000});assert.equal(r.status,200);car=r.data;assert.equal(car.buyer.fullName,'Тестовый Покупатель');assert.equal(car.seller.passportNumber,'ID0012345');
 const before=car.revision;
 for(const party of [{fullName:' '},{fullName:'Invalid',birthDate:'2020-02-31'},{fullName:'Invalid',birthDate:'2000-01-01',passportIssueDate:'1999-01-01'}])assert.equal((await call(path+'/parties/buyer','PATCH',{revision:before,party})).status,400);
 assert.equal((await call(path+'/parties/owner','PATCH',{revision:before,party:{fullName:'Invalid role'}})).status,400);
 r=await call(path+'/parties/buyer','PATCH',{revision:before,party:car.buyer});assert.equal(r.status,200);assert.equal(r.data.revision,before);
 r=await call(path+'/parties/buyer','PATCH',{revision:before,party:{...car.buyer,phone:'+7 000 000 00 00'}});assert.equal(r.status,200);
 const final=(await call(path)).data;assert.equal(final.buyer.phone,'+7 000 000 00 00');assert.equal(final.seller.fullName,'Тестовый Продавец');assert.equal(final.mileage,24000);assert.equal(final.notes,input.notes);assert.equal(final.history[0].title,'Обновлены данные покупателя');
});

test('contract is generated as an editable Word file, stored with the car, and contains the supplied values',async()=>{
 let car=(await call('/cars','POST',{brand:'BMW',model:'X6',vin:'WBA11EX0XR9W88146',year:2024,status:'Не уточнён',location:'Бишкек',mileage:23000,price:0})).data;const path='/cars/'+car.id;
 const seller={fullName:'КАШКАРЛЫКОВ ТУРАТБЕК БАКЫТОВИЧ',passportNumber:'ID4354460',passportIssuedBy:'COM 218041',passportIssueDate:'2025-02-10',address:'Кыргызская Республика, Чуйская область, с. Беловодское'};
 const buyer={fullName:'ВОРОБЬЕВ ВЛАДИСЛАВ АЛЕКСАНДРОВИЧ',birthDate:'2008-03-15',passportSeries:'2021',passportNumber:'614350',passportIssuedBy:'ГУ МВД РОССИИ ПО ВОРОНЕЖСКОЙ ОБЛАСТИ',passportIssueDate:'2022-03-28',passportCode:'360-008',address:'г. Воронеж, ул. Лихачева, д. 14'};
 car=(await call(path+'/parties/seller','PATCH',{revision:car.revision,party:seller})).data;car=(await call(path+'/parties/buyer','PATCH',{revision:car.revision,party:buyer})).data;
 let r=await call(path+'/contracts','POST',{revision:car.revision,contractNo:'DKP-2026-4689',contractDate:'2026-09-03',priceUsd:100759,priceRub:8050612.34,invoiceNo:'INV-7788',invoiceDate:'2026-08-29'});assert.equal(r.status,200,JSON.stringify(r.data));car=r.data.car;const f=r.data.file;assert.equal(f.category,'Договор');assert.equal(car.files.at(-1).id,f.id);assert.equal(car.history[0].title,'Сгенерирован договор');
 r=await call(path+'/files/'+f.id);assert.equal(r.status,200);assert.equal(r.headers.get('Content-Type'),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');const zip=unzipSync(new Uint8Array(r.data));const xml=strFromU8(zip['word/document.xml']);for(const value of [seller.fullName,buyer.fullName,'WBA11EX0XR9W88146','100 759,00','8 050 612,34','INV-7788','сто тысяч семьсот пятьдесят девять долларов США'])assert.match(xml,new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.equal((await call(path+'/contracts','POST',{revision:car.revision,contractNo:'X',contractDate:'2026-09-03',priceUsd:0,priceRub:1,invoiceNo:'Y',invoiceDate:'2026-08-29'})).status,400);
});

test('seller and passport pages save atomically as documents and reject invalid or stale uploads',async()=>{
 let car=(await call('/cars','POST',{brand:'Test',model:'Passport',vin:'WBA1234567X999995',year:2024,status:'Не уточнён',mileage:23000,location:'Бишкек',price:0})).data;
 const path='/cars/'+car.id;const bytes=new Uint8Array([255,216,255,224,0,16,255,217]);
 const form=(revision,invalid=false)=>{const f=new FormData();f.set('revision',revision);f.set('party',JSON.stringify({fullName:'Тестовый Продавец',passportNumber:'ID0123456'}));f.append('passport',new File([bytes],'page-1.jpg',{type:'image/jpeg'}));f.append('passport',new File([invalid?'not an image':bytes],'page-2.jpg',{type:'image/jpeg'}));return f};
 let r=await call(path+'/parties/seller','PATCH',form(car.revision,true));assert.equal(r.status,400);let fresh=(await call(path)).data;assert.equal(fresh.seller,undefined);assert.equal(fresh.files.length,0);assert.equal(fresh.revision,car.revision);
 const oldRevision=car.revision;r=await call(path+'/parties/seller','PATCH',form(car.revision));assert.equal(r.status,200,JSON.stringify(r.data));car=r.data;assert.equal(car.files.length,2);assert.equal(car.seller.passportNumber,'ID0123456');assert.equal(car.mileage,23000);assert.equal(car.location,'Бишкек');assert.ok(car.files.every(f=>f.category==='Документ'&&f.partyRole==='seller'));
 for(const f of car.files){const downloaded=await call(path+'/files/'+f.id);assert.deepEqual(new Uint8Array(downloaded.data),bytes)}
 assert.equal((await call(path+'/parties/seller','PATCH',form(oldRevision))).status,409);fresh=(await call(path)).data;assert.equal(fresh.files.length,2);assert.equal(fresh.revision,car.revision);assert.equal(fresh.history.filter(h=>h.title==='Добавлен паспорт продавца').length,2);
});

test('website publication explicitly selects only safe photos and fields; stale exports and sold cars are excluded',async()=>{
 env.BOOM_SYNC_SECRET='local-test-secret-no-production-value';
 let car=(await call('/cars','POST',{brand:'Test',model:'Publication',vin:'WBA1234567X999991',year:2025,status:'На складе',stockDate:'2026-09-01',mileage:0,location:'Private location',price:1234567,notes:'PRIVATE NOTES',contact:'PRIVATE CONTACT'})).data;
 const path='/cars/'+car.id;
 car=(await call(path+'/publication','PATCH',{revision:car.revision,enabled:true,description:'Описание',photoIds:[]})).data;
 const upload=async category=>{const fd=new FormData();fd.set('revision',car.revision);fd.set('category',category);fd.set('file',new File([new Uint8Array([255,216,255,224,0,16,255,217])],category==='Фото'?'car.jpg':'passport.jpg',{type:'image/jpeg'}));car=(await call(path+'/files','POST',fd)).data;return car.files.at(-1).id};
 const photo=await upload('Фото'),document=await upload('Документ');
 assert.equal((await call(path+'/publication','PATCH',{revision:car.revision,enabled:true,description:'Описание',photoIds:[document]})).status,400);
 car=(await call(path+'/publication','PATCH',{revision:car.revision,enabled:true,description:'Описание',photoIds:[photo]})).data;
 const snap=await call('/publication/snapshot','POST',{});assert.equal(snap.status,200,JSON.stringify(snap.data));assert.equal(snap.data.payload.cars.length,1);const publicCar=snap.data.payload.cars[0];
 assert.equal(publicCar.photos[0].id,photo);assert.ok(publicCar.photos[0].sha256);assert.equal(publicCar.price,1234567);for(const k of ['notes','contact','vin','seller','buyer','files','costs','location'])assert.equal(publicCar[k],undefined);
 assert.equal((await call('/publication/verify','POST',snap.data)).status,200);
 car=(await call(path,'PATCH',{...car,price:2345678})).data;
 assert.equal(car.publication.enabled,true);assert.equal((await call('/publication/verify','POST',snap.data)).status,409);
 car=(await call(path,'PATCH',{...car,status:'Продан',soldDate:today()})).data;
 assert.equal((await call('/publication/snapshot','POST',{})).data.payload.cars.length,0);
 assert.equal((await call(path+'/publication','PATCH',{revision:car.revision,enabled:true,description:'Описание',photoIds:[photo]})).status,400);
});

test('minimal cards persist independently without VIN, year, price or dates',async()=>{
 let a=await call('/cars','POST',{brand:'Toyota',model:'Camry'});
 let b=await call('/cars','POST',{brand:'Toyota',model:'Camry'});
 assert.equal(a.status,201);assert.equal(b.status,201);a=a.data;b=b.data;assert.notEqual(a.id,b.id);
 for(const car of [a,b]){const saved=(await call('/cars/'+car.id)).data;assert.equal(saved.vin,'');assert.equal(saved.year,null);assert.equal(saved.price,null);assert.equal(saved.purchaseDate,'');}
 a=(await call('/cars/'+a.id,'PATCH',{...a,vin:'WBA1234567X888888'})).data;
 assert.equal((await call('/cars/'+b.id,'PATCH',{...b,vin:a.vin})).status,409);
 assert.equal((await call('/cars/'+b.id)).data.vin,'');
 a=(await call('/cars/'+a.id,'PATCH',{...a,vin:''})).data;
 b=(await call('/cars/'+b.id,'PATCH',{...b,vin:'WBA1234567X888888'})).data;
 assert.equal(b.vin,'WBA1234567X888888');assert.equal(a.year,null);
 for(const status of ['На складе','Забронирован','Продан']){
  const r=await call('/cars/'+a.id,'PATCH',{...a,status});assert.equal(r.status,200);a=r.data;assert.equal(daysInStock(a),null);
 }
 for(const bad of [{brand:''},{model:''},{vin:'123'},{year:1800},{price:-1}]){
  assert.equal((await call('/cars','POST',{brand:'Toyota',model:'Camry',...bad})).status,400);
 }
});

test('KRW and TPO combine with ruble costs and keep missing exchange rates explicit',async()=>{
 let car=(await call('/cars','POST',{brand:'BMW',model:'740d',year:2025,productionMonth:'2025-04',owner:'Паша'})).data;
 const values={krw:115900000,krwPerUsd:1416,tpoUsd:21144};
 let r=await call('/cars/'+car.id+'/cost-basis','PATCH',{revision:car.revision,values});assert.equal(r.status,200);car=r.data;assert.equal(costTotal(car),null);
 r=await call('/cars/'+car.id+'/cost-basis','PATCH',{revision:car.revision,values:{...values,usdRub:90,logisticsRub:200000,documentsRub:10000,recyclingRub:50000}});assert.equal(r.status,200);car=r.data;
 assert.equal(costTotal(car),Math.round(((115900000/1416+21144)*90+260000)*100)/100);
 assert.equal((await call('/cars/'+car.id+'/cost-basis','PATCH',{revision:car.revision-1,values})).status,409);
 assert.equal((await call('/cars/'+car.id+'/cost-basis','PATCH',{revision:car.revision,values:{usdRub:-1}})).status,400);
 const edited=(await call('/cars/'+car.id,'PATCH',{...car,notes:'Keep cost basis'})).data;assert.deepEqual(edited.costBasis,car.costBasis);
});

test('inventory replacement backs up cards and files atomically, rejects stale inventory and does not repeat',async()=>{
 let old=(await call('/cars')).data.cars;
 const fileCar=old[0],fd=new FormData();fd.set('file',new File(['backup-proof'],'proof.txt',{type:'text/plain'}));fd.set('category','Документ');fd.set('revision',fileCar.revision);
 const uploaded=await call('/cars/'+fileCar.id+'/files','POST',fd);assert.equal(uploaded.status,200);const file=uploaded.data.files.at(-1);
 const input={batchId:'test-real-import',confirm:'replace-inventory-with-backup',expected:old.map(({id,revision})=>({id,revision})),cars:[{brand:'BMW',model:'X7',vin:'WBA21EN06S9016582',year:2025,productionMonth:'2025-04',owner:'Женя',costBasis:{krw:138000000,krwPerUsd:1416,tpoUsd:18375}}]};
 assert.equal((await call('/inventory-replace','POST',input)).status,409);
 assert.equal((await call('/cars')).data.cars.length,old.length);
 old=(await call('/cars')).data.cars;input.expected=old.map(({id,revision})=>({id,revision}));
 const result=await call('/inventory-replace','POST',input);assert.equal(result.status,201,JSON.stringify(result.data));
 const cars=(await call('/cars')).data.cars;assert.equal(cars.length,1);assert.equal(cars[0].owner,'Женя');assert.equal(cars[0].costBasis.krw,138000000);
 assert.equal((await call('/inventory-backups/test-real-import')).data.cars.length,old.length);
 const restoredFile=await call('/inventory-backups/test-real-import/files/'+file.id);assert.equal(new TextDecoder().decode(restoredFile.data),'backup-proof');
 assert.equal((await call('/inventory-replace','POST',input)).data.alreadyApplied,true);
 assert.equal((await call('/cars')).data.cars[0].id,cars[0].id);
});

test('delivery stages and document progress persist independently with audit history',async()=>{
 let c=(await call('/cars','POST',{brand:'Toyota',model:'Camry',status:'Выкуплен'})).data;
 const path='/cars/'+c.id;
 for(const status of ['Забронирован','Выкуплен','В пути в Бишкек','В пути в Воронеж','Прибыл']){
  const r=await call(path,'PATCH',{...c,status});assert.equal(r.status,200);c=r.data;assert.equal(c.status,status);assert.equal(c.documentStatus,'Нет');
 }
 const routes=c.route.length;
 for(const value of ['Прошёл лабораторию','ПТС / СБКТС недействующий','ПТС действующий','Нет']){
  const r=await call(path+'/document-status','PATCH',{revision:c.revision,value});assert.equal(r.status,200);c=r.data;assert.equal(c.documentStatus,value);assert.equal(c.status,'Прибыл');assert.equal(c.route.length,routes);assert.equal(c.history[0].title,'Изменён статус документов');
 }
 assert.equal((await call(path+'/document-status','PATCH',{revision:c.revision-1,value:'ПТС действующий'})).status,409);
 assert.equal((await call(path+'/document-status','PATCH',{revision:c.revision,value:'Ошибка'})).status,400);
 c=(await call(path+'/document-status','PATCH',{revision:c.revision,value:'ПТС действующий'})).data;
 c=(await call(path+'/route','POST',{revision:c.revision,date:today(),location:'Воронеж',status:'Прибыл'})).data;
 assert.equal(c.stockDate,today());assert.equal(c.documentStatus,'ПТС действующий');
 const reserved=(await call('/cars','POST',{brand:'BMW',model:'X5'})).data;
 const r=await call('/cars/'+reserved.id+'/route','POST',{revision:reserved.revision,date:today(),location:'Корея',status:'Забронирован'});
 assert.equal(r.status,200);assert.equal(r.data.stockDate,'');
});

test('multiple photos keep revisions and idempotent uploads; videos support byte ranges and remain separate',async()=>{
 let car=(await call('/cars','POST',{brand:'BMW',model:'Media'})).data;const path='/cars/'+car.id;
 const jpeg=new Uint8Array([255,216,255,224,0,0,255,217]);
 async function upload(file,category,id,revision=car.revision){const fd=new FormData();fd.set('file',file);fd.set('category',category);fd.set('revision',revision);if(id)fd.set('uploadId',id);return call(path+'/files','POST',fd)}
 const firstId=crypto.randomUUID(),firstRev=car.revision;
 let r=await upload(new File([jpeg],'one.jpg'),'Фото',firstId);assert.equal(r.status,200);car=r.data;
 r=await upload(new File([jpeg],'one.jpg'),'Фото',firstId,firstRev);assert.equal(r.status,200);assert.equal(r.data.files.length,1);
 r=await upload(new File([jpeg],'two.jpg'),'Фото',crypto.randomUUID());assert.equal(r.status,200);car=r.data;assert.equal(car.files.length,2);
 const bytes=Uint8Array.from({length:400100},(_,i)=>i%251);bytes.set([0,0,0,24,102,116,121,112,105,115,111,109]);
 r=await upload(new File([bytes],'walkaround.mp4'),'Видео',crypto.randomUUID());assert.equal(r.status,200);car=r.data;const video=car.files.at(-1),url=path+'/files/'+video.id;
 assert.equal(video.mime,'video/mp4');assert.equal(car.files.filter(f=>f.category==='Фото').length,2);
 r=await call(url,'GET',undefined,{Range:'bytes=179990-180020'});assert.equal(r.status,206);assert.equal(r.headers.get('Content-Range'),'bytes 179990-180020/400100');assert.deepEqual(new Uint8Array(r.data),bytes.slice(179990,180021));
 r=await call(url,'GET',undefined,{Range:'bytes=-20'});assert.deepEqual(new Uint8Array(r.data),bytes.slice(-20));
 r=await call(url,'HEAD');assert.equal(r.headers.get('Content-Length'),String(bytes.length));assert.equal(r.data.byteLength,0);
 assert.equal((await call(url,'GET',undefined,{Range:'bytes=999999-'})).status,416);
 assert.equal((await upload(new File([bytes],'bad.mp4'),'Фото',crypto.randomUUID())).status,400);
 assert.equal((await upload(new File(['not video'],'fake.mp4'),'Видео',crypto.randomUUID())).status,400);
 r=await call(path+'/files/'+video.id,'DELETE',{revision:car.revision});assert.equal(r.status,200);assert.equal((await call(url)).status,404);
});

test('buyer and seller passport files save before party details, retain roles and survive later edits',async()=>{
 let car=(await call('/cars','POST',{brand:'BMW',model:'Passport test'})).data;
 for(const role of ['buyer','seller']){
  const fd=new FormData();fd.set('revision',car.revision);fd.set('party','{}');fd.set('passportOnly','true');fd.append('passport',new File(['%PDF-1.4\n%%EOF'],'passport.pdf',{type:'application/pdf'}));
  const r=await call('/cars/'+car.id+'/parties/'+role,'PATCH',fd);assert.equal(r.status,200,JSON.stringify(r.data));car=r.data;assert.equal(car[role],undefined);
  const f=car.files.find(f=>f.partyRole===role);assert.equal(f.mime,'application/pdf');assert.equal(f.category,'Документ');assert.equal((await call('/cars/'+car.id+'/files/'+f.id)).status,200);
  car=(await call('/cars/'+car.id+'/parties/'+role,'PATCH',{revision:car.revision,party:{fullName:'Тест '+role}})).data;
 }
 assert.equal(car.files.length,2);assert.equal(car.buyer.fullName,'Тест buyer');assert.equal(car.seller.fullName,'Тест seller');
});
test('payment choices and typed documents persist independently and reject stale edits',async()=>{
 let car=(await call('/cars','POST',{brand:'BMW',model:'Payment'})).data;const path='/cars/'+car.id;
 let r=await call(path+'/payment','PATCH',{revision:car.revision,payment:{payerType:'Оплата от юрлица',method:'Вектор'}});assert.equal(r.status,200);car=r.data;
 assert.equal((await call(path+'/payment','PATCH',{revision:car.revision,payment:{payerType:'Other',method:'Вектор'}})).status,400);
 const fd=new FormData();fd.set('revision',car.revision);fd.set('category','Документ');fd.set('paymentDocument','Платёжное поручение');fd.set('file',new File(['test payment'],'payment.txt',{type:'text/plain'}));
 r=await call(path+'/files','POST',fd);assert.equal(r.status,200);const stale=car.revision;car=r.data;assert.equal(car.files[0].paymentDocument,'Платёжное поручение');assert.equal(car.payment.method,'Вектор');
 assert.equal((await call(path+'/payment','PATCH',{revision:stale,payment:{payerType:'Оплата от физлица',method:'Обменник'}})).status,409);
 car=(await call(path,'PATCH',{...car,notes:'updated'})).data;assert.equal(car.payment.payerType,'Оплата от юрлица');assert.equal(car.files[0].paymentDocument,'Платёжное поручение');
});

test('live public catalogue accepts incomplete ads and never exposes private files',async()=>{
 let car=(await call('/cars','POST',{brand:'BMW',model:'Public test',notes:'PRIVATE'})).data;const path='/cars/'+car.id;
 car=(await call(path+'/publication','PATCH',{revision:car.revision,enabled:true,autoPhotos:true,photoIds:[]})).data;
 const request=async path=>worker.fetch(new Request('https://vector.test'+path),env);
 let r=await request('/api/public/catalog');assert.equal(r.status,200);let shown=(await r.json()).cars.find(c=>c.id===car.id);assert.ok(shown);assert.ok(shown.description.includes('Компания БумАвто'));assert.equal(shown.photos.length,0);for(const key of ['notes','seller','buyer','costs','vin','files','revision'])assert.equal(shown[key],undefined);
 const fd=new FormData();fd.set('revision',car.revision);fd.set('category','Фото');fd.set('file',new File([new Uint8Array([255,216,255,217])],'photo.jpg',{type:'image/jpeg'}));car=(await call(path+'/files','POST',fd)).data;
 shown=(await (await request('/api/public/catalog')).json()).cars.find(c=>c.id===car.id);assert.equal(shown.photos.length,1);assert.equal((await request(new URL(shown.photos[0].url).pathname)).status,200);
 assert.equal((await request('/api/cars')).status,401);assert.equal((await request('/api/public/photos/'+car.id+'/private')).status,404);
 car=(await call(path+'/publication','PATCH',{revision:car.revision,enabled:false,photoIds:[]})).data;
 assert.ok(!(await (await request('/api/public/catalog')).json()).cars.some(c=>c.id===car.id));assert.equal((await request(new URL(shown.photos[0].url).pathname)).status,404);
});

test('public videos require explicit selection and revoke access with publication',async()=>{
 let car=(await call('/cars','POST',{brand:'BMW',model:'Video publication'})).data;const path='/cars/'+car.id;
 const fd=new FormData();fd.set('revision',car.revision);fd.set('category','Видео');fd.set('file',new File([new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0])],'walkaround.mp4',{type:'video/mp4'}));car=(await call(path+'/files','POST',fd)).data;const id=car.files[0].id;
 car=(await call(path+'/publication','PATCH',{revision:car.revision,enabled:true,photoIds:[]})).data;
 const url='https://vector.test/api/public/videos/'+car.id+'/'+id;
 assert.equal((await worker.fetch(new Request(url),env)).status,404);
 assert.equal((await call(path+'/publication','PATCH',{revision:car.revision,enabled:true,videoIds:['private']})).status,400);
 car=(await call(path+'/publication','PATCH',{revision:car.revision,enabled:true,videoIds:[id],photoIds:[]})).data;
 const catalog=await (await worker.fetch(new Request('https://vector.test/api/public/catalog'),env)).json();assert.equal(catalog.cars.find(c=>c.id===car.id).videos.length,1);
 const r=await worker.fetch(new Request(url,{headers:{Range:'bytes=0-9'}}),env);assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,10);
 car=(await call(path+'/publication','PATCH',{revision:car.revision,enabled:false,videoIds:[id],photoIds:[]})).data;
 assert.equal((await worker.fetch(new Request(url),env)).status,404);
});

test('route milestones accept listed stages, sort historical dates and calculate durations',async()=>{
 const {stageTimeline}=await import('../src/route-stages.js');
 let car=(await call('/cars','POST',{brand:'Test',model:'Route milestones',country:'Корея'})).data;
 const path='/cars/'+car.id+'/route';
 for(const [stage,date] of [['arrived_bishkek','2026-09-05'],['purchased','2026-08-01'],['departed_korea','2026-08-10'],['departed_voronezh','2026-09-07']]){
  const r=await call(path,'POST',{revision:car.revision,stage,date});assert.equal(r.status,200,JSON.stringify(r.data));car=r.data;
 }
 assert.equal(car.status,'В пути в Воронеж');assert.equal(car.location,'В пути из Бишкека в Воронеж');
 const timeline=stageTimeline(car.route,'2026-09-10');assert.deepEqual(timeline.map(r=>r.days),[9,26,2,3]);
 assert.equal((await call(path,'POST',{revision:car.revision,stage:'arbitrary',date:'2026-09-08'})).status,400);
 assert.equal((await call(path,'POST',{revision:car.revision,stage:'arrived_voronezh',date:'2099-01-01'})).status,400);
 let r=await call(path,'POST',{revision:car.revision,stage:'arrived_voronezh',date:'2026-09-08'});assert.equal(r.status,200);car=r.data;
 assert.equal(car.status,'Прибыл');assert.equal(car.location,'Воронеж');assert.equal(car.stockDate,'2026-09-08');assert.equal(stageTimeline(car.route).at(-1).finished,true);
 assert.equal(stageTimeline([{stage:'departed_korea',date:'2026-09-01'},{stage:'purchased',date:'2026-09-01'}])[0].days,0);
});
test('route editing recalculates arrival, totals and preserves history with revision protection',async()=>{
 const {routeDurations}=await import('../src/route-stages.js');let car=(await call('/cars','POST',{brand:'Test',model:'Route edits'})).data;const path='/cars/'+car.id+'/route';
 for(const [stage,date] of [['purchased','2026-08-01'],['departed_korea','2026-08-10'],['arrived_bishkek','2026-09-01'],['departed_voronezh','2026-09-03'],['arrived_voronezh','2026-09-08']])car=(await call(path,'POST',{revision:car.revision,stage,date})).data;
 const arrival=car.route.find(r=>r.stage==='arrived_voronezh');const rev=car.revision;let r=await call(path+'/'+arrival.id,'PATCH',{revision:rev,stage:'arrived_voronezh',date:'2026-09-09'});assert.equal(r.status,200);car=r.data;assert.equal(car.stockDate,'2026-09-09');assert.equal(car.route.filter(x=>x.id===arrival.id).length,1);assert.equal(car.history[0].title,'Изменён этап маршрута');assert.ok(car.history[0].detail.includes('2026-09-08'));assert.equal(routeDurations(car.route).total,39);assert.deepEqual(routeDurations(car.route).periods.map(p=>p.days),[9,22,2,6]);assert.equal((await call(path+'/'+arrival.id,'PATCH',{revision:rev,stage:'purchased',date:'2026-09-09'})).status,409);
 assert.equal(routeDurations([]).total,null);assert.equal(routeDurations([{id:'a',stage:'purchased',date:'2026-09-01'}],'2026-09-10').elapsed,9);
 r=await call(path+'/'+arrival.id,'PATCH',{revision:car.revision,stage:'departed_voronezh',date:'2026-09-09'});assert.equal(r.status,200);assert.equal(r.data.status,'В пути в Воронеж');assert.equal(r.data.stockDate,'');assert.equal(routeDurations(r.data.route).total,null);
});
test('delete car requires confirmation, preserves concurrent changes, deletes only its files',async()=>{
 let car=(await call('/cars','POST',{brand:'Test',model:'Delete'})).data;
 const other=(await call('/cars','POST',{brand:'Test',model:'Keep'})).data;
 const fd=new FormData();fd.set('file',new File(['sample'],'note.txt',{type:'text/plain'}));fd.set('category','Документ');fd.set('revision',car.revision);car=(await call('/cars/'+car.id+'/files','POST',fd)).data;
 const path='/cars/'+car.id;assert.equal((await call(path,'DELETE',{revision:car.revision})).status,400);assert.equal((await call(path,'DELETE',{revision:car.revision-1,confirm:'delete-car'})).status,409);
 const fileId=car.files[0].id;assert.ok(await db.prepare('SELECT * FROM file_chunks WHERE file_id=?').bind(fileId).first());assert.equal((await call(path,'DELETE',{revision:car.revision,confirm:'delete-car'})).status,200);assert.equal((await call(path)).status,404);assert.equal(await db.prepare('SELECT * FROM file_chunks WHERE file_id=?').bind(fileId).first(),null);assert.equal((await call('/cars/'+other.id)).status,200);
 const {authorize}=await import('../src/access.js');for(const role of ['viewer','editor'])assert.throws(()=>authorize({role,active:1},new Request('https://crm.test/api'+path,{method:'DELETE'})));
});
test('EPTS and SBKTS files and status persist independently and support preview and deletion',async()=>{
 let car=(await call('/cars','POST',{brand:'Test',model:'EPTS'})).data;
 for(const type of ['EPTS','SBKTS']){const fd=new FormData();fd.set('file',new File(['%PDF-1.4\n test'],type+'.pdf',{type:'application/pdf'}));fd.set('category','Документ');fd.set('vehicleDocument',type);fd.set('revision',car.revision);const r=await call('/cars/'+car.id+'/files','POST',fd);assert.equal(r.status,200);car=r.data;assert.equal(car.files.at(-1).vehicleDocument,type)}
 for(const value of ['Действующий','Недействующий']){const r=await call('/cars/'+car.id+'/epts-status','PATCH',{revision:car.revision,value});assert.equal(r.status,200);car=r.data;assert.equal(car.eptsStatus,value)}
 assert.equal((await call('/cars/'+car.id+'/epts-status','PATCH',{revision:car.revision,value:'invalid'})).status,400);
 const f=car.files.find(f=>f.vehicleDocument==='EPTS');const preview=await call('/cars/'+car.id+'/files/'+f.id+'?preview=1');assert.equal(preview.status,200);assert.ok(preview.headers.get('Content-Disposition').startsWith('inline'));
 const r=await call('/cars/'+car.id+'/files/'+f.id,'DELETE',{revision:car.revision});assert.equal(r.status,200);assert.equal(r.data.files.length,1);assert.equal(r.data.files[0].vehicleDocument,'SBKTS');assert.equal(r.data.eptsStatus,'Недействующий');
});
test('cover selection persists photo order and rejects documents and stale changes',async()=>{
 let car=(await call('/cars','POST',{brand:'Test',model:'Cover'})).data;
 car.files=[{id:'photo-one',category:'Фото',name:'one.jpg'},{id:'photo-two',category:'Фото',name:'two.jpg'},{id:'document-one',category:'Документ',name:'passport.pdf'}];await db.prepare('UPDATE cars SET data=? WHERE id=?').bind(JSON.stringify(car),car.id).run();
 const path='/cars/'+car.id+'/cover';assert.equal((await call(path,'PATCH',{revision:car.revision,fileId:'document-one'})).status,404);const old=car.revision;const r=await call(path,'PATCH',{revision:old,fileId:'photo-two'});assert.equal(r.status,200);assert.equal(r.data.files[0].id,'photo-two');assert.equal(r.data.files.length,3);assert.equal((await call('/cars/'+car.id)).data.files[0].id,'photo-two');assert.equal((await call(path,'PATCH',{revision:old,fileId:'photo-one'})).status,409);
});
test('photo reorder preserves documents and persists adjacent moves',async()=>{
 let car=(await call('/cars','POST',{brand:'Test',model:'Order'})).data;car.files=[{id:'p1',category:'Фото',name:'1.jpg'},{id:'doc',category:'Документ',name:'d.pdf'},{id:'p2',category:'Фото',name:'2.jpg'}];await db.prepare('UPDATE cars SET data=? WHERE id=?').bind(JSON.stringify(car),car.id).run();const path='/cars/'+car.id+'/photo-order';const r=await call(path,'PATCH',{revision:car.revision,fileId:'p2',direction:-1});assert.equal(r.status,200);assert.deepEqual(r.data.files.map(f=>f.id),['p2','doc','p1']);assert.equal((await call('/cars/'+car.id)).data.files[0].id,'p2');assert.equal((await call(path,'PATCH',{revision:r.data.revision,fileId:'doc',direction:1})).status,400);assert.equal((await call(path,'PATCH',{revision:car.revision,fileId:'p1',direction:-1})).status,409);
});

test('utilization payment status and receipt persist independently with preview and deletion',async()=>{
 let car=(await call('/cars','POST',{brand:'Test',model:'Utilization'})).data;
 const path='/cars/'+car.id,old=car.revision;
 let r=await call(path+'/utilization-status','PATCH',{revision:old,value:'Оплачен'});assert.equal(r.status,200);car=r.data;
 assert.equal((await call(path)).data.utilizationStatus,'Оплачен');
 assert.equal((await call(path+'/utilization-status','PATCH',{revision:old,value:'Не оплачен'})).status,409);
 assert.equal((await call(path+'/utilization-status','PATCH',{revision:car.revision,value:'unknown'})).status,400);
 const fd=new FormData();fd.set('revision',car.revision);fd.set('category','Чек');fd.set('vehicleDocument','UTILIZATION_RECEIPT');fd.set('file',new File(['%PDF-1.4\nreceipt'],'receipt.pdf',{type:'application/pdf'}));
 r=await call(path+'/files','POST',fd);assert.equal(r.status,200,JSON.stringify(r.data));car=r.data;const file=car.files.at(-1);assert.equal(file.vehicleDocument,'UTILIZATION_RECEIPT');assert.equal(car.utilizationStatus,'Оплачен');
 const preview=await call(path+'/files/'+file.id+'?preview=1');assert.equal(preview.status,200);assert.match(preview.headers.get('Content-Disposition'),/inline/);
 r=await call(path+'/files/'+file.id,'DELETE',{revision:car.revision});assert.equal(r.status,200);car=r.data;assert.equal(car.files.length,0);assert.equal(car.utilizationStatus,'Оплачен');
 r=await call(path+'/utilization-status','PATCH',{revision:car.revision,value:'Не оплачен'});assert.equal(r.status,200);assert.equal((await call(path)).data.utilizationStatus,'Не оплачен');
});

test('expense settlement persists with individual rates and conflict protection',async()=>{
 let c=(await call('/cars','POST',{brand:'Test',model:'Settlement'})).data;const p='/cars/'+c.id;
 let r=await call(p+'/cost-basis','PATCH',{revision:c.revision,values:{usdRub:90,tpoUsd:1000,expenses:{tpoUsd:{paid:true,usdRub:80}}}});assert.equal(r.status,200);c=r.data;assert.equal(costTotal(c),80000);
 r=await call(p+'/costs','POST',{revision:c.revision,type:'Документы',date:'2026-09-14',amount:100,currency:'USD',rate:null,paid:false});assert.equal(r.status,200,JSON.stringify(r.data));c=r.data;const id=c.costs.at(-1).id;
 const stale=c.revision;r=await call(p+'/costs/'+id,'PATCH',{revision:c.revision,paid:true});assert.equal(r.status,200);c=r.data;assert.equal(c.costs.at(-1).paid,true);assert.equal(c.costs.at(-1).rate,null);assert.equal(costTotal(c),89000);assert.equal((await call(p+'/costs/'+id,'PATCH',{revision:stale,paid:false})).status,409);
 r=await call(p+'/cost-basis','PATCH',{revision:c.revision,values:{...c.costBasis,usdRub:100}});assert.equal(r.status,200);c=r.data;assert.equal(costTotal(c),90000);assert.equal(c.costBasis.expenses.tpoUsd.usdRub,80);
 r=await call(p+'/cost-basis','PATCH',{revision:c.revision,values:{...c.costBasis,expenses:{...c.costBasis.expenses,recyclingRub:{paid:true}}}});assert.equal(r.status,200);c=r.data;assert.equal(c.utilizationStatus,'Оплачен');
 r=await call(p+'/utilization-status','PATCH',{revision:c.revision,value:'Не оплачен'});assert.equal(r.status,200);assert.equal(r.data.costBasis.expenses.recyclingRub.paid,false);
});

test('email password login: owner provisioning, viewer isolation, reset, revocation and throttle',async()=>{
 const pwd='Test-only-long-password-2026';
 let r=await call('/access/passwords','POST',{name:'Password Test',email:' TEST.USER@example.test ',password:pwd,role:'viewer'});assert.equal(r.status,200,JSON.stringify(r.data));const id=r.data.userId;
 const login=async(password=pwd,email='test.user@example.test',extra={})=>call('/login/password','POST',{email,password},{Origin:'https://vector.test','oai-authenticated-user-id':'',...extra});
 r=await login('wrong');assert.equal(r.status,401);r=await login();assert.equal(r.status,200,JSON.stringify(r.data));const cookie=r.headers.get('set-cookie').split(';')[0];assert.match(r.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Lax/);
 let session=await call('/session','GET',undefined,{Cookie:cookie,'oai-authenticated-user-id':''});assert.equal(session.data.role,'viewer');
 r=await call('/cars','POST',{brand:'No',model:'Write'},{Cookie:cookie,Origin:'https://vector.test','oai-authenticated-user-id':''});assert.equal(r.status,403);
 r=await call('/access/passwords','POST',{name:'Intruder',email:'bad@example.test',password:pwd,role:'editor'},{Cookie:cookie,Origin:'https://vector.test','oai-authenticated-user-id':''});assert.equal(r.status,403);
 r=await login(pwd,'test.user@example.test',{Origin:'https://evil.test'});assert.equal(r.status,403);
 let users=(await call('/access/users')).data.users;let u=users.find(u=>u.id===id);assert.equal(u.hasPassword,1);assert.ok(!JSON.stringify(users).includes(pwd));assert.equal(u.password_hash,undefined);
 r=await call('/access/passwords','POST',{userId:id,revision:u.revision,email:u.email,password:pwd+'new'});assert.equal(r.status,200);assert.equal((await login()).status,401);assert.equal((await login(pwd+'new')).status,200);
 assert.equal((await call('/session','GET',undefined,{Cookie:cookie,'oai-authenticated-user-id':''})).status,401);
 r=await call('/access/passwords','POST',{userId:id,revision:u.revision,email:u.email,password:pwd});assert.equal(r.status,409);
 u=(await call('/access/users')).data.users.find(u=>u.id===id);await call('/access/users/'+id,'PATCH',{role:'viewer',active:false,revision:u.revision});assert.equal((await login(pwd+'new')).status,401);
 for(let i=0;i<11;i++)r=await login('wrong','absent@example.test');assert.equal(r.status,429);
 const logs=(await call('/access/users')).data.audit;assert.ok(!JSON.stringify(logs).includes(pwd));
});

test('country purchase currencies, customs, TPO files and contract amount persist',async()=>{
 for(const [country,currency,amount,extra,expected] of [
  ['Китай','CNY',700000,{cnyPerUsd:7},9085000],
  ['Корея','KRW',140000000,{krwPerUsd:1400},9085000],
  ['Бишкек','USD',100000,{},9085000]
 ]){
  let r=await call('/cars','POST',{brand:'Test',model:country,country,customsCountry:'Киргизия',purchaseDate:today(),status:'Выкуплен',costBasis:{purchaseAmount:amount,purchaseCurrency:currency,usdRub:90,documentsRub:85000,...extra}});
  assert.equal(r.status,201,JSON.stringify(r.data));let car=r.data;const path='/cars/'+car.id;assert.equal(costTotal(car),expected);
  car=(await call(path,'PATCH',{...car,owner:'Женя',color:'Графит'})).data;assert.equal(car.costBasis.purchaseCurrency,currency);assert.equal(car.customsCountry,'Киргизия');assert.equal(costTotal(car),expected);
  r=await call(path+'/payment','PATCH',{revision:car.revision,payment:{payerType:'',method:'',contractAmountRub:9900000}});assert.equal(r.status,200);car=r.data;
  car=(await call(path+'/payment','PATCH',{revision:car.revision,payment:{payerType:'Оплата от физлица',method:'Вектор'}})).data;assert.equal(car.payment.contractAmountRub,9900000);
  const fd=new FormData();fd.set('revision',car.revision);fd.set('category','Документ');fd.set('vehicleDocument','TPO');fd.set('file',new File(['%PDF-1.4 test'],'tpo.pdf',{type:'application/pdf'}));
  r=await call(path+'/files','POST',fd);assert.equal(r.status,200,JSON.stringify(r.data));car=r.data;const file=car.files.at(-1);assert.equal(file.vehicleDocument,'TPO');
  r=await call(path+'/files/'+file.id+'?preview=1');assert.equal(r.status,200);assert.match(r.headers.get('Content-Disposition'),/^inline/);
  r=await call(path+'/files/'+file.id,'DELETE',{revision:car.revision});assert.equal(r.status,200);assert.equal(r.data.files.length,0);
 }
 const {basisInput,costSummary,defaultCurrency}=await import('../src/cost-basis.js');
 assert.equal(defaultCurrency('Китай'),'CNY');assert.equal(defaultCurrency('Корея'),'KRW');assert.equal(defaultCurrency('Бишкек'),'USD');
 const b=basisInput({purchaseAmount:700000,purchaseCurrency:'CNY',cnyPerUsd:7,usdRub:90,logisticsUsd:1200,tpoUsd:10000,expenses:{purchaseAmount:{paid:true,usdRub:80},logisticsUsd:{usdRub:85}}});
 const summary=costSummary({costBasis:b});assert.equal(summary.paidRub,8000000);assert.equal(summary.rub,8902000);
 assert.equal(costSummary({costBasis:basisInput({purchaseAmount:100,purchaseCurrency:'CNY',usdRub:90})}).rub,null);
 assert.throws(()=>basisInput({purchaseAmount:1,purchaseCurrency:'INVALID'}));assert.throws(()=>basisInput({purchaseAmount:1,purchaseCurrency:'CNY',cnyPerUsd:0}));
 const legacy={krw:140000000,krwPerUsd:1400,usdRub:90,tpoUsd:10000,documentsRub:85000};assert.equal(costTotal({costBasis:legacy}),9985000);assert.equal(costTotal({costBasis:basisInput(legacy)}),9985000);
});
