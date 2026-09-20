import test from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';

test('Telegram requests work in the Worker runtime without following redirects or sending real messages',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vector-telegram-runtime-'));
 try{
  await build({stdin:{resolveDir:resolve('.'),contents:`
   import {telegramCall} from './src/telegram-server.js';
   const env={TELEGRAM_BOT_TOKEN:'123456:abcdefghijklmnopqrstuvwxyz_TEST'};
   const assert=(ok,message)=>{if(!ok)throw new Error(message)};
   export default {async test(){
    let calls=0;
    const value=await telegramCall(env,'getMe',{},async(url,options)=>{
     // Native workerd Request rejects unsupported redirect modes; Node mocks did not.
     const request=new Request(url,options);calls++;
     assert(request.redirect==='manual','Redirects must not be followed');
     return Response.json({ok:true,result:{is_bot:true,id:123456}});
    });
    assert(calls===1&&value.is_bot,'Connection check must return a result');
    for(const mode of ['redirect','html','network']){
     let count=0,failed=false;
     try{await telegramCall(env,'getMe',{},async(url,options)=>{
      new Request(url,options);count++;
      if(mode==='network')throw new Error(url);
      if(mode==='redirect')return new Response(null,{status:302,headers:{Location:'https://example.test/'}});
      return new Response('<html>Unavailable</html>',{status:502});
     });}catch(e){failed=true;assert(e.status===502,'Expected connection error');assert(e.message.includes('Сообщения не отправлялись'),'Checks must not imply a post was sent');assert(!e.message.includes(env.TELEGRAM_BOT_TOKEN),'Never expose the token');}
     assert(failed&&count===1,'No redirects or automatic retries');
    }
   }};
  `},bundle:true,format:'esm',platform:'neutral',outfile:join(dir,'test.mjs')});
  await writeFile(join(dir,'config.capnp'),'using Workerd = import "/workerd/workerd.capnp"; const config :Workerd.Config = (services = [(name = "telegram-test", worker = (compatibilityDate = "2026-04-01", modules = [(name = "test.mjs", esModule = embed "test.mjs")]))]);');
  execFileSync(resolve('node_modules/workerd/bin/workerd'),['test',join(dir,'config.capnp')],{stdio:'pipe',timeout:20000});
 }finally{await rm(dir,{recursive:true,force:true});}
});
