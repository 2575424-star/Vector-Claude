import {PARTY_FIELDS,daysInStock,validDate,today} from './domain.js';
import {stageById,routeDurations} from './route-stages.js';
import {BASIS_FIELDS,costSummary} from './cost-basis.js';

export const SECTION_LABELS={overview:'Обзор',route:'Маршрут',costs:'Себестоимость',files:'Документы',photos:'Фото и видео',history:'История',publication:'Описание объявления',avito:'Авито'};
const LABELS={brand:'Марка',model:'Модель',vin:'VIN',owner:'Собственник',year:'Год',productionMonth:'Месяц выпуска',trim:'Комплектация',color:'Цвет',country:'Страна вывоза',location:'Местонахождение',status:'Текущий статус',price:'Цена продажи, ₽',mileage:'Пробег, км',purchaseDate:'Дата покупки из обзора',stockDate:'Дата поступления на склад из обзора',soldDate:'Дата продажи',contact:'Контакт',notes:'Заметки',documentStatus:'Статус документов',eptsStatus:'Статус ЭПТС'};
const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>v?.[k]!==undefined).map(k=>[k,v[k]]));
export const carLabel=c=>`${c.brand} ${c.model}${c.vin?' · VIN …'+c.vin.slice(-6):''}`;
export const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/мерседес(?:[ _-]*бенц)?|мерс(?:а|у|е)?\b/gu,'mercedesbenz').replace(/бмв/gu,'bmw').replace(/фольксваген/gu,'volkswagen').replace(/туарег/gu,'touareg').replace(/рейндж\s*ровер/gu,'rangerover').replace(/ленд\s*ровер/gu,'landrover').replace(/(\d)\s*д\b/gu,'$1d').replace(/[ _-]/g,'').replace(/[^\p{L}\p{N}]/gu,'');
const pluralQuestion=q=>/\b(?:all|compare)\b|(?:все|всех|какие|каких|список|сравни|сколько\s+(?:всего\s+)?(?:машин|авто)|по\s+кажд)/iu.test(q);
export function resolveCars(cars,question,selectedId='',lastIds=[]){
 if(selectedId){const c=cars.find(c=>c.id===selectedId);return c?{cars:[c],ambiguous:false}:{cars:[],ambiguous:false,notFound:true};}
 const q=norm(question).replace(/(\d)д/gu,'$1d'),tokens=String(question).toLowerCase().match(/[a-zа-яё0-9]+/gu)||[];
 const scores=cars.map(c=>{let score=0;const vin=String(c.vin||'').toLowerCase(),brand=norm(c.brand),model=norm(c.model);
  if(vin&&q.includes(vin))score=200;
  if(vin&&tokens.some(t=>/^[a-z0-9]{4,16}$/.test(t)&&vin.endsWith(t)))score=Math.max(score,150);
  if(model.length>=2&&q.includes(model))score+=60;
  // BMW X7 / Х7 and G450d / G 450 d are common spoken and typed forms.
  if(model.length>=2&&q.replace(/х(?=\d)/gu,'x').replace(/г(?=\d)/gu,'g').includes(model))score=Math.max(score,60);
  if(brand&&q.includes(brand))score+=20;
  if(/гелик|гелендваген/iu.test(question)&&/mercedes/.test(brand)&&/^g(?:class)?\d/.test(model))score+=60;
  if(c.owner&&norm(c.owner).length>=3&&q.includes(norm(c.owner)))score+=10;
  return {c,score};});
 const matched=scores.filter(x=>x.score>0),best=Math.max(0,...matched.map(x=>x.score));
 if(best<60&&/(?:[xgхг]\s*\d{1,3}|\d{3}\s*[diд])(?:[^a-zа-я0-9]|$)/iu.test(question))return {cars:[],ambiguous:false,notFound:true};
 if(tokens.some(t=>/^[a-hj-npr-z0-9]{17}$/.test(t)&&!cars.some(c=>String(c.vin||'').toLowerCase()===t)))return {cars:[],ambiguous:false,notFound:true};
 if(matched.length){const chosen=pluralQuestion(question)?matched:matched.filter(x=>x.score===best);return {cars:chosen.map(x=>x.c),ambiguous:chosen.length>1&&!pluralQuestion(question)};}
 if(!pluralQuestion(question)&&lastIds.length===1&&/(?:^он(?:\s|$)|него|нему|ней|этот|этого|эта|машин|автомобил|^а\s|^и\s)/iu.test(question)){const c=cars.find(c=>c.id===lastIds[0]);if(c)return {cars:[c],ambiguous:false};}
 if(pluralQuestion(question))return {cars:cars.filter(c=>!c.archived),ambiguous:false,wholeInventory:true};
 return {cars:cars.filter(c=>!c.archived),ambiguous:false,unresolved:true};
}
export function carSources(c,question='',at=today()){
 const rows=[],add=(section,data)=>rows.push({id:c.id+':'+section,carId:c.id,carLabel:carLabel(c),section,label:SECTION_LABELS[section],data});
 add('overview',{...Object.fromEntries(Object.entries(LABELS).map(([k,label])=>[label,c[k]??null])),Архив:!!c.archived,'Дней на складе':daysInStock(c,at)});
 const routes=(c.route||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 add('route',{этапы:routes.filter(r=>stageById(r.stage)).map(r=>({id:r.id,этап:stageById(r.stage).label,код:r.stage,дата:r.date,местонахождение:r.location,статус:r.status,комментарий:r.note||''})),прочиеЗаписи:routes.filter(r=>!stageById(r.stage)).map(r=>({дата:r.date,статус:r.status,местонахождение:r.location,комментарий:r.note||''})),длительности:routeDurations(routes,at),примечание:'Даты этапов маршрута не равны датам создания/изменения карточки. Прочие записи могут быть автоматическими.'});
 add('costs',{основныеРасходы:Object.fromEntries(BASIS_FIELDS.map(([k,label])=>[label,c.costBasis?.[k]??null])),прежняяЛогистикаРуб:c.costBasis?.logisticsRub??null,дополнительныеРасходы:(c.costs||[]).map(x=>pick(x,['type','date','description','amount','currency','rate'])),итого:costSummary(c)});
 const sensitive=/(?:паспорт|покупат|продав|фио|фамил|адрес|телефон|контакт|рожден)/iu.test(question);
 const party=p=>p?(sensitive?Object.fromEntries(PARTY_FIELDS.map(([k,label])=>[label,p[k]||null])):{ФИО:p.fullName||null}):null;
 add('files',{статусДокументов:c.documentStatus||'Нет',статусЭПТС:c.eptsStatus||null,покупатель:party(c.buyer),продавец:party(c.seller),оплата:c.payment||null,черновикДоговора:c.contractDraft||null,файлы:(c.files||[]).filter(f=>!['Фото','Видео'].includes(f.category)).map(f=>pick(f,['id','name','date','category','partyRole','vehicleDocument','paymentDocument','contract','size'])),примечание:'Есть только заполненные поля и реквизиты файлов. Содержимое PDF, фото паспортов и сканов здесь не прочитано.'});
 add('photos',{файлы:(c.files||[]).filter(f=>['Фото','Видео'].includes(f.category)).map(f=>pick(f,['id','name','category','date','size'])),обложка:(c.files||[]).find(f=>f.category==='Фото')?.name||null});
 const relevant=/(?:истори|измен|редакт|добав|раньше|предыдущ|было|кто.*цен)/iu.test(question),history=c.history||[];
 add('history',{записи:history.slice(0,relevant?100:10).map(h=>({...pick(h,['date','title','detail']),автор:h.actor?.name||h.actor?.email||null})),всегоЗаписей:history.length,ограничение:history.length>(relevant?100:10)?'Показаны только последние записи; это не вся история.':null});
 add('publication',{выбранНаСайт:!!c.publication?.enabled,описание:c.publication?.description||'',стандартныйТекст:c.publication?.standardText||''});
 add('avito',{подготовка:c.avito||null,примечание:'Вкладка подготовки файла. Статус отмечается вручную, selected означает включение в файл, не факт публикации на Авито. Автоматическая публикация не подключена.'});
 return rows;
}
const date=d=>validDate(d)?d.split('-').reverse().join('.'):String(d||'не указана');
function refs(c,sections){return sections.map(section=>({id:c.id+':'+section,carId:c.id,carLabel:carLabel(c),section,label:SECTION_LABELS[section]}));}
const factualResult=(text,c,sections)=>({text,sources:refs(c,sections),carIds:[c.id],engine:'database'});
export function directAnswer(question,cars,resolution,at=today()){
 if(/(?<![\p{L}\p{N}])(?:измени|изменить|поменяй|поставь|удали|удалить|загрузи|сохрани|отредактируй|создай|добавь|перенеси|опубликуй)(?![\p{L}\p{N}])/iu.test(question))return {text:'Сейчас VECTOR AI работает только для поиска информации. Изменение карточек, загрузка файлов и другие действия через ассистента отключены. Обычное ручное редактирование CRM доступно.',sources:[],carIds:[],engine:'database'};
 if(resolution.ambiguous)return {text:'Нашлось несколько подходящих автомобилей. Выберите нужный — VIN и собственник помогут их различить.',sources:[],carIds:[],choices:cars.map(c=>({id:c.id,label:carLabel(c),owner:c.owner||''})),engine:'database'};
 if(cars.length!==1)return null;const c=cars[0],title=carLabel(c),q=question.toLowerCase(),routes=c.route||[];
 if(/(?:когда|дат[ауы]|числ[ао])/iu.test(q)&&/(?:выкуп|отправ)/iu.test(q)&&!/(?:приб|приех|план|ожида|истори)/iu.test(q)){
  const stage=/выкуп/iu.test(q)?'purchased':/кореи|корею/iu.test(q)?'departed_korea':/воронеж|бишкека/iu.test(q)?'departed_voronezh':null;
  if(stage){const rows=routes.filter(r=>r.stage===stage).sort((a,b)=>String(a.date).localeCompare(String(b.date)));return factualResult(title+'\n'+(rows.length?rows.map(r=>`${stageById(stage).label}: ${date(r.date)}.`).join('\n'):`Этап «${stageById(stage).label}» в маршруте не записан.`),c,['route']);}
 }
 if(/(?:когда|дат[ауы]|числ[ао]|прибыл\s+ли|приехал\s+ли)/iu.test(q)&&/(?:приб|приех|доех|поступ)/iu.test(q)&&!/(?:прибуд|приед|план|ожида)/iu.test(q)){
  const city=/бишкек/iu.test(q)?'Бишкек':/воронеж/iu.test(q)?'Воронеж':null;
  const stages=city?[city==='Бишкек'?'arrived_bishkek':'arrived_voronezh']:['arrived_bishkek','arrived_voronezh'];
  const arrivals=routes.filter(r=>stages.includes(r.stage)).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  if(arrivals.length)return factualResult(title+'\n'+arrivals.map(r=>`${stageById(r.stage).label}: ${date(r.date)}.`).join('\n')+'\nИсточник: Маршрут.',c,['route']);
  const legacy=routes.filter(r=>!r.stage&&['Прибыл','На складе'].includes(r.status)&&(!city||String(r.location||'').toLowerCase().includes(city.toLowerCase()))&&!/создан|создание/iu.test(r.note||''));
  if(legacy.length)return factualResult(title+'\nВ маршруте есть записи: '+legacy.map(r=>`${r.status}, ${r.location||'место не указано'} — ${date(r.date)}`).join('; ')+'. Это записи изменения статуса, а не отдельный этап прибытия.',c,['route']);
  return factualResult(`${title}\nЭтап прибытия${city?' в '+city:''} в маршруте не записан.`+(!city&&c.stockDate?` В обзоре есть дата поступления на склад: ${date(c.stockDate)} (место прибытия этим полем не определяется).`:''),c,!city&&c.stockDate?['route','overview']:['route']);
 }
 if(/(?:маршрут|этапы|хронологи.*достав|путь\s+авто)/iu.test(q)&&!/(?:сколько|дней|почему|сравн)/iu.test(q)){
  const items=routes.filter(r=>stageById(r.stage)).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  return factualResult(title+'\n'+(items.length?items.map(r=>`${date(r.date)} — ${stageById(r.stage).label}${r.location?' · '+r.location:''}`).join('\n'):'Отдельные этапы маршрута пока не добавлены.'),c,['route']);
 }
 if(/(?:сколько|количество|срок|занял|длитель)/iu.test(q)&&/(?:дней|дня|день|достав|пути|этап)/iu.test(q)&&!/(?:склад|продаж)/iu.test(q)){
  const d=routeDurations(routes,at);return factualResult(title+'\n'+d.periods.map(p=>`${p.label}: ${p.days===null?'не хватает дат':p.days+' дн.'+(p.ongoing?' (этап продолжается)':'')}`).join('\n')+'\nОт выкупа до прибытия в Воронеж: '+(d.total===null?'недостаточно записанных дат.':d.total+' дн.'),c,['route']);
 }
 if(/сколько.*(?:дней|дня).*склад|дней\s+на\s+складе/iu.test(q)){const n=daysInStock(c,at);return factualResult(`${title}\n${n===null?'Дата поступления на склад не указана.':`На складе: ${n} дн.${c.soldDate?' (до продажи)':''} Дата поступления: ${date(c.stockDate)}.`}`,c,['overview']);}
 if(/(?:какая|сколько|покажи|узнай|назови|цена)/iu.test(q)&&/цен[ауы]\s*(?:продаж|авто|у\b)|продажн[а-я]*\s+цен|за\s+сколько\s+прода/iu.test(q)&&!/(?:истори|почему|разниц|покупк|измен|раньше)/iu.test(q))return factualResult(`${title}\nЦена продажи: ${c.price==null||c.price===''?'не указана':new Intl.NumberFormat('ru-RU').format(c.price)+' ₽'}.`,c,['overview']);
 if(/(?:какая|сколько|итог|покажи).*себестоим|себестоим.*(?:какая|итого)/iu.test(q)){const total=costSummary(c);return factualResult(`${title}\nСебестоимость: ${total.rub===null?'не полностью рассчитана — не хватает курса':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(total.rub)+' ₽'}. Дополнительных расходов: ${(c.costs||[]).length}.`,c,['costs']);}
 if(/(?:где\s+(?:сейчас|находит|авто|машин)|местонахожд|текущий\s+статус)/iu.test(q)&&!/(?:документ|паспорт|файл)/iu.test(q))return factualResult(`${title}\nСтатус: ${c.status||'не указан'}. Местонахождение: ${c.location||'не указано'}.`,c,['overview','route']);
 return null;
}

export function selectSources(cars,question){
 let sources=cars.flatMap(c=>carSources(c,question));
 const priority=/авито|avito/iu.test(question)?'avito':/маршрут|приб|приех|достав|этап|выкуп|путь|пути/iu.test(question)?'route':/стоим|расход|курс|тпо|логист|утил/iu.test(question)?'costs':/документ|договор|паспорт|инвойс|покупат|продав|оплат|эптс|сбктс/iu.test(question)?'files':/истори|измен/iu.test(question)?'history':/фото|видео|облож/iu.test(question)?'photos':'overview';
 sources.sort((a,b)=>(a.section===priority?0:a.section==='overview'?1:2)-(b.section===priority?0:b.section==='overview'?1:2));
 let bytes=0;const selected=[];for(const s of sources){const size=JSON.stringify(s).length;if(bytes+size>160000)continue;selected.push(s);bytes+=size;}
 return {sources:selected,omitted:sources.length-selected.length};
}
