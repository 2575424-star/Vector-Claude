import {photoResponse} from './encar-photos.js';
import {powerRows,storePower,resolvePower,cleanPower} from './encar-power.js';
import {fetchListing} from './encar-import.js';
import {cleanQuote,quoteResult} from './encar.js';
import table from './encar-table.json' with {type:'json'};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
let rateCache;
export async function encarRequest(req,env,actor){const u=new URL(req.url),db=env.DB;
 if(u.pathname==='/api/encar/photo'&&req.method==='GET')return photoResponse(req);
 if(u.pathname==='/api/encar/import'&&req.method==='POST'){
  const raw=await req.text();if(raw.length>2000)return json({error:'Ссылка слишком длинная'},400);
  let value;try{value=JSON.parse(raw).url;}catch{return json({error:'Не удалось прочитать ссылку'},400);}
  try{const data=await fetchListing(value,table);data.quote=resolvePower(data.quote,await powerRows(db),true);if(data.quote.powerCatalogKey)data.warnings=data.warnings.filter(w=>!w.startsWith('Мощность'));return json(data);}catch(e){return json({error:e.message},422);}
 }
 if(u.pathname==='/api/encar/power'&&req.method==='GET')return json({rows:await powerRows(db)});
 if(u.pathname==='/api/encar/power'&&req.method==='POST'){const raw=await req.text();if(raw.length>10000)return json({error:'Слишком большая запись'},413);try{return json(await storePower(db,actor,JSON.parse(raw)));}catch(e){return json({error:e.message},400);}}
 if(u.pathname==='/api/encar/rates' &&req.method==='GET'){
  if(rateCache&&Date.now()-rateCache.at<3600000)return json(rateCache.value);
  try{const r=await fetch('https://www.cbr-xml-daily.ru/daily_json.js',{redirect:'manual',signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error();const d=await r.json();const unit=k=>{const c=d.Valute?.[k];const v=c?.Value/c?.Nominal;if(!Number.isFinite(v)||v<=0)throw new Error();return v;};const usd=unit('USD'),eur=unit('EUR'),krw=unit('KRW');if(!d.Date||!Number.isFinite(Date.parse(d.Date)))throw new Error();const value={eurUsd:eur/usd,krwPerUsd:usd/krw,usdRub:usd,rateDate:d.Date.slice(0,10),rateSource:'ЦБ через cbr-xml-daily.ru'};rateCache={at:Date.now(),value};return json(value);}catch{return json({error:'Не удалось загрузить курсы. Укажите их вручную или повторите позже.'},503);}
 }
 if(u.pathname==='/api/encar/quotes'&&req.method==='GET'){const {results}=await db.prepare("SELECT value FROM app_meta WHERE key LIKE 'encar:quote:%' ORDER BY json_extract(value,'$.updatedAt') DESC LIMIT 200").all();return json({quotes:results.map(r=>JSON.parse(r.value))});}
 if(u.pathname==='/api/encar/quotes'&&req.method==='POST'){
  if(Number(req.headers.get('content-length'))>20000)return json({error:'Слишком большой расчёт'},413);
  const raw=await req.text();if(raw.length>20000)return json({error:'Слишком большой расчёт'},413);
  let b,q;try{b=JSON.parse(raw);q=cleanQuote(b);if(q.tableId){const row=table.find(r=>r.id===q.tableId);if(!row)throw new Error('Строка таблицы не найдена');q.eur=row.eur;}if(!q.brand||!q.model)throw new Error('Укажите марку и модель');}catch(e){return json({error:e.message||'Проверьте расчёт'},400);}
  const id=b.id?String(b.id):crypto.randomUUID();if(!/^[a-zA-Z0-9-]{1,80}$/.test(id))return json({error:'Неверный номер расчёта'},400);
  const key='encar:quote:'+id,now=new Date().toISOString();let prior=null;
  if(b.id){const row=await db.prepare('SELECT value FROM app_meta WHERE key=?').bind(key).first();if(!row)return json({error:'Расчёт не найден'},404);prior=JSON.parse(row.value);if(b.revision!==prior.revision)return json({error:'Расчёт уже изменён. Откройте сохранённую версию заново.'},409);}
  const out={...q,id,revision:(prior?.revision||0)+1,result:quoteResult(q),createdAt:prior?.createdAt||now,updatedAt:now,updatedBy:actor.name};
  const stmt=prior?db.prepare("UPDATE app_meta SET value=? WHERE key=? AND json_extract(value,'$.revision')=?").bind(JSON.stringify(out),key,prior.revision):db.prepare('INSERT OR IGNORE INTO app_meta(key,value) VALUES(?,?)').bind(key,JSON.stringify(out));const r=await stmt.run();if(!r.meta.changes)return json({error:'Расчёт изменён. Обновите список.'},409);return json(out);
 }
 return json({error:'Страница не найдена'},404);
}
