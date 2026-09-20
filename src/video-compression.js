export const VIDEO_MAX_BYTES=30*1024*1024;
export function encodingPlan(duration,attempt=0){
 if(!Number.isFinite(duration)||duration<=0)throw new Error('Не удалось определить длительность видео.');
 const total=Math.floor(VIDEO_MAX_BYTES*8*0.86/duration*Math.pow(0.65,attempt));
 const audio=total<180000?32000:64000;
 if(total-audio<20000)throw new Error('Видео слишком длинное для сжатия до 30 МБ. Разделите его на несколько частей.');
 return {video:Math.min(4500000,total-audio),audio};
}
export function encodingArgs(duration,attempt=0){
 const rate=encodingPlan(duration,attempt);
 return ['-i','input','-map','0:v:0','-map','0:a:0?','-vf',"scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2",'-r','30','-c:v','libx264','-preset','veryfast','-b:v',String(rate.video),'-maxrate',String(rate.video),'-bufsize',String(rate.video*2),'-pix_fmt','yuv420p','-c:a','aac','-b:a',String(rate.audio),'-movflags','+faststart','-y','output.mp4'];
}
export async function compressVideo(file,{signal,onProgress=()=>{}}={}){
 if(file.size<=VIDEO_MAX_BYTES)return file;
 if(file.size>512*1024*1024)throw new Error('Для обработки в браузере выберите видео до 512 МБ. Более крупное разделите на части.');
 const {FFmpeg}=await import('@ffmpeg/ffmpeg');const ffmpeg=new FFmpeg();let wasmURL;
 const abort=()=>ffmpeg.terminate();signal?.addEventListener('abort',abort,{once:true});
 try{
  if(signal?.aborted)throw new Error('Сжатие отменено');
  onProgress('Подготовка сжатия…');
  const parts=await Promise.all([0,1].map(async part=>{const r=await fetch('/video-engine/ffmpeg-core.'+part+'.bin',{signal});if(!r.ok)throw new Error('Не удалось загрузить модуль сжатия. Повторите позже.');return r.arrayBuffer()}));
  wasmURL=URL.createObjectURL(new Blob(parts,{type:'application/wasm'}));
  await ffmpeg.load({classWorkerURL:new URL('/video-engine/worker.js',location.origin).href,coreURL:new URL('/video-engine/ffmpeg-core.js',location.origin).href,wasmURL});
  if(signal?.aborted)throw new Error('Сжатие отменено');
  await ffmpeg.writeFile('input',new Uint8Array(await file.arrayBuffer()));
  if(await ffmpeg.ffprobe(['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1','input','-o','duration.txt'])!==0)throw new Error('Не удалось прочитать видео.');
  const duration=Number(new TextDecoder().decode(await ffmpeg.readFile('duration.txt')).trim());
  let attempt=0;ffmpeg.on('progress',({progress})=>onProgress('Сжатие'+(attempt?' · повтор '+attempt:'')+': '+Math.max(0,Math.min(99,Math.round(progress*100)))+'%'));
  for(attempt=0;attempt<3;attempt++){
   if(signal?.aborted)throw new Error('Сжатие отменено');
   const code=await ffmpeg.exec(encodingArgs(duration,attempt));
   if(code!==0)throw new Error('Не удалось сжать видео. Возможно, устройству не хватает памяти или формат не поддерживается.');
   const bytes=await ffmpeg.readFile('output.mp4');
   if(bytes.length>0&&bytes.length<=VIDEO_MAX_BYTES){onProgress('Сжато до '+(bytes.length/1024/1024).toFixed(1)+' МБ');return new File([bytes],file.name.replace(/\.[^.]+$/,'')+'-compressed.mp4',{type:'video/mp4'})}
   await ffmpeg.deleteFile('output.mp4');
  }
  throw new Error('Не удалось уложить видео в 30 МБ. Попробуйте более короткий ролик.');
 }catch(e){if(signal?.aborted)throw new Error('Сжатие отменено');throw new Error(e?.message||'Не удалось сжать видео на этом устройстве. Попробуйте на компьютере.');}
 finally{signal?.removeEventListener('abort',abort);ffmpeg.terminate();if(wasmURL)URL.revokeObjectURL(wasmURL)}
}
