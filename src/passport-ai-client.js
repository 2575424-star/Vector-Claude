import {checkPassportFiles} from './passport.js';

export async function recognizePassport(pages,{signal,onProgress=()=>{}}={}){
 checkPassportFiles(pages.map(p=>p.file));
 const form=new FormData();for(const p of pages)form.append('passport',p.file);
 form.set('rotations',JSON.stringify(pages.map(p=>p.rotation||0)));
 const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const timer=setTimeout(abort,65000);
 try{
  onProgress({percent:null,message:'Читаю фото и определяю поля паспорта…'});
  const response=await fetch('/api/passport/recognize',{method:'POST',body:form,signal:controller.signal,credentials:'same-origin'});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.fields){const e=new Error(data?.error||'Не удалось распознать паспорт. Повторите позже.');e.userMessage=true;throw e}
  return data;
 }catch(e){if(controller.signal.aborted&&!signal?.aborted){const timeout=new Error('Распознавание заняло слишком много времени. Попробуйте один разворот.');timeout.userMessage=true;throw timeout}throw e}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
