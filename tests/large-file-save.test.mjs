import test from 'node:test';import assert from 'node:assert/strict';
import {fileResponse} from '../src/file-response.js';
import {makeDb} from './db.mjs';import {saveLargeFile} from '../src/large-file-save.js';
test('30 MiB uploads use bounded RPCs, retain all bytes and publish atomically',async()=>{
 const db=makeDb();await db.batch([db.prepare('CREATE TABLE file_chunks(file_id TEXT,part INTEGER,data TEXT,PRIMARY KEY(file_id,part))'),db.prepare('CREATE TABLE cars(id TEXT,revision INTEGER,data TEXT)')]);
 await db.prepare('INSERT INTO cars VALUES(?,?,?)').bind('car',1,'{}').run();
 const original=db.batch;let max=0;db.batch=async statements=>{const size=JSON.stringify(statements).length*2;max=Math.max(max,size);assert.ok(size<32*1024*1024,'RPC payload too large');return original(statements)};
 const bytes=new Uint8Array(30*1024*1024);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 const encode=b=>Buffer.from(b).toString('base64');
 async function persist(db,c,rev,extra){const r=await db.batch([db.prepare('UPDATE cars SET revision=?,data=? WHERE id=? AND revision=?').bind(rev+1,JSON.stringify(c),c.id,rev),...extra]);if(!r[0].meta.changes)throw new Error('conflict');return c}
 await saveLargeFile(db,{id:'car',lastWrite:'first'},1,'video',bytes,encode,persist);
 const {results}=await db.prepare('SELECT data FROM file_chunks WHERE file_id=? ORDER BY part').bind('video').all();const restored=Buffer.concat(results.map(x=>Buffer.from(x.data,'base64')));assert.deepEqual(restored,Buffer.from(bytes));assert.ok(max<12*1024*1024);
 const readDb={prepare(sql){const stmt=db.prepare(sql),all=stmt.all.bind(stmt);stmt.all=async()=>{const result=await all();assert.ok(JSON.stringify(result).length*2<32*1024*1024);return result};return stmt}};const response=await fileResponse(new Request('https://vector.test/video'),readDb,{id:'video',name:'test.mov',mime:'video/quicktime',category:'Видео',size:bytes.length});assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(bytes));
 await assert.rejects(saveLargeFile(db,{id:'car',lastWrite:'stale'},1,'stale',bytes.subarray(0,500000),encode,persist),/conflict/);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM file_chunks WHERE file_id LIKE 'pending:%' OR file_id='stale'").first()).n,0);
 let calls=0;db.batch=async statements=>{if(++calls===2)throw new Error('interrupted');return original(statements)};
 await assert.rejects(saveLargeFile(db,{id:'car',lastWrite:'fail'},2,'failed',bytes,encode,persist),/interrupted/);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM file_chunks WHERE file_id LIKE 'pending:%' OR file_id='failed'").first()).n,0);
 assert.equal((await db.prepare('SELECT revision FROM cars').first()).revision,2);
});
