// ==UserScript==
// @name         Encar Price Module (GitHub CSV)
// @namespace    http://tampermonkey.net/
// @version      3.3
// @description  Загрузка стоимости из CSV файла в репозитории GitHub (с авто-выбором года)
// @match        *://www.encar.com/cars/detail/*
// @match        *://fem.encar.com/cars/detail/*
// @connect      raw.githubusercontent.com
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// ==/UserScript==

(function() {
    'use strict';
    
    if (!unsafeWindow.EncarHub) {
        console.error('[Price] CoreHub не найден!');
        return;
    }
    
    const Hub = unsafeWindow.EncarHub;
    
    const CSV_URL = 'https://raw.githubusercontent.com/2575424-star/encar-userscript/refs/heads/main/car-prices.csv';
    
    let allPriceData = [];
    let priceDataLoaded = false;
    
    let selectedPriceBrand = null;
    let selectedPriceModel = null;
    let selectedPriceEngine = null;
    let selectedPriceYear = null;
    let selectedPriceManual = null;
    
    function parseCSV(csvText) {
        const rows = []; let row = [], field = '', quoted = false;
        for (let i = 0; i < csvText.length; i++) {
            const c = csvText[i];
            if (c === '"') { if (quoted && csvText[i+1] === '"') { field += '"'; i++; } else quoted = !quoted; }
            else if (c === ',' && !quoted) { row.push(field.trim()); field = ''; }
            else if (c === '\n' && !quoted) { row.push(field.trim()); rows.push(row); row = []; field = ''; }
            else field += c;
        }
        if (quoted) return [];
        row.push(field.trim()); rows.push(row);
        const lines = rows;
        if (lines.length < 2) return [];
        
        let headerIndex = 0;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].some(v => v.includes('Марка')) && lines[i].some(v => v.includes('Модель'))) {
                headerIndex = i;
                break;
            }
        }
        
        const headers = lines[headerIndex];
        const colBrand = headers.findIndex(h => h.includes('Марка'));
        const colModel = headers.findIndex(h => h.includes('Модель'));
        const colEngine = headers.findIndex(h => h.includes('Объем') || h.includes('Объём'));
        const colYear = headers.findIndex(h => h.includes('Год'));
        const colPrice = headers.findIndex(h => h.includes('Стоимость') || h.includes('Цена'));
        
        if (colBrand === -1 || colModel === -1 || colPrice === -1) {
            console.error('[Price] Не найдены нужные колонки в CSV');
            return [];
        }
        
        const data = [];
        for (let i = headerIndex + 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            
            const values = line;
            if (values.length <= Math.max(colBrand, colModel, colPrice)) continue;
            
            const price = Number(values[colPrice].replace(/\s/g, '').replace(',', '.'));
            if (!Number.isFinite(price) || price <= 0) continue;
            
            const year = colYear !== -1 ? parseInt(values[colYear], 10) : null;
            const engine = colEngine !== -1 ? values[colEngine] : null;
            
            data.push({
                Марка: values[colBrand],
                Модель: values[colModel],
                Объем: engine,
                Год: year,
                Цена: price
            });
        }
        
        console.log(`[Price] Загружено ${data.length} записей из CSV`);
        return data;
    }
    
    function findPriceFromData(brand, model, engine, year) {
        if (!allPriceData.length) return null;
        
        const strYear = parseInt(year);
        if (!brand || !model || engine == null || !strYear) return null;
        const engineStr = String(engine || '').replace(/\s/g, '');
        
        let found = allPriceData.find(item =>
            item.Марка?.toLowerCase() === brand?.toLowerCase() &&
            item.Модель?.toLowerCase() === model?.toLowerCase() &&
            (!engineStr || String(item.Объем || '').replace(/\s/g, '') === engineStr) &&
            (!strYear || item.Год === strYear)
        );
        
        return found ? found.Цена : null;
    }
    
    function getCurrentEuroPrice() {
        if (selectedPriceManual !== null) return selectedPriceManual;
        if (selectedPriceBrand && selectedPriceModel && selectedPriceEngine && selectedPriceYear && allPriceData.length) {
            return findPriceFromData(selectedPriceBrand, selectedPriceModel, selectedPriceEngine, selectedPriceYear);
        }
        const brand = Hub.get('carBrand');
        const model = Hub.get('carModel');
        const engine = Hub.get('carEngineVolume');
        const year = Hub.get('carYear');
        if (brand && model && engine && year && allPriceData.length) {
            return findPriceFromData(brand, model, engine, year);
        }
        return null;
    }
    
    function setDataAndNotify(data) {
        allPriceData = data;
        priceDataLoaded = true;
        Hub.set('priceDataLoaded', true);
        Hub.set('priceDataError', null);
        Hub.set('allPriceData', allPriceData);
        Hub.emit('priceData:loaded', allPriceData);
        console.log(`[Price] ✅ Данные сохранены в Hub: ${allPriceData.length} записей`);
        
        const euroPrice = getCurrentEuroPrice();
        if (euroPrice) {
            Hub.set('selectedEuroPrice', euroPrice);
            console.log(`[Price] ✅ Цена установлена: ${euroPrice.toLocaleString()} €`);
        }
        
        // Обновляем UI
        const priceSpan = document.getElementById('price-euro');
        if (priceSpan && euroPrice) {
            priceSpan.textContent = `${euroPrice.toLocaleString()} €`;
        }
    }
    
    function loadPriceData() {
        console.log('[Price] Загрузка CSV из репозитория:', CSV_URL);
        
        GM_xmlhttpRequest({
            method: 'GET',
            url: CSV_URL,
            timeout: 15000,
            onload: function(res) {
                console.log('[Price] GM_xmlhttpRequest статус:', res.status);
                if (res.status === 200 && res.responseText && res.responseText.length > 100) {
                    const data = parseCSV(res.responseText);
                    if (data.length > 0) {
                        setDataAndNotify(data);
                        autoSelectPrice();
                    } else {
                        console.error('[Price] Не удалось распарсить CSV');
                        setDefaultPriceData();
                    }
                } else {
                    console.error('[Price] Ошибка загрузки CSV, статус:', res.status);
                    setDefaultPriceData();
                }
            },
            onerror: function(err) {
                console.error('[Price] Ошибка GM_xmlhttpRequest:', err);
                setDefaultPriceData();
            },
            ontimeout: function() {
                console.error('[Price] Таймаут GM_xmlhttpRequest');
                setDefaultPriceData();
            }
        });
    }
    
    function setDefaultPriceData() {
        allPriceData = [];
        priceDataLoaded = false;
        Hub.set('priceDataLoaded', false);
        Hub.set('allPriceData', []);
        Hub.set('selectedEuroPrice', null);
        Hub.set('priceDataError', 'Таблица ТПО не загрузилась. Укажите ТПО вручную.');
    }

    function autoSelectPrice() {
        const brand = Hub.get('carBrand');
        const model = Hub.get('carModel');
        const engine = Hub.get('carEngineVolume');
        const year = Hub.get('carYear');
        
        console.log(`[Price] Авто-выбор: ${brand} ${model} ${engine}cc ${year}`);
        
        Hub.set('selectedEuroPrice', null);
        if (brand && model && engine && year && allPriceData.length) {
            const price = findPriceFromData(brand, model, engine, year);
            if (price !== null) {
                selectedPriceManual = null;
                selectedPriceBrand = brand;
                selectedPriceModel = model;
                selectedPriceEngine = engine;
                selectedPriceYear = year;
                Hub.set('selectedEuroPrice', price);
                console.log(`[Price] ✅ Авто-выбор цены: ${price.toLocaleString()} € (год ${year})`);
                
                const priceSpan = document.getElementById('price-euro');
                if (priceSpan) {
                    priceSpan.textContent = `${price.toLocaleString()} €`;
                }
            } else {
                console.log(`[Price] ⚠️ Цена не найдена для ${brand} ${model} ${engine}cc ${year}`);
            }
        }
    }
    
    function setManualPrice(price) {
        if (price && !isNaN(price) && price > 0) {
            selectedPriceManual = price;
            selectedPriceBrand = null;
            selectedPriceModel = null;
            selectedPriceEngine = null;
            selectedPriceYear = null;
            Hub.set('selectedEuroPrice', price);
            console.log(`[Price] Ручная установка: ${price.toLocaleString()} €`);
            
            const priceSpan = document.getElementById('price-euro');
            if (priceSpan) {
                priceSpan.textContent = `${price.toLocaleString()} €`;
            }
        }
    }
    
    function getAllPriceData() {
        return allPriceData;
    }
    
    function updatePriceContentDisplay() {
        const innerDiv = document.getElementById('price-content-inner');
        if (!innerDiv) return;
        
        if (!allPriceData.length) {
            innerDiv.innerHTML = '<div style="text-align:center; padding:8px;">Таблица недоступна или загружается. ТПО можно ввести вручную.</div>';
            return;
        }
        
        const brands = [...new Set(allPriceData.map(i => i.Марка))].sort();
        
        // Получаем данные из Hub для авто-выбора
        const hubBrand = Hub.get('carBrand');
        const hubModel = Hub.get('carModel');
        const hubEngine = Hub.get('carEngineVolume');
        const hubYear = Hub.get('carYear');
        
        // Определяем выбранные значения (приоритет: ручной выбор > данные из Hub)
        let selectedBrand = selectedPriceBrand || hubBrand || '';
        let selectedModel = selectedPriceModel || hubModel || '';
        let selectedEngine = selectedPriceEngine || (hubEngine ? hubEngine.toString() : '');
        let selectedYear = selectedPriceYear || hubYear || '';
        
        let modelsHtml = '<option value="">— выберите модель —</option>';
        let enginesHtml = '<option value="">— выберите объём —</option>';
        let yearsHtml = '<option value="">— выберите год —</option>';
        
        if (selectedBrand) {
            const models = [...new Set(allPriceData.filter(i => i.Марка === selectedBrand).map(i => i.Модель))].sort();
            modelsHtml = '<option value="">— выберите модель —</option>' + models.map(m => `<option value="${m}" ${m === selectedModel ? 'selected' : ''}>${m}</option>`).join('');
            
            if (selectedModel) {
                const engines = [...new Set(allPriceData.filter(i => i.Марка === selectedBrand && i.Модель === selectedModel).map(i => i.Объем))].sort((a,b) => parseInt(a)-parseInt(b));
                enginesHtml = '<option value="">— выберите объём —</option>' + engines.map(e => `<option value="${e}" ${String(e) === String(selectedEngine) ? 'selected' : ''}>${e}</option>`).join('');
                
                if (selectedEngine) {
                    const years = [...new Set(allPriceData.filter(i => i.Марка === selectedBrand && i.Модель === selectedModel && String(i.Объем) === String(selectedEngine)).map(i => i.Год))].sort((a,b) => b-a);
                    yearsHtml = '<option value="">— выберите год —</option>' + years.map(y => `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${y}</option>`).join('');
                }
            }
        }
        
        innerDiv.innerHTML = `
            <div style="margin-bottom:8px;"><label style="font-size:11px; color:#94a3b8;">Марка:</label>
            <select id="price-brand-select" style="width:100%; padding:6px; background:#0f172a; color:white; border:1px solid #475569; border-radius:8px;">
                <option value="">— выберите марку —</option>${brands.map(b => `<option value="${b}" ${b === selectedBrand ? 'selected' : ''}>${b}</option>`).join('')}
            </select></div>
            <div style="margin-bottom:8px;"><label style="font-size:11px; color:#94a3b8;">Модель:</label>
            <select id="price-model-select" style="width:100%; padding:6px; background:#0f172a; color:white; border:1px solid #475569; border-radius:8px;">${modelsHtml}</select></div>
            <div style="margin-bottom:8px;"><label style="font-size:11px; color:#94a3b8;">Объём (см³):</label>
            <select id="price-engine-select" style="width:100%; padding:6px; background:#0f172a; color:white; border:1px solid #475569; border-radius:8px;">${enginesHtml}</select></div>
            <div style="margin-bottom:8px;"><label style="font-size:11px; color:#94a3b8;">Год:</label>
            <select id="price-year-select" style="width:100%; padding:6px; background:#0f172a; color:white; border:1px solid #475569; border-radius:8px;">${yearsHtml}</select></div>
            <div style="display:flex; gap:8px; margin-top:12px;">
                <button id="price-apply-auto" style="background:#fbbf24; border:none; padding:6px 12px; border-radius:8px; cursor:pointer; font-weight:bold;">Применить</button>
                <button id="price-cancel-auto" style="background:#475569; border:none; padding:6px 12px; border-radius:8px; cursor:pointer; color:white;">Отмена</button>
            </div>
        `;
        
        const brandSelect = document.getElementById('price-brand-select');
        const modelSelect = document.getElementById('price-model-select');
        const engineSelect = document.getElementById('price-engine-select');
        const yearSelect = document.getElementById('price-year-select');
        const applyBtn = document.getElementById('price-apply-auto');
        const cancelBtn = document.getElementById('price-cancel-auto');
        const priceContent = document.getElementById('price-content');
        const priceArrow = document.getElementById('price-arrow');
        const priceSpan = document.getElementById('price-euro');
        
        if (brandSelect) {
            brandSelect.onchange = () => {
                const brand = brandSelect.value;
                if (!brand) {
                    modelSelect.innerHTML = '<option value="">— выберите модель —</option>';
                    modelSelect.disabled = true;
                    engineSelect.disabled = true;
                    yearSelect.disabled = true;
                    return;
                }
                const models = [...new Set(allPriceData.filter(i => i.Марка === brand).map(i => i.Модель))].sort();
                modelSelect.innerHTML = '<option value="">— выберите модель —</option>' + models.map(m => `<option value="${m}">${m}</option>`).join('');
                modelSelect.disabled = false;
                engineSelect.disabled = true;
                yearSelect.disabled = true;
            };
        }
        
        if (modelSelect) {
            modelSelect.onchange = () => {
                const brand = brandSelect.value, model = modelSelect.value;
                if (!brand || !model) return;
                const engines = [...new Set(allPriceData.filter(i => i.Марка === brand && i.Модель === model).map(i => i.Объем))].sort((a,b) => parseInt(a)-parseInt(b));
                engineSelect.innerHTML = '<option value="">— выберите объём —</option>' + engines.map(e => `<option value="${e}">${e}</option>`).join('');
                engineSelect.disabled = false;
                yearSelect.disabled = true;
            };
        }
        
        if (engineSelect) {
            engineSelect.onchange = () => {
                const brand = brandSelect.value, model = modelSelect.value, engine = engineSelect.value;
                if (!brand || !model || !engine) return;
                const years = [...new Set(allPriceData.filter(i => i.Марка === brand && i.Модель === model && i.Объем === engine).map(i => i.Год))].sort((a,b) => b-a);
                yearSelect.innerHTML = '<option value="">— выберите год —</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
                yearSelect.disabled = false;
            };
        }
        
        if (applyBtn) {
            applyBtn.onclick = () => {
                const brand = brandSelect.value, model = modelSelect.value, engine = engineSelect.value, year = parseInt(yearSelect.value);
                if (!brand || !model || !engine || !year) { 
                    alert('Выберите все параметры'); 
                    return; 
                }
                const price = allPriceData.find(i => i.Марка === brand && i.Модель === model && i.Объем === engine && i.Год === year)?.Цена;
                if (price) {
                    setManualPrice(price);
                    Hub.set('selectedPriceBrand', brand);
                    Hub.set('selectedPriceModel', model);
                    Hub.set('selectedPriceEngine', engine);
                    Hub.set('selectedPriceYear', year);
                    if (priceSpan) priceSpan.textContent = `${price.toLocaleString()} €`;
                    console.log(`[Price] Применена цена: ${price.toLocaleString()} € для ${brand} ${model} ${engine} ${year}`);
                }
                if (priceContent) priceContent.style.display = 'none';
                if (priceArrow) priceArrow.innerHTML = '▼';
            };
        }
        
        if (cancelBtn && priceContent && priceArrow) {
            cancelBtn.onclick = () => {
                priceContent.style.display = 'none';
                priceArrow.innerHTML = '▼';
            };
        }
    }
    
    unsafeWindow.EncarPrice = {
        resetManualPrice: () => { selectedPriceManual = null; autoSelectPrice(); },
        setManual: setManualPrice,
        refresh: loadPriceData,
        findPrice: (brand, model, engine, year) => findPriceFromData(brand, model, engine, year),
        getCurrentPrice: getCurrentEuroPrice,
        getData: () => allPriceData,
        updateDisplay: updatePriceContentDisplay
    };
    
    Hub.on('carData:ready', () => {
        console.log('[Price] carData:ready получен');
        if (allPriceData.length) {
            autoSelectPrice();
            // Обновляем отображение в выпадающем меню
            if (unsafeWindow.EncarPrice?.updateDisplay) {
                unsafeWindow.EncarPrice.updateDisplay();
            }
        } else {
            Hub.once('priceData:loaded', () => {
                autoSelectPrice();
                if (unsafeWindow.EncarPrice?.updateDisplay) {
                    unsafeWindow.EncarPrice.updateDisplay();
                }
            });
        }
    });
    
    // Подписка на изменение года для обновления отображения
    Hub.on('carYear:changed', () => {
        console.log('[Price] carYear изменился, обновляем отображение');
        if (allPriceData.length) {
            autoSelectPrice();
        }
        if (unsafeWindow.EncarPrice?.updateDisplay) {
            unsafeWindow.EncarPrice.updateDisplay();
        }
    });
    
    // Подписка на изменение марки/модели/объёма для обновления отображения
    Hub.on('carBrand:changed', () => {
        autoSelectPrice();
        if (unsafeWindow.EncarPrice?.updateDisplay) unsafeWindow.EncarPrice.updateDisplay();
    });
    Hub.on('carModel:changed', () => {
        autoSelectPrice();
        if (unsafeWindow.EncarPrice?.updateDisplay) unsafeWindow.EncarPrice.updateDisplay();
    });
    Hub.on('carEngineVolume:changed', () => {
        autoSelectPrice();
        if (unsafeWindow.EncarPrice?.updateDisplay) unsafeWindow.EncarPrice.updateDisplay();
    });
    
    Hub.on('priceContent:update', () => {
        updatePriceContentDisplay();
    });
    
    Hub.on('carId:changed', () => { selectedPriceManual = null; selectedPriceBrand = null; selectedPriceModel = null; selectedPriceEngine = null; selectedPriceYear = null; Hub.set('selectedEuroPrice', null); });

    // Запускаем загрузку
    loadPriceData();
    
    console.log('[Price] Модуль загружен (версия 3.3)');
})();
