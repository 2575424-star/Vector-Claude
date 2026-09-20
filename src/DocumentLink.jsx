import React,{useState,useEffect,useRef} from 'react';
import {Download,X,ExternalLink} from 'lucide-react';
import {unzipSync,strFromU8} from 'fflate';
export function DocumentPreview({car,file,onClose}){
 const ref=useRef(),[text,setText]=useState(''),[error,setError]=useState('');
 const url='/api/cars/'+car.id+'/files/'+file.id,ext=file.name.split('.').pop().toLowerCase();
 const image=['jpg','jpeg','png','webp'].includes(ext),pdf=ext==='pdf',readable=['docx','txt','csv','xlsx'].includes(ext);
 useEffect(()=>{const old=document.activeElement;ref.current.showModal();return()=>old?.focus?.()},[]);
 useEffect(()=>{if(!readable)return;const controller=new AbortController();(async()=>{
 try{const r=await fetch(url+'?preview=1',{signal:controller.signal});if(!r.ok)throw Error('Не удалось открыть документ');const bytes=new Uint8Array(await r.arrayBuffer());if(controller.signal.aborted)return;
 if(['txt','csv'].includes(ext)){setText(new TextDecoder().decode(bytes));return}
 let total=0;const z=unzipSync(bytes,{filter:f=>{const keep=ext==='docx'?f.name==='word/document.xml':/^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(f.name);if(keep){total+=f.originalSize;if(total>15000000)throw Error('Документ слишком большой для просмотра')}return keep}});
 const xml=b=>{const d=new DOMParser().parseFromString(strFromU8(b),'application/xml');if(d.querySelector('parsererror'))throw Error('Не удалось прочитать документ');return d};
 if(ext==='docx'){if(!z['word/document.xml'])throw Error('Не найден текст документа');setText([...xml(z['word/document.xml']).getElementsByTagNameNS('*','p')].map(p=>[...p.getElementsByTagNameNS('*','t')].map(t=>t.textContent).join('')).join('\n'))}
 else{const ss=z['xl/sharedStrings.xml']?[...xml(z['xl/sharedStrings.xml']).getElementsByTagName('si')].map(n=>n.textContent):[];setText(Object.keys(z).filter(k=>k.startsWith('xl/worksheets/')).sort().map((k,i)=>'Лист '+(i+1)+'\n'+[...xml(z[k]).getElementsByTagName('row')].map(row=>[...row.getElementsByTagName('c')].map(c=>{const v=c.querySelector('v')?.textContent||c.textContent||'';return c.getAttribute('r')+': '+(c.getAttribute('t')==='s'?ss[Number(v)]||'':v)}).join('    ')).join('\n')).join('\n\n'))}
 }catch(e){if(!controller.signal.aborted)setError(e.message)}
 })();return()=>controller.abort()},[url,ext,readable]);
 return <dialog ref={ref} className="modal wide" onCancel={e=>{e.preventDefault();onClose()}}><div className="modal-head"><div><h2>Просмотр документа</h2><p>{file.name}</p></div><button className="icon-btn" aria-label="Закрыть" onClick={onClose}><X/></button></div><div className="party-document-preview">{image?<img src={url+'?preview=1'} alt={file.name}/>:pdf?<iframe title={file.name} src={url+'?preview=1'}/>:readable?<div style={{padding:24,background:'#fff',color:'#182129',width:'100%',overflow:'auto'}}>{ext==='docx'&&<p>Текстовый просмотр. Оригинальное оформление сохранено в скачиваемом файле.</p>}<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontFamily:'inherit'}}>{error||text||'Загрузка документа…'}</pre></div>:<p style={{padding:24}}>Этот формат нельзя просмотреть в браузере. Нажмите «Скачать», чтобы открыть файл на устройстве.</p>}</div><div className="modal-foot">{(image||pdf)&&<a className="btn" href={url+'?preview=1'} target="_blank" rel="noreferrer"><ExternalLink size={16}/> Открыть отдельно</a>}<a className="btn primary" href={url+'?download=1'} download={file.name}><Download size={16}/> Скачать</a></div></dialog>
}
export default function DocumentLink({car,file}){const[open,setOpen]=useState(false);return <><button type="button" className="party-document-open" onClick={()=>setOpen(true)}>{file.name}</button><a className="icon-btn party-download" aria-label={'Скачать '+file.name} href={'/api/cars/'+car.id+'/files/'+file.id+'?download=1'} download={file.name}><Download size={17}/></a>{open&&<DocumentPreview car={car} file={file} onClose={()=>setOpen(false)}/>}</>}
