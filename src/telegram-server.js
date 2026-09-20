import {TELEGRAM_CHANNEL,TELEGRAM_URL,telegramDraft,telegramInput,telegramSnapshot} from './telegram.js';
import {digest,readPhoto} from './publication.js';
import {avitoAI} from './avito-ai.js';
import {avitoFields} from './avito.js';
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status})};
const json=v=>Response.json(v,{headers:{'Cache-Control':'no-store'}}),now=()=>new Date().toISOString();
const key=id=>'telegram:post:'+id;
const get=async(db,k)=>{const r=await db.prepare('SELECT value FROM app_meta WHERE key=?').bind(k).first();return r?JSON.parse(r.value):null;};
const put=(db,k,v)=>db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k,JSON.stringify(v)).run();
const hash=s=>digest(new TextEncoder().encode(s));
async function body(req){if(Number(req.headers.get('Content-Length')||0)>24000)fail('Слишком большой запрос.',413);const reader=req.body?.getReader();if(!reader)fail('Нет данных.');const parts=[];let n=0;try{while(true){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>24000){await reader.cancel();fail('Слишком большой запрос.',413);}parts.push(r.value);}}finally{reader.releaseLock();}try{return JSON.parse(await new Blob(parts).text());}catch{fail('Не удалось прочитать запрос.');}}
export async function telegramCall(env,method,data,fetcher=fetch){
 const token=env.TELEGRAM_BOT_TOKEN?.trim();if(!token)fail('Сначала подключите Telegram-бота.',503);
 if(!/^[0-9]+:[A-Za-z0-9_-]{20,}$/.test(token))fail('Проверьте токен Telegram-бота в настройках сайта.',503);
 const checking=['getMe','getChat','getChatMember'].includes(method);
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),25000);let httpStatus=null,reason='network';
 try{const r=await fetcher('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',headers:data instanceof FormData?{}:{'Content-Type':'application/json'},body:data instanceof FormData?data:JSON.stringify(data),signal:ac.signal,redirect:'manual'});httpStatus=r.status;if(r.status>=300&&r.status<400){reason='redirect';throw new Error('unknown');}let result;try{result=await r.json();}catch{reason='invalid_response';throw new Error('unknown');}
  if(result?.ok===false){const code=Number(result.error_code);if(method==='editMessageText'&&code===400&&/message is not modified/i.test(result.description||''))return {unchanged:true};const message=code===429?'Telegram просит подождать перед следующей отправкой.':code===401?'Токен бота недействителен.':code===403?'У бота нет доступа к каналу.':code===400?'Telegram отклонил запрос. Проверьте права бота, фотографии и наличие сообщения в канале.':'Telegram временно недоступен.';throw Object.assign(new Error(message),{status:code===429?429:502,definite:code>=400&&code<500});}
  if(!r.ok||result?.ok!==true){reason='invalid_response';throw new Error('unknown');}return result.result;
 }catch(e){if(e.status)throw e;if(ac.signal.aborted)reason='timeout';
  // Do not log raw exceptions or request URLs: Telegram credentials are in the path.
  console.error('Telegram request failed',{method:['getMe','getChat','getChatMember','sendPhoto','sendMediaGroup','sendMessage','editMessageText'].includes(method)?method:'unknown',reason,httpStatus});
  const detail=reason==='timeout'?'Telegram не ответил за 25 секунд.':reason==='redirect'?'Получено неожиданное перенаправление.':reason==='invalid_response'?'Получен неожиданный ответ сервера'+(httpStatus?' (HTTP '+httpStatus+')':'')+'.':'Не удалось установить соединение с Telegram.';
  const step={getMe:'проверка токена',getChat:'проверка канала',getChatMember:'проверка прав бота'}[method];
  throw Object.assign(new Error(checking?detail+' Этап: '+step+'. Сообщения не отправлялись.':'Связь с Telegram прервалась. Результат отправки нужно проверить в канале.'),{status:502,definite:false});
 }finally{clearTimeout(timer);}
}
async function checkConnection(env,fetcher){
 const me=await telegramCall(env,'getMe',{},fetcher),chat=await telegramCall(env,'getChat',{chat_id:'@'+TELEGRAM_CHANNEL},fetcher);
 if(!me.is_bot||chat.type!=='channel'||String(chat.username).toLowerCase()!==TELEGRAM_CHANNEL||!Number.isSafeInteger(chat.id))fail('Бот должен быть подключён именно к @'+TELEGRAM_CHANNEL+'.');
 const member=await telegramCall(env,'getChatMember',{chat_id:chat.id,user_id:me.id},fetcher);
 if(member.status!=='administrator'||!member.can_post_messages)fail('Добавьте бота администратором канала с правом публикации.',403);
 return {chatId:chat.id,botId:me.id,botUsername:me.username,title:chat.title,channel:TELEGRAM_CHANNEL,tokenHash:await hash(env.TELEGRAM_BOT_TOKEN.trim()),verifiedAt:now()};
}
async function config(env){const c=await get(env.DB,'telegram:connection'),present=!!env.TELEGRAM_BOT_TOKEN?.trim();return {channel:TELEGRAM_CHANNEL,url:TELEGRAM_URL,tokenPresent:present,connected:present&&c?.channel===TELEGRAM_CHANNEL&&c.tokenHash===await hash(env.TELEGRAM_BOT_TOKEN.trim()),botUsername:c?.botUsername||'',verifiedAt:c?.verifiedAt||null,aiEnabled:!!env.OPENAI_API_KEY?.trim()};}
async function connection(env){const c=await get(env.DB,'telegram:connection');if(!(await config(env)).connected)fail('Сначала нажмите «Проверить подключение».',503);return c;}
function publicPost(post){if(!post)return null;return {state:post.state,operation:post.operation,updatedAt:post.updatedAt,postedAt:post.postedAt||null,url:post.messages?.[0]?TELEGRAM_URL+'/'+post.messages[0].message_id:null,textUrl:post.textMessageId?TELEGRAM_URL+'/'+post.textMessageId:null,error:post.error||'',hasText:!!post.textMessageId,sentPhotos:post.messages?.length?post.snapshot?.photos?.map(p=>p.id)||[]:[],snapshotRevision:post.snapshot?.revision,sold:!!post.snapshot?.sold};}
async function cas(db,id,old,next){const r=old?await db.prepare('UPDATE app_meta SET value=? WHERE key=? AND value=?').bind(JSON.stringify(next),key(id),JSON.stringify(old)).run():await db.prepare('INSERT OR IGNORE INTO app_meta(key,value) VALUES(?,?)').bind(key(id),JSON.stringify(next)).run();if(!r.meta.changes)fail('Отправка уже запущена или состояние изменилось. Обновите статус.',409);}
async function saveJob(db,id,job){job.updatedAt=now();await put(db,key(id),job);}
function messages(result,count,chatId){const rows=Array.isArray(result)?result:[result];if(rows.length!==count||rows.some(m=>!Number.isSafeInteger(m.message_id)||m.chat?.id!==chatId))throw Object.assign(new Error('Telegram не вернул подтверждение всех сообщений. Проверьте канал.'),{status:502,definite:false});return rows.map(m=>({message_id:m.message_id}));}
export async function telegramRequest(req,env,actor,member,deps){
 const db=env.DB,path=new URL(req.url).pathname,fetcher=deps.fetcher||fetch;
 if(path==='/api/telegram/config'&&req.method==='GET')return json(await config(env));
 if(path==='/api/telegram/check'&&req.method==='POST'){if(member.role!=='owner')fail('Подключение настраивает владелец.',403);const c=await checkConnection(env,fetcher),old=await get(db,'telegram:connection');if(old&&old.chatId!==c.chatId)fail('Адрес канала теперь принадлежит другому каналу. Подключение остановлено.',409);await put(db,'telegram:connection',c);return json(await config(env));}
 const m=path.match(/^\/api\/cars\/([^/]+)\/telegram(?:\/(preview|publish|update|generate|status))?$/);if(!m)return null;
 const c=await deps.getCar(db,decodeURIComponent(m[1])),post=await get(db,key(c.id));
 if(req.method==='GET'&&(!m[2]||m[2]==='status'))return json({draft:telegramDraft(c),post:publicPost(post),config:await config(env)});
 if(member.role==='viewer')fail('Ваша роль разрешает только просмотр.',403);
 if(['publish','update','preview'].includes(m[2])&&member.role!=='owner')fail('Публикация доступна владельцу CRM.',403);
 if(!['PATCH','POST'].includes(req.method))fail('Метод не поддерживается.',405);
 const b=await body(req);if(c.revision!==Number(b.revision))fail('Карточка изменилась. Обновите её перед продолжением.',409);
 if(!m[2]&&req.method==='PATCH'){
  const frozen=!!post?.messages?.length;if(frozen&&JSON.stringify(b.photoIds)!==JSON.stringify(telegramDraft(c).photoIds))fail('Фото уже отправленного альбома не меняются. Можно обновить текст и цену.');const v=telegramInput(c,frozen?{...b,photoIds:[]}:b);if(frozen)v.photoIds=telegramDraft(c).photoIds;c.telegram={...v,updatedAt:now()};deps.event(c,'Сохранён черновик Telegram','Публикация в канал не выполнялась.');return json(await deps.persist(db,c,c.revision));
 }
 if(req.method!=='POST')fail('Метод не поддерживается.',405);
 if(m[2]==='generate')return json(await avitoAI(env,actor,c,{fields:avitoFields(c)},'text',fetcher));
 if(m[2]==='preview'){
  const operation=b.operation==='update'?'update':'publish',snapshot=telegramSnapshot(c,operation);
  if(operation==='publish'&&post&&!['failed'].includes(post.state))fail('Публикация уже создана или её результат требует проверки. Используйте обновление текста.',409);
  if(operation==='update'&&(!post?.textMessageId||!['published','update_failed','update_unknown'].includes(post.state)))fail('Нет опубликованного текста для обновления.',409);
  if(operation==='update')snapshot.photos=post.snapshot.photos;
  const preview={id:crypto.randomUUID(),actorId:actor.id,operation,snapshot,expiresAt:Date.now()+600000};await put(db,'telegram:preview:'+c.id,preview);return json(preview);
 }
 if(!['publish','update'].includes(m[2]))fail('Действие не поддерживается.',405);
 if(b.confirm!==m[2])fail('Подтвердите отправку после предпросмотра.');
 const preview=await get(db,'telegram:preview:'+c.id);if(!preview||preview.id!==b.previewId||preview.actorId!==actor.id||preview.operation!==m[2]||preview.expiresAt<Date.now()||preview.snapshot.revision!==c.revision)fail('Предпросмотр устарел. Откройте его ещё раз.',409);
 const conn=await connection(env),fresh=await checkConnection(env,fetcher);if(conn.chatId!==fresh.chatId||conn.botId!==fresh.botId)fail('Подключение изменилось. Проверьте бота заново.',409);
 if(post&&(post.chatId!==conn.chatId||post.botId!==conn.botId))fail('Этот пост отправлял другой бот. Обновление остановлено.',409);
 const snapshot=preview.snapshot,operation=m[2];
 if(operation==='publish'&&post&&post.state!=='failed')fail('Повторная публикация заблокирована. Проверьте состояние поста.',409);
 if(operation==='update'&&(!post?.textMessageId||!['published','update_failed','update_unknown'].includes(post.state)))fail('Сообщение недоступно для обновления.',409);
 const job={...post,chatId:conn.chatId,botId:conn.botId,operation,state:operation==='publish'?'sending':'updating',operationId:crypto.randomUUID(),updatedAt:now(),actorId:actor.id,snapshot,error:'',messages:post?.messages||[]};
 await cas(db,c.id,post,job);let stage='prepare';
 try{
  const current=await deps.getCar(db,c.id);if(current.revision!==snapshot.revision)throw Object.assign(new Error('Карточка изменилась перед отправкой. Создайте новый предпросмотр.'),{definite:true});
  if(operation==='update'){
   stage='update';await telegramCall(env,'editMessageText',{chat_id:job.chatId,message_id:job.textMessageId,text:snapshot.text,link_preview_options:{is_disabled:true}},fetcher);
  }else{
   const form=new FormData();form.set('chat_id',String(job.chatId));const media=[];
   for(let i=0;i<snapshot.photos.length;i++){const f=snapshot.photos[i],bytes=await readPhoto(db,f.id);if(bytes.length!==f.size)throw Object.assign(new Error('Не удалось прочитать фотографию. Повторите предпросмотр.'),{definite:true});form.set('photo'+i,new Blob([bytes],{type:f.mime}),'car_'+i+(f.mime==='image/png'?'.png':'.jpg'));media.push({type:'photo',media:'attach://photo'+i,...(i===0?{caption:snapshot.title.slice(0,1024)}:{})});}
   if((await deps.getCar(db,c.id)).revision!==snapshot.revision)throw Object.assign(new Error('Карточка изменилась при подготовке фотографий.'),{definite:true});
   if(media.length===1){form.set('photo',form.get('photo0'));form.delete('photo0');form.set('caption',snapshot.title.slice(0,1024));}else form.set('media',JSON.stringify(media));
   stage='album';const result=await telegramCall(env,media.length===1?'sendPhoto':'sendMediaGroup',form,fetcher);job.messages=messages(result,media.length,job.chatId);await saveJob(db,c.id,job);
   stage='text';const text=await telegramCall(env,'sendMessage',{chat_id:job.chatId,text:snapshot.text,link_preview_options:{is_disabled:true},reply_parameters:{message_id:job.messages[0].message_id}},fetcher);job.textMessageId=messages(text,1,job.chatId)[0].message_id;
  }
  job.state='published';job.postedAt||=now();job.error='';await saveJob(db,c.id,job);
  let latest=null;try{latest=await deps.getCar(db,c.id);deps.event(latest,operation==='publish'?'Опубликовано в Telegram':'Обновлён пост Telegram',TELEGRAM_URL+'/'+job.textMessageId);latest=await deps.persist(db,latest,latest.revision);}catch{latest=null;}
  return json({post:publicPost(job),car:latest});
 }catch(e){job.state=operation==='update'?(e.definite?'update_failed':'update_unknown'):stage==='prepare'?'failed':job.messages.length?'partial':e.definite?'failed':'unknown';job.error=e.message||'Не удалось завершить публикацию.';await saveJob(db,c.id,job);return json({post:publicPost(job),warning:job.error});}
}
