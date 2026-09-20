import template from './avito-template.json' with {type:'json'};
import {validDate} from './domain.js';

export const AVITO_TEMPLATE=template;
export const AVITO_STATES=[['draft','Черновик'],['preparing','Подготовка'],['published','Опубликовано'],['sold','Продано']];
export const AVITO_DOCS='https://www.avito.ru/autoload/documentation/templates/67035?fileFormat=excel';
export const AVITO_LABELS={Address:'Адрес осмотра',Id:'ID в файле Авито',AvitoId:'Номер объявления Авито',ManagerName:'Контактное лицо',ContactPhone:'Телефон',ContactMethod:'Способ связи',Category:'Категория',Description:'Описание',Price:'Цена, ₽',Accident:'Состояние',CarType:'Тип автомобиля',AdType:'Тип объявления',Kilometrage:'Пробег, км',Color:'Цвет',Make:'Марка Авито',Model:'Модель Авито',GenerationId:'ID поколения Авито',ModificationId:'ID модификации Авито',ComplectationId:'ID комплектации Авито',Generation:'Поколение',Modification:'Модификация',Complectation:'Комплектация',FuelType:'Двигатель / топливо',Transmission:'КПП',EngineSize:'Объём двигателя, л',Year:'Год выпуска',Doors:'Число дверей',BodyType:'Кузов',DriveType:'Привод',Power:'Мощность, л. с.',WheelType:'Руль',Owners:'Владельцев по ПТС',PTS:'ПТС',VIN:'VIN',GRN:'Госномер',RegInRussia:'Регистрация в России',OnOrder:'Под заказ',VideoURL:'Ссылка на видео',Interior:'Салон',InteriorColor:'Цвет салона',ClimateControl:'Климат-контроль',PowerSteering:'Усилитель руля',PowerWindows:'Стеклоподъёмники',AudioSystem:'Аудиосистема',Lights:'Фары',Wheels:'Диски',DateBegin:'Начало публикации',DateEnd:'Окончание публикации',Latitude:'Широта',Longitude:'Долгота'};
export const AVITO_GROUPS=[
 ['Объявление и контакты',['Address','ManagerName','ContactPhone','ContactMethod','AdType','AvitoId','OnOrder']],
 ['Автомобиль',['Make','Model','VIN','Year','Kilometrage','Color','Accident','Owners','PTS','RegInRussia','GRN']],
 ['Характеристики и каталог Авито',['GenerationId','ModificationId','ComplectationId','Generation','Modification','Complectation','FuelType','Transmission','EngineSize','Power','Doors','BodyType','DriveType','WheelType']],
 ['Дополнительно',['Interior','InteriorColor','ClimateControl','PowerSteering','PowerWindows','AudioSystem','Lights','Wheels','VideoURL','DateBegin','DateEnd']]
];
const keys=new Set(AVITO_GROUPS.flatMap(x=>x[1]).concat(['Description','Price']));
export const CAR_LINKS={VIN:'vin',Year:'year',Kilometrage:'mileage',Color:'color',Price:'price'};
export const NUMERIC_FIELDS=new Set(['Year','Kilometrage','Price','EngineSize','Power','Doors']);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const plain=(s,max=1000)=>String(s??'').trim().slice(0,max);
const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]/gu,'');
export const eligibleAvitoPhoto=f=>f.category==='Фото'&&!f.partyRole&&!f.vehicleDocument&&!f.paymentDocument&&!f.contract&&['image/jpeg','image/png','image/webp'].includes(f.mime);
export function avitoPhotos(c){return (c.files||[]).filter(eligibleAvitoPhoto);}
export function avitoFields(c,overrides){
 const stored=overrides??c.avito?.fields??{};
 const fields={Make:c.brand||'',Model:c.model||'',Complectation:c.trim||'',Category:'Автомобили',CarType:'С пробегом',AdType:'Автомобиль приобретён на продажу',Description:c.publication?.description||'',...stored};
 if(!overrides)for(const [k,f] of Object.entries(CAR_LINKS))fields[k]=c[f]??'';
 else for(const [k,f] of Object.entries(CAR_LINKS))if(fields[k]===undefined)fields[k]=c[f]??'';
 const color=template.choices.Color.find(x=>norm(x)===norm(fields.Color));if(color)fields.Color=color;
 fields.Category='Автомобили';fields.CarType='С пробегом';fields.Id=c.id;
 return fields;
}
export function avitoInput(c,b){
 if(!b||typeof b!=='object'||Array.isArray(b))fail('Проверьте данные объявления.');
 const state=b.state||'draft';if(!AVITO_STATES.some(x=>x[0]===state))fail('Выберите статус объявления.');
 if(b.fields===null||typeof b.fields!=='object'||Array.isArray(b.fields))fail('Проверьте поля Авито.');
 const fields={};for(const [k,v] of Object.entries(b.fields||{})){
  if(!keys.has(k))continue;
  if(v!==null&&!['string','number'].includes(typeof v))fail('Проверьте поле «'+(AVITO_LABELS[k]||k)+'».');
  const text=plain(v,k==='Description'?10000:1000);if(String(v??'').length>(k==='Description'?10000:1000))fail('Слишком длинное поле «'+(AVITO_LABELS[k]||k)+'».');
  if(text&&NUMERIC_FIELDS.has(k)){const n=Number(text.replace(',','.'));if(!Number.isFinite(n)||n<0||n>1e12)fail('Проверьте число в поле «'+AVITO_LABELS[k]+'».');fields[k]=n;}else fields[k]=text;
 }
 const ids=Array.isArray(b.photoIds)?[...new Set(b.photoIds)]:[];if(ids.length>50||ids.some(id=>!avitoPhotos(c).some(f=>f.id===id)))fail('Выберите только существующие фотографии этого автомобиля, до 50.');
 const title=plain(b.title,200),listingUrl=plain(b.listingUrl,1000);if(listingUrl){let u;try{u=new URL(listingUrl);}catch{fail('Проверьте ссылку на объявление.');}if(u.protocol!=='https:'||!(u.hostname==='avito.ru'||u.hostname.endsWith('.avito.ru'))||u.username||u.password)fail('Укажите HTTPS-ссылку на объявление Авито.');}
 if(state==='published'&&!listingUrl&&!fields.AvitoId)fail('Для отметки «Опубликовано» укажите ссылку или номер реального объявления.');
 if(b.selected===true&&(c.isDemo||c.archived||c.status==='Продан'||c.soldDate||state==='sold'))fail('Тестовый, архивный или проданный автомобиль нельзя включить в выгрузку.');
 return {state,title,listingUrl,fields,photoIds:ids,selected:b.selected===true,catalogConfirmed:b.catalogConfirmed===true};
}
export function avitoCheck(c,draft=c.avito){
 const fields=avitoFields(c,draft?.fields),errors=[],warnings=[];
 const add=(field,message)=>errors.push({field,label:AVITO_LABELS[field]||field,message});
 for(const f of template.fields){if(!f.required||['ImageNames','ImageUrls'].includes(f.key))continue;const v=fields[f.key];if(v===undefined||v===null||String(v).trim()==='')add(f.key,'Заполните поле');}
 for(const [k,v] of Object.entries(fields))if(v!==''&&v!=null&&template.choices[k]&&!template.choices[k].includes(String(v)))add(k,'Выберите значение из справочника Авито');
 for(const k of NUMERIC_FIELDS){const v=fields[k];if(v!==''&&v!=null&&(!Number.isFinite(Number(v))||Number(v)<0))add(k,'Неверное число');}
 for(const k of ['Year','Kilometrage','Price','Power','Doors'])if(fields[k]!==''&&fields[k]!=null&&!Number.isInteger(Number(fields[k])))add(k,'Нужно целое число');
 if(fields.Price!==''&&!(Number(fields.Price)>0))add('Price','Цена должна быть больше нуля');
 if(fields.Year!==''&&(Number(fields.Year)<1900||Number(fields.Year)>new Date().getUTCFullYear()+1))add('Year','Проверьте год выпуска');
 if(fields.VIN&&!/^[A-HJ-NPR-Z0-9]{17}$/i.test(fields.VIN))add('VIN','Нужен VIN из 17 латинских букв и цифр');
 if(fields.ContactPhone&&!/^\+?[\d\s()-]{7,25}$/.test(fields.ContactPhone))add('ContactPhone','Проверьте телефон');
 if(fields.Description&&/<(?:script|iframe|img|a)\b|https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(fields.Description))add('Description','Уберите ссылки, почту и небезопасный HTML из описания');
 for(const k of ['DateBegin','DateEnd'])if(fields[k]&&(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2}))?$/.test(fields[k])||!validDate(String(fields[k]).slice(0,10))||!Number.isFinite(Date.parse(fields[k]))))add(k,'Укажите существующую дату в формате ГГГГ-ММ-ДД');
 if(fields.DateBegin&&fields.DateEnd&&fields.DateEnd<fields.DateBegin)add('DateEnd','Окончание раньше начала публикации');
 const ids=draft?.photoIds||[];if(!ids.length)add('photos','Выберите фотографии для публикации');
 if(ids.some(id=>!avitoPhotos(c).some(f=>f.id===id)))add('photos','Одна из выбранных фотографий удалена или недоступна');
 if(!draft?.catalogConfirmed)add('catalog','Сверьте марку, модель, поколение и модификацию с каталогом Авито');
 if(c.isDemo||c.archived||c.soldDate||c.status==='Продан'||draft?.state==='sold')add('state','Тестовый, архивный или проданный автомобиль не выгружается');
 warnings.push('Проверка по шаблону от 10.09.2026. Актуальность значений каталога и итоговую модерацию проверяет Авито.');
 if(!fields.ContactPhone)warnings.push('Телефон не указан — проверьте контактный номер в профиле Авито.');
 return {ready:errors.length===0,errors,warnings,fields};
}
export function avitoRow(c){
 const check=avitoCheck(c);if(!check.ready)fail(`${c.brand} ${c.model}: ${check.errors.map(x=>x.label+': '+x.message).join('; ')}`);
 const photoIds=c.avito.photoIds,images=photoIds.map((id,i)=>{const f=avitoPhotos(c).find(f=>f.id===id);return {id,name:`${c.id}_${String(i+1).padStart(2,'0')}.${f.mime==='image/png'?'png':'jpg'}`,mime:f.mime,size:f.size,url:`/api/cars/${encodeURIComponent(c.id)}/files/${encodeURIComponent(id)}`};});
 const row={};for(const f of template.fields){const v=check.fields[f.key];if(v!==undefined&&v!==null&&v!=='')row[f.key]=v;}
 row.ImageNames=images.map(x=>x.name).join(' | ');delete row.ImageUrls;
 return {id:c.id,revision:c.revision,label:`${c.brand} ${c.model}`,row,images,warnings:check.warnings};
}
