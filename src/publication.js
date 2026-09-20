import {DEFAULT_AD_TEXT,adDescription} from './publication-template.js';
// Only this explicit projection may leave the private CRM.
export const BOOM_ORIGIN='https://boom-auto.divine-lime-4457.chatgpt.site';
export const CRM_ORIGIN='https://vector-crm-pavel.divine-lime-4457.chatgpt.site';
const enc=new TextEncoder();
export const publicVideo=f=>f.category==='Видео'&&!f.partyRole&&['video/mp4','video/webm','video/quicktime'].includes(f.mime);
export const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export async function digest(bytes){return hex(await crypto.subtle.digest('SHA-256',bytes))}
export async function sign(payload,secret){if(!secret)throw Object.assign(new Error('Обмен с Бум Авто ещё не настроен'),{status:503});const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,enc.encode(JSON.stringify(payload))))}
export function eligible(c){return c.publication?.enabled===true&&!c.isDemo&&!c.archived&&c.status!=='Продан'&&!c.soldDate}
export function publicationInput(c,b){
 const description=String(b.description||'').trim();const photoIds=Array.isArray(b.photoIds)?[...new Set(b.photoIds)]:[];
 if(description.length>5000||photoIds.length>20)throw Object.assign(new Error('Описание — до 5000 символов, фото — до 20'),{status:400});
 if(photoIds.some(id=>!c.files.some(f=>f.id===id&&f.category==='Фото'&&!f.partyRole&&['image/jpeg','image/png','image/webp'].includes(f.mime))))throw Object.assign(new Error('Выберите только фотографии автомобиля'),{status:400});
 if(b.enabled===true&&(c.isDemo||c.archived||c.status==='Продан'||c.soldDate))throw Object.assign(new Error('Тестовый, архивный или проданный автомобиль нельзя опубликовать'),{status:400});

 const videoIds=Array.isArray(b.videoIds)?[...new Set(b.videoIds)]:(c.publication?.videoIds||[]).filter(id=>c.files.some(f=>f.id===id&&publicVideo(f)));
 if(videoIds.length>10||videoIds.some(id=>!c.files.some(f=>f.id===id&&publicVideo(f))))throw Object.assign(new Error('Выберите до 10 видео автомобиля'),{status:400});
 const useStandardText=(b.useStandardText??c.publication?.useStandardText)!==false;
 const standardText=String(b.standardText??c.publication?.standardText??DEFAULT_AD_TEXT);
 if(standardText.length>10000)throw Object.assign(new Error('Стандартный текст — до 10000 символов'),{status:400});
 return {enabled:b.enabled===true,description,photoIds,videoIds,autoPhotos:b.autoPhotos===true,useStandardText,standardText};
}
export function project(c){const available=c.files.filter(f=>f.category==='Фото'&&!f.partyRole&&['image/jpeg','image/png','image/webp'].includes(f.mime));const p=publicationInput(c,{...c.publication,photoIds:c.publication?.autoPhotos?available.slice(0,20).map(f=>f.id):(c.publication?.photoIds||[]).filter(id=>available.some(f=>f.id===id))});return {id:c.id,revision:c.revision,brand:c.brand,model:c.model,trim:c.trim||'',year:c.year,color:c.color||'',mileage:c.mileage??null,price:c.price,currency:'RUB',status:['Прибыл','На складе','Таможня пройдена'].includes(c.status)?'В наличии':'Под заказ',description:adDescription(c,p),videos:p.videoIds.map(id=>{const f=c.files.find(f=>f.id===id);return {id:f.id,mime:f.mime,size:f.size}}),photos:p.photoIds.map(id=>{const f=c.files.find(f=>f.id===id);return {id:f.id,mime:f.mime,size:f.size}})}}
export async function readPhoto(db,id){const {results}=await db.prepare('SELECT data FROM file_chunks WHERE file_id=? ORDER BY part').bind(id).all();const raw=atob(results.map(r=>r.data).join(''));return Uint8Array.from(raw,c=>c.charCodeAt(0))}
export async function selectedCars(db){const {results}=await db.prepare('SELECT data FROM cars').all();return results.map(r=>JSON.parse(r.data)).filter(eligible).sort((a,b)=>a.id.localeCompare(b.id)).map(project)}
export async function snapshot(db,secret){const cars=await selectedCars(db);if(cars.length>200)throw Object.assign(new Error('В одной выгрузке поддерживается до 200 автомобилей'),{status:400});const fingerprint=await digest(enc.encode(JSON.stringify(cars)));for(const c of cars)for(const p of c.photos){const bytes=await readPhoto(db,p.id);if(bytes.length!==p.size)throw new Error('Не удалось прочитать фото');p.sha256=await digest(bytes)}const payload={schema:1,source:CRM_ORIGIN,target:BOOM_ORIGIN,nonce:crypto.randomUUID(),issuedAt:Date.now(),expiresAt:Date.now()+15*60*1000,fingerprint,cars};return {payload,signature:await sign(payload,secret)}}
export async function verifyCurrent(db,envelope,secret){if(!envelope?.payload||await sign(envelope.payload,secret)!==envelope.signature||envelope.payload.expiresAt<Date.now())throw Object.assign(new Error('Срок выгрузки истёк. Начните заново.'),{status:409});if(await digest(enc.encode(JSON.stringify(await selectedCars(db))))!==envelope.payload.fingerprint)throw Object.assign(new Error('Карточки изменились во время выгрузки. Запустите её заново.'),{status:409});return {ok:true}}
