// ==UserScript==
// @name         Encar Photos Module (Pro)
// @namespace    http://tampermonkey.net/
// @version      7.7
// @description  Профессиональное КП (исправлены настройки)
// @match        *://www.encar.com/cars/detail/*
// @match        *://fem.encar.com/cars/detail/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';
    
    console.log('[Photos] Загрузка...');
    
    function waitForHub(callback) {
        if (unsafeWindow.EncarHub) {
            callback();
            return;
        }
        const interval = setInterval(() => {
            if (unsafeWindow.EncarHub) {
                clearInterval(interval);
                clearTimeout(timeout);
                callback();
            }
        }, 100);
        const timeout = setTimeout(() => {
            clearInterval(interval);
            console.warn('[Photos] CoreHub не найден, но продолжаем');
            callback();
        }, 3000);
    }
    
    waitForHub(() => {
        const Hub = unsafeWindow.EncarHub;
        let photosList = [];
        
        // Настройки компании
        let companySettings = {
            companyName: 'Бум Авто',
            inn: '',
            ogrn: '',
            address: '',
            phone: '',
            managerName: '',
            managerPhone: '',
            customBrand: '',
            customModel: '',
            logo: ''
        };
        
        try {
            const saved = localStorage.getItem('encar_company_settings');
            if (saved) {
                const parsed = JSON.parse(saved);
                companySettings = { ...companySettings, ...parsed };
            }
        } catch(e) {}
        
        // Детальные расходы (значения по умолчанию)
        let koreaInspection = 150000;
        let koreaDealerCommission = 440000;
        let koreaDelivery = 250000;
        let koreaEvacuator = 50000;
        let koreaExportFeePercent = 0.4;
        let koreaExportFeeMin = 100000;
        let koreaFreight = 5000000;
        
        let bishkekUnloading = 200;
        let bishkekBroker = 400;
        let bishkekDelivery = 1200;
        
        let rfUnloading = 3000;
        let rfPreparation = 3000;
        let rfDocuments = 85000;
        
        function loadDetailedSettings() {
            const saved = localStorage.getItem('encar_detailed_settings');
            if (saved) {
                try {
                    const s = JSON.parse(saved);
                    koreaInspection = s.koreaInspection ?? 150000;
                    koreaDealerCommission = s.koreaDealerCommission ?? 440000;
                    koreaDelivery = s.koreaDelivery ?? 250000;
                    koreaEvacuator = s.koreaEvacuator ?? 50000;
                    koreaExportFeePercent = s.koreaExportFeePercent ?? 0.4;
                    koreaExportFeeMin = s.koreaExportFeeMin ?? 100000;
                    koreaFreight = s.koreaFreight ?? 5000000;
                    bishkekUnloading = s.bishkekUnloading ?? 200;
                    bishkekBroker = s.bishkekBroker ?? 400;
                    bishkekDelivery = s.bishkekDelivery ?? 1200;
                    rfUnloading = s.rfUnloading ?? 3000;
                    rfPreparation = s.rfPreparation ?? 3000;
                    rfDocuments = s.rfDocuments ?? 85000;
                } catch(e) {}
            }
        }
        
        function calculateExportFee() {
            const carPriceKrw = Hub ? (Hub.get('carPriceKrw') || 0) : 0;
            let fee = carPriceKrw * koreaExportFeePercent / 100;
            return fee < koreaExportFeeMin ? koreaExportFeeMin : fee;
        }
        
        function calculateTotalKoreaUSD() {
            const usdToKrw = Hub ? (Hub.get('usdToKrw') ?? NaN) : 1473;
            const totalKrw = koreaInspection + koreaDealerCommission + koreaDelivery + 
                             koreaEvacuator + calculateExportFee() + koreaFreight;
            return Math.round(totalKrw / usdToKrw);
        }
        
        function calculateTotalBishkekUSD() {
            return bishkekUnloading + bishkekBroker + bishkekDelivery;
        }
        
        function calculateTotalRFRUB() {
            return rfUnloading + rfPreparation + rfDocuments;
        }
        
        function findCarId() {
            const pathId = window.location.pathname.match(/\/cars\/detail\/(\d+)/);
            if (pathId) return pathId[1];
            const urlMatch = window.location.href.match(/carid=(\d+)/);
            if (urlMatch) return urlMatch[1];
            return null;
        }
        
        function findAllPhotos() {
            return new Promise((resolve) => {
                const carId = findCarId();
                if (!carId) { resolve([]); return; }
                const urls = Array.from(document.querySelectorAll('img')).map(img => img.currentSrc || img.src).filter(src => {
                    try { const u = new URL(src); return u.protocol === 'https:' && u.hostname === 'ci.encar.com' && u.pathname.includes(carId + '_'); } catch (_) { return false; }
                });
                photosList = [...new Set(urls)].slice(0, 6);
                if (Hub) Hub.set('photosList', photosList);
                resolve(photosList);
            });
        }
        
        function formatNumber(num) { 
            return Number.isFinite(num) ? num.toLocaleString('ru-RU') : '—'; 
        }
        
        function formatDate() {
            return new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
        }
        
        function formatValidUntil() {
            const d = new Date();
            d.setDate(d.getDate() + 3);
            return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
        }
        
        function getCarData() {
            if (!Hub) return { brand: '—', model: '—', year: '—', month: null, vin: '—', mileage: null, engine: null, power: null, views: null, accidentTotal: 'Нет данных о страховых случаях', carPriceKrw: 0, usdToKrw: 1473, selectedEuroPrice: null, calculatedTpo: 0, utilizationFee: 0, totalPrice: 0, usdRate: 0, eurRate: 0, usdtRate: 0, ourServices: 300000 };
            return {
                brand: companySettings.customBrand || Hub.get('carBrand') || '—',
                model: companySettings.customModel || Hub.get('carModel') || '—',
                year: Hub.get('carYear') || '—',
                month: Hub.get('carMonth'),
                vin: Hub.get('carVin') || '—',
                mileage: Hub.get('carMileage'),
                engine: Hub.get('carEngineVolume'),
                power: Hub.get('carPowerHp'),
                views: Hub.get('carViews'),
                accidentTotal: Hub.get('accidentTotal') || 'Нет данных о страховых случаях',
                carPriceKrw: Hub.get('carPriceKrw') || 0,
                usdToKrw: Hub.get('usdToKrw') ?? NaN,
                selectedEuroPrice: Hub.get('selectedEuroPrice'),
                calculatedTpo: Hub.get('calculatedTpo'),
                utilizationFee: Hub.get('utilizationFee'),
                totalPrice: Hub.get('totalPrice'),
                usdRate: Hub.get('usdRate') || 0,
                eurRate: Hub.get('eurRate') || 0,
                usdtRate: Hub.get('usdtRate') || 0,
                ourServices: Hub.get('ourServices') ?? 300000
            };
        }
        
        async function printReport() {
            console.log('[Photos] Генерация КП...');
            loadDetailedSettings();
            
            if (photosList.length === 0) {
                const loadingDiv = document.createElement('div');
                loadingDiv.innerHTML = '<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1e1e2f;color:white;padding:25px;border-radius:20px;z-index:10030;text-align:center;">🔍 Поиск фото...</div>';
                document.body.appendChild(loadingDiv);
                await findAllPhotos();
                loadingDiv.remove();
            }
            
            const data = getCarData();
            const priceUsd = data.carPriceKrw ? Math.round(data.carPriceKrw / data.usdToKrw) : 0;
            const koreaUSD = calculateTotalKoreaUSD();
            const bishkekUSD = calculateTotalBishkekUSD();
            const rfRUB = calculateTotalRFRUB();
            const yearDisplay = data.month ? `${data.year}/${data.month}` : data.year;
            const engineDisplay = data.engine ? (data.engine/1000).toFixed(1) + 'L' : '—';
            const exportFee = calculateExportFee();
            
            // Создаем копию настроек для вставки в JavaScript
            const settingsCopy = {
                companyName: companySettings.companyName,
                inn: companySettings.inn,
                ogrn: companySettings.ogrn,
                address: companySettings.address,
                phone: companySettings.phone,
                managerName: companySettings.managerName,
                managerPhone: companySettings.managerPhone,
                customBrand: companySettings.customBrand,
                customModel: companySettings.customModel,
                logo: companySettings.logo
            };
            const settingsJson = JSON.stringify(settingsCopy).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
            
            const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>КП ${data.brand} ${data.model}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui;background:#e8edf2;padding:20px}
.toolbar{position:fixed;bottom:30px;right:30px;z-index:1000;display:flex;gap:10px}
.toolbar button{padding:10px 24px;border:none;border-radius:40px;cursor:pointer;font-weight:600;color:white}
.btn-settings{background:#475569}.btn-print{background:#1e3a5f}.btn-pdf{background:#2c5f2d}
.proposal{max-width:1100px;margin:0 auto}
.page{background:white;border-radius:20px;margin-bottom:25px;overflow:hidden;page-break-after:always}
@media print{.toolbar{display:none}body{background:white;padding:0}.page{box-shadow:none;margin:0;border-radius:0}}
.header{background:linear-gradient(135deg,#0f2a44,#1a4a6f);padding:16px 25px;color:white}
.logo-area{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.logo-area img{height:38px}
.company-info{text-align:right;font-size:10px;line-height:1.4}
.car-title{font-size:22px;font-weight:800}
.manager-info{text-align:right;font-size:11px}
.validity{font-size:9px;opacity:0.7;margin-top:8px}
.section{padding:16px 25px;border-bottom:1px solid #eef2f6}
.section-title{font-size:16px;font-weight:800;color:#1e3a5f;margin-bottom:12px}
.info-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px 25px}
.info-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #eef2f6}
.info-label{font-size:13px;color:#475569}
.info-value{font-size:14px;font-weight:700;color:#0f172a}
.expense-detail{margin-top:8px;padding-left:16px;border-left:2px solid #fbbf24}
.expense-row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px}
.price-table{width:100%;border-collapse:collapse;margin-top:10px}
.price-table th{text-align:left;padding:8px 0;font-size:12px;border-bottom:2px solid #e2e8f0}
.price-table td{padding:8px 0;font-size:13px;border-bottom:1px solid #eef2f6}
.price-table td:last-child{text-align:right;font-weight:700}
.total-row{background:#fef9e6}
.total-row td{font-weight:800;font-size:18px;color:#d97706}
.total-row td:last-child{font-size:20px}
.photos-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}
.photo-item{aspect-ratio:4/3;background:#f8fafc;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0}
.photo-item img{width:100%;height:100%;object-fit:cover}
.footer{background:#f8fafc;padding:12px 25px;text-align:center;font-size:9px;color:#64748b;border-top:1px solid #eef2f6}
.requisites{display:flex;justify-content:space-between;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:8px}
</style>
</head>
<body>
<div class="toolbar"><button class="btn-settings" onclick="showSettings()">⚙️ Настройки</button><button class="btn-print" onclick="window.print()">🖨️ Печать</button><button class="btn-pdf" onclick="window.print()">📄 PDF</button></div>
<div class="proposal">
<div class="page">
<div class="header">
<div class="logo-area"><img src="${companySettings.logo}" onerror="this.style.display='none'"><div class="company-info"><strong>${companySettings.companyName}</strong><br>ИНН ${companySettings.inn} | ОГРН ${companySettings.ogrn}<br>${companySettings.address}<br>тел ${companySettings.phone}</div></div>
<div class="car-title">${data.brand} ${data.model}</div>
<div class="manager-info">${companySettings.managerName}<br>тел ${companySettings.managerPhone}</div>
<div class="validity">Расчёт на ${formatDate()}; окончательные платежи уточняются</div>
</div>
<div class="section"><div class="section-title">📋 ИНФОРМАЦИЯ</div>
<div class="info-grid">
<div class="info-row"><span>📅 Год</span><span>${yearDisplay}</span></div>
<div class="info-row"><span>🔧 Двигатель</span><span>${engineDisplay}</span></div>
<div class="info-row"><span>⚡ Мощность</span><span>${data.power ? data.power + ' л.с.' : '—'}</span></div>
<div class="info-row"><span>📊 Пробег</span><span>${data.mileage ? data.mileage.toLocaleString() + ' km' : '—'}</span></div>
<div class="info-row"><span>🔢 VIN</span><span>${data.vin === '—' || !data.vin ? '—' : data.vin}</span></div>
<div class="info-row"><span>👁️ Просмотры</span><span>${data.views?.toLocaleString() || '—'}</span></div>
<div class="info-row"><span>💸 Страховые</span><span>${data.accidentTotal}</span></div>
</div></div>
<div class="section"><div class="section-title">💰 РАСЧЁТ</div>
<p>Предварительный расчёт. Курсы и тарифы ТПО/утильсбора требуют проверки. Прочерк означает отсутствие данных.</p><div class="info-grid"><div class="info-row"><span>💰 Цена в Корее</span><span>${data.carPriceKrw ? formatNumber(data.carPriceKrw) + ' ₩' : '—'} / ${priceUsd ? formatNumber(priceUsd) + ' $' : '—'}</span></div></div>
<div style="margin:10px 0 5px;font-weight:700">🇰🇷 Расходы Корея</div>
<div class="expense-detail">
<div class="expense-row"><span>Осмотр:</span><span>${formatNumber(koreaInspection)} ₩ (${Math.round(koreaInspection/data.usdToKrw)} $)</span></div>
<div class="expense-row"><span>Комиссия дилера:</span><span>${formatNumber(koreaDealerCommission)} ₩ (${Math.round(koreaDealerCommission/data.usdToKrw)} $)</span></div>
<div class="expense-row"><span>Доставка по Корее:</span><span>${formatNumber(koreaDelivery)} ₩ (${Math.round(koreaDelivery/data.usdToKrw)} $)</span></div>
<div class="expense-row"><span>Эвакуатор:</span><span>${formatNumber(koreaEvacuator)} ₩ (${Math.round(koreaEvacuator/data.usdToKrw)} $)</span></div>
<div class="expense-row"><span>Экспортные:</span><span>${koreaExportFeePercent}% = ${formatNumber(exportFee)} ₩ (${Math.round(exportFee/data.usdToKrw)} $)</span></div>
<div class="expense-row"><span>Фрахт до Бишкека:</span><span>${formatNumber(koreaFreight)} ₩ (${Math.round(koreaFreight/data.usdToKrw)} $)</span></div>
<div class="expense-row" style="margin-top:5px;border-top:1px solid #e2e8f0"><span style="font-weight:700">ИТОГО КОРЕЯ:</span><span style="font-weight:700">${formatNumber(koreaUSD)} $</span></div>
</div>
<div style="margin:10px 0 5px;font-weight:700">🇰🇬 Расходы Бишкек</div>
<div class="expense-detail">
<div class="expense-row"><span>Разгрузка:</span><span>${formatNumber(bishkekUnloading)} $</span></div>
<div class="expense-row"><span>СВХ + брокер:</span><span>${formatNumber(bishkekBroker)} $</span></div>
<div class="expense-row"><span>Доставка в РФ:</span><span>${formatNumber(bishkekDelivery)} $</span></div>
<div class="expense-row" style="margin-top:5px;border-top:1px solid #e2e8f0"><span style="font-weight:700">ИТОГО БИШКЕК:</span><span style="font-weight:700">${formatNumber(bishkekUSD)} $</span></div>
</div>
<div style="margin:10px 0 5px;font-weight:700">🇷🇺 Расходы РФ</div>
<div class="expense-detail">
<div class="expense-row"><span>Разгрузка:</span><span>${formatNumber(rfUnloading)} ₽</span></div>
<div class="expense-row"><span>Подготовка:</span><span>${formatNumber(rfPreparation)} ₽</span></div>
<div class="expense-row"><span>Оформление:</span><span>${formatNumber(rfDocuments)} ₽</span></div>
<div class="expense-row"><span>Наши услуги:</span><span>${formatNumber(data.ourServices)} ₽</span></div>
<div class="expense-row" style="margin-top:5px;border-top:1px solid #e2e8f0"><span style="font-weight:700">ИТОГО РФ:</span><span style="font-weight:700">${formatNumber(rfRUB + data.ourServices)} ₽</span></div>
</div>
<div style="margin:10px 0 5px;font-weight:700">🏛️ Таможня</div>
<div class="expense-detail">
<div class="expense-row"><span>Таможенная стоимость:</span><span>${data.selectedEuroPrice ? formatNumber(data.selectedEuroPrice) + ' €' : '—'}</span></div>
<div class="expense-row"><span>ТПО:</span><span>${formatNumber(data.calculatedTpo)} $</span></div>
<div class="expense-row"><span>Утильсбор:</span><span>${formatNumber(data.utilizationFee)} ₽</span></div>
</div>
<table class="price-table"><thead><tr><th>Статья</th><th>Сумма</th></tr></thead>
<tbody>
<tr><td>💰 Цена + расходы (USD)</td><td>${formatNumber(priceUsd + koreaUSD + bishkekUSD + data.calculatedTpo)} $</td></tr>
<tr><td>💎 Курс USDT</td><td>${data.usdtRate.toFixed(2)} ₽</td></tr>
<tr><td>♻️ Утильсбор</td><td>${formatNumber(data.utilizationFee)} ₽</td></tr>
<tr><td>📄 Расходы РФ</td><td>${formatNumber(rfRUB)} ₽</td></tr>
<tr><td>🤝 Наши услуги</td><td>${formatNumber(data.ourServices)} ₽</td></tr>
<tr class="total-row"><td>Предварительный итог</td><td>${formatNumber(data.totalPrice)} ₽</td></tr>
</tbody>
</table>
</div>
<div class="footer"><p>Курс USD: ${data.usdRate.toFixed(2)} ₽ | EUR: ${data.eurRate.toFixed(2)} ₽</p><div class="requisites"><span>${companySettings.companyName}</span><span>ИНН ${companySettings.inn}</span><span>ОГРН ${companySettings.ogrn}</span><span>${companySettings.address}</span><span>тел ${companySettings.phone}</span></div><p>Дата: ${formatDate()}</p></div>
</div>
${photosList.length ? `<div class="page"><div class="section"><div class="section-title">📸 ФОТОГРАФИИ</div><div class="photos-grid">${photosList.map(url => `<div class="photo-item"><img src="${url}" onerror="this.style.opacity=0.3"></div>`).join('')}</div></div><div class="footer"><p>© ${data.brand} ${data.model}</p></div></div>` : ''}
</div>
<script>
(function() {
    const defaultSettings = ${settingsJson};
    
    window.showSettings = function() {
        let s = JSON.parse(JSON.stringify(defaultSettings));
        try {
            const saved = localStorage.getItem('encar_company_settings');
            if (saved) {
                const parsed = JSON.parse(saved);
                s = { ...s, ...parsed };
            }
        } catch(e) {}
        
        const div = document.createElement('div');
        div.id = 'sett-popup';
        div.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:20000;display:flex;align-items:center;justify-content:center';
        
        function esc(str) {
            if (str === undefined || str === null) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }
        
        div.innerHTML = '<div style="background:#1e293b;border-radius:16px;padding:20px;width:400px;max-width:90%;color:white;">' +
            '<h3 style="color:#fbbf24;margin-bottom:15px;">⚙️ Настройки</h3>' +
            '<div><input id="s-company" placeholder="Название компании" value="' + esc(s.companyName) + '" style="width:100%;padding:8px;margin:5px 0;background:#0f172a;color:white;border:none;border-radius:8px"></div>' +
            '<div><input id="s-inn" placeholder="ИНН" value="' + esc(s.inn) + '" style="width:100%;padding:8px;margin:5px 0;background:#0f172a;color:white;border:none;border-radius:8px"></div>' +
            '<div><input id="s-ogrn" placeholder="ОГРН" value="' + esc(s.ogrn) + '" style="width:100%;padding:8px;margin:5px 0;background:#0f172a;color:white;border:none;border-radius:8px"></div>' +
            '<div><input id="s-address" placeholder="Адрес" value="' + esc(s.address) + '" style="width:100%;padding:8px;margin:5px 0;background:#0f172a;color:white;border:none;border-radius:8px"></div>' +
            '<div><input id="s-phone" placeholder="Телефон" value="' + esc(s.phone) + '" style="width:100%;padding:8px;margin:5px 0;background:#0f172a;color:white;border:none;border-radius:8px"></div>' +
            '<div><input id="s-manager" placeholder="Менеджер" value="' + esc(s.managerName) + '" style="width:100%;padding:8px;margin:5px 0;background:#0f172a;color:white;border:none;border-radius:8px"></div>' +
            '<div><input id="s-managerPhone" placeholder="Тел менеджера" value="' + esc(s.managerPhone) + '" style="width:100%;padding:8px;margin:5px 0;background:#0f172a;color:white;border:none;border-radius:8px"></div>' +
            '<div><input id="s-brand" placeholder="Марка (вручную)" value="' + esc(s.customBrand) + '" style="width:100%;padding:8px;margin:5px 0;background:#0f172a;color:white;border:none;border-radius:8px"></div>' +
            '<div><input id="s-model" placeholder="Модель (вручную)" value="' + esc(s.customModel) + '" style="width:100%;padding:8px;margin:5px 0;background:#0f172a;color:white;border:none;border-radius:8px"></div>' +
            '<div style="display:flex;gap:10px;margin-top:15px"><button id="sett-cancel" style="background:#475569;padding:8px 20px;border:none;border-radius:8px;color:white">Отмена</button><button id="sett-save" style="background:#fbbf24;padding:8px 20px;border:none;border-radius:8px;font-weight:bold">Сохранить</button></div>' +
            '</div>';
        document.body.appendChild(div);
        document.getElementById('sett-cancel').onclick = () => div.remove();
        document.getElementById('sett-save').onclick = () => {
            const newSettings = {
                companyName: document.getElementById('s-company').value,
                inn: document.getElementById('s-inn').value,
                ogrn: document.getElementById('s-ogrn').value,
                address: document.getElementById('s-address').value,
                phone: document.getElementById('s-phone').value,
                managerName: document.getElementById('s-manager').value,
                managerPhone: document.getElementById('s-managerPhone').value,
                customBrand: document.getElementById('s-brand').value,
                customModel: document.getElementById('s-model').value,
                logo: defaultSettings.logo
            };
            localStorage.setItem('encar_company_settings', JSON.stringify(newSettings));
            alert('Настройки сохранены. Обновите страницу.');
            div.remove();
        };
    };
})();
</script>
</body>
</html>`;
            
            const win = window.open('', '_blank', 'width=1200,height=900');
            win.document.write(html);
            win.document.close();
        }
        
        unsafeWindow.EncarPhotos = { 
            print: printReport, 
            find: findAllPhotos, 
            getPhotos: () => photosList
        };
        
        console.log('[Photos] Модуль загружен v7.7');
    });
})();
