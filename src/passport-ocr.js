import {createWorker} from 'tesseract.js';
import {extractPassport} from './passport.js';

export async function recognizePassport(pages,{onProgress=()=>{},signal}={}){
 let worker;let closed=false;let timer;
 const stop=()=>{closed=true;if(worker)void worker.terminate()};
 signal?.addEventListener('abort',stop,{once:true});
 const abort=()=>{if(closed||signal?.aborted)throw new Error('Распознавание отменено')};
 try{
  abort();onProgress({percent:0,message:'Подготовка распознавания…'});
  worker=await createWorker(['rus','eng'],1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr/core',langPath:'/ocr/lang',workerBlobURL:false,logger:m=>{if(!closed&&m.status==='recognizing text')onProgress({percent:Math.round(m.progress*100),message:'Распознаю текст…'})}});
  abort();await worker.setParameters({tessedit_pageseg_mode:'3',preserve_interword_spaces:'1'});
  const results=[];
  for(let i=0;i<pages.length;i++){
   abort();onProgress({percent:0,message:`Фото ${i+1} из ${pages.length}`});
   const img=await createImageBitmap(pages[i].file);const scale=Math.min(2,2400/Math.max(img.width,img.height));
   const width=Math.round(img.width*scale),height=Math.round(img.height*scale),angle=pages[i].rotation||0;
   const canvas=document.createElement('canvas');canvas.width=angle%180?height:width;canvas.height=angle%180?width:height;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(angle*Math.PI/180);ctx.drawImage(img,-width/2,-height/2,width,height);img.close();
   const recognition=worker.recognize(canvas,{rotateAuto:true});
   const result=await Promise.race([recognition,new Promise((_,reject)=>{timer=setTimeout(()=>{stop();reject(new Error('Распознавание заняло слишком много времени. Попробуйте более чёткое фото.'))},90000)})]);clearTimeout(timer);
   abort();results.push(result.data.text);canvas.width=canvas.height=0;
  }
  const text=results.join('\n');const parsed=extractPassport(text);onProgress({percent:100,message:'Распознавание завершено'});return {...parsed,text};
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);if(worker)await worker.terminate();}
}
