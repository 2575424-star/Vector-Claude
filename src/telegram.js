export const TELEGRAM_CHANNEL='boom_avto_vrn';
export const TELEGRAM_URL='https://t.me/'+TELEGRAM_CHANNEL;
export const telegramPhoto=f=>f.category==='Фото'&&!f.partyRole&&!f.paymentDocument&&!f.vehicleDocument&&!f.contract&&['image/jpeg','image/png'].includes(f.mime);
export const telegramPhotos=c=>(c.files||[]).filter(telegramPhoto);
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status})};
export function telegramInput(c,b){
 if(!b||typeof b!=='object')fail('Проверьте данные поста.');
 const description=String(b.description??'').trim(),contact=String(b.contact??'').trim();
 if(description.length>3000||contact.length>300)fail('Описание — до 3000 символов, контакт — до 300.');
 const photoIds=Array.isArray(b.photoIds)?[...new Set(b.photoIds)]:[];
 if(photoIds.length>10||photoIds.some(id=>!telegramPhotos(c).some(f=>f.id===id)))fail('Выберите до 10 фотографий JPG или PNG из этой карточки.');
 return {description,contact,photoIds,sold:b.sold===true};
}
export function telegramDraft(c){return {description:c.telegram?.description??c.avito?.fields?.Description??c.publication?.description??'',contact:c.telegram?.contact||'',photoIds:c.telegram?.photoIds||[],sold:!!c.telegram?.sold};}
const money=n=>new Intl.NumberFormat('ru-RU').format(n)+' ₽';
export function telegramText(c,draft=telegramDraft(c)){
 const a=c.avito?.fields||{},title=[c.brand,c.model,c.year].filter(Boolean).join(' '),lines=[title];
 if(c.mileage!=null)lines.push('Пробег: '+new Intl.NumberFormat('ru-RU').format(c.mileage)+' км');
 const specs=[a.FuelType,a.EngineSize?a.EngineSize+' л':'',a.Power?a.Power+' л.с.':'',a.Transmission,a.DriveType].filter(Boolean);if(specs.length)lines.push(specs.join(' · '));
 if(c.trim)lines.push('Комплектация: '+c.trim);if(c.color)lines.push('Цвет: '+c.color);
 if(draft.description)lines.push('',draft.description);
 lines.push('',draft.sold||c.status==='Продан'||c.soldDate?'ПРОДАНО':c.price>0?'Цена: '+money(c.price):'Цена по запросу');
 if(draft.contact)lines.push('',draft.contact);
 return {title,text:lines.join('\n')};
}
export function telegramSnapshot(c,mode='publish'){
 const saved=telegramDraft(c),d=telegramInput(c,mode==='update'?{...saved,photoIds:[]}:saved),t=telegramText(c,d);
 if(c.isDemo||c.archived)fail('Тестовые и архивные автомобили не публикуются.');
 if(mode==='publish'&&(d.sold||c.status==='Продан'||c.soldDate))fail('Проданный автомобиль нельзя опубликовать заново.');
 if(t.text.length>4096)fail('Пост длиннее 4096 символов. Сократите описание.');
 if(mode==='publish'&&!d.photoIds.length)fail('Выберите фотографии для поста.');
 const photos=d.photoIds.map(id=>{const f=telegramPhotos(c).find(f=>f.id===id);if(f.size>10000000)fail('Для Telegram фотография должна быть меньше 10 МБ.');return {id:f.id,mime:f.mime,size:f.size};});
 if(photos.reduce((n,p)=>n+p.size,0)>25000000)fail('Для одной отправки выберите фотографии общим размером до 25 МБ.');
 return {carId:c.id,revision:c.revision,channel:TELEGRAM_CHANNEL,...t,photos,sold:d.sold||c.status==='Продан'||!!c.soldDate};
}
