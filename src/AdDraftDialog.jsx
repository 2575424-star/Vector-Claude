import React,{useEffect,useId,useRef} from 'react';
import {X,Check} from 'lucide-react';
import './ad-draft.css';

export default function AdDraftDialog({channel,title,description,advantages=[],disabled,onApply,onClose}){
 const ref=useRef(null),heading=useId();
 useEffect(()=>{
  const dialog=ref.current,previous=document.activeElement;
  dialog.showModal();
  return()=>{dialog.close();if(previous?.isConnected)previous.focus?.();};
 },[]);
 return <dialog ref={ref} className="modal wide ad-draft-dialog" aria-labelledby={heading} onCancel={e=>{e.preventDefault();onClose();}}>
  <div className="modal-head"><div><h2 id={heading}>Текст для {channel} готов</h2><p>Проверьте описание перед применением.</p></div><button type="button" className="icon-btn" aria-label="Закрыть черновик" onClick={onClose}><X size={20}/></button></div>
  <div className="modal-body">{title&&<h3>{title}</h3>}<p className="ad-draft-text">{description}</p>{advantages.length>0&&<ul className="ad-draft-text">{advantages.map((x,i)=><li key={i}>{x}</li>)}</ul>}<p className="ad-draft-note">Кнопка «Применить» перенесёт текст в форму. Затем сохраните черновик.</p></div>
  <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Отмена</button><button type="button" className="btn primary" disabled={disabled} onClick={onApply}><Check size={18}/> Применить</button></div>
 </dialog>;
}
