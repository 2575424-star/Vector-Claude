import {photoURLs} from './encar-photos.js';
export const LEGACY_FIELDS=[['krw','Цена автомобиля, ₩'],['krwPerUsd','Вонов за 1 доллар'],['eurUsd','Долларов за 1 евро'],['usdRub','Рублей за 1 доллар'],['koreaUsd','Расходы Корея → Бишкек, $'],['bishkekUsd','Услуги в Бишкеке, $'],['deliveryUsd','Доставка Бишкек → Воронеж, $'],['documentsRub','Документы, ₽'],['utilRub','Утилизационный сбор, ₽'],['servicesRub','Наши услуги, ₽']];
const legacyEmpty=()=>({brand:'',model:'',trim:'',vin:'',year:'',mileage:'',engine:'',encarId:'',url:'',tableId:'',eur:'',manualTpo:'',rateDate:'',rateSource:'',krw:'',krwPerUsd:'',eurUsd:'',usdRub:'',koreaUsd:0,bishkekUsd:0,deliveryUsd:0,documentsRub:0,utilRub:'',servicesRub:0});
const number=v=>v===''||v==null?null:Number(v);
const round=v=>Math.round((v+Number.EPSILON)*100)/100;
function legacyResult(q){const n=k=>number(q[k]);const missing=[];for(const [k,label] of LEGACY_FIELDS){if(k==='eurUsd'&&n('manualTpo')!==null)continue;const v=n(k);if(v===null||!Number.isFinite(v)||v<0||(['krwPerUsd','eurUsd','usdRub'].includes(k)&&v===0))missing.push(label);}
 const manual=n('manualTpo'),eur=n('eur'),rate=n('eurUsd');
 const tpo=manual!==null&&Number.isFinite(manual)&&manual>=0?manual:eur!==null&&eur>0&&rate>0?round(eur*.48*rate):null;
 if(tpo===null)missing.push('Стоимость по таблице ТПО или ручной ТПО');
 const price=n('krw')!==null&&n('krwPerUsd')>0?n('krw')/n('krwPerUsd'):null;
 if(missing.length)return {tpo,priceUsd:price===null?null:round(price),usd:null,rub:null,missing};
 const usd=price+tpo+n('koreaUsd')+n('bishkekUsd')+n('deliveryUsd');const rub=usd*n('usdRub')+n('documentsRub')+n('utilRub')+n('servicesRub');
 return {tpo,priceUsd:round(price),usd:round(rub/n('usdRub')),rub:round(rub),missing};}
