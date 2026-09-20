// Personal, one-use login links. No passwords or ChatGPT account required.
// Raw link/session secrets are never persisted; access still uses crm_users roles.
const fail=(message,status=403)=>{throw Object.assign(new Error(message),{status})};
const hash=async token=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
const secret=()=>crypto.randomUUID()+crypto.randomUUID();
const cookie=(token,age)=>'__Host-vector_session='+token+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+age;
const cookieToken=req=>req.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-vector_session='))?.slice('__Host-vector_session='.length)||'';
async function smallJson(req){
 if(!req.headers.get('Content-Type')?.startsWith('application/json'))fail('Ожидается JSON',400);
 const reader=req.body?.getReader();if(!reader)fail('Пустой запрос',400);
 let length=0,text='';const decoder=new TextDecoder();
 while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.length;if(length>4096){await reader.cancel();fail('Слишком большой запрос',413)}text+=decoder.decode(chunk.value,{stream:true});}
 try{return JSON.parse(text+decoder.decode())}catch{fail('Некорректный запрос',400)}
}
export async function sessionIdentity(req,db){
 const token=cookieToken(req);if(!token||token.length>200)return null;
 const row=await db.prepare('SELECT u.id,u.name,u.email FROM crm_sessions s JOIN crm_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').bind(await hash(token),new Date().toISOString()).first();
 return row?{...row,authMethod:'link'}:null;
}
export async function publicLogin(req,db,env={}){
 const u=new URL(req.url);if(!['/api/login/redeem','/api/login/logout'].includes(u.pathname))return null;
 if(req.method!=='POST')fail('Метод не поддерживается',405);
 if(req.headers.get('Origin')!==u.origin)fail('Откройте ссылку на сайте CRM');
 if(u.pathname==='/api/login/logout'){
  const token=cookieToken(req);if(token&&token.length<=200)await db.prepare('DELETE FROM crm_sessions WHERE token_hash=?').bind(await hash(token)).run();
  return Response.json({ok:true},{headers:{'Set-Cookie':cookie('',0),'Cache-Control':'no-store'}});
 }
 const b=await smallJson(req);if(typeof b.token!=='string'||!/^[0-9a-f-]{72}$/.test(b.token))fail('Ссылка входа недействительна');
 const tokenHash=await hash(b.token);
 // Owner-authorized recovery link: secret hash is configured in Sites, never in client assets.
 // It uses the ordinary single-use login flow and cannot reactivate a revoked account.
 if(env.CRM_TEMP_LOGIN_HASH===tokenHash&&Date.parse(env.CRM_TEMP_LOGIN_EXPIRES)>Date.now()){
  const id='local:temporary-'+tokenHash.slice(0,24),linkId='temporary-'+tokenHash;
  await db.batch([
   db.prepare("INSERT OR IGNORE INTO crm_users(id,name,email,role) VALUES(?,?,'','editor')").bind(id,'Павел · временный вход'),
   db.prepare('INSERT OR IGNORE INTO crm_login_links(id,token_hash,user_id,expires_at) VALUES(?,?,?,?)').bind(linkId,tokenHash,id,env.CRM_TEMP_LOGIN_EXPIRES)
  ]);
 }
 const link=await db.prepare('SELECT l.*,u.active,u.name,u.email FROM crm_login_links l JOIN crm_users u ON u.id=l.user_id WHERE l.token_hash=?').bind(tokenHash).first();
 if(!link||!link.active||link.revoked||link.used_session||link.expires_at<=new Date().toISOString())fail('Ссылка истекла, использована или отозвана. Попросите владельца создать новую.');
 const token=secret(),sessionHash=await hash(token),expires=new Date(Date.now()+30*86400000).toISOString();
 const result=await db.batch([
 db.prepare('UPDATE crm_login_links SET used_session=? WHERE id=? AND used_session IS NULL AND revoked=0 AND expires_at>? AND EXISTS(SELECT 1 FROM crm_users WHERE id=? AND active=1)').bind(sessionHash,link.id,new Date().toISOString(),link.user_id),
 db.prepare('INSERT INTO crm_sessions(token_hash,user_id,expires_at) SELECT ?,user_id,? FROM crm_login_links WHERE id=? AND used_session=?').bind(sessionHash,expires,link.id,sessionHash),
 db.prepare('INSERT INTO crm_access_audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_sessions WHERE token_hash=?)').bind(crypto.randomUUID(),new Date().toISOString(),JSON.stringify({id:link.user_id,name:link.name,email:link.email}),'Вход по персональной ссылке',link.user_id,sessionHash)]);
 if(!result[1].meta.changes)fail('Ссылка уже использована',409);
 return Response.json({ok:true},{headers:{'Set-Cookie':cookie(token,30*86400),'Cache-Control':'no-store'}});
}
export async function createLoginLink(req,db,actor){
 const b=await smallJson(req);
 let member,id=b.userId;
 if(id){member=await db.prepare('SELECT * FROM crm_users WHERE id=?').bind(id).first();if(!member||!member.active||!member.id.startsWith('local:')||member.role==='owner')fail('Для этого сотрудника нельзя создать ссылку');}
 else{if(!['viewer','editor'].includes(b.role)||!String(b.name||'').trim())fail('Укажите имя и роль',400);id='local:'+crypto.randomUUID();member={id,name:String(b.name).trim().slice(0,200),email:'',role:b.role};}
 const token=secret(),linkId=crypto.randomUUID(),expires=new Date(Date.now()+7*86400000).toISOString();
 const statements=[];
 if(!b.userId)statements.push(db.prepare('INSERT INTO crm_users(id,name,email,role) VALUES(?,?,?,?)').bind(id,member.name,'',member.role));
 statements.push(db.prepare('INSERT INTO crm_login_links(id,token_hash,user_id,expires_at) VALUES(?,?,?,?)').bind(linkId,await hash(token),id,expires),db.prepare('INSERT INTO crm_access_audit VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),new Date().toISOString(),JSON.stringify(actor),'Создана ссылка входа: '+member.role,id));
 await db.batch(statements);
 return Response.json({id:linkId,url:new URL(req.url).origin+'/#login='+token,expires_at:expires},{status:201,headers:{'Cache-Control':'no-store'}});
}
