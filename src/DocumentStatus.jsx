import React,{useState,useId} from 'react';
import {DOCUMENT_STATUSES} from './domain.js';
export default function DocumentStatus({car,onSave,readOnly=false}){
 const id=useId(),[value,set]=useState(car.documentStatus||'Нет'),[busy,bus]=useState(false),[error,err]=useState('');
 async function save(e){e.preventDefault();bus(true);err('');try{await onSave(value)}catch(e){err(e.message)}finally{bus(false)}}
 return <section className="panel document-status"><div className="panel-title"><div><h2>Оформление документов</h2><p>Выбирается независимо от этапа доставки автомобиля</p></div></div><form onSubmit={save}><fieldset disabled={readOnly||busy} className="permission-fields"><label htmlFor={id}>Статус документов</label><div className="document-status-controls"><select id={id} value={value} onChange={e=>set(e.target.value)}>{DOCUMENT_STATUSES.map(s=><option key={s}>{s}</option>)}</select><button data-write="" className="btn primary" disabled={busy||value===(car.documentStatus||'Нет')}>{busy?'Сохраняю…':'Сохранить статус'}</button></div>{error&&<p className="error" role="alert">{error}</p>}</fieldset></form></section>
}
