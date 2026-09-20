// Постановление РФ №1291, раздел I п.2, колонка 2026; редакция №1713.
// https://www.alta.ru/tamdoc/13ps1291/ — проверено 11.09.2026.
export const UTIL_SOURCE='https://www.alta.ru/tamdoc/13ps1291/';
const limits=[117.68,139.75,161.81,183.88,205.94,228,250.07,272.13,294.2,316.26,338.33,367.75,Infinity];
const coefficients=[
 [[14.88,27.6],[15.36,28.43],[15.84,29.28],[16.2,30.12],...Array.from({length:9},()=>[17.28,30.12])],
 [[40.04,70.44],[45,74.64],[47.64,79.2],[50.52,83.88],[57.12,91.92],[64.56,100.56],[72.96,110.16],[83.16,120.6],[94.8,132],[108,144.6],[123.24,158.4],[140.4,173.4],[160.08,189.84]],
 [[112.52,170.36],[115.34,172.8],[118.2,175.08],[120.12,177.6],[126,183],[131.04,188.52],[136.32,193.68],[141.72,199.08],[147.48,204.72],[153.36,210.48],[159.48,216.36],[165.84,222.36],[172.44,228.6]],
 [[129.2,197.81],[131.76,200.04],[134.4,202.2],[137.16,204.36],[140.52,207.24],[144,212.4],[151.92,217.8],[160.32,224.28],[169.2,231],[178.44,237.96],[188.28,245.04],[198.6,252.48],[209.52,260.04]],
 [[164.53,216.29],[167.28,219.48],[170.16,222.84],[173.04,226.2],[176.52,231.36],[180,236.64],[186.36,249.6],[192.88,263.4],[199.68,277.92],[206.64,293.16],[213.84,309.36],[221.28,326.4],[229.08,344.28]]
];
export const num=v=>v===''||v==null?null:Number(v);
export const money=v=>Math.round((v+Number.EPSILON)*100)/100;
export function utilization(q){
 const manual=num(q.utilRub);if(manual!==null)return Number.isFinite(manual)&&manual>=0?{rub:manual,manual:true}:{rub:null,reason:'Проверьте ручной утильсбор'};
 const fail=reason=>({rub:null,reason});
 if(String(q.utilYear)!=='2026')return fail('Автоматические ставки доступны за 2026 год; укажите утильсбор вручную');
 if(q.utilRegime!=='standard')return fail('Для личного ввоза или особых условий укажите подтверждённый утильсбор вручную');
 if(q.powertrain!=='ice')return fail('Для электромобиля, гибрида или неизвестного типа двигателя нужен ручной расчёт утильсбора');
 const cc=num(q.engine),hp=num(q.powerHp);if(!(cc>0&&Number.isFinite(cc)))return fail('Укажите фактический объём двигателя в см³');
 if(!(hp>0&&Number.isFinite(hp)))return fail('Укажите мощность в л.с. или утильсбор вручную');
 if(!['new','old'].includes(q.utilAge))return fail('Выберите возраст автомобиля на дату уплаты');
 const kw=money(hp*0.735499),group=[1000,2000,3000,3500,Infinity].findIndex(x=>cc<=x),band=limits.findIndex(x=>kw<=x);
 const coefficient=coefficients[group][band][q.utilAge==='old'?1:0];const baseRub=money(20000*coefficient),extra=num(q.eaeuRub);
 if(extra===null||!Number.isFinite(extra)||extra<0)return {...fail('Укажите доплату ЕАЭС (0, если её нет)'),baseRub,coefficient,kw};
 return {rub:money(baseRub+extra),baseRub,coefficient,kw,manual:false};
}