import {utilization,num,money} from './encar-util.js';
export const ENCAR_FIELDS=[['krw','Цена автомобиля, ₩'],['discountPct','Скидка / возврат, %'],['koreaKrw','Все расходы до Бишкека, ₩'],['krwPerUsd','Вонов за 1 доллар'],['bishkekUsd','Брокер, $'],['deliveryUsd','Доставка Бишкек → Воронеж, $'],['usdRub','Рублей за 1 доллар'],['markupPct','Надбавка при переводе в рубли, %'],['documentsRub','Документы, ₽']];
export const emptyQuote=()=>({...legacyEmpty(),formulaVersion:2,photoUrls:[],discountPct:4,koreaKrw:6000000,bishkekUsd:1000,deliveryUsd:1200,markupPct:2,documentsRub:85000,powerHp:'',powerSource:'',powerKind:'system',market:'Корея',powerReference:'',powerCatalogKey:'',powertrain:'ice',utilAge:'',utilYear:new Date().getUTCFullYear(),utilRegime:'standard',eaeuRub:0});
export function newFormulaCopy(old){const q=emptyQuote();for(const k of ['brand','model','trim','vin','year','mileage','engine','encarId','url','tableId','eur','manualTpo','rateDate','rateSource','krw','krwPerUsd','eurUsd','usdRub','utilRub'])q[k]=old[k]??q[k];return q;}
export function quoteResult(q){
 if(Number(q.formulaVersion)!==2)return legacyResult(q);
 const n=k=>num(q[k]),missing=[];
 for(const [k,label] of ENCAR_FIELDS){const v=n(k);if(v===null||!Number.isFinite(v)||v<0||(['krwPerUsd','usdRub'].includes(k)&&v===0)||(['discountPct','markupPct'].includes(k)&&v>100))missing.push(label);}
 const manual=n('manualTpo'),eur=n('eur'),rate=n('eurUsd');
 const tpo=manual!==null&&Number.isFinite(manual)&&manual>=0?manual:eur>0&&rate>0&&Number.isFinite(eur*rate)?money(eur*.48*rate):null;
 if(tpo===null)missing.push(eur>0?'Курс: долларов за 1 евро для ТПО':'Стоимость по таблице ТПО или ручной ТПО');
 const util=utilization({...q,powertrain:'ice'});if(util.rub===null)missing.push(util.reason);
 const valid=k=>n(k)!==null&&Number.isFinite(n(k))&&n(k)>=0;
 const discountedKrw=valid('krw')&&valid('discountPct')&&n('discountPct')<=100?n('krw')*(1-n('discountPct')/100):null;
 const landedKrw=discountedKrw!==null&&valid('koreaKrw')?discountedKrw+n('koreaKrw'):null;
 const priceUsd=landedKrw!==null&&n('krwPerUsd')>0?landedKrw/n('krwPerUsd'):null;
 const subtotalUsd=priceUsd!==null&&tpo!==null&&valid('bishkekUsd')&&valid('deliveryUsd')?priceUsd+tpo+n('bishkekUsd')+n('deliveryUsd'):null;
 const convertedRub=subtotalUsd!==null&&n('usdRub')>0?subtotalUsd*n('usdRub'):null;
 const markupRub=convertedRub!==null&&valid('markupPct')?convertedRub*n('markupPct')/100:null;
 const beforeUtilRub=convertedRub!==null&&markupRub!==null&&valid('documentsRub')?convertedRub+markupRub+n('documentsRub'):null;
 const rub=missing.length||beforeUtilRub===null?null:money(beforeUtilRub+util.rub);
 return {tpo,util,discountedKrw:discountedKrw===null?null:money(discountedKrw),landedKrw:landedKrw===null?null:money(landedKrw),priceUsd:priceUsd===null?null:money(priceUsd),subtotalUsd:subtotalUsd===null?null:money(subtotalUsd),convertedRub:convertedRub===null?null:money(convertedRub),markupRub:markupRub===null?null:money(markupRub),beforeUtilRub:beforeUtilRub===null?null:money(beforeUtilRub),rub,usd:rub===null?null:money(rub/n('usdRub')),missing};
}
export function cleanQuote(b){const q=Number(b.formulaVersion)===2?emptyQuote():legacyEmpty();q.formulaVersion=Number(b.formulaVersion)===2?2:1;
 for(const k of ['brand','model','trim','vin','year','mileage','engine','encarId','url','tableId','rateDate','rateSource','powerSource','powerReference','powerCatalogKey','powerKind','market','powertrain','utilAge','utilRegime'])q[k]=String(b[k]??q[k]??'').trim().slice(0,k==='url'?500:150);
 if(q.url){const u=new URL(q.url);if(u.protocol!=='https:'||u.username||u.password||u.port||!['www.encar.com','fem.encar.com'].includes(u.hostname)||!/^\/cars\/detail\/\d+\/?$/.test(u.pathname))throw new Error('Укажите объявление Encar');q.url=u.origin+u.pathname;q.encarId=u.pathname.match(/\d+/)[0];}
 const fields=q.formulaVersion===2?[...ENCAR_FIELDS.map(f=>f[0]),'eurUsd','powerHp','utilYear','eaeuRub','utilRub'] : LEGACY_FIELDS.map(f=>f[0]);
 for(const k of [...fields,'eur','manualTpo']){const v=num(b[k]);if(v!==null&&(!Number.isFinite(v)||v<0||v>1e12||(['krwPerUsd','eurUsd','usdRub'].includes(k)&&v===0)||(['discountPct','markupPct'].includes(k)&&v>100)))throw new Error('Проверьте числовые поля');q[k]=v;}
 q.photoUrls=photoURLs(b.photoUrls);return q;
}
export function readEncarImport(hash){try{if(!hash.startsWith('#encar?'))return null;const raw=new URLSearchParams(hash.slice(7)).get('import');if(!raw||raw.length>10000)return null;return cleanQuote(JSON.parse(raw));}catch{return null;}}
