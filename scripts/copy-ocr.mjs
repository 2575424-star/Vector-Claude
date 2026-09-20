import fs from 'node:fs';
import path from 'node:path';
const root='dist/client/ocr';
fs.mkdirSync(root+'/core',{recursive:true});fs.mkdirSync(root+'/lang',{recursive:true});
fs.copyFileSync('node_modules/tesseract.js/dist/worker.min.js',root+'/worker.min.js');
for(const name of fs.readdirSync('node_modules/tesseract.js-core'))if(name.endsWith('.wasm.js'))fs.copyFileSync(path.join('node_modules/tesseract.js-core',name),path.join(root,'core',name));
for(const lang of ['rus','eng'])fs.copyFileSync(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`,`${root}/lang/${lang}.traineddata.gz`);
fs.copyFileSync('node_modules/tesseract.js/LICENSE.md',root+'/LICENSE-tesseract.txt');
fs.copyFileSync('node_modules/tesseract.js-core/LICENSE',root+'/LICENSE-core.txt');
fs.copyFileSync('node_modules/mrz/LICENSE',root+'/LICENSE-mrz.txt');
console.log('OCR assets copied: engine, worker and Russian/English language data.');

const videoRoot='dist/client/video-engine';fs.mkdirSync(videoRoot,{recursive:true});
for(const name of fs.readdirSync('node_modules/@ffmpeg/ffmpeg/dist/esm'))if(name.endsWith('.js'))fs.copyFileSync('node_modules/@ffmpeg/ffmpeg/dist/esm/'+name,videoRoot+'/'+name);
fs.copyFileSync('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js',videoRoot+'/ffmpeg-core.js');
fs.rmSync(videoRoot+'/ffmpeg-core.wasm',{force:true});
const wasm=fs.readFileSync('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'),half=Math.ceil(wasm.length/2);
fs.writeFileSync(videoRoot+'/ffmpeg-core.0.bin',wasm.subarray(0,half));fs.writeFileSync(videoRoot+'/ffmpeg-core.1.bin',wasm.subarray(half));
console.log('Video compression engine copied.');
