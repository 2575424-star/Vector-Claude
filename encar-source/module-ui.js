// ==UserScript==
// @name         Encar UI Module (Final)
// @namespace    http://tampermonkey.net/
// @version      28.6
// @description  Финальная версия панели с автоматическим обновлением расходов Корея
// @match        *://www.encar.com/cars/detail/*
// @match        *://fem.encar.com/cars/detail/*
// @grant        unsafeWindow
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';
    
    // Ждём появления CoreHub
    function waitForHub(callback) {
        if (unsafeWindow.EncarHub) {
            callback();
            return;
        }
        console.log('[UI] Ожидание CoreHub...');
        const interval = setInterval(() => {
            if (unsafeWindow.EncarHub) {
                clearInterval(interval);
                console.log('[UI] CoreHub найден');
                callback();
            }
        }, 100);
        setTimeout(() => {
            clearInterval(interval);
            if (!unsafeWindow.EncarHub) {
                console.error('[UI] CoreHub не загружен');
            }
        }, 10000);
    }
    
    waitForHub(() => {
        const Hub = unsafeWindow.EncarHub;
        
        let mainPanel = null;
        let calcPanel = null;
        let isDragging = false;
        let dragOffsetX = 0, dragOffsetY = 0;
        let isCollapsed = false;
        let isCalcDragging = false;
        let calcDragOffsetX = 0, calcDragOffsetY = 0;
        
        // ========== РЕДАКТИРУЕМЫЕ РАСХОДЫ ДЛЯ КАЛЬКУЛЯТОРА ==========
        let calcKoreaExpenses = 4000;
        let calcBishkekExpenses = 1600;
        let calcDocsRf = 85000;
        let calcDiscount = 4, calcRateAdjustment = -1;
        const inputNumber = value => value == null || String(value).trim() === '' ? NaN : Number(String(value).replace(/\s/g, '').replace(',', '.'));
        
        function loadCalcExpenses() {
            const saved = localStorage.getItem('encar_calc_expenses');
            if (saved) {
                try {
                    const settings = JSON.parse(saved);
                    calcDiscount = Number.isFinite(settings.discount) && settings.discount >= 0 && settings.discount <= 100 ? settings.discount : 4;
                    calcRateAdjustment = Number.isFinite(settings.rateAdjustment) ? settings.rateAdjustment : -1;
                    calcKoreaExpenses = settings.koreaExpenses !== undefined ? settings.koreaExpenses : 4000;
                    calcBishkekExpenses = settings.bishkekExpenses !== undefined ? settings.bishkekExpenses : 1600;
                    calcDocsRf = settings.docsRf !== undefined ? settings.docsRf : 85000;
                } catch(e) {}
            }
        }
        
        function saveCalcExpenses() {
            localStorage.setItem('encar_calc_expenses', JSON.stringify({
                koreaExpenses: calcKoreaExpenses,
                bishkekExpenses: calcBishkekExpenses,
                docsRf: calcDocsRf, discount: calcDiscount, rateAdjustment: calcRateAdjustment
            }));
        }
        
        // ========== ДЕТАЛЬНЫЕ РАСХОДЫ ==========
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
        let ourServices = 300000;
        
        function loadDetailedSettings() {
            const saved = localStorage.getItem('encar_detailed_settings');
            if (saved) {
                try {
                    const settings = JSON.parse(saved);
                    koreaInspection = settings.koreaInspection !== undefined ? settings.koreaInspection : 150000;
                    koreaDealerCommission = settings.koreaDealerCommission !== undefined ? settings.koreaDealerCommission : 440000;
                    koreaDelivery = settings.koreaDelivery !== undefined ? settings.koreaDelivery : 250000;
                    koreaEvacuator = settings.koreaEvacuator !== undefined ? settings.koreaEvacuator : 50000;
                    koreaExportFeePercent = settings.koreaExportFeePercent !== undefined ? settings.koreaExportFeePercent : 0.4;
                    koreaExportFeeMin = settings.koreaExportFeeMin !== undefined ? settings.koreaExportFeeMin : 100000;
                    koreaFreight = settings.koreaFreight !== undefined ? settings.koreaFreight : 5000000;
                    bishkekUnloading = settings.bishkekUnloading !== undefined ? settings.bishkekUnloading : 200;
                    bishkekBroker = settings.bishkekBroker !== undefined ? settings.bishkekBroker : 400;
                    bishkekDelivery = settings.bishkekDelivery !== undefined ? settings.bishkekDelivery : 1200;
                    rfUnloading = settings.rfUnloading !== undefined ? settings.rfUnloading : 3000;
                    rfPreparation = settings.rfPreparation !== undefined ? settings.rfPreparation : 3000;
                    rfDocuments = settings.rfDocuments !== undefined ? settings.rfDocuments : 85000;
                    ourServices = settings.ourServices !== undefined ? settings.ourServices : 300000;
                    Hub.set('ourServices', ourServices, true);
                } catch(e) {}
            } else {
                ourServices = 300000;
                Hub.set('ourServices', ourServices, true);
            }
        }
        
        function saveDetailedSettings() {
            localStorage.setItem('encar_detailed_settings', JSON.stringify({
                koreaInspection, koreaDealerCommission, koreaDelivery, koreaEvacuator,
                koreaExportFeePercent, koreaExportFeeMin, koreaFreight,
                bishkekUnloading, bishkekBroker, bishkekDelivery,
                rfUnloading, rfPreparation, rfDocuments, ourServices
            }));
        }
        
        // ========== РАСЧЁТЫ ==========
        function calculateExportFee() {
            const carPriceKrw = Hub.get('carPriceKrw') || 0;
            let exportFee = carPriceKrw * koreaExportFeePercent / 100;
            if (exportFee < koreaExportFeeMin) exportFee = koreaExportFeeMin;
            return exportFee;
        }
        
        function calculateTotalKoreaUSD() {
            const usdToKrw = Hub.get('usdToKrw') ?? NaN;
            const exportFee = calculateExportFee();
            const totalKrw = koreaInspection + koreaDealerCommission + koreaDelivery + 
                             koreaEvacuator + exportFee + koreaFreight;
            return Math.round(totalKrw / usdToKrw);
        }
        
        function calculateTotalBishkekUSD() {
            return bishkekUnloading + bishkekBroker + bishkekDelivery;
        }
        
        function calculateTotalRFRUB() {
            return rfUnloading + rfPreparation + rfDocuments;
        }
        
        function updateGlobalExpenses() {
            const koreaUSD = calculateTotalKoreaUSD();
            const bishkekUSD = calculateTotalBishkekUSD();
            const rfRUB = calculateTotalRFRUB();
            
            Hub.set('koreaLogistics', koreaUSD);
            Hub.set('servicesBishkek', bishkekUSD);
            Hub.set('docsRf', rfRUB);
            Hub.emit('any:changed', {});
            updateCalcPanel();
        }
        
        function updateCalcPanel() {
            if (!calcPanel) return;
            
            const carPriceUSD = Hub.get('carPriceKrw') ? Math.round(Hub.get('carPriceKrw') / (Hub.get('usdToKrw') ?? NaN)) : 0;
            const currentTpo = Hub.get('calculatedTpo') || 0;
            const currentUsdtRate = Hub.get('usdtRate') ?? NaN;
            const utilizationFee = Hub.get('utilizationFee') || 0;
            const mainTotal = Hub.get('totalPrice');
            
            const ourPrice = carPriceUSD * (1 - calcDiscount / 100);
            const totalUSD = ourPrice + calcKoreaExpenses + currentTpo + calcBishkekExpenses;
            const calcRate = currentUsdtRate + calcRateAdjustment;
            const totalRUB = Number.isFinite(mainTotal) && calcRate > 0 ? (totalUSD * calcRate) + utilizationFee + calcDocsRf : NaN;
            const markup = mainTotal - totalRUB;
            
            const priceUsdSpan = calcPanel.querySelector('#calc-price-usd');
            const ourPriceSpan = calcPanel.querySelector('#calc-our-price');
            const tpoSpan = calcPanel.querySelector('#calc-tpo');
            const totalUSDSpan = calcPanel.querySelector('#calc-total-usd');
            const usdtRateSpan = calcPanel.querySelector('#calc-usdt-rate');
            const utilSpan = calcPanel.querySelector('#calc-util');
            const docsSpan = calcPanel.querySelector('#calc-docs-value');
            const koreaSpan = calcPanel.querySelector('#calc-korea-value');
            const bishkekSpan = calcPanel.querySelector('#calc-bishkek-value');
            const totalRUBSpan = calcPanel.querySelector('#calc-total-rub');
            const markupSpan = calcPanel.querySelector('#calc-markup');
            
            if (priceUsdSpan) priceUsdSpan.textContent = `${Math.round(carPriceUSD).toLocaleString()} $`;
            if (ourPriceSpan) {
                ourPriceSpan.textContent = `${formatNumber(Math.round(ourPrice))} $ (−${calcDiscount}%)`;
                ourPriceSpan.style.cursor = 'pointer';
                ourPriceSpan.onclick = () => {
                    const value = prompt('Скидка к цене, % (0–100):', calcDiscount);
                    if (value === null || value.trim() === '') return;
                    const n = Number(value.replace(',', '.'));
                    if (!Number.isFinite(n) || n < 0 || n > 100) return alert('Введите число от 0 до 100');
                    calcDiscount = n; saveCalcExpenses(); updateCalcPanel();
                };
            }
            if (tpoSpan) tpoSpan.textContent = `${Math.round(currentTpo).toLocaleString()} $`;
            if (totalUSDSpan) totalUSDSpan.textContent = `${Math.round(totalUSD).toLocaleString()} $`;
            if (usdtRateSpan) {
                usdtRateSpan.textContent = `${currentUsdtRate.toFixed(2)} ₽; поправка ${calcRateAdjustment}; итог ${calcRate.toFixed(2)}`;
                usdtRateSpan.style.cursor = 'pointer';
                usdtRateSpan.onclick = () => {
                    const value = prompt('Поправка к курсу, ₽ (может быть отрицательной):', calcRateAdjustment);
                    if (value === null || value.trim() === '') return;
                    const n = Number(value.replace(',', '.'));
                    if (!Number.isFinite(n) || currentUsdtRate + n <= 0) return alert('Итоговый курс должен быть положительным');
                    calcRateAdjustment = n; saveCalcExpenses(); updateCalcPanel();
                };
            }
            if (utilSpan) utilSpan.textContent = `${Math.round(utilizationFee).toLocaleString()} ₽`;
            if (docsSpan) {
                docsSpan.textContent = `${Math.round(calcDocsRf).toLocaleString()} ₽`;
                docsSpan.onclick = () => editCalcExpense('docs');
            }
            if (koreaSpan) {
                koreaSpan.textContent = `${calcKoreaExpenses.toLocaleString()} $`;
                koreaSpan.onclick = () => editCalcExpense('korea');
            }
            if (bishkekSpan) {
                bishkekSpan.textContent = `${calcBishkekExpenses.toLocaleString()} $`;
                bishkekSpan.onclick = () => editCalcExpense('bishkek');
            }
            if (totalRUBSpan) totalRUBSpan.textContent = `${formatNumber(Number.isFinite(totalRUB) ? Math.round(totalRUB) : null)} ₽`;
            if (markupSpan) {
                markupSpan.textContent = `${formatNumber(Number.isFinite(markup) ? Math.round(markup) : null)} ₽`;
                markupSpan.style.color = markup > 0 ? '#22c55e' : (markup < 0 ? '#ef4444' : '#fbbf24');
            }
        }
        
        function editCalcExpense(type) {
            let currentValue, promptText;
            switch(type) {
                case 'korea':
                    currentValue = calcKoreaExpenses;
                    promptText = 'Расходы Корея ($):';
                    break;
                case 'bishkek':
                    currentValue = calcBishkekExpenses;
                    promptText = 'Расходы Бишкек ($):';
                    break;
                case 'docs':
                    currentValue = calcDocsRf;
                    promptText = 'Документы РФ (₽):';
                    break;
                default: return;
            }
            const newValue = prompt(promptText, currentValue);
            if (newValue !== null && Number.isFinite(inputNumber(newValue)) && inputNumber(newValue) >= 0) {
                const numValue = inputNumber(newValue);
                if (type === 'korea') calcKoreaExpenses = numValue;
                if (type === 'bishkek') calcBishkekExpenses = numValue;
                if (type === 'docs') calcDocsRf = numValue;
                saveCalcExpenses();
                updateCalcPanel();
            }
        }
        
        // ========== СТИЛИ ==========
        GM_addStyle(`
            @keyframes slideIn { from { transform: translateX(-100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            @keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            .encar-panel { animation: slideInRight 0.3s ease-out; }
            .calc-panel { animation: slideIn 0.3s ease-out; }
            .encar-panel button, .encar-panel .clickable { transition: all 0.2s ease; cursor: pointer; }
            .encar-panel button:hover, .encar-panel .clickable:hover { transform: scale(1.02); opacity: 0.8; text-decoration: underline; }
            .encar-panel::-webkit-scrollbar, .calc-panel::-webkit-scrollbar { width: 4px; }
            .encar-panel::-webkit-scrollbar-track, .calc-panel::-webkit-scrollbar-track { background: rgba(255,255,255,0.1); border-radius: 2px; }
            .encar-panel::-webkit-scrollbar-thumb, .calc-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.3); border-radius: 2px; }
            .collapse-btn { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: #fbbf24; border-radius: 50%; cursor: pointer; transition: all 0.2s ease; font-size: 16px; font-weight: bold; color: #0f172a; }
            .collapse-btn:hover { background: #d97706; transform: scale(1.05); }
            .calc-collapse-btn { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; background: #fbbf24; border-radius: 50%; cursor: pointer; transition: all 0.2s ease; font-size: 12px; font-weight: bold; color: #0f172a; }
            .calc-collapse-btn:hover { background: #d97706; transform: scale(1.05); }
            .expense-header { cursor: pointer; transition: all 0.2s ease; }
            .expense-header:hover { opacity: 0.8; }
            .expense-content { margin-top: 6px; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 8px; font-size: 11px; }
            .expense-row { display: flex; justify-content: space-between; margin-bottom: 6px; padding: 2px 0; }
            .expense-label { color: #94a3b8; }
            .expense-value { color: #fbbf24; font-weight: 600; cursor: pointer; }
            .expense-value:hover { text-decoration: underline; }
            .accident-header { cursor: pointer; transition: all 0.2s ease; }
            .accident-header:hover { opacity: 0.8; }
            .calc-clickable { cursor: pointer; transition: all 0.2s ease; }
            .calc-clickable:hover { opacity: 0.8; text-decoration: underline; }
        `);
        
        function formatVolume(cc) { if (!cc) return '—'; const liters = cc / 1000; return Number.isInteger(liters) ? `${liters}.0L` : `${liters.toFixed(1)}L`; }
        function formatMileage(mileage) { if (!mileage) return '—'; return `${mileage.toLocaleString()} km`; }
        function formatVin(vin) { return vin ? vin.replace(/\s/g, '').toUpperCase() : '—'; }
        function formatNumber(num) { return Number.isFinite(num) ? num.toLocaleString() : '—'; }
        
        function updatePanel() {
            if (!mainPanel) return;
            const brand = Hub.get('carBrand') || '—';
            const model = Hub.get('carModel') || '—';
            const titleSpan = mainPanel.querySelector('#panel-title');
            if (titleSpan) titleSpan.textContent = `${brand} ${model}`.trim();
            
            const viewsSpan = mainPanel.querySelector('#info-views');
            if (viewsSpan) viewsSpan.textContent = Hub.get('carViews')?.toLocaleString() || '—';
            
            const year = Hub.get('carYear');
            const month = Hub.get('carMonth');
            const yearSpan = mainPanel.querySelector('#info-year');
            if (yearSpan) yearSpan.textContent = month ? `${year}/${month}` : (year || '—');
            
            const engineSpan = mainPanel.querySelector('#info-engine');
            if (engineSpan) engineSpan.textContent = formatVolume(Hub.get('carEngineVolume'));
            
            const powerSpan = mainPanel.querySelector('#info-power');
            if (powerSpan) powerSpan.textContent = Hub.get('carPowerHp') ? `${Hub.get('carPowerHp')} л.с.` : '—';
            
            const mileageSpan = mainPanel.querySelector('#info-mileage');
            if (mileageSpan) mileageSpan.textContent = formatMileage(Hub.get('carMileage'));
            
            const vinSpan = mainPanel.querySelector('#info-vin');
            if (vinSpan) vinSpan.textContent = formatVin(Hub.get('carVin'));
            
            const accidentTotal = Hub.get('accidentTotal');
            const accidentSpan = mainPanel.querySelector('#accident-value');
            if (accidentSpan) accidentSpan.innerHTML = accidentTotal && accidentTotal !== '—' ? accidentTotal : '<span style="color:#f97316;">загрузка...</span>';
            
            const carPriceKrw = Hub.get('carPriceKrw');
            const usdToKrw = Hub.get('usdToKrw') ?? NaN;
            const priceUsd = carPriceKrw ? Math.round(carPriceKrw / usdToKrw) : 0;
            const priceValueSpan = mainPanel.querySelector('#price-value');
            if (priceValueSpan) {
                priceValueSpan.innerHTML = `${carPriceKrw ? formatNumber(carPriceKrw) + ' ₩' : '—'} / ${priceUsd ? formatNumber(priceUsd) + ' $' : '—'}`;
            }
            
            // Пересчитываем koreaLogistics на случай, если carPriceKrw изменился
            const koreaUSD = calculateTotalKoreaUSD();
            const bishkekUSD = calculateTotalBishkekUSD();
            const rfRUB = calculateTotalRFRUB();
            
            const totalKoreaSpan = mainPanel.querySelector('#total-korea');
            if (totalKoreaSpan) totalKoreaSpan.textContent = `${formatNumber(koreaUSD)} $`;
            
            const totalBishkekSpan = mainPanel.querySelector('#total-bishkek');
            if (totalBishkekSpan) totalBishkekSpan.textContent = `${formatNumber(bishkekUSD)} $`;
            
            const totalRFSpan = mainPanel.querySelector('#total-rf');
            if (totalRFSpan) totalRFSpan.textContent = `${formatNumber(rfRUB)} ₽`;
            
            const ourSpanMain = mainPanel.querySelector('#our-value');
            if (ourSpanMain) ourSpanMain.textContent = `${formatNumber(ourServices)} ₽`;
            
            const euroPrice = Hub.get('selectedEuroPrice');
            const priceEuroSpan = mainPanel.querySelector('#price-euro');
            if (priceEuroSpan) priceEuroSpan.textContent = euroPrice ? `${formatNumber(euroPrice)} €` : '—';
            
            const tpoSpan = mainPanel.querySelector('#tpo-value');
            const tpoValue = Hub.get('calculatedTpo');
            if (tpoSpan) tpoSpan.innerHTML = Number.isFinite(tpoValue) ? `${formatNumber(tpoValue)} $` : '<span style="color:#f97316;">заполните</span>';
            
            const utilSpan = mainPanel.querySelector('#util-value');
            const utilizationFee = Hub.get('utilizationFee');
            if (utilSpan) utilSpan.innerHTML = Number.isFinite(utilizationFee) ? `${formatNumber(utilizationFee)} ₽` : '<span style="color:#f97316;">заполните</span>';
            
            const eurUsdButton = mainPanel.querySelector('#tpo-eurusd');
            const effectiveEurUsd = Hub.get('manualEurUsdRate') ?? Hub.get('eurUsdRate');
            if (eurUsdButton) {
                const manual = Hub.get('manualEurUsdRate') != null;
                eurUsdButton.textContent = Number.isFinite(effectiveEurUsd) && effectiveEurUsd > 0 ? `ТПО: EUR × 48% × ${effectiveEurUsd.toFixed(4)} USD/EUR (${manual ? 'вручную' : 'по курсам источника'})` : 'ТПО: укажите курс USD за 1 EUR';
                eurUsdButton.onclick = () => {
                    const value = prompt('Долларов за 1 евро. Пусто — автоматический курс:', Hub.get('manualEurUsdRate') ?? effectiveEurUsd ?? '');
                    if (value === null) return;
                    if (value.trim() === '') Hub.set('manualEurUsdRate', null);
                    else {
                        const rate = inputNumber(value);
                        if (!Number.isFinite(rate) || rate <= 0) return alert('Введите положительный курс');
                        Hub.set('manualEurUsdRate', rate);
                    }
                };
            }
            const totalPrice = Hub.get('totalPrice');
            const notice = mainPanel.querySelector('#calculation-notice');
            if (notice) notice.textContent = [Hub.get('calculationNotice'), Hub.get('currencyStatus')].filter(Boolean).join(' ');
            const totalSpan = mainPanel.querySelector('#total-price');
            if (totalSpan) totalSpan.textContent = `${formatNumber(totalPrice)} ₽`;
            
            const collapsedTotalSpan = mainPanel.querySelector('#collapsed-total-price');
            if (collapsedTotalSpan) collapsedTotalSpan.textContent = `${formatNumber(totalPrice)} ₽`;
            
            const usdRate = Hub.get('usdRate') || 0;
            const usdHeader = mainPanel.querySelector('#usd-header');
            if (usdHeader) usdHeader.textContent = `🇺🇸 ${usdRate.toFixed(2)}`;
            
            const eurRate = Hub.get('eurRate') || 0;
            const eurHeader = mainPanel.querySelector('#eur-header');
            if (eurHeader) eurHeader.textContent = `🇪🇺 ${eurRate.toFixed(2)}`;
            
            const usdToKrwRate = Hub.get('usdToKrw') || 0;
            const krwHeader = mainPanel.querySelector('#krw-header');
            if (krwHeader) krwHeader.textContent = `🇰🇷 ${Math.round(usdToKrwRate)}`;
            
            const usdtRate = Hub.get('usdtRate') || 0;
            const usdtHeader = mainPanel.querySelector('#usdt-header');
            if (usdtHeader) usdtHeader.textContent = `💎 ${usdtRate.toFixed(2)}`;
            
            // Обновляем значения в Hub, если они изменились
            Hub.set('koreaLogistics', koreaUSD, true);
            Hub.set('servicesBishkek', bishkekUSD, true);
            Hub.set('docsRf', rfRUB, true);
            
            updateCalcPanel();
        }
        
        function updateDetailedExpenses() {
            const koreaDetailsDiv = document.getElementById('korea-details-inner');
            const bishkekDetailsDiv = document.getElementById('bishkek-details-inner');
            const rfDetailsDiv = document.getElementById('rf-details-inner');
            const usdToKrw = Hub.get('usdToKrw') ?? NaN;
            const exportFee = calculateExportFee();
            
            if (koreaDetailsDiv) {
                koreaDetailsDiv.innerHTML = `
                    <div class="expense-row"><span class="expense-label">🔍 Осмотр авто:</span><span class="expense-value" data-expense="koreaInspection">${formatNumber(koreaInspection)} ₩ (${Math.round(koreaInspection/usdToKrw)} $)</span></div>
                    <div class="expense-row"><span class="expense-label">💰 Комиссия дилера:</span><span class="expense-value" data-expense="koreaDealerCommission">${formatNumber(koreaDealerCommission)} ₩ (${Math.round(koreaDealerCommission/usdToKrw)} $)</span></div>
                    <div class="expense-row"><span class="expense-label">🚚 Доставка по Корее:</span><span class="expense-value" data-expense="koreaDelivery">${formatNumber(koreaDelivery)} ₩ (${Math.round(koreaDelivery/usdToKrw)} $)</span></div>
                    <div class="expense-row"><span class="expense-label">🔄 Эвакуатор в порт:</span><span class="expense-value" data-expense="koreaEvacuator">${formatNumber(koreaEvacuator)} ₩ (${Math.round(koreaEvacuator/usdToKrw)} $)</span></div>
                    <div class="expense-row"><span class="expense-label">📄 Экспортные документы:</span><span class="expense-value" data-expense="koreaExportFee">${koreaExportFeePercent}% (мин ${formatNumber(koreaExportFeeMin)} ₩) = ${formatNumber(exportFee)} ₩ (${Math.round(exportFee/usdToKrw)} $)</span></div>
                    <div class="expense-row"><span class="expense-label">🚢 Фрахт до Бишкека:</span><span class="expense-value" data-expense="koreaFreight">${formatNumber(koreaFreight)} ₩ (${Math.round(koreaFreight/usdToKrw)} $)</span></div>
                    <div class="expense-row" style="margin-top:6px; padding-top:6px; border-top:1px solid #334155;"><span class="expense-label" style="font-weight:bold;">💰 ИТОГО КОРЕЯ:</span><span class="expense-value" style="color:#fbbf24; font-weight:bold;">${formatNumber(calculateTotalKoreaUSD())} $</span></div>
                `;
            }
            
            if (bishkekDetailsDiv) {
                bishkekDetailsDiv.innerHTML = `
                    <div class="expense-row"><span class="expense-label">📦 Разгрузка + эвакуатор:</span><span class="expense-value" data-expense="bishkekUnloading">${formatNumber(bishkekUnloading)} $</span></div>
                    <div class="expense-row"><span class="expense-label">📋 СВХ + брокерские услуги:</span><span class="expense-value" data-expense="bishkekBroker">${formatNumber(bishkekBroker)} $</span></div>
                    <div class="expense-row"><span class="expense-label">🚚 Доставка в РФ:</span><span class="expense-value" data-expense="bishkekDelivery">${formatNumber(bishkekDelivery)} $</span></div>
                    <div class="expense-row" style="margin-top:6px; padding-top:6px; border-top:1px solid #334155;"><span class="expense-label" style="font-weight:bold;">💰 ИТОГО БИШКЕК:</span><span class="expense-value" style="color:#fbbf24; font-weight:bold;">${formatNumber(calculateTotalBishkekUSD())} $</span></div>
                `;
            }
            
            if (rfDetailsDiv) {
                rfDetailsDiv.innerHTML = `
                    <div class="expense-row"><span class="expense-label">🔄 Разгрузка авто:</span><span class="expense-value" data-expense="rfUnloading">${formatNumber(rfUnloading)} ₽</span></div>
                    <div class="expense-row"><span class="expense-label">🔧 Подготовка к выдаче:</span><span class="expense-value" data-expense="rfPreparation">${formatNumber(rfPreparation)} ₽</span></div>
                    <div class="expense-row"><span class="expense-label">📄 Оформление документов:</span><span class="expense-value" data-expense="rfDocuments">${formatNumber(rfDocuments)} ₽</span></div>
                    <div class="expense-row" style="margin-top:6px; padding-top:6px; border-top:1px solid #334155;"><span class="expense-label" style="font-weight:bold;">💰 ИТОГО РФ:</span><span class="expense-value" style="color:#fbbf24; font-weight:bold;">${formatNumber(rfUnloading + rfPreparation + rfDocuments)} ₽</span></div>
                `;
            }
            
            document.querySelectorAll('[data-expense]').forEach(el => {
                const expenseName = el.getAttribute('data-expense');
                if (expenseName !== 'koreaExportFee') el.onclick = () => editExpense(expenseName);
            });
        }
        
        function editExpense(expenseName) {
            let currentValue, promptText;
            switch(expenseName) {
                case 'koreaInspection': currentValue = koreaInspection; promptText = 'Осмотр авто (вон):'; break;
                case 'koreaDealerCommission': currentValue = koreaDealerCommission; promptText = 'Комиссия дилера (вон):'; break;
                case 'koreaDelivery': currentValue = koreaDelivery; promptText = 'Доставка по Корее (вон):'; break;
                case 'koreaEvacuator': currentValue = koreaEvacuator; promptText = 'Эвакуатор в порт (вон):'; break;
                case 'koreaFreight': currentValue = koreaFreight; promptText = 'Фрахт до Бишкека (вон):'; break;
                case 'bishkekUnloading': currentValue = bishkekUnloading; promptText = 'Разгрузка + эвакуатор ($):'; break;
                case 'bishkekBroker': currentValue = bishkekBroker; promptText = 'СВХ + брокер ($):'; break;
                case 'bishkekDelivery': currentValue = bishkekDelivery; promptText = 'Доставка в РФ ($):'; break;
                case 'rfUnloading': currentValue = rfUnloading; promptText = 'Разгрузка авто (₽):'; break;
                case 'rfPreparation': currentValue = rfPreparation; promptText = 'Подготовка к выдаче (₽):'; break;
                case 'rfDocuments': currentValue = rfDocuments; promptText = 'Оформление документов (₽):'; break;
                default: return;
            }
            const newValue = prompt(promptText, currentValue);
            if (newValue !== null && Number.isFinite(inputNumber(newValue)) && inputNumber(newValue) >= 0) {
                const numValue = inputNumber(newValue);
                switch(expenseName) {
                    case 'koreaInspection': koreaInspection = numValue; break;
                    case 'koreaDealerCommission': koreaDealerCommission = numValue; break;
                    case 'koreaDelivery': koreaDelivery = numValue; break;
                    case 'koreaEvacuator': koreaEvacuator = numValue; break;
                    case 'koreaFreight': koreaFreight = numValue; break;
                    case 'bishkekUnloading': bishkekUnloading = numValue; break;
                    case 'bishkekBroker': bishkekBroker = numValue; break;
                    case 'bishkekDelivery': bishkekDelivery = numValue; break;
                    case 'rfUnloading': rfUnloading = numValue; break;
                    case 'rfPreparation': rfPreparation = numValue; break;
                    case 'rfDocuments': rfDocuments = numValue; break;
                }
                saveDetailedSettings();
                updateDetailedExpenses();
                updateGlobalExpenses();
                updatePanel();
            }
        }
        
        function createCalcPanel() {
            if (calcPanel) return;
            loadCalcExpenses();
            
            calcPanel = document.createElement('div');
            calcPanel.className = 'calc-panel';
            calcPanel.id = 'encar-calc-panel';
            calcPanel.style.cssText = `
                position: fixed !important;
                bottom: 20px !important;
                left: 20px !important;
                z-index: 10001 !important;
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%) !important;
                color: #f1f5f9 !important;
                border-radius: 12px !important;
                padding: 8px 10px !important;
                font-family: 'Segoe UI', system-ui, sans-serif !important;
                box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3) !important;
                border: 1px solid rgba(251,191,36,0.3) !important;
                font-size: 11px !important;
                width: 180px !important;
                backdrop-filter: blur(8px) !important;
                cursor: move;
                user-select: none;
                transition: all 0.2s ease;
            `;
            
            calcPanel.innerHTML = `
                <div id="calc-drag-handle" style="cursor: move; margin-bottom: 4px; padding-bottom: 4px; border-bottom: 1px solid rgba(251,191,36,0.3);">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 13px; font-weight: 700; color: #fbbf24;">⚙️ Админ</span>
                        <div id="calc-collapse-btn" class="calc-collapse-btn">+</div>
                    </div>
                </div>
                <div id="calc-full-content" style="display: none;">
                    <div style="margin-bottom: 6px;">
                        <div style="background: rgba(251,191,36,0.1); border-radius: 8px; padding: 6px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="color: #94a3b8; font-size: 10px;">💰 Цена USD:</span>
                                <span id="calc-price-usd" style="color: #fbbf24; font-weight: 700;">—</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="color: #94a3b8; font-size: 10px;">📉 Скидка (нажмите):</span>
                                <span id="calc-our-price" style="color: #22c55e; font-weight: 700;">—</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px; padding-top: 2px; border-top: 1px solid #334155;">
                                <span style="color: #94a3b8; font-size: 10px;">➕ Корея:</span>
                                <span id="calc-korea-value" class="calc-clickable" style="color: #fbbf24; font-weight: 600; cursor: pointer;">—</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="color: #94a3b8; font-size: 10px;">🏛️ ТПО:</span>
                                <span id="calc-tpo" style="color: #fbbf24; font-weight: 600;">—</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="color: #94a3b8; font-size: 10px;">➕ Бишкек:</span>
                                <span id="calc-bishkek-value" class="calc-clickable" style="color: #fbbf24; font-weight: 600;">—</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px; padding-top: 2px; border-top: 1px solid #334155;">
                                <span style="color: #94a3b8; font-size: 10px;">💰 USD Итого:</span>
                                <span id="calc-total-usd" style="color: #fbbf24; font-weight: 800;">—</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="color: #94a3b8; font-size: 10px;">💎 Курс USDT:</span>
                                <span id="calc-usdt-rate" style="color: #fbbf24; font-weight: 600;">—</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="color: #94a3b8; font-size: 10px;">♻️ Утиль:</span>
                                <span id="calc-util" style="color: #fbbf24; font-weight: 600;">—</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="color: #94a3b8; font-size: 10px;">📄 Документы:</span>
                                <span id="calc-docs-value" class="calc-clickable" style="color: #fbbf24; font-weight: 600;">—</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-top: 4px; padding-top: 4px; border-top: 1px solid #334155;">
                                <span style="color: #94a3b8; font-size: 10px;">Предварительно:</span>
                                <span id="calc-total-rub" style="color: #22c55e; font-weight: 800; font-size: 12px;">—</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-top: 4px; padding-top: 4px; border-top: 1px solid #fbbf24;">
                                <span style="color: #94a3b8; font-size: 10px; font-weight: 700;">🏷️ НАЦЕНКА:</span>
                                <span id="calc-markup" style="font-weight: 800; font-size: 12px;">—</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div id="calc-collapsed-content" style="display: block;">
                    <div style="text-align: center;">
                        <span style="color: #fbbf24; font-size: 11px; font-weight: 700;">⚙️ Админ</span>
                    </div>
                </div>
            `;
            
            document.body.appendChild(calcPanel);
            
            const calcDragHandle = document.getElementById('calc-drag-handle');
            if (calcDragHandle) {
                calcDragHandle.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    if (e.target.id === 'calc-collapse-btn') return;
                    isCalcDragging = true;
                    const rect = calcPanel.getBoundingClientRect();
                    calcDragOffsetX = e.clientX - rect.left;
                    calcDragOffsetY = e.clientY - rect.top;
                    calcPanel.style.cursor = 'grabbing';
                    e.preventDefault();
                });
            }
            
            document.addEventListener('mousemove', (e) => {
                if (!isCalcDragging) return;
                let newLeft = e.clientX - calcDragOffsetX;
                let newTop = e.clientY - calcDragOffsetY;
                newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - calcPanel.offsetWidth));
                newTop = Math.max(0, Math.min(newTop, window.innerHeight - calcPanel.offsetHeight));
                calcPanel.style.left = newLeft + 'px';
                calcPanel.style.top = newTop + 'px';
                calcPanel.style.right = 'auto';
                calcPanel.style.bottom = 'auto';
            });
            
            document.addEventListener('mouseup', () => {
                if (isCalcDragging) {
                    isCalcDragging = false;
                    calcPanel.style.cursor = 'move';
                }
            });
            
            const calcCollapseBtn = document.getElementById('calc-collapse-btn');
            const calcFullContent = document.getElementById('calc-full-content');
            const calcCollapsedContent = document.getElementById('calc-collapsed-content');
            let isCalcCollapsed = true;
            
            if (calcCollapseBtn && calcFullContent && calcCollapsedContent) {
                calcCollapseBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (isCalcCollapsed) {
                        calcFullContent.style.display = 'block';
                        calcCollapsedContent.style.display = 'none';
                        calcPanel.style.width = '200px';
                        calcPanel.style.padding = '8px 10px';
                        calcCollapseBtn.innerHTML = '−';
                        isCalcCollapsed = false;
                    } else {
                        calcFullContent.style.display = 'none';
                        calcCollapsedContent.style.display = 'block';
                        calcPanel.style.width = '80px';
                        calcPanel.style.padding = '6px 8px';
                        calcCollapseBtn.innerHTML = '+';
                        isCalcCollapsed = true;
                    }
                });
            }
            
            updateCalcPanel();
        }
        
        function createPanel() {
            if (mainPanel) return;
            loadDetailedSettings();
            
            mainPanel = document.createElement('div');
            mainPanel.className = 'encar-panel';
            mainPanel.id = 'encar-combined-panel';
            mainPanel.style.cssText = `position:fixed;bottom:20px;right:20px;z-index:10001;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#f1f5f9;border-radius:16px;padding:12px 16px;font-family:'Segoe UI',system-ui;box-shadow:0 10px 25px -5px rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);font-size:13px;width:380px;backdrop-filter:blur(8px);cursor:move;user-select:none;transition:all 0.2s ease;`;
            
            mainPanel.innerHTML = `
                <div id="drag-handle" style="cursor:move;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);">
                    <div style="display:flex;align-items:center;justify-content:space-between;">
                        <div style="display:flex;align-items:center;gap:8px;"><span style="font-size:22px;font-weight:700;">🚗 <span id="panel-title">Encar Helper</span></span></div>
                        <div style="display:flex;align-items:center;gap:12px;"><span style="font-size:16px;font-weight:600;color:#ffffff;">👁️ <span id="info-views" style="font-size:16px;font-weight:700;color:#ffffff;">—</span></span><div id="collapse-btn" class="collapse-btn">−</div></div>
                    </div>
                    <div style="display:flex;gap:12px;margin-top:8px;background:rgba(0,0,0,0.3);padding:6px 12px;border-radius:24px;width:fit-content;">
                        <span id="usd-header" class="clickable" style="color:#60a5fa;font-size:14px;font-weight:600;">🇺🇸 --</span><span style="color:#475569;font-size:14px;">|</span>
                        <span id="eur-header" class="clickable" style="color:#60a5fa;font-size:14px;font-weight:600;">🇪🇺 --</span><span style="color:#475569;font-size:14px;">|</span>
                        <span id="krw-header" class="clickable" style="color:#60a5fa;font-size:14px;font-weight:600;">🇰🇷 --</span><span style="color:#475569;font-size:14px;">|</span>
                        <span id="usdt-header" class="clickable" style="color:#fbbf24;font-size:14px;font-weight:700;">💎 --</span>
                    </div>
                </div>
                <div id="panel-full-content">
                    <div style="margin-bottom:10px;">
                        <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="color:#94a3b8;font-size:15px;font-weight:500;">📅 Год</span><span id="info-year" style="font-size:15px;font-weight:600;color:#fbbf24;">—</span></div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="color:#94a3b8;font-size:15px;font-weight:500;">🔧 Двигатель</span><span id="info-engine" style="font-size:15px;font-weight:600;color:#fbbf24;">—</span></div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="color:#94a3b8;font-size:15px;font-weight:500;">⚡ Мощность</span><span id="info-power" class="clickable" style="font-size:15px;font-weight:600;color:#fbbf24;">—</span></div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="color:#94a3b8;font-size:15px;font-weight:500;">📊 Пробег</span><span id="info-mileage" style="font-size:15px;font-weight:600;color:#fbbf24;">—</span></div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="color:#94a3b8;font-size:15px;font-weight:500;">🔢 VIN</span><span id="info-vin" class="clickable" style="font-family:monospace;font-size:13px;font-weight:500;cursor:pointer;">—</span></div>
                    </div>
                    
                    <div style="margin-bottom:10px;">
                        <div id="accident-header" class="accident-header" style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.05);border-radius:10px;padding:6px 10px;">
                            <span style="color:#94a3b8;font-size:14px;font-weight:500;">💸 Страховые выплаты:</span>
                            <div style="display:flex;align-items:center;gap:6px;"><span id="accident-value" style="color:#fbbf24;font-weight:600;font-size:14px;">загрузка...</span><span id="accident-arrow" style="font-size:12px;color:#94a3b8;">▼</span></div>
                        </div>
                        <div id="accident-content" style="display:none;margin-top:6px;padding:8px;background:rgba(0,0,0,0.3);border-radius:8px;"><div id="accident-details" style="font-size:12px;color:#cbd5e1;">Загрузка...</div></div>
                    </div>
                    
                    <div style="background:rgba(255,255,255,0.05);border-radius:12px;padding:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:14px;font-weight:500;">💰 Цена в Корее:</span>
                        <span id="price-value" style="color:#fbbf24;font-weight:700;font-size:15px;">—</span>
                    </div>
                    
                    <div style="margin-bottom:8px;">
                        <div id="korea-header" class="expense-header" style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.05);border-radius:10px;padding:8px 10px;">
                            <span style="font-size:14px;font-weight:500;">🇰🇷 Расходы Корея</span>
                            <div style="display:flex;align-items:center;gap:8px;"><span id="total-korea" style="color:#fbbf24;font-weight:700;font-size:15px;">—</span><span id="korea-arrow" style="font-size:12px;color:#94a3b8;">▼</span></div>
                        </div>
                        <div id="korea-content" style="display:none;margin-top:6px;"><div id="korea-details-inner" class="expense-content"></div></div>
                    </div>
                    
                    <div style="margin-bottom:8px;">
                        <div id="bishkek-header" class="expense-header" style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.05);border-radius:10px;padding:8px 10px;">
                            <span style="font-size:14px;font-weight:500;">🇰🇬 Расходы Бишкек</span>
                            <div style="display:flex;align-items:center;gap:8px;"><span id="total-bishkek" style="color:#fbbf24;font-weight:700;font-size:15px;">—</span><span id="bishkek-arrow" style="font-size:12px;color:#94a3b8;">▼</span></div>
                        </div>
                        <div id="bishkek-content" style="display:none;margin-top:6px;"><div id="bishkek-details-inner" class="expense-content"></div></div>
                    </div>
                    
                    <div style="margin-bottom:8px;">
                        <div id="rf-header" class="expense-header" style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.05);border-radius:10px;padding:8px 10px;">
                            <span style="font-size:14px;font-weight:500;">🇷🇺 Расходы РФ</span>
                            <div style="display:flex;align-items:center;gap:8px;"><span id="total-rf" style="color:#fbbf24;font-weight:700;font-size:15px;">—</span><span id="rf-arrow" style="font-size:12px;color:#94a3b8;">▼</span></div>
                        </div>
                        <div id="rf-content" style="display:none;margin-top:6px;"><div id="rf-details-inner" class="expense-content"></div></div>
                    </div>
                    
                    <div style="background:rgba(255,255,255,0.05);border-radius:12px;padding:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:14px;font-weight:500;">🤝 Наши услуги:</span>
                        <span id="our-value" class="clickable" style="color:#fbbf24;font-weight:700;font-size:15px;cursor:pointer;">${formatNumber(ourServices)} ₽</span>
                    </div>
                    
                    <div style="background:rgba(255,255,255,0.05);border-radius:12px;padding:8px;margin-bottom:8px;">
                        <div style="font-size:12px;color:#94a3b8;margin-bottom:6px;font-weight:500;">🏛️ Таможня Киргизия</div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                            <span style="font-size:14px;font-weight:500;">💰 Таможенная стоимость:</span>
                            <div><span id="price-euro" class="clickable" style="color:#fbbf24;font-weight:700;font-size:15px;text-decoration:underline;cursor:pointer;">—</span><span id="price-arrow" style="margin-left:3px;font-size:9px;color:#94a3b8;cursor:pointer;">▼</span></div>
                        </div>
                        <div id="price-content" style="display:none;margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);"><div id="price-content-inner" style="font-size:11px;">Загрузка...</div></div>
                        <div style="display:flex;justify-content:space-between;"><span style="font-size:14px;font-weight:500;">🏛️ ТПО:</span><span id="tpo-value" class="clickable" style="font-weight:700;font-size:15px;">—</span></div>
                    </div>
                    
                    <div style="background:rgba(255,255,255,0.05);border-radius:12px;padding:8px;margin-bottom:8px;">
                        <div style="display:flex;justify-content:space-between;"><span style="font-size:14px;font-weight:500;">♻️ Утильсбор:</span><span id="util-value" class="clickable" style="font-weight:700;font-size:15px;">—</span></div>
                    </div>
                    
                    <div style="border-top:2px solid #fbbf24;padding-top:8px;margin-top:4px;">
                        <div style="display:flex;justify-content:space-between;align-items:baseline;">
                            <span style="font-weight:700;color:#fbbf24;font-size:18px;">Предварительно:</span>
                            <span id="total-price" style="font-size:20px;font-weight:800;color:#fbbf24;">0 ₽</span>
                        </div>
                    </div>
                    
                    <button id="tpo-eurusd" type="button" style="background:transparent;color:#fbbf24;border:1px solid #475569;border-radius:8px;padding:6px;margin-top:8px;cursor:pointer">Курс EUR/USD для ТПО</button>
                    <div id="calculation-notice" style="color:#fbbf24;font-size:11px;margin-top:8px;"></div>
                    <div style="margin-top:12px;">
                        <button id="print-report-btn" style="width:100%;background:#fbbf24;border:none;padding:8px 0;border-radius:10px;font-weight:700;cursor:pointer;color:#0f172a;font-size:13px;">🖨️ Коммерческое предложение</button>
                    </div>
                </div>
                <div id="panel-collapsed-content" style="display:none;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="color:#94a3b8;font-size:13px;">Предварительно:</span>
                        <span id="collapsed-total-price" style="font-size:18px;font-weight:800;color:#fbbf24;">0 ₽</span>
                    </div>
                </div>
            `;
            
            document.body.appendChild(mainPanel);
            
            // Drag & Drop
            const dragHandle = document.getElementById('drag-handle');
            if (dragHandle) {
                dragHandle.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    if (e.target.classList?.contains('collapse-btn')) return;
                    isDragging = true;
                    const rect = mainPanel.getBoundingClientRect();
                    dragOffsetX = e.clientX - rect.left;
                    dragOffsetY = e.clientY - rect.top;
                    mainPanel.style.cursor = 'grabbing';
                    e.preventDefault();
                });
            }
            
            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                let newLeft = e.clientX - dragOffsetX;
                let newTop = e.clientY - dragOffsetY;
                newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - mainPanel.offsetWidth));
                newTop = Math.max(0, Math.min(newTop, window.innerHeight - mainPanel.offsetHeight));
                mainPanel.style.left = newLeft + 'px';
                mainPanel.style.top = newTop + 'px';
                mainPanel.style.right = 'auto';
                mainPanel.style.bottom = 'auto';
            });
            
            document.addEventListener('mouseup', () => { if (isDragging) { isDragging = false; mainPanel.style.cursor = 'move'; } });
            
            // Раскрывающиеся блоки
            const koreaHeader = document.getElementById('korea-header'), koreaContent = document.getElementById('korea-content'), koreaArrow = document.getElementById('korea-arrow');
            if (koreaHeader && koreaContent && koreaArrow) koreaHeader.onclick = () => { const isHidden = koreaContent.style.display === 'none'; koreaContent.style.display = isHidden ? 'block' : 'none'; koreaArrow.innerHTML = isHidden ? '▲' : '▼'; if (isHidden) updateDetailedExpenses(); };
            
            const bishkekHeader = document.getElementById('bishkek-header'), bishkekContent = document.getElementById('bishkek-content'), bishkekArrow = document.getElementById('bishkek-arrow');
            if (bishkekHeader && bishkekContent && bishkekArrow) bishkekHeader.onclick = () => { const isHidden = bishkekContent.style.display === 'none'; bishkekContent.style.display = isHidden ? 'block' : 'none'; bishkekArrow.innerHTML = isHidden ? '▲' : '▼'; if (isHidden) updateDetailedExpenses(); };
            
            const rfHeader = document.getElementById('rf-header'), rfContent = document.getElementById('rf-content'), rfArrow = document.getElementById('rf-arrow');
            if (rfHeader && rfContent && rfArrow) rfHeader.onclick = () => { const isHidden = rfContent.style.display === 'none'; rfContent.style.display = isHidden ? 'block' : 'none'; rfArrow.innerHTML = isHidden ? '▲' : '▼'; if (isHidden) updateDetailedExpenses(); };
            
            // Страховые выплаты
            const accidentHeader = document.getElementById('accident-header');
            const accidentContent = document.getElementById('accident-content');
            const accidentArrow = document.getElementById('accident-arrow');
            if (accidentHeader && accidentContent && accidentArrow) {
                accidentHeader.onclick = () => {
                    if (accidentContent.style.display === 'none') {
                        accidentContent.style.display = 'block';
                        accidentArrow.innerHTML = '▲';
                        const details = Hub.get('accidentDetails');
                        const detailsDiv = document.getElementById('accident-details');
                        if (detailsDiv && details && details.length) {
                            const usdToKrw = Hub.get('usdToKrw') ?? NaN;
                            detailsDiv.innerHTML = details.map((acc, idx) => {
                                const part = acc.partCost || 0, labor = acc.laborCost || 0, paint = acc.paintingCost || 0;
                                const totalWon = part + labor + paint;
                                const totalUsd = Math.round(totalWon / usdToKrw);
                                return `<div><b>Случай ${idx+1}</b> ${acc.date ? `(${acc.date})` : ''}<br>💰 ${totalUsd.toLocaleString()} $</div>`;
                            }).join('');
                        } else if (detailsDiv) {
                            detailsDiv.innerHTML = '<div>Нет страховых случаев</div>';
                        }
                    } else {
                        accidentContent.style.display = 'none';
                        accidentArrow.innerHTML = '▼';
                    }
                };
            }
            
            // Сворачивание панели
            const collapseBtn = document.getElementById('collapse-btn'), fullContent = document.getElementById('panel-full-content'), collapsedContent = document.getElementById('panel-collapsed-content');
            if (collapseBtn && fullContent && collapsedContent) collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); if (isCollapsed) { fullContent.style.display = 'block'; collapsedContent.style.display = 'none'; mainPanel.style.width = '380px'; mainPanel.style.padding = '12px 16px'; collapseBtn.innerHTML = '−'; isCollapsed = false; } else { fullContent.style.display = 'none'; collapsedContent.style.display = 'block'; mainPanel.style.width = '200px'; mainPanel.style.padding = '10px 14px'; collapseBtn.innerHTML = '+'; isCollapsed = true; } });
            
            // Обработчики
            for (const [id, key, label] of [['usd-header','usdRate','USD/RUB'], ['eur-header','eurRate','EUR/RUB'], ['krw-header','usdToKrw','вонов за доллар'], ['usdt-header','usdtRate','USDT/RUB']]) {
                document.getElementById(id).onclick = () => {
                    const value = prompt('Курс ' + label + ':', Hub.get(key) ?? '');
                    if (value === null || value.trim() === '') return;
                    const rate = Number(value.replace(/\s/g, '').replace(',', '.'));
                    if (!Number.isFinite(rate) || rate <= 0) return alert('Введите положительный курс');
                    Hub.set(key, rate);
                    if (['usdRate','eurRate'].includes(key) && Hub.get('usdRate') > 0 && Hub.get('eurRate') > 0) Hub.set('eurUsdRate', Hub.get('eurRate') / Hub.get('usdRate'));
                    Hub.set('currencyStatus', 'Курсы изменены вручную');
                    updateDetailedExpenses(); updateGlobalExpenses(); updatePanel(); updateCalcPanel();
                };
            }

            document.getElementById('info-power').onclick = () => { const val = prompt('Мощность (л.с.):', Hub.get('carPowerHp') || ''); if (val && !isNaN(parseInt(val))) Hub.set('carPowerHp', parseInt(val)); };
            document.getElementById('info-vin').onclick = () => { const vin = Hub.get('carVin'); if (vin) { navigator.clipboard.writeText(vin); const span = document.getElementById('info-vin'); const orig = span.textContent; span.textContent = '✅ Скопировано!'; setTimeout(() => span.textContent = orig, 1500); } };
            
            // Наши услуги (отдельный блок)
            const ourSpanMain = document.getElementById('our-value');
            if (ourSpanMain) {
                ourSpanMain.onclick = () => {
                    const val = prompt('Наши услуги (₽):', ourServices);
                    if (val !== null && Number.isFinite(inputNumber(val)) && inputNumber(val) >= 0) {
                        const numValue = inputNumber(val);
                        ourServices = numValue;
                        saveDetailedSettings();
                        Hub.set('ourServices', ourServices);
                        updateDetailedExpenses();
                        updateGlobalExpenses();
                        updatePanel();
                    }
                };
            }
            
            document.getElementById('tpo-value').onclick = () => { const current = Hub.get('manualTpo') ?? Hub.get('calculatedTpo') ?? ''; const val = prompt('ТПО в USD (оставьте пустым для авто):', current); if (val === '') Hub.set('manualTpo', null); else if (val && Number.isFinite(inputNumber(val)) && inputNumber(val) >= 0) Hub.set('manualTpo', inputNumber(val)); updateCalcPanel(); };
            document.getElementById('util-value').onclick = () => { const current = Hub.get('manualUtilizationFee') ?? Hub.get('utilizationFee') ?? ''; const val = prompt('Утильсбор в ₽ (оставьте пустым для авто):', current); if (val === '') Hub.set('manualUtilizationFee', null); else if (val && Number.isFinite(inputNumber(val)) && inputNumber(val) >= 0) Hub.set('manualUtilizationFee', inputNumber(val)); updateCalcPanel(); };
            
            // Меню цены
            const priceSpan = document.getElementById('price-euro');
            const priceContent = document.getElementById('price-content');
            const priceArrow = document.getElementById('price-arrow');
            if (priceSpan && priceContent && priceArrow) {
                priceArrow.onclick = (e) => { e.stopPropagation(); if (priceContent.style.display === 'none') { priceContent.style.display = 'block'; priceArrow.innerHTML = '▲'; if (unsafeWindow.EncarPrice?.updateDisplay) unsafeWindow.EncarPrice.updateDisplay(); else Hub.emit('priceContent:update', {}); } else { priceContent.style.display = 'none'; priceArrow.innerHTML = '▼'; } };
                priceSpan.onclick = (e) => {
                    e.stopPropagation();
                    const value = prompt('Таможенная стоимость EUR (пусто — авто):', Hub.get('selectedEuroPrice') ?? '');
                    if (value === null) return;
                    if (value.trim() === '') {
                        unsafeWindow.EncarPrice?.resetManualPrice();
                    } else {
                        const n = inputNumber(value);
                        if (!Number.isFinite(n) || n <= 0) return alert('Введите положительную стоимость');
                        unsafeWindow.EncarPrice?.setManual(n);
                    }
                    updatePanel();
                };
            }
            
            document.getElementById('print-report-btn').onclick = () => { if (unsafeWindow.EncarPhotos?.print) unsafeWindow.EncarPhotos.print(); else alert('Модуль фото не загружен'); };
            
            updateDetailedExpenses();
            updateGlobalExpenses();
            updatePanel();
            
            createCalcPanel();
            updateCalcPanel();
            
            // Подписка на изменение цены авто для обновления расходов Корея
            Hub.on('carPriceKrw:changed', () => {
                updateDetailedExpenses();
                updateGlobalExpenses();
                updatePanel();
            });
            
            // Периодическое обновление (как резерв)
            setInterval(() => { 
                updateDetailedExpenses();
                updateGlobalExpenses();
                updatePanel(); 
                updateCalcPanel(); 
            }, 5000);
        }
        
        Hub.on('any:changed', () => { updatePanel(); updateCalcPanel(); });
        Hub.on('priceContent:update', () => { if (unsafeWindow.EncarPrice?.updateDisplay) unsafeWindow.EncarPrice.updateDisplay(); });
        Hub.on('accidentData:loaded', () => updatePanel());
        
        createPanel();
        console.log('[UI] Панель загружена v28.6 (автоматическое обновление расходов Корея)');
    });
})();
