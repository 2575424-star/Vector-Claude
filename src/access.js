import {setPassword} from './password-login.js';
import {createLoginLink} from './local-login.js';
// Sites dispatch authenticates these headers. No client role or email is used as authority.
const fail=(message,status=403)=>{throw Object.assign(new Error(message),{status})};
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
const ready=new WeakMap();
export async function ensureAccess(db){
 if(!db)fail('Облачная база недоступна',503);
 if(!ready.has(db))ready.set(db,db.batch([
 db.prepare("CREATE TABLE IF NOT EXISTS crm_passwords (user_id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL)"),
 db.prepare("CREATE TABLE IF NOT EXISTS crm_login_attempts (key TEXT PRIMARY KEY,window_start INTEGER NOT NULL,attempts INTEGER NOT NULL)"),
 db.prepare("CREATE TABLE IF NOT EXISTS crm_password_write_guard (id TEXT PRIMARY KEY,valid INTEGER NOT NULL)"),
 db.prepare("CREATE TABLE IF NOT EXISTS crm_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at TEXT NOT NULL)"),
 db.prepare("CREATE INDEX IF NOT EXISTS crm_sessions_user ON crm_sessions(user_id)"),
 db.prepare("CREATE TABLE IF NOT EXISTS crm_login_links (id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,user_id TEXT NOT NULL,expires_at TEXT NOT NULL,used_session TEXT,revoked INTEGER NOT NULL DEFAULT 0)"),
 db.prepare("CREATE TABLE IF NOT EXISTS crm_users (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),active INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 1,last_op TEXT)"),
 db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS one_crm_owner ON crm_users(role) WHERE role='owner'"),
 db.prepare("CREATE TABLE IF NOT EXISTS crm_invites (id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('editor','viewer')),expires_at TEXT NOT NULL,used_by TEXT,revoked INTEGER NOT NULL DEFAULT 0)"),
 db.prepare("CREATE TABLE IF NOT EXISTS crm_access_audit (id TEXT PRIMARY KEY,date TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL)")
 ]).catch(e=>{ready.delete(db);throw e}));
 await ready.get(db);
}
export function identity(req){const id=req.headers.get('oai-authenticated-user-id');if(!id)fail('Войдите в CRM',401);const email=req.headers.get('oai-authenticated-user-email')||'';let name=req.headers.get('oai-authenticated-user-full-name')||'';if(req.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8'){try{name=decodeURIComponent(name)}catch{name=''}}return{id,email,name:name||email||'Сотрудник'};}
export async function membership(db,user){return await db.prepare('SELECT * FROM crm_users WHERE id=?').bind(user.id).first();}
export function authorize(member,req){
 if(!member?.active)fail('Доступ к CRM не назначен или отозван');
 const p=new URL(req.url).pathname,read=['GET','HEAD'].includes(req.method);
 if((req.method==='DELETE'&&/^\/api\/cars\/[^/]+$/.test(p))||p.startsWith('/api/access/')||p.startsWith('/api/inventory-')||p.startsWith('/api/publication/')||p==='/api/demo'||/\/(archive|publication)(\/|$)/.test(p)){if(member.role!=='owner')fail('Это действие доступно только владельцу');}
 else if(!read&&member.role==='viewer')fail('Ваша роль разрешает только просмотр');
}
const hash=async token=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
const audit=(db,actor,action,target)=>db.prepare('INSERT INTO crm_access_audit VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),new Date().toISOString(),JSON.stringify(actor),action,target);
export async function accessRequest(req,env,user){
 const db=env.DB,u=new URL(req.url);await ensureAccess(db);
 let member=await membership(db,user);
 if(u.pathname==='/api/session')return json({user,role:member?.active?member.role:null,setupRequired:!(await db.prepare("SELECT id FROM crm_users WHERE role='owner'").first())});
 if(u.pathname==='/api/access/bootstrap'&&req.method==='POST'){
  const b=await req.json();if(!env.CRM_OWNER_SETUP_TOKEN||typeof b.token!=='string'||await hash(b.token)!==await hash(env.CRM_OWNER_SETUP_TOKEN))fail('Ссылка настройки недействительна');
  if(await db.prepare("SELECT id FROM crm_users WHERE role='owner'").first())fail('Владелец уже настроен',409);
  await db.batch([db.prepare("INSERT INTO crm_users(id,name,email,role) VALUES(?,?,?,'owner')").bind(user.id,user.name,user.email),audit(db,user,'Назначен владелец',user.id)]);
  return json({ok:true});
 }
 if(u.pathname==='/api/access/accept'&&req.method==='POST'){
  if(member)fail('Учётная запись уже зарегистрирована. Права изменяет владелец.',409);
  const b=await req.json();if(typeof b.token!=='string'||b.token.length>200)fail('Недействительное приглашение');
  const invite=await db.prepare('SELECT * FROM crm_invites WHERE token_hash=?').bind(await hash(b.token)).first();
  if(!invite||invite.used_by||invite.revoked||invite.expires_at<=new Date().toISOString())fail('Приглашение использовано, отозвано или истекло');
  const result=await db.batch([
   db.prepare('UPDATE crm_invites SET used_by=? WHERE id=? AND used_by IS NULL AND revoked=0 AND expires_at>?').bind(user.id,invite.id,new Date().toISOString()),
   db.prepare('INSERT INTO crm_users(id,name,email,role) SELECT ?,?,?,role FROM crm_invites WHERE id=? AND used_by=? AND revoked=0').bind(user.id,user.name,user.email,invite.id,user.id),
   db.prepare('INSERT INTO crm_access_audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_users WHERE id=?)').bind(crypto.randomUUID(),new Date().toISOString(),JSON.stringify(user),'Принято приглашение',invite.id,user.id)]);
  if(!result[1].meta.changes)fail('Приглашение уже использовано',409);
  return json({ok:true});
 }
 authorize(member,req);
 if(u.pathname==='/api/access/passwords'&&req.method==='POST')return setPassword(req,db,user);
 if(u.pathname==='/api/access/login-links'&&req.method==='POST')return createLoginLink(req,db,user);
 const revokeLogin=u.pathname.match(/^\/api\/access\/login-links\/([^/]+)$/);if(revokeLogin&&req.method==='DELETE'){await db.batch([db.prepare('UPDATE crm_login_links SET revoked=1 WHERE id=?').bind(revokeLogin[1]),audit(db,user,'Ссылка входа отозвана',revokeLogin[1])]);return json({ok:true});}
 if(u.pathname==='/api/access/users'&&req.method==='GET'){
  const users=await db.prepare('SELECT u.id,u.name,u.email,u.role,u.active,u.revision,EXISTS(SELECT 1 FROM crm_passwords p WHERE p.user_id=u.id) AS hasPassword FROM crm_users u').all();
  const invites=await db.prepare('SELECT id,name,role,expires_at,used_by,revoked FROM crm_invites ORDER BY expires_at DESC').all();
  const logs=await db.prepare('SELECT * FROM crm_access_audit ORDER BY date DESC LIMIT 50').all();
  const loginLinks=await db.prepare('SELECT l.id,l.user_id,l.expires_at,l.revoked,l.used_session IS NOT NULL AS used,u.name FROM crm_login_links l JOIN crm_users u ON u.id=l.user_id ORDER BY l.expires_at DESC').all();
  return json({users:users.results,invites:invites.results,loginLinks:loginLinks.results,audit:logs.results.map(l=>({...l,actor:JSON.parse(l.actor)}))});
 }
 if(u.pathname==='/api/access/invites'&&req.method==='POST'){
  const b=await req.json();if(!['editor','viewer'].includes(b.role))fail('Выберите роль',400);
  const token=crypto.randomUUID()+crypto.randomUUID(),id=crypto.randomUUID(),expires=new Date(Date.now()+7*86400000).toISOString();
  await db.batch([db.prepare('INSERT INTO crm_invites(id,token_hash,name,role,expires_at) VALUES(?,?,?,?,?)').bind(id,await hash(token),String(b.name||'Сотрудник').trim().slice(0,200),b.role,expires),audit(db,user,'Создано приглашение: '+b.role,id)]);
  return json({id,expires_at:expires,url:u.origin+'/#invite='+token},201);
 }
 const change=u.pathname.match(/^\/api\/access\/users\/([^/]+)$/);
 if(change&&req.method==='PATCH'){
  const b=await req.json();if(!['viewer','editor'].includes(b.role)||typeof b.active!=='boolean')fail('Проверьте роль и доступ',400);
  const target=await db.prepare('SELECT * FROM crm_users WHERE id=?').bind(decodeURIComponent(change[1])).first();
  if(!target||target.role==='owner')fail('Владельца нельзя изменить');
  const op=crypto.randomUUID();const result=await db.batch([
   db.prepare("UPDATE crm_users SET role=?,active=?,revision=revision+1,last_op=? WHERE id=? AND revision=? AND role!='owner'").bind(b.role,b.active?1:0,op,target.id,b.revision),
   db.prepare('INSERT INTO crm_access_audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_users WHERE id=? AND last_op=?)').bind(crypto.randomUUID(),new Date().toISOString(),JSON.stringify(user),b.active?'Назначена роль: '+b.role:'Доступ отозван',target.id,target.id,op)]);
  if(!result[0].meta.changes)fail('Права уже изменились. Обновите страницу.',409);if(!b.active)await db.batch([db.prepare('DELETE FROM crm_sessions WHERE user_id=?').bind(target.id),db.prepare('UPDATE crm_login_links SET revoked=1 WHERE user_id=?').bind(target.id)]);return json({ok:true});
 }
 const revoke=u.pathname.match(/^\/api\/access\/invites\/([^/]+)$/);
 if(revoke&&req.method==='DELETE'){await db.batch([db.prepare('UPDATE crm_invites SET revoked=1 WHERE id=?').bind(revoke[1]),audit(db,user,'Приглашение отозвано',revoke[1])]);return json({ok:true});}
 if(u.pathname.startsWith('/api/access/'))fail('Действие не найдено',404);
 return null;
}
