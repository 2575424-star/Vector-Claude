import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {AVITO_TEMPLATE,NUMERIC_FIELDS} from './avito.js';
const esc=x=>String(x??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export function makeAvitoWorkbook(templateBytes,rows){
 if(!rows.length||rows.length>50000)throw new Error('Неверное число объявлений.');
 const zip=unzipSync(templateBytes),path='xl/worksheets/sheet2.xml';if(!zip[path])throw new Error('Не найден лист объявлений в шаблоне.');let xml=strFromU8(zip[path]);
 if(!xml.includes('</sheetData>')||[...xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)].some(m=>Number(m[1])>4))throw new Error('Шаблон содержит посторонние строки.');
 const output=rows.map((row,i)=>'<row r="'+(i+5)+'">'+AVITO_TEMPLATE.fields.map(f=>{const value=row[f.key];if(value===undefined||value===null||value==='')return '';const ref=f.column+(i+5);return NUMERIC_FIELDS.has(f.key)&&typeof value==='number'?`<c r="${ref}" t="n"><v>${value}</v></c>`:`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;}).join('')+'</row>').join('');
 xml=xml.replace('</sheetData>',output+'</sheetData>').replace(/<dimension\b[^>]*\/>/,`<dimension ref="A1:CI${rows.length+4}"/>`);zip[path]=strToU8(xml);return zipSync(zip,{level:6});
}
async function jpeg(bytes){const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/webp'}));try{const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.94));if(!blob)throw new Error('Не удалось преобразовать WEBP в JPEG.');return new Uint8Array(await blob.arrayBuffer());}finally{bitmap.close();}}
export async function buildAvitoBundle(prepared,verify,onProgress=()=>{}){
 const tr=await fetch(prepared.template);if(!tr.ok)throw new Error('Не удалось загрузить шаблон Авито.');const workbook=makeAvitoWorkbook(new Uint8Array(await tr.arrayBuffer()),prepared.cars.map(c=>c.row));
 const images=prepared.cars.flatMap(c=>c.images),files={};let total=workbook.length;
 for(let i=0;i<images.length;i++){const f=images[i];onProgress(`Готовлю фото ${i+1} из ${images.length}`);const r=await fetch(f.url);if(!r.ok)throw new Error('Не удалось получить фотографию. Обновите страницу и повторите.');let bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length!==f.size)throw new Error('Фотография изменилась. Подготовьте выгрузку заново.');if(f.mime==='image/webp')bytes=await jpeg(bytes);if(bytes.length>25000000)throw new Error('Одна из фотографий превышает 25 МБ после преобразования. Выберите меньший файл.');total+=bytes.length;if(total>99000000)throw new Error('Размер выгрузки превышает 99 МБ. Выберите меньше фотографий.');files[f.name]=bytes;}
 const photos=zipSync(files,{level:0});if(photos.length+workbook.length>100000000)throw new Error('Файл и фото превышают 100 МБ.');await verify();
 return {xlsx:new Blob([workbook],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),photos:new Blob([photos],{type:'application/zip'}),count:prepared.cars.length};
}
