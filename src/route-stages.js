import {today} from './domain.js';
export const ROUTE_STAGES=[
 {id:'purchased',label:'Автомобиль выкуплен',status:'Выкуплен'},
 {id:'departed_korea',label:'Автомобиль отправлен из Кореи',status:'В пути в Бишкек',location:'В пути из Кореи в Бишкек'},
 {id:'arrived_bishkek',label:'Автомобиль прибыл в Бишкек',status:'Выкуплен',location:'Бишкек'},
 {id:'departed_voronezh',label:'Автомобиль отправлен в Воронеж',status:'В пути в Воронеж',location:'В пути из Бишкека в Воронеж'},
 {id:'arrived_voronezh',label:'Автомобиль прибыл в Воронеж',status:'Прибыл',location:'Воронеж'}
];
export function stageById(id){return ROUTE_STAGES.find(s=>s.id===id)}
export function stageTimeline(route,asOf=today()){
 const rows=route.filter(r=>stageById(r.stage)).slice().sort((a,b)=>a.date.localeCompare(b.date)||ROUTE_STAGES.findIndex(s=>s.id===a.stage)-ROUTE_STAGES.findIndex(s=>s.id===b.stage)||(a.createdAt||'').localeCompare(b.createdAt||''));
 return rows.map((r,i)=>({...r,label:stageById(r.stage).label,days:Math.max(0,Math.round((Date.parse((rows[i+1]?.date||asOf)+'T00:00:00Z')-Date.parse(r.date+'T00:00:00Z'))/86400000)),current:i===rows.length-1,finished:r.stage==='arrived_voronezh'&&i===rows.length-1}));
}
export function routeDurations(route,asOf=today()){
 const rows=stageTimeline(route,asOf),byId=id=>rows.find(r=>r.stage===id);
 const diff=(a,b)=>a&&b&&b>=a?Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000):null;
 const labels=['До отправки из Кореи','Корея → Бишкек','В Бишкеке','Бишкек → Воронеж'];
 const periods=labels.map((label,i)=>{const start=byId(ROUTE_STAGES[i].id),end=byId(ROUTE_STAGES[i+1].id);const ongoing=!!start&&!end&&rows.at(-1)?.id===start.id;return {label,days:diff(start?.date,end?.date||(ongoing?asOf:null)),ongoing}});
 const start=byId('purchased'),end=byId('arrived_voronezh');return {periods,total:diff(start?.date,end?.date),elapsed:!end?diff(start?.date,asOf):null};
}
