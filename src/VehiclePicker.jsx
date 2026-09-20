import React,{useRef,useState,useEffect,useId} from 'react';
import {Autocomplete} from '@base-ui/react/autocomplete';
import {ChevronDown} from 'lucide-react';
export default function VehiclePicker({label,value,onChange,groups,disabled=false}){
 const input=useRef(null),id=useId();const[container,setContainer]=useState(null);
 useEffect(()=>{setContainer(input.current?.closest('dialog')||null)},[]);
 return <div className="field vehicle-picker"><label htmlFor={id}>{label} *</label><Autocomplete.Root items={groups} value={value} onValueChange={onChange} openOnInputClick modal={false} disabled={disabled} filter={(item,query)=>item.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))}>
 <div className="vehicle-picker-control"><Autocomplete.Input ref={input} id={id} required maxLength={200} placeholder={disabled?'Сначала выберите марку':'Выберите или введите'} onFocus={e=>e.target.select()}/><Autocomplete.Trigger type="button" className="vehicle-picker-trigger" aria-label={'Открыть список: '+label}><ChevronDown size={17}/></Autocomplete.Trigger></div>
 <Autocomplete.Portal container={container}><Autocomplete.Positioner className="vehicle-picker-positioner" sideOffset={6} align="start"><Autocomplete.Popup className="vehicle-picker-popup"><Autocomplete.Empty className="vehicle-picker-empty">Нет в списке — введённое название можно сохранить.</Autocomplete.Empty><Autocomplete.List className="vehicle-picker-list">{group=><Autocomplete.Group key={group.label} items={group.items}><Autocomplete.GroupLabel className="vehicle-picker-label">{group.label}</Autocomplete.GroupLabel><Autocomplete.Collection>{item=><Autocomplete.Item className="vehicle-picker-item" key={item} value={item}>{item}</Autocomplete.Item>}</Autocomplete.Collection></Autocomplete.Group>}</Autocomplete.List></Autocomplete.Popup></Autocomplete.Positioner></Autocomplete.Portal>
 </Autocomplete.Root></div>
}
