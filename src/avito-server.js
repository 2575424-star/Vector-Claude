import {avitoInput,avitoFields,avitoCheck,avitoRow,CAR_LINKS} from './avito.js';
import {avitoAI} from './avito-ai.js';
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status})};
const json=v=>Response.json(v,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function body(req){if(Number(req.headers.get('Content-Length')||0)>160000)fail('Слишком большой запрос.',413);const reader=req.body?.getReader();if(!reader)fail('Нет данных.');let n=0;const parts=[];try{while(true){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>160000){await reader.cancel();fail('Слишком большой запрос.',413);}parts.push(r.value);}}finally{reader.releaseLock();}try{return JSON.parse(await new Blob(parts).text());}catch{fail('Не удалось прочитать данные.');}}
export async function avitoRequest(req,env,actor,deps){
 const p=new URL(req.url).pathname;
 if(p==='/api/avito/config'&&req.method==='GET')return json({aiEnabled:!!env.OPENAI_API_KEY?.trim(),publishingConnected:false});
 if(['/api/avito/prepare','/api/avito/verify'].includes(p)&&req.method==='POST'){
  const b=await body(req);if(!Array.isArray(b.cars)||!b.cars.length||b.cars.length>50)fail('Выберите от 1 до 50 автомобилей.');if(new Set(b.cars.map(x=>x.id)).size!==b.cars.length)fail('Автомобиль выбран дважды.');
  const prepared=[];for(const ref of b.cars){const c=await deps.getCar(env.DB,String(ref.id));if(c.revision!==Number(ref.revision))fail('Одна из карточек изменилась. Обновите страницу и подготовьте файл заново.',409);if(!c.avito?.selected)fail(`${c.brand} ${c.model}: автомобиль не выбран для выгрузки.`);prepared.push(avitoRow(c));}
  if(prepared.flatMap(x=>x.images).reduce((s,x)=>s+x.size,0)>95000000)fail('Фото этой выгрузки занимают больше 95 МБ. Выберите меньше фотографий или автомобилей.');
  return json({cars:prepared,preparedAt:new Date().toISOString(),publishes:false,template:'/templates/avito-used-cars-2026-09-10.xlsx'});
 }
 const m=p.match(/^\/api\/cars\/([^/]+)\/avito(?:\/(generate|market))?$/);if(!m)return null;
 const c=await deps.getCar(env.DB,decodeURIComponent(m[1]));
 if(!m[2]&&req.method==='GET')return json({avito:c.avito||null,fields:avitoFields(c),check:avitoCheck(c)});
 if(!['POST','PATCH'].includes(req.method))fail('Метод не поддерживается.',405);
 const b=await body(req);if(c.revision!==Number(b.revision))fail('Карточка изменилась. Обновите страницу и повторите.',409);
 const draft=avitoInput(c,b);
 if(m[2]){if(req.method!=='POST')fail('Метод не поддерживается.',405);return json(await avitoAI(env,actor,c,draft,m[2]==='market'?'market':'text',deps.fetcher||fetch));}
 if(req.method!=='PATCH')fail('Метод не поддерживается.',405);
 const rev=c.revision,changes={};for(const [k,f] of Object.entries(CAR_LINKS))if(draft.fields[k]!==undefined){changes[f]=draft.fields[k];delete draft.fields[k];}
 Object.assign(c,deps.carInput({...c,...changes}));c.avito={...draft,updatedAt:new Date().toISOString(),updatedBy:actor.name||actor.email||'Сотрудник'};
 deps.event(c,'Обновлена подготовка Авито',`${draft.selected?'Включён в файл выгрузки':'Не выбран для выгрузки'}. Публикация на Авито не выполнялась.`);
 return json(await deps.persist(env.DB,c,rev));
}
