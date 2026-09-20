// Owner-provisioned email/password accounts. No public registration.
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const enc=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const sha=async s=>hex(await crypto.subtle.digest('SHA-256',enc.encode(s)));
const iterations=100000;
async function derive(password,salt){const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt),iterations},key,256));}
function same(a,b){let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
export async function passwordBody(req){if(!req.headers.get('Content-Type')?.startsWith('application/json'))fail('Ожидается JSON');const reader=req.body?.getReader();if(!reader)fail('Пустой запрос');let n=0,parts=[];while(true){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>4096){await reader.cancel();fail('Слишком большой запрос',413)}parts.push(r.value);}try{const buf=new Uint8Array(n);let i=0;for(const p of parts){buf.set(p,i);i+=p.length;}return JSON.parse(new TextDecoder().decode(buf));}catch{fail('Некорректный запрос');}}
export async function passwordLogin(req,db){
 if(new URL(req.url).pathname!=='/api/login/password')return null;
 if(req.method!=='POST')fail('Метод не поддерживается',405);
 if(req.headers.get('Origin')!==new URL(req.url).origin)fail('Откройте CRM для входа',403);
 const b=await passwordBody(req),email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
 if(!email||email.length>254||typeof b.password!=='string'||b.password.length>128)fail('Неверная почта или пароль',401);
 const now=Date.now(),windowStart=Math.floor(now/900000)*900000,keys=[await sha('email:'+email),await sha('ip:'+(req.headers.get('CF-Connecting-IP')||'unknown'))];
 await db.batch([db.prepare('DELETE FROM crm_login_attempts WHERE window_start<?').bind(windowStart-900000),...keys.map(k=>db.prepare('INSERT INTO crm_login_attempts(key,window_start,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start=excluded.window_start THEN attempts+1 ELSE 1 END,window_start=excluded.window_start').bind(k,windowStart))]);
 const counts=await Promise.all(keys.map(k=>db.prepare('SELECT attempts FROM crm_login_attempts WHERE key=?').bind(k).first()));if(counts[0].attempts>10||counts[1].attempts>50)fail('Слишком много попыток. Попробуйте через 15 минут.',429);
 const row=await db.prepare('SELECT p.*,u.active FROM crm_passwords p JOIN crm_users u ON u.id=p.user_id WHERE p.email=?').bind(email).first();
 const calculated=await derive(b.password,row?.salt||'vector-dummy-salt-for-unknown-account');
 if(!row||!row.active||!same(calculated,row.password_hash))fail('Неверная почта или пароль',401);
 const token=crypto.randomUUID()+crypto.randomUUID(),tokenHash=await sha(token),expiry=new Date(now+30*86400000).toISOString();
 const result=await db.batch([db.prepare('INSERT INTO crm_sessions(token_hash,user_id,expires_at) SELECT ?,p.user_id,? FROM crm_passwords p JOIN crm_users u ON u.id=p.user_id WHERE p.user_id=? AND p.password_hash=? AND u.active=1').bind(tokenHash,expiry,row.user_id,row.password_hash),db.prepare('INSERT INTO crm_access_audit SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_sessions WHERE token_hash=?)').bind(crypto.randomUUID(),new Date(now).toISOString(),JSON.stringify({id:row.user_id}),'Вход по почте и паролю',row.user_id,tokenHash)]);
 if(!result[0].meta.changes)fail('Неверная почта или пароль',401);
 return Response.json({ok:true},{headers:{'Cache-Control':'no-store','Set-Cookie':'__Host-vector_session='+token+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000'}});
}
export async function setPassword(req,db,actor){
 const b=await passwordBody(req),email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)fail('Укажите корректную почту');
 if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)fail('Пароль должен содержать от 12 до 128 символов');
 let user=b.userId?await db.prepare('SELECT * FROM crm_users WHERE id=?').bind(b.userId).first():null;
 if(b.userId&&!user)fail('Сотрудник не найден',404);
 if(user&&!user.active)fail('Сначала восстановите доступ сотрудника');
 if(user&&user.revision!==b.revision)fail('Данные доступа изменились. Обновите страницу.',409);
 if(!user&&(!['editor','viewer'].includes(b.role)||!String(b.name||'').trim()))fail('Укажите имя и роль');
 const other=await db.prepare('SELECT user_id FROM crm_passwords WHERE email=?').bind(email).first();if(other&&other.user_id!==user?.id)fail('Эта почта уже используется',409);
 const salt=hex(crypto.getRandomValues(new Uint8Array(32))),passwordHash=await derive(b.password,salt),id=user?.id||'local:'+crypto.randomUUID();
 const statements=[];
 if(!user)statements.push(db.prepare('INSERT INTO crm_users(id,name,email,role) VALUES(?,?,?,?)').bind(id,String(b.name).trim().slice(0,200),email,b.role));
 // Conditional guard makes a concurrent credential update roll back, rather than overwrite it.
 else statements.push(db.prepare('INSERT INTO crm_password_write_guard(id,valid) VALUES(?,(SELECT CASE WHEN revision=? THEN 1 ELSE NULL END FROM crm_users WHERE id=?))').bind(crypto.randomUUID(),b.revision,id),db.prepare('UPDATE crm_users SET email=?,revision=revision+1 WHERE id=?').bind(email,id));
 statements.push(db.prepare('INSERT INTO crm_passwords(user_id,email,salt,password_hash) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,salt=excluded.salt,password_hash=excluded.password_hash').bind(id,email,salt,passwordHash),db.prepare('DELETE FROM crm_sessions WHERE user_id=?').bind(id),db.prepare('UPDATE crm_login_links SET revoked=1 WHERE user_id=?').bind(id),db.prepare('INSERT INTO crm_access_audit VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),new Date().toISOString(),JSON.stringify({id:actor.id,name:actor.name}),user?'Обновлены данные входа':'Создан вход по почте',id));
 statements.push(db.prepare('DELETE FROM crm_password_write_guard WHERE valid=1'));
 try{await db.batch(statements)}catch(e){if(/constraint|unique/i.test(e.message))fail('Почта занята или данные уже изменились. Обновите страницу.',409);throw e;}
 return Response.json({ok:true,userId:id},{headers:{'Cache-Control':'no-store'}});
}
