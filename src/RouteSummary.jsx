import React from 'react';
import {routeDurations} from './route-stages.js';
export default function RouteSummary({route}){
 const {periods,total,elapsed}=routeDurations(route);
 return <div className="route-summary-panel"><h3>Сроки маршрута</h3><div className="route-duration-grid">{periods.map(p=><div className="route-duration" key={p.label}><span>{p.label}</span><strong>{p.days===null?'—':p.days}<small>{p.days===null?'нет дат':'дн.'}</small></strong>{p.ongoing&&<em>Этап продолжается</em>}</div>)}</div><div className="route-duration-total"><div><b>От выкупа до Воронежа</b><span>{total!==null?'Маршрут завершён':elapsed!==null?'Прошло с выкупа · прибытие ещё не указано':'Укажите даты выкупа и прибытия'}</span></div><strong>{total??elapsed??'—'}{(total??elapsed)!==null&&<small> дн.</small>}</strong></div></div>
}
