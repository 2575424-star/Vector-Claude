export const POWER_SEED=[{id:'bmw-x5-30d-xline-2024-kr',brand:'BMW',model:'X5',trim:'xDrive 30d xLine',year:'2024',engine:'2993',market:'Корея',powerHp:298,powerKind:'system',powertrain:'other',source:'Подтверждено Павлом; BMW: общая мощность 298 л.с.',sourceUrl:'https://www.bmw.co.uk/en/all-models/x-models/x5/bmw-x5-technical-data.html'}];
const norm=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export const powerIdentity=q=>[q.brand,q.model,q.trim,q.year,q.engine,q.market||'Корея'].map(norm).join('|');
export function cleanPower(b){const out={};for(const k of ['brand','model','trim','year','engine','market','source','sourceUrl','powerKind','powertrain'])out[k]=String(b[k]??'').trim().slice(0,k==='sourceUrl'?500:200);out.market=out.market||'Корея';
 if(!out.brand||!out.model||!out.trim||!/^\d{4}$/.test(out.year)||!(Number(out.engine)>0))throw new Error('Для справочника нужны марка, модель, модификация, год и объём в см³');
 out.powerHp=Number(b.powerHp);if(!Number.isFinite(out.powerHp)||out.powerHp<=0||out.powerHp>3000)throw new Error('Мощность должна быть от 0 до 3000 л.с.');
 if(!['system','engine'].includes(out.powerKind))throw new Error('Выберите: общая мощность или мощность ДВС');
 if(out.sourceUrl){const u=new URL(out.sourceUrl);if(u.protocol!=='https:'||u.username||u.password)throw new Error('Источник должен быть HTTPS-ссылкой');}
 if(!['ice','other',''].includes(out.powertrain))out.powertrain='';return out;
}
export function powerMatches(q,rows){return rows.filter(r=>powerIdentity(r)===powerIdentity(q));}
export function applyPower(q,row){return {...q,powerHp:row.powerHp,powerKind:row.powerKind,powerSource:row.source||'Справочник мощности',powerReference:row.sourceUrl||'',powerCatalogKey:powerIdentity(q),powertrain:'ice'};}
export function resolvePower(q,rows,preferCatalog=false){if(!preferCatalog&&q.powerHp!==''&&q.powerHp!=null)return q;const matches=powerMatches(q,rows);return matches.length===1?applyPower(q,matches[0]):q;}
export async function powerRows(db){const {results}=await db.prepare("SELECT value FROM app_meta WHERE key LIKE 'encar:power:%'").all();const overrides=results.map(r=>JSON.parse(r.value));const keys=new Set(overrides.map(powerIdentity));return [...overrides,...POWER_SEED.filter(r=>!keys.has(powerIdentity(r)))];}
export async function storePower(db,actor,b){const row=cleanPower(b);const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(powerIdentity(row)));const id=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');const key='encar:power:'+id;
 const prior=await db.prepare('SELECT value FROM app_meta WHERE key=?').bind(key).first();if(prior&&b.expectedUpdatedAt!==JSON.parse(prior.value).updatedAt)throw new Error('Запись справочника уже изменена. Обновите список перед сохранением.');
 const out={...row,id,updatedAt:new Date().toISOString(),updatedBy:actor.name};const stmt=prior?db.prepare("UPDATE app_meta SET value=? WHERE key=? AND json_extract(value,'$.updatedAt')=?").bind(JSON.stringify(out),key,b.expectedUpdatedAt):db.prepare('INSERT OR IGNORE INTO app_meta(key,value) VALUES(?,?)').bind(key,JSON.stringify(out));const r=await stmt.run();if(!r.meta.changes)throw new Error('Запись уже добавлена другим сотрудником');return out;
}
