import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const base='https://vector-crm-pavel.divine-lime-4457.chatgpt.site';
const names=['core-hub','module-currency','module-calculations','module-price','module-car-data','module-photos','module-ui'];
const header=`// ==UserScript==
// @name VECTOR Encar → CRM
// @namespace ${base}
// @version 1.2.0
// @description Расчёт и передача объявления в VECTOR CRM
// @match https://www.encar.com/cars/detail/*
// @match https://fem.encar.com/cars/detail/*
// @grant unsafeWindow
// @grant GM_xmlhttpRequest
// @grant GM_addStyle
// @connect api.encar.com
// @connect cbr-xml-daily.ru
// @connect www.cbr-xml-daily.ru
// @connect vector-crm-pavel.divine-lime-4457.chatgpt.site
// @run-at document-idle
// ==/UserScript==\n`;
let body=names.map(n=>fs.readFileSync(new URL('encar-source/'+n+'.js',root),'utf8').replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/,'')).join('\n;\n');
body=body.replace('https://raw.githubusercontent.com/2575424-star/encar-userscript/refs/heads/main/car-prices.csv',base+'/encar/car-prices.csv');
const bridge=`\n;(()=>{const button=document.createElement('button');button.textContent='Передать в VECTOR';button.style.cssText='position:fixed;bottom:22px;left:22px;z-index:2147483647;background:#ef9663;color:#172127;border:0;border-radius:12px;padding:16px 22px;font:600 16px system-ui;cursor:pointer;box-shadow:0 8px 30px #0005';document.body.append(button);button.onclick=()=>{const h=unsafeWindow.EncarHub;if(!h)return alert('Калькулятор ещё загружается');const get=k=>h.get(k)??'';const data={brand:get('carBrand'),model:get('carModel'),vin:get('carVin'),year:get('carYear'),mileage:get('carMileage'),engine:get('carEngineVolume'),url:location.origin+location.pathname,krw:get('carPriceKrw'),krwPerUsd:get('usdToKrw'),eurUsd:h.get('manualEurUsdRate')??get('eurUsdRate'),usdRub:get('usdtRate'),eur:get('selectedEuroPrice'),manualTpo:get('manualTpo'),koreaUsd:get('koreaLogistics'),bishkekUsd:get('servicesBishkek'),deliveryUsd:0,documentsRub:get('docsRf'),utilRub:get('manualUtilizationFee'),servicesRub:get('ourServices'),rateDate:h.get('lastCurrencyUpdate')?.toISOString?.().slice(0,10)||'',rateSource:'Передано из Encar'};window.open('${base}/#encar?import='+encodeURIComponent(JSON.stringify(data)),'_blank','noopener,noreferrer');};})();`;
fs.writeFileSync(new URL('public/encar/vector-encar.user.js',root),header+body+bridge);
