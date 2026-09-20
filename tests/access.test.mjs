import test from 'node:test';import assert from 'node:assert/strict';
import worker from '../src/worker.js';import {makeDb} from './db.mjs';
const DB=makeDb(),env={DB,CRM_OWNER_SETUP_TOKEN:'test-only-setup-token',ASSETS:{fetch:()=>new Response('app')}};
async function call(user,path,method='GET',body,extra={}){
 const headers={...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test'}:{}),...extra};
 if(body&&! (body instanceof FormData))headers['Content-Type']='application/json';
 const r=await worker.fetch(new Request('https://vector.test/api'+path,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),env);
 return{status:r.status,data:await r.json()};
}
test('identity, owner setup, invitations, roles, revocation and attribution are enforced by API',async()=>{
 assert.equal((await call(null,'/cars')).status,401);
 assert.equal((await call('stranger','/cars')).status,403);
 assert.equal((await call('owner','/access/bootstrap','POST',{token:'wrong'})).status,403);
 assert.equal((await call('owner','/access/bootstrap','POST',{token:env.CRM_OWNER_SETUP_TOKEN})).status,200);
 assert.equal((await call('stranger','/access/bootstrap','POST',{token:env.CRM_OWNER_SETUP_TOKEN})).status,409);
 assert.equal((await call('owner','/session')).data.role,'owner');
 async function invite(role,user){const r=await call('owner','/access/invites','POST',{role,name:user});assert.equal(r.status,201);const token=new URL(r.data.url).hash.slice(8);assert.equal((await call(user,'/access/accept','POST',{token})).status,200);return token}
 const token=await invite('viewer','reader');await invite('editor','editor');
 assert.equal((await call('other','/access/accept','POST',{token})).status,403);
 assert.equal((await call('owner','/access/invites','POST',{role:'owner'})).status,400);
 assert.equal((await call('reader','/cars')).status,200);
 for(const path of ['/cars','/passport/recognize','/inventory-replace','/access/invites','/publication/snapshot'])assert.equal((await call('reader',path,'POST',{})).status,403,path);
 assert.equal((await call('reader','/inventory-backups')).status,403);
 assert.equal((await call('reader','/access/users')).status,403);
 assert.equal((await call('stranger','/cars','GET',null,{'oai-authenticated-user-email':'owner@example.test'})).status,403);
 let car=(await call('editor','/cars','POST',{brand:'BMW',model:'X7',actor:{name:'Forged'}})).data;
 assert.equal(car.history[0].actor.id,'editor');assert.notEqual(car.history[0].actor.name,'Forged');
 assert.equal((await call('editor','/cars/'+car.id+'/archive','POST',{revision:car.revision,archived:true})).status,403);
 assert.equal((await call('editor','/cars/'+car.id+'/publication','PATCH',{revision:car.revision})).status,403);
 const doc=await call('editor','/cars/'+car.id+'/document-status','PATCH',{revision:car.revision,value:'ПТС действующий'});assert.equal(doc.status,200);assert.equal(doc.data.history[0].actor.id,'editor');
 const fd=new FormData();fd.set('file',new File(['private file'],'test.txt',{type:'text/plain'}));fd.set('category','Документ');fd.set('revision',doc.data.revision);
 const uploaded=await call('editor','/cars/'+car.id+'/files','POST',fd);assert.equal(uploaded.status,200);
 const member=(await call('owner','/access/users')).data.users.find(u=>u.id==='editor');
 assert.equal((await call('owner','/access/users/editor','PATCH',{revision:member.revision,role:'viewer',active:true})).status,200);
 assert.equal((await call('editor','/cars','POST',{brand:'BMW',model:'X5'})).status,403);
 assert.equal((await call('owner','/access/users/editor','PATCH',{revision:member.revision,role:'editor',active:true})).status,409);
 assert.equal((await call('owner','/access/users/editor','PATCH',{revision:member.revision+1,role:'viewer',active:false})).status,200);
 assert.equal((await call('editor','/cars')).status,403);
 assert.equal((await call('editor','/cars/'+car.id+'/files/'+uploaded.data.files[0].id)).status,403);
 assert.equal((await call('owner','/access/users/owner','PATCH',{revision:1,role:'viewer',active:false})).status,403);
 assert.equal((await call('owner','/cars','POST',{brand:'BMW',model:'X5'},{Origin:'https://evil.test'})).status,403);
 const revoked=(await call('owner','/access/invites','POST',{role:'viewer'})).data;await call('owner','/access/invites/'+revoked.id,'DELETE');
 assert.equal((await call('new','/access/accept','POST',{token:new URL(revoked.url).hash.slice(8)})).status,403);
});

test('external employees sign in without platform identity; replay, CSRF, expiry, and revocation are rejected',async()=>{
 const ownerHeaders={'oai-authenticated-user-id':'owner','Origin':'https://vector.test','Content-Type':'application/json'};
 async function raw(path,method='GET',body,headers={}){
  return worker.fetch(new Request('https://vector.test/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
 }
 let r=await raw('/access/login-links','POST',{name:'External Employee',role:'editor'},ownerHeaders);
 assert.equal(r.status,201);const link=await r.json(),token=new URL(link.url).hash.slice(7);
 r=await raw('/login/redeem','POST',{token},{Origin:'https://evil.test','Content-Type':'application/json'});assert.equal(r.status,403);
 r=await raw('/login/redeem','POST',{token},{Origin:'https://vector.test','Content-Type':'application/json'});assert.equal(r.status,200);
 const cookie=r.headers.get('Set-Cookie');assert.match(cookie,/Secure; HttpOnly; SameSite=Lax/);
 const headers={Cookie:cookie.split(';')[0],Origin:'https://vector.test','Content-Type':'application/json'};
 r=await raw('/session','GET',undefined,headers);const session=await r.json();assert.equal(session.role,'editor');assert.equal(session.user.authMethod,'link');
 const id=session.user.id;
 r=await raw('/cars','POST',{brand:'BMW',model:'External'},headers);assert.equal(r.status,201);const car=await r.json();assert.equal(car.history[0].actor.id,id);
 assert.equal((await raw('/cars','POST',{brand:'BMW',model:'CSRF'},{Cookie:headers.Cookie,'Content-Type':'application/json'})).status,403);
 assert.equal((await raw('/access/users','GET',undefined,headers)).status,403);
 assert.equal((await raw('/login/redeem','POST',{token},{Origin:'https://vector.test','Content-Type':'application/json'})).status,403);
 const member=(await call('owner','/access/users')).data.users.find(u=>u.id===id);
 await call('owner','/access/users/'+encodeURIComponent(id),'PATCH',{role:'viewer',active:true,revision:member.revision});
 assert.equal((await raw('/cars','POST',{brand:'BMW',model:'Denied'},headers)).status,403);
 await call('owner','/access/users/'+encodeURIComponent(id),'PATCH',{role:'viewer',active:false,revision:member.revision+1});
 assert.equal((await raw('/cars','GET',undefined,headers)).status,401);
 await call('owner','/access/users/'+encodeURIComponent(id),'PATCH',{role:'viewer',active:true,revision:member.revision+2});
 assert.equal((await raw('/cars','GET',undefined,headers)).status,401);
 r=await raw('/access/login-links','POST',{userId:id},ownerHeaders);const renewed=await r.json(),renewToken=new URL(renewed.url).hash.slice(7);
 await DB.prepare("UPDATE crm_login_links SET expires_at='2000-01-01' WHERE id=?").bind(renewed.id).run();
 assert.equal((await raw('/login/redeem','POST',{token:renewToken},{Origin:'https://vector.test','Content-Type':'application/json'})).status,403);
 r=await raw('/access/login-links','POST',{userId:id},ownerHeaders);const finalLink=await r.json();
 r=await raw('/login/redeem','POST',{token:new URL(finalLink.url).hash.slice(7)},{Origin:'https://vector.test','Content-Type':'application/json'});
 const finalCookie=r.headers.get('Set-Cookie').split(';')[0];
 r=await raw('/login/logout','POST',undefined,{Cookie:finalCookie,Origin:'https://vector.test'});assert.equal(r.status,200);assert.match(r.headers.get('Set-Cookie'),/Max-Age=0/);
 assert.equal((await raw('/cars','GET',undefined,{Cookie:finalCookie})).status,401);
 assert.equal((await raw('/access/login-links','POST',{name:'Escalate',role:'owner'},ownerHeaders)).status,400);
});
