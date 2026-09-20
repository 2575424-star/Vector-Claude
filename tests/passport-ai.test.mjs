import {ensureAccess} from '../src/access.js';
import {makeDb} from './db.mjs';
const db=makeDb();await ensureAccess(db);await db.prepare("INSERT INTO crm_users(id,name,email,role) VALUES('test-owner','Test Owner','test@example.test','owner')").run();
const authHeaders={'oai-authenticated-user-id':'test-owner'};
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {recognizePassportAI,sanitizePassportResult,passportSchema} from '../src/passport-ai-server.js';
import {mergePassportFields} from '../src/passport.js';

const blank=()=>Object.fromEntries(passportSchema.properties.fields.required.map(k=>[k,null]));
const result=(fields={},extra={})=>({documentType:'passport_ru',multiplePeople:false,fields:{...blank(),...fields},uncertainFields:[],...extra});
function request({bytes=new Uint8Array([255,216,255,224,1,2,3]),type='image/jpeg',origin}={}){
 const fd=new FormData();fd.append('passport',new File([bytes],'document.jpg',{type}));fd.set('rotations','[90]');
 return new Request('https://vector.test/api/passport/recognize',{method:'POST',body:fd,headers:{...authHeaders,...(origin?{Origin:origin}:{})}});
}
const apiResult=data=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(data)}]}]});

test('missing connection is explicit, config never exposes a key, and foreign origins cannot submit',async()=>{
 const disabled=await worker.fetch(new Request('https://vector.test/api/passport/config',{headers:authHeaders}),{DB:db});
 assert.deepEqual(await disabled.json(),{enabled:false,provider:'OpenAI'});
 const enabled=await worker.fetch(new Request('https://vector.test/api/passport/config',{headers:authHeaders}),{DB:db,OPENAI_API_KEY:'test-secret'});
 assert.deepEqual(await enabled.json(),{enabled:true,provider:'OpenAI'});
 const missing=await worker.fetch(request(),{DB:db});assert.equal(missing.status,503);assert.match((await missing.json()).error,/не подключено/);
 assert.equal((await worker.fetch(request({origin:'https://other.test'}),{})).status,403);
});

test('vision request preserves original image, uses structured output, and fills only reviewed blanks',async()=>{
 let calls=0;
 const output=await recognizePassportAI(request(),{OPENAI_API_KEY:'test-secret'},async(url,options)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,'Bearer test-secret');
  const b=JSON.parse(options.body);assert.equal(b.store,false);assert.equal(b.text.format.strict,true);
  const image=b.input[0].content.find(x=>x.type==='input_image');assert.equal(image.detail,'original');assert.ok(image.image_url.startsWith('data:image/jpeg;base64,'));
  assert.ok(b.input[0].content.some(x=>x.text?.includes('90 градусов')));
  return apiResult(result({fullName:'ТЕСТОВ ИВАН ПЕТРОВИЧ',passportSeries:'0102',passportNumber:'000123',birthDate:'1985-04-12'}));
 });
 assert.equal(calls,1);assert.equal(output.fields.passportNumber,'000123');assert.equal(output.fields.address,undefined);
 const merged=mergePassportFields({fullName:'ДРУГОЙ ЧЕЛОВЕК',phone:'123'},output.fields);
 assert.equal(merged.values.fullName,'ДРУГОЙ ЧЕЛОВЕК');assert.equal(merged.conflicts.fullName,'ТЕСТОВ ИВАН ПЕТРОВИЧ');assert.equal(merged.values.phone,'123');
});

test('uncertain fields, impossible dates, malformed numbers and mixed identities do not populate',()=>{
 const r=sanitizePassportResult(result({fullName:'НЕЯСНОЕ ИМЯ',passportNumber:'12345?',birthDate:'1985-02-31',passportIssueDate:'2099-01-01'},{uncertainFields:['fullName']}));
 assert.deepEqual(r.fields,{});assert.ok(r.warnings.length>=4);
 assert.deepEqual(sanitizePassportResult(result({fullName:'ТЕСТОВ ИВАН'},{multiplePeople:true})).fields,{});
 assert.deepEqual(sanitizePassportResult(result({fullName:'ТЕСТОВ ИВАН'},{documentType:'unknown'})).fields,{});
 assert.deepEqual(sanitizePassportResult(result({birthDate:'2000-01-01',passportIssueDate:'1999-01-01'})).fields,{});
});

test('mixed-case browser multipart boundaries survive bounded upload parsing',async()=>{
 const boundary='----WebKitFormBoundaryAbC123XyZ';
 const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="passport"; filename="passport.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),Buffer.from([255,216,255,224,1,2,3]),Buffer.from(`\r\n--${boundary}--\r\n`)]);
 const req=new Request('https://vector.test/api/passport/recognize',{method:'POST',headers:{'Content-Type':`multipart/form-data; boundary=${boundary}`},body});
 let called=false;await recognizePassportAI(req,{OPENAI_API_KEY:'test-secret'},async()=>{called=true;return apiResult(result())});assert.equal(called,true);
});

test('bad images and oversized bodies are rejected before paid calls; provider errors are safe and never retried',async()=>{
 const env={OPENAI_API_KEY:'test-secret'};let calls=0;
 const never=async()=>{calls++;throw new Error('unexpected')};
 await assert.rejects(recognizePassportAI(request({bytes:new TextEncoder().encode('not an image')}),env,never),e=>e.status===400);
 const huge=request();huge.headers.set('Content-Length',String(12*1024*1024));
 await assert.rejects(recognizePassportAI(huge,env,never),e=>e.status===413);assert.equal(calls,0);
 await assert.rejects(recognizePassportAI(request(),env,async()=>{calls++;return new Response('test-secret private payload',{status:429})}),e=>e.status===429&&!e.message.includes('test-secret'));
 assert.equal(calls,1);
 await assert.rejects(recognizePassportAI(request(),env,async()=>Response.json({status:'incomplete',output:[]})),e=>e.status===502);
 await assert.rejects(recognizePassportAI(request(),env,async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]})),e=>e.status===422);
});
