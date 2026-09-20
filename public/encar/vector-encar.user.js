// ==UserScript==
// @name VECTOR Encar → CRM
// @namespace https://vector-crm-pavel.divine-lime-4457.chatgpt.site
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
// ==/UserScript==


(function() {
    'use strict';

    if (!unsafeWindow.EncarHub) {
        unsafeWindow.EncarHub = {
            _data: {},
            _listeners: {},
            _onceListeners: {},
            
            set: function(key, value, silent = false) {
                const oldValue = this._data[key];
                this._data[key] = value;
                if (!silent) {
                    this.emit(`${key}:changed`, { key, value, oldValue });
                    this.emit('any:changed', { key, value, oldValue });
                }
                console.log(`[Hub] ${key} =`, value);
                return value;
            },
            
            get: function(key) {
                return this._data[key];
            },
            
            getAll: function() {
                return { ...this._data };
            },
            
            on: function(event, callback) {
                if (!this._listeners[event]) this._listeners[event] = [];
                this._listeners[event].push(callback);
            },
            
            once: function(event, callback) {
                if (!this._onceListeners[event]) this._onceListeners[event] = [];
                this._onceListeners[event].push(callback);
            },
            
            off: function(event, callback) {
                if (this._listeners[event]) {
                    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
                }
                if (this._onceListeners[event]) {
                    this._onceListeners[event] = this._onceListeners[event].filter(cb => cb !== callback);
                }
            },
            
            emit: function(event, data) {
                if (this._listeners[event]) {
                    this._listeners[event].forEach(cb => {
                        try { cb(data); } catch(e) { console.error(`[Hub] Ошибка в ${event}:`, e); }
                    });
                }
                if (this._onceListeners && this._onceListeners[event]) {
                    const callbacks = [...this._onceListeners[event]];
                    delete this._onceListeners[event];
                    callbacks.forEach(cb => {
                        try { cb(data); } catch(e) { console.error(`[Hub] Ошибка в once ${event}:`, e); }
                    });
                }
            },
            
            waitFor: function(key, timeout = 10000) {
                return new Promise((resolve, reject) => {
                    const existing = this.get(key);
                    if (existing !== undefined && existing !== null) {
                        resolve(existing);
                        return;
                    }
                    const timeoutId = setTimeout(() => {
                        this.off(`${key}:changed`, handler);
                        reject(new Error(`Timeout waiting for ${key}`));
                    }, timeout);
                    const handler = (data) => {
                        clearTimeout(timeoutId);
                        this.off(`${key}:changed`, handler);
                        resolve(data.value);
                    };
                    this.on(`${key}:changed`, handler);
                });
            }
        };
    }
    
    GM_addStyle(`
        #encar-combined-panel,
        #encar-combined-panel * {
            translate: no !important;
            -webkit-translate: no !important;
        }
    `);
    
    document.documentElement.setAttribute('translate', 'no');
    document.body.setAttribute('translate', 'no');
    
    console.log('[CoreHub] Инициализирован v2.1');
})();

;


(function() {
    'use strict';

    // Ждём, пока ядро загрузится
    if (!unsafeWindow.EncarHub) {
        console.error('[Currency] CoreHub не найден!');
        return;
    }

    const Hub = unsafeWindow.EncarHub;

    // Значения по умолчанию
    const DEFAULT_RATES = {
        usdRate: 96.5,
        eurRate: 104.2,
        usdToKrw: 1473,
        eurUsdRate: 1.08,
        usdtRate: 90,
        lastUpdateTime: null
    };

    // Загрузка курсов с ЦБ РФ
    function fetchCurrencyRates() {
        console.log('[Currency] Загрузка курсов...');

        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://cbr-xml-daily.ru/daily.xml',
            timeout: 10000,
            onload: function(response) {
                if (response.status === 200 && response.response) {
                    try {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.response, 'text/xml');

                        const read = id => {
                            const node = doc.querySelector(`Valute[ID="${id}"]`);
                            const value = Number(node?.querySelector('Value')?.textContent.replace(',', '.'));
                            const nominal = Number(node?.querySelector('Nominal')?.textContent);
                            if (!(value > 0) || !(nominal > 0) || !Number.isFinite(value / nominal)) throw new Error('Неполный курс');
                            return value / nominal;
                        };
                        const usdRate = read('R01235'), eurRate = read('R01239');
                        const usdToKrw = usdRate / read('R01815');
                        const eurUsdRate = eurRate / usdRate;
                        const date = doc.querySelector('ValCurs')?.getAttribute('Date');
                        if (!/^\d{2}\.\d{2}\.\d{4}$/.test(date || '')) throw new Error('Нет даты курса');
                        const [day, month, year] = date.split('.');
                        const lastUpdateTime = new Date(`${year}-${month}-${day}T00:00:00Z`);
                        Hub.set('currencyStatus', 'Курсы cbr-xml-daily.ru на ' + date);
                        Hub.set('usdRate', usdRate);
                        Hub.set('eurRate', eurRate);
                        Hub.set('usdToKrw', usdToKrw);
                        Hub.set('eurUsdRate', eurUsdRate);
                        Hub.set('lastCurrencyUpdate', lastUpdateTime);

                        console.log(`[Currency] Курсы: USD=${usdRate.toFixed(2)}, EUR=${eurRate.toFixed(2)}, USD/KRW=${Math.round(usdToKrw)}`);
                    } catch(e) {
                        console.error('[Currency] Ошибка парсинга:', e);
                        setDefaultRates();
                    }
                } else {
                    console.error('[Currency] Ошибка HTTP:', response.status);
                    setDefaultRates();
                }
            },
            onerror: function(err) {
                console.error('[Currency] Ошибка сети:', err);
                setDefaultRates();
            },
            ontimeout: function() {
                console.error('[Currency] Таймаут запроса');
                setDefaultRates();
            }
        });
    }

    function setDefaultRates() {
        // При сбое сохраняем последний успешный курс и его реальную дату.
        Hub.set('currencyStatus', Hub.get('lastCurrencyUpdate') ? 'Обновление курсов не удалось; сохранён прежний курс.' : 'Курсы не загружены. Введите вручную или повторите загрузку.');
    }

    // Обновление USDT курса (можно редактировать вручную)
    function loadUsdtFromStorage() {
        const saved = localStorage.getItem('encar_usdt_rate');
        if (saved) {
            try {
                const rate = parseFloat(saved);
                if (!isNaN(rate) && rate > 0) {
                    Hub.set('usdtRate', rate);
                    return;
                }
            } catch(e) {}
        }
        Hub.set('usdtRate', null);
    }

    function saveUsdtRate(rate) {
        if (Number.isFinite(rate) && rate > 0) localStorage.setItem('encar_usdt_rate', rate.toString());
    }

    // Подписываемся на изменение USDT курса
    Hub.on('usdtRate:changed', (data) => {
        saveUsdtRate(data.value);
    });

    // Запуск
    loadUsdtFromStorage();
    fetchCurrencyRates();

    // Обновляем курсы каждый час
    setInterval(() => fetchCurrencyRates(), 3600000);

    // Экспортируем методы для ручного обновления
    unsafeWindow.EncarCurrency = {
        refresh: fetchCurrencyRates,
        setUsdtRate: (rate) => { if (!Number.isFinite(rate) || rate <= 0) throw new Error('Курс должен быть положительным'); Hub.set('usdtRate', rate); }
    };

    console.log('[Currency] Модуль загружен');
})();

;


(function() {
    'use strict';

    if (!unsafeWindow.EncarHub) {
        console.error('[Calculations] CoreHub не найден!');
        return;
    }

    const Hub = unsafeWindow.EncarHub;
    const valid = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;

    // Значения по умолчанию для расходов
    const DEFAULT_EXPENSES = {
        koreaLogistics: 4000,   // $
        servicesBishkek: 1200,  // $
        docsRf: 80000,          // ₽
        ourServices: 250000     // ₽
    };

    // Расчёт ТПО
    function calculateTpo() {
        const manualTpo = Hub.get('manualTpo');
        if (manualTpo !== null && manualTpo !== undefined) return valid(manualTpo) ? manualTpo : null;

        const euroPrice = Hub.get('selectedEuroPrice');
        const eurUsdRate = Hub.get('manualEurUsdRate') ?? Hub.get('eurUsdRate');

        if (valid(euroPrice) && euroPrice > 0 && valid(eurUsdRate) && eurUsdRate > 0) {
            return Math.round(euroPrice * 0.48 * eurUsdRate * 100) / 100;
        }
        return null;
    }

    // Расчёт утильсбора
    function calculateUtilizationFee(engineCc, hp) {
        const manualFee = Hub.get('manualUtilizationFee');
        if (manualFee !== null && manualFee !== undefined) return valid(manualFee) ? manualFee : null;

        // Электромобиль требует отдельного подтверждённого тарифа. Нулевой объём не равен отсутствию данных.
        if (!valid(engineCc) || engineCc === 0 || !valid(hp) || hp === 0) return null;

        // Логика расчёта в зависимости от объёма и мощности
        if (engineCc <= 2000) {
            if (hp <= 160) return 3400;
            if (hp < 190) return 900000;
            if (hp < 220) return 952800;
            if (hp < 250) return 1010400;
            if (hp < 280) return 1114200;
            if (hp < 310) return 1291200;
            if (hp < 340) return 1459200;
            if (hp < 370) return 1663200;
            if (hp < 400) return 1896000;
            if (hp < 500) return 2808000;
            return 2808000;
        }

        if (engineCc <= 3000) {
            if (hp <= 160) return 3400;
            if (hp <= 190) return 2306800;
            if (hp <= 250) return 2402400;
            if (hp <= 310) return 2620800;
            if (hp <= 400) return 2949000;
            return 3189600;
        }

        // Для больших объёмов
        return 5200000;
    }

    // Расчёт итоговой стоимости
    function calculateTotalPrice() {
        const price = Hub.get('carPriceKrw'), krw = Hub.get('usdToKrw'), rate = Hub.get('usdtRate');
        const tpo = calculateTpo(), util = calculateUtilizationFee(Hub.get('carEngineVolume'), Hub.get('carPowerHp'));
        const expenses = Object.keys(DEFAULT_EXPENSES).map(key => Hub.get(key) ?? DEFAULT_EXPENSES[key]);
        if (![price, krw, rate].every(v => valid(v) && v > 0) || ![tpo, util, ...expenses].every(valid)) return null;
        const [korea, bishkek, docs, services] = expenses;
        return Math.round((price / krw + korea + tpo + bishkek) * rate + util + docs + services);
    }

    function updateUtilizationFee() {
        Hub.set('utilizationFee', calculateUtilizationFee(Hub.get('carEngineVolume'), Hub.get('carPowerHp')));
    }

    // Обновление всех расчётов
    function updateAllCalculations() {
        const tpo = calculateTpo();
        Hub.set('calculatedTpo', tpo);

        updateUtilizationFee();

        const total = calculateTotalPrice();
        Hub.set('totalPrice', total);
        Hub.set('calculationNotice', total === null ? 'Расчёт неполный: заполните цену, курсы, ТПО и утильсбор.' : 'Предварительный расчёт. Таблица ТПО и тариф утильсбора требуют подтверждения.');

        Hub.emit('calculations:updated', { tpo, total });
    }

    // Загрузка сохранённых настроек
    function loadSettingsFromStorage() {
        let settings = {};
        try {
            const saved = JSON.parse(localStorage.getItem('encar_settings'));
            if (saved && Date.now() - saved.timestamp < 90 * 86400000) settings = saved;
        } catch (_) {}
        // Сначала разобрать весь снимок: слушатели сохранения не должны затереть его в ходе загрузки.
        for (const [key, fallback] of Object.entries(DEFAULT_EXPENSES)) Hub.set(key, valid(settings[key]) ? settings[key] : fallback);
    }

    function saveSettingsToStorage() {
        localStorage.setItem('encar_settings', JSON.stringify({
            koreaLogistics: Hub.get('koreaLogistics'),
            servicesBishkek: Hub.get('servicesBishkek'),
            docsRf: Hub.get('docsRf'),
            ourServices: Hub.get('ourServices'),
            timestamp: Date.now()
        }));
    }

    // Подписки на изменения
    Hub.on('carEngineVolume:changed', () => updateAllCalculations());
    Hub.on('carPowerHp:changed', () => updateAllCalculations());
    Hub.on('selectedEuroPrice:changed', () => updateAllCalculations());
    Hub.on('manualEurUsdRate:changed', () => updateAllCalculations());
    Hub.on('eurUsdRate:changed', () => updateAllCalculations());
    Hub.on('usdtRate:changed', () => updateAllCalculations());
    Hub.on('usdToKrw:changed', () => updateAllCalculations());
    Hub.on('carPriceKrw:changed', () => updateAllCalculations());

    Hub.on('koreaLogistics:changed', () => { saveSettingsToStorage(); updateAllCalculations(); });
    Hub.on('servicesBishkek:changed', () => { saveSettingsToStorage(); updateAllCalculations(); });
    Hub.on('docsRf:changed', () => { saveSettingsToStorage(); updateAllCalculations(); });
    Hub.on('ourServices:changed', () => { saveSettingsToStorage(); updateAllCalculations(); });

    Hub.on('manualTpo:changed', () => updateAllCalculations());
    Hub.on('manualUtilizationFee:changed', () => updateAllCalculations());

    // Загрузка сохранённых значений
    loadSettingsFromStorage();

    let loadingOverrides = false;
    function loadCarOverrides() {
        loadingOverrides = true;
        const id = Hub.get('carId');
        for (const [key, prefix, field] of [['manualTpo', 'encar_tpo_', 'tpo'], ['manualUtilizationFee', 'encar_util_', 'value']]) {
            let value = null;
            try {
                const saved = id ? JSON.parse(localStorage.getItem(prefix + id)) : null;
                if (saved && Date.now() - saved.timestamp < 30 * 86400000 && valid(saved[field])) value = saved[field];
            } catch (_) {}
            Hub.set(key, value);
        }
        loadingOverrides = false;
    }
    Hub.on('carId:changed', loadCarOverrides);
    loadCarOverrides();

    // Сохранение ручных значений
    Hub.on('manualTpo:changed', (data) => {
        const id = Hub.get('carId');
        if (id && !loadingOverrides) {
            localStorage.setItem(`encar_tpo_${id}`, JSON.stringify({
                tpo: data.value,
                timestamp: Date.now()
            }));
        }
    });

    Hub.on('manualUtilizationFee:changed', (data) => {
        const id = Hub.get('carId');
        if (id && !loadingOverrides) {
            localStorage.setItem(`encar_util_${id}`, JSON.stringify({
                value: data.value,
                timestamp: Date.now()
            }));
        }
    });

    // Первичный расчёт
    setTimeout(() => updateAllCalculations(), 500);

    console.log('[Calculations] Модуль загружен');
})();

;


(function() {
    'use strict';
    
    if (!unsafeWindow.EncarHub) {
        console.error('[Price] CoreHub не найден!');
        return;
    }
    
    const Hub = unsafeWindow.EncarHub;
    
    const CSV_URL = 'https://vector-crm-pavel.divine-lime-4457.chatgpt.site/encar/car-prices.csv';
    
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

;


(function() {
    'use strict';

    if (!unsafeWindow.EncarHub) {
        console.error('[CarData] CoreHub не найден!');
        return;
    }

    const Hub = unsafeWindow.EncarHub;
    let accidentDetails = null;

    // ========== РАСШИРЕННЫЙ ПЕРЕВОД МАРОК ==========
    const BRAND_TRANSLATIONS = {
        '현대': 'HYUNDAI', '기아': 'KIA', '기아(아시아)': 'KIA', '대우': 'DAEWOO',
        '쉐보레': 'CHEVROLET', '르노삼성': 'RENAULT', '삼성': 'SAMSUNG',
        '벤츠': 'MERCEDES-BENZ', 'BMW': 'BMW', '아우디': 'AUDI',
        '폭스바겐': 'VOLKSWAGEN', '볼보': 'VOLVO', '포드': 'FORD',
        '도요타': 'TOYOTA', '혼다': 'HONDA', '닛산': 'NISSAN', '미니': 'MINI',
        '푸조': 'PEUGEOT', '지프': 'JEEP', '랜드로버': 'LAND ROVER',
        '재규어': 'JAGUAR', '포르쉐': 'PORSCHE', '렉서스': 'LEXUS',
        '인피니티': 'INFINITI', '마쓰다': 'MAZDA', '미쓰비시': 'MITSUBISHI',
        '스바루': 'SUBARU', '벤틀리': 'BENTLEY', '테슬라': 'TESLA'
    };

    function translateBrand(koreanBrand) {
        if (!koreanBrand) return null;
        for (const [kr, en] of Object.entries(BRAND_TRANSLATIONS)) {
            if (koreanBrand.includes(kr)) return en;
        }
        return koreanBrand.toUpperCase();
    }

    // ========== ПЕРЕВОД МОДЕЛЕЙ (РАСШИРЕННЫЙ) ==========
    const MODEL_TRANSLATIONS = {
        // BMW
        '1시리즈': '1 Series', '2시리즈': '2 Series', '3시리즈': '3 Series',
        '4시리즈': '4 Series', '5시리즈': '5 Series', '6시리즈': '6 Series',
        '7시리즈': '7 Series', '8시리즈': '8 Series',
        '그란투리스모': 'Gran Turismo', 'GT': 'GT',
        'M2': 'M2', 'M3': 'M3', 'M4': 'M4', 'M5': 'M5', 'M6': 'M6', 'M8': 'M8',
        'X1': 'X1', 'X2': 'X2', 'X3': 'X3', 'X4': 'X4', 'X5': 'X5', 'X6': 'X6', 'X7': 'X7',
        'X3M': 'X3 M', 'X4M': 'X4 M', 'X5M': 'X5 M', 'X6M': 'X6 M', 'XM': 'XM',
        'Z3': 'Z3', 'Z4': 'Z4', 'Z8': 'Z8',
        'i3': 'i3', 'i4': 'i4', 'i5': 'i5', 'i7': 'i7', 'i8': 'i8',
        'iX1': 'iX1', 'iX2': 'iX2', 'iX3': 'iX3', 'iX': 'iX',
        
        // Mercedes-Benz
        'A-클래스': 'A-Class', 'A클래스': 'A-Class', 'A-лайз': 'A-Class',
        'B-클래스': 'B-Class', 'B클래스': 'B-Class',
        'C-클래스': 'C-Class', 'C클래스': 'C-Class', 'C-лайз': 'C-Class',
        'CLA-클래스': 'CLA-Class', 'CLA클래스': 'CLA-Class',
        'CLE-클래스': 'CLE-Class', 'CLE클래스': 'CLE-Class',
        'CLS-클래스': 'CLS-Class', 'CLS클래스': 'CLS-Class',
        'E-클래스': 'E-Class', 'E클래스': 'E-Class', 'E-лайз': 'E-Class', 'E-лайт': 'E-Class',
        'EQA': 'EQA', 'EQB': 'EQB', 'EQC': 'EQC', 'EQE': 'EQE', 'EQS': 'EQS',
        'G-클래스': 'G-Class', 'G클래스': 'G-Class', 'G-лайз': 'G-Class',
        'GLA-클래스': 'GLA-Class', 'GLA클래스': 'GLA-Class',
        'GLB-클래스': 'GLB-Class', 'GLB클래스': 'GLB-Class',
        'GLC-클래스': 'GLC-Class', 'GLC클래스': 'GLC-Class',
        'GLE-클래스': 'GLE-Class', 'GLE클래스': 'GLE-Class',
        'GLS-클래스': 'GLS-Class', 'GLS클래스': 'GLS-Class',
        'S-클래스': 'S-Class', 'S클래스': 'S-Class', 'S-лайз': 'S-Class',
        'SL-클래스': 'SL-Class', 'SL클래스': 'SL-Class',
        'SLC-클래스': 'SLC-Class', 'SLK-클래스': 'SLK-Class',
        'AMG GT': 'AMG GT', 'SLS AMG': 'SLS AMG',
        'V-클래스': 'V-Class', 'V클래스': 'V-Class',
        '스프린터': 'Sprinter',
        
        // Land Rover
        '디스커버리 스포츠': 'Discovery Sport',
        '디스커버리': 'Discovery',
        '디펜더': 'Defender',
        '레인지로버 벨라': 'Range Rover Velar',
        '레인지로버 스포츠': 'Range Rover Sport',
        '레인지로버 이보크': 'Range Rover Evoque',
        '레인지로버': 'Range Rover',
        '프리랜더': 'Freelander',
        '벨라': 'Velar', '이보크': 'Evoque',
        
        // Audi
        'A4': 'A4', 'A6': 'A6', 'A8': 'A8', 'Q5': 'Q5', 'Q7': 'Q7', 'Q8': 'Q8',
        
        // Porsche
        '카이엔': 'Cayenne', '마칸': 'Macan', '파나메라': 'Panamera', '911': '911',
        
        // Tesla
        '모델 S': 'Model S', '모델 X': 'Model X', '모델 Y': 'Model Y', '모델 3': 'Model 3',
        
        // Lexus
        'ES': 'ES', 'NX': 'NX', 'RX': 'RX', 'LX': 'LX', 'UX': 'UX',
    };

    function translateModel(koreanModel) {
        if (!koreanModel) return null;
        
        // Прямое совпадение (без учёта регистра)
        const lowerModel = koreanModel.toLowerCase();
        for (const [kr, en] of Object.entries(MODEL_TRANSLATIONS)) {
            if (lowerModel === kr.toLowerCase()) {
                console.log(`[CarData] Перевод модели (точное): ${koreanModel} -> ${en}`);
                return en;
            }
        }
        
        // Частичное совпадение
        for (const [kr, en] of Object.entries(MODEL_TRANSLATIONS)) {
            if (lowerModel.includes(kr.toLowerCase())) {
                console.log(`[CarData] Перевод модели (частичный): ${koreanModel} -> ${en}`);
                return en;
            }
        }
        
        // Удаляем корейские символы и скобки
        let cleaned = koreanModel
            .replace(/[가-힣]/g, '')
            .replace(/\([^)]*\)/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        
        if (cleaned && /^[A-Za-z0-9\s-]+$/.test(cleaned)) {
            console.log(`[CarData] Перевод модели (очистка): ${koreanModel} -> ${cleaned}`);
            return cleaned;
        }
        
        console.log(`[CarData] Модель не переведена: ${koreanModel}`);
        return koreanModel;
    }

    // ========== МАРКА И МОДЕЛЬ (С ПРИНУДИТЕЛЬНЫМ ПЕРЕВОДОМ) ==========
    function getCarBrandAndModel() {
        let brand = null, model = null;

        // Способ 1: из PRELOADED_STATE
        if (window.__PRELOADED_STATE__) {
            try {
                const cat = window.__PRELOADED_STATE__.cars?.base?.category ||
                           window.__PRELOADED_STATE__.cars?.detail?.category;
                if (cat) {
                    brand = cat.manufacturerEnglishName || cat.manufacturerName;
                    model = cat.modelEnglishName || cat.modelName;
                    if (brand && model) {
                        if (brand && !/^[A-Z]+$/.test(brand)) brand = translateBrand(brand);
                        if (model) model = translateModel(model);
                        console.log(`[CarData] Способ 1 (PRELOADED): ${brand} ${model}`);
                        return { brand, model };
                    }
                }
            } catch(e) {}
        }

        // Способ 2: из скриптов
        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
            const txt = s.textContent;
            let m = txt.match(/"manufacturerEnglishName":"([^"]+)"/);
            if (m && !brand) brand = m[1];
            m = txt.match(/"manufacturerName":"([^"]+)"/);
            if (m && !brand) brand = m[1];
            m = txt.match(/"modelEnglishName":"([^"]+)"/);
            if (m && !model) model = m[1];
            m = txt.match(/"modelName":"([^"]+)"/);
            if (m && !model) model = m[1];
            if (brand && model) break;
        }

        // Способ 3: из заголовка страницы
        if (!brand || !model) {
            const title = document.title;
            const match = title.match(/^([A-Z]+)\s+([^(]+)/);
            if (match) {
                brand = brand || match[1];
                model = model || match[2].trim();
            }
        }

        // Принудительный перевод
        if (brand && !/^[A-Z]+$/.test(brand)) brand = translateBrand(brand);
        if (model) {
            const translatedModel = translateModel(model);
            if (translatedModel) model = translatedModel;
            // Дополнительная очистка
            model = model.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
            model = model.replace(/년형|년식?/g, '').trim();
        }

        console.log(`[CarData] Финальные данные: brand=${brand}, model=${model}`);
        return (brand || model) ? { brand, model } : null;
    }

    // ========== ОСТАЛЬНЫЕ ФУНКЦИИ (БЕЗ ИЗМЕНЕНИЙ) ==========
    function getCarYearMonth() {
        let year = null, month = null;

        if (window.__PRELOADED_STATE__) {
            try {
                const cat = window.__PRELOADED_STATE__.cars?.base?.category;
                if (cat) {
                    if (cat.yearMonth && cat.yearMonth.length === 6) {
                        year = cat.yearMonth.slice(0, 4);
                        month = cat.yearMonth.slice(4, 6);
                        console.log(`[CarData] Год/месяц способ 1: ${year}/${month}`);
                        return { year, month };
                    }
                    if (cat.formYear) {
                        year = cat.formYear;
                        console.log(`[CarData] Год способ 1: ${year}`);
                        return { year, month };
                    }
                }
            } catch(e) {}
        }

        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
            const txt = s.textContent;
            let m = txt.match(/"yearMonth":"(\d{4})(\d{2})"/);
            if (m) {
                year = m[1];
                month = m[2];
                console.log(`[CarData] Год/месяц способ 2: ${year}/${month}`);
                return { year, month };
            }
            m = txt.match(/"year":(\d{4})/);
            if (m && !year) year = m[1];
            m = txt.match(/"month":(\d{1,2})/);
            if (m && !month) month = m[1].padStart(2, '0');
            if (year) break;
        }

        if (!year) {
            const body = document.body.innerText;
            let m = body.match(/(\d{4})년형?/);
            if (m) {
                year = m[1];
                console.log(`[CarData] Год способ 3: ${year}`);
                return { year, month };
            }
            m = body.match(/(\d{4})\.(\d{2})/);
            if (m) {
                year = m[1];
                month = m[2];
                console.log(`[CarData] Год/месяц способ 3: ${year}/${month}`);
                return { year, month };
            }
        }

        return year ? { year, month } : null;
    }

    function getVinNumber() {
        let vin = null;

        if (window.__PRELOADED_STATE__) {
            try {
                vin = window.__PRELOADED_STATE__.cars?.base?.vehicleNo ||
                      window.__PRELOADED_STATE__.cars?.base?.vin ||
                      window.__PRELOADED_STATE__.cars?.detail?.vehicleNo ||
                      window.__PRELOADED_STATE__.vehicleNo;
                if (vin && vin.length === 17) {
                    console.log(`[CarData] VIN способ 1: ${vin}`);
                    return vin.toUpperCase();
                }
            } catch(e) {}
        }

        const urlMatch = window.location.href.match(/[?&]vin=([A-HJ-NPR-Z0-9]{17})/i);
        if (urlMatch) {
            console.log(`[CarData] VIN способ 2: ${urlMatch[1]}`);
            return urlMatch[1].toUpperCase();
        }

        const body = document.body.innerText;
        let match = body.match(/[A-HJ-NPR-Z0-9]{17}/i);
        if (match) {
            console.log(`[CarData] VIN способ 3: ${match[0]}`);
            return match[0].toUpperCase();
        }

        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
            const txt = script.textContent;
            let m = txt.match(/"vehicleNo":"([A-Z0-9]{17})"/);
            if (m) { vin = m[1]; break; }
            m = txt.match(/"vin":"([A-Z0-9]{17})"/);
            if (m) { vin = m[1]; break; }
            m = txt.match(/[A-HJ-NPR-Z0-9]{17}/);
            if (m && m[0].length === 17) { vin = m[0]; break; }
        }

        if (vin && vin.length === 17) {
            console.log(`[CarData] VIN способ 4: ${vin}`);
            return vin.toUpperCase();
        }

        console.log('[CarData] VIN не найден');
        return null;
    }

    function getCarMileage() {
        if (window.__PRELOADED_STATE__) {
            try {
                const mileage = window.__PRELOADED_STATE__.cars?.base?.spec?.mileage ||
                               window.__PRELOADED_STATE__.cars?.base?.mileage;
                if (mileage) {
                    console.log(`[CarData] Пробег способ 1: ${mileage}`);
                    return mileage;
                }
            } catch(e) {}
        }

        const body = document.body.innerText;
        const match = body.match(/주행거리\s*:?\s*([\d,]+)\s*km/i);
        if (match) {
            const mileage = parseInt(match[1].replace(/,/g, ''));
            console.log(`[CarData] Пробег способ 2: ${mileage}`);
            return mileage;
        }
        return null;
    }

    function getEngineVolume() {
        let volume = null;

        if (window.__PRELOADED_STATE__) {
            try {
                volume = window.__PRELOADED_STATE__.cars?.base?.spec?.displacement;
                if (volume) {
                    volume = Math.ceil(parseInt(volume) / 100) * 100;
                    console.log(`[CarData] Объём способ 1: ${volume}cc`);
                    return volume;
                }
            } catch(e) {}
        }

        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
            const txt = s.textContent;
            let m = txt.match(/"displacement"\s*:\s*(\d+)/);
            if (m) {
                volume = Math.ceil(parseInt(m[1]) / 100) * 100;
                console.log(`[CarData] Объём способ 2: ${volume}cc`);
                return volume;
            }
            m = txt.match(/"engineCapacity"\s*:\s*(\d+)/);
            if (m) {
                volume = Math.ceil(parseInt(m[1]) / 100) * 100;
                console.log(`[CarData] Объём способ 2b: ${volume}cc`);
                return volume;
            }
        }

        const body = document.body.innerText;
        let match = body.match(/(\d{3,4})\s*cc/i);
        if (match) {
            volume = Math.ceil(parseInt(match[1]) / 100) * 100;
            console.log(`[CarData] Объём способ 3: ${volume}cc`);
            return volume;
        }

        const model = Hub.get('carModel');
        if (model) {
            const modelMatch = model.match(/(\d{3})/);
            if (modelMatch) {
                const modelCode = parseInt(modelMatch[1]);
                if (modelCode >= 520 && modelCode < 530) volume = 2000;
                else if (modelCode >= 530 && modelCode < 540) volume = 3000;
                else if (modelCode >= 540 && modelCode < 550) volume = 4000;
                else if (modelCode >= 550) volume = 4400;
                else if (modelCode >= 320 && modelCode < 330) volume = 2000;
                else if (modelCode >= 330 && modelCode < 340) volume = 3000;
                else if (modelCode >= 340) volume = 3000;
                if (volume) {
                    console.log(`[CarData] Объём способ 4: ${volume}cc`);
                    return volume;
                }
            }
        }

        console.log('[CarData] Объём не найден');
        return null;
    }

    function getCarPower() {
        function kwToHp(kw) { return Math.round(kw * 1.341); }

        if (window.__PRELOADED_STATE__) {
            try {
                const base = window.__PRELOADED_STATE__.cars?.base;
                if (base?.spec?.maxPower) {
                    const kw = base.spec.maxPower;
                    console.log(`[CarData] Мощность способ 1: ${kw}kW / ${kwToHp(kw)}hp`);
                    return { hp: kwToHp(kw), kw: kw };
                }
                if (base?.spec?.enginePower) {
                    const kw = base.spec.enginePower;
                    console.log(`[CarData] Мощность способ 1b: ${kw}kW / ${kwToHp(kw)}hp`);
                    return { hp: kwToHp(kw), kw: kw };
                }
            } catch(e) {}
        }

        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
            const m = s.textContent.match(/"maxPower"\s*:\s*(\d+)/);
            if (m) {
                const kw = parseInt(m[1]);
                console.log(`[CarData] Мощность способ 2: ${kw}kW / ${kwToHp(kw)}hp`);
                return { hp: kwToHp(kw), kw: kw };
            }
        }

        const body = document.body.innerText;
        const match = body.match(/(\d{2,3})\s*(?:PS|마력)/);
        if (match) {
            const hp = parseInt(match[1]);
            console.log(`[CarData] Мощность способ 3: ${hp}hp`);
            return { hp: hp, kw: Math.round(hp / 1.341) };
        }
        return null;
    }

    function getCarPriceKrw() {
        if (window.__PRELOADED_STATE__) {
            try {
                const price = window.__PRELOADED_STATE__.cars?.base?.advertisement?.price;
                if (price) {
                    const priceNum = parseInt(price) * 10000;
                    console.log(`[CarData] Цена способ 1: ${priceNum.toLocaleString()} ₩`);
                    return priceNum;
                }
                const price2 = window.__PRELOADED_STATE__.cars?.base?.price;
                if (price2) {
                    console.log(`[CarData] Цена способ 1b: ${price2.toLocaleString()} ₩`);
                    return price2;
                }
            } catch(e) {}
        }

        const body = document.body.innerText;
        const match = body.match(/(\d{1,3}(?:,\d{3})*)\s*만원/);
        if (match) {
            const price = parseInt(match[1].replace(/,/g, '')) * 10000;
            console.log(`[CarData] Цена способ 2: ${price.toLocaleString()} ₩`);
            return price;
        }
        return null;
    }

    function getCarId() {
        const pathId = window.location.pathname.match(/\/cars\/detail\/(\d+)/);
        if (pathId) return pathId[1];
        const urlMatch = window.location.href.match(/carid=(\d+)/);
        if (urlMatch) return urlMatch[1];
        if (window.__PRELOADED_STATE__?.cars?.base?.vehicleId) {
            return window.__PRELOADED_STATE__.cars.base.vehicleId;
        }
        return null;
    }

    function getCarViews() {
        if (window.__PRELOADED_STATE__) {
            try {
                return window.__PRELOADED_STATE__.cars?.base?.manage?.viewCount;
            } catch(e) {}
        }
        const body = document.body.innerText;
        const match = body.match(/조회수\s*:?\s*([\d,]+)/);
        if (match) return parseInt(match[1].replace(/,/g, ''));
        return null;
    }

    // ========== СТРАХОВЫЕ ВЫПЛАТЫ ==========
    function getVehicleNumber(carId, callback) {
        const body = document.body.innerText;
        let match = body.match(/차량번호\s*:?\s*([가-힣0-9]+)/);
        if (match && match[1]) { callback(match[1]); return; }
        if (window.__PRELOADED_STATE__?.cars?.base?.carNumber) {
            callback(window.__PRELOADED_STATE__.cars.base.carNumber);
            return;
        }
        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://api.encar.com/v1/readside/inspection/vehicle/${carId}`,
            headers: { 'Accept': 'application/json' },
            onload: (resp) => {
                if (resp.status === 200 && resp.response) {
                    try {
                        const data = JSON.parse(resp.response);
                        const carNo = data.master?.detail?.carNo;
                        if (carNo) { callback(carNo); return; }
                    } catch(e) {}
                }
                callback(null);
            },
            onerror: () => callback(null)
        });
    }

    function fetchAccidentData(carId, vehicleNo, callback) {
        const url = `https://api.encar.com/v1/readside/record/vehicle/${carId}/open?vehicleNo=${encodeURIComponent(vehicleNo)}`;
        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            headers: { 'Accept': 'application/json' },
            onload: (resp) => {
                if (resp.status === 200 && resp.response) {
                    try {
                        const data = JSON.parse(resp.response);
                        const accidents = data.accidents || [];
                        let totalPaymentWon = 0;
                        for (const acc of accidents) {
                            totalPaymentWon += (acc.partCost || 0) + (acc.laborCost || 0) + (acc.paintingCost || 0);
                        }
                        const usdToKrw = Hub.get('usdToKrw') || 1473;
                        const totalPaymentUsd = Math.round(totalPaymentWon / usdToKrw);
                        callback({ count: Number.isInteger(data.myAccidentCnt) ? data.myAccidentCnt : undefined, totalWon: totalPaymentWon, totalUsd: totalPaymentUsd, details: accidents });
                    } catch(e) { callback(null); }
                } else { callback(null); }
            },
            onerror: () => callback(null)
        });
    }

    function formatAccidentTotal(accidentInfo) {
        if (!accidentInfo || accidentInfo.count === undefined) return '—';
        if (accidentInfo.count === 0) return 'Страховые случаи не указаны';
        return `${accidentInfo.totalUsd.toLocaleString()} $`;
    }

    function updateAccidentPanel(accidentInfo) {
        const accidentSpan = document.getElementById('accident-value');
        const accidentDetailsDiv = document.getElementById('accident-details');
        const usdToKrw = Hub.get('usdToKrw') || 1473;
        
        if (accidentSpan) accidentSpan.textContent = formatAccidentTotal(accidentInfo);
        
        if (accidentDetailsDiv && accidentInfo && accidentInfo.details && accidentInfo.details.length > 0) {
            accidentDetailsDiv.innerHTML = accidentInfo.details.map((acc, idx) => {
                const part = acc.partCost || 0, labor = acc.laborCost || 0, paint = acc.paintingCost || 0;
                const totalWon = part + labor + paint;
                const totalUsd = Math.round(totalWon / usdToKrw);
                return `<div style="margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid #334155;">
                    <b>Случай ${idx+1}</b> (${acc.date || '—'})<br>
                    💰 Выплата: ${totalUsd.toLocaleString()} $ (${totalWon.toLocaleString()} 원)<br>
                    🔧 Запчасти: ${Math.round(part/usdToKrw).toLocaleString()} $<br>
                    🛠️ Работа: ${Math.round(labor/usdToKrw).toLocaleString()} $<br>
                    🎨 Покраска: ${Math.round(paint/usdToKrw).toLocaleString()} $
                </div>`;
            }).join('');
        } else if (accidentDetailsDiv && accidentInfo && accidentInfo.count === 0) {
            accidentDetailsDiv.innerHTML = '<div>Нет страховых случаев</div>';
        }
        
        Hub.set('accidentTotal', formatAccidentTotal(accidentInfo));
        Hub.set('accidentDetails', accidentInfo?.details || []);
        Hub.emit('accidentData:loaded', accidentInfo);
    }

    function loadAccidentData() {
        const carId = getCarId();
        if (!carId) { 
            updateAccidentPanel({ count: 0, totalWon: 0, totalUsd: 0, details: [] }); 
            return; 
        }
        getVehicleNumber(carId, (vehicleNo) => {
            if (!vehicleNo) { 
                updateAccidentPanel({ count: 0, totalWon: 0, totalUsd: 0, details: [] }); 
                return; 
            }
            fetchAccidentData(carId, vehicleNo, (info) => {
                accidentDetails = info || { count: 0, totalWon: 0, totalUsd: 0, details: [] };
                updateAccidentPanel(accidentDetails);
                console.log(`[CarData] Страховые выплаты: ${accidentDetails.totalUsd?.toLocaleString() || 0} $, случаев: ${accidentDetails.count}`);
            });
        });
    }

    // ========== ГЛАВНАЯ ФУНКЦИЯ СБОРА ==========
    function collectAllCarData() {
        console.log('[CarData] Начало сбора данных...');

        const carInfo = getCarBrandAndModel();
        const yearData = getCarYearMonth();
        const vin = getVinNumber();
        const mileage = getCarMileage();
        const engineVolume = getEngineVolume();
        const priceKrw = getCarPriceKrw();
        const carId = getCarId();
        const views = getCarViews();
        const powerData = getCarPower();

        if (carInfo) {
            Hub.set('carBrand', carInfo.brand);
            Hub.set('carModel', carInfo.model);
        }

        if (yearData) {
            Hub.set('carYear', yearData.year ? parseInt(yearData.year) : null);
            Hub.set('carMonth', yearData.month || null);
        }

        Hub.set('carVin', vin);
        Hub.set('carMileage', mileage);
        Hub.set('carEngineVolume', engineVolume);
        Hub.set('carPriceKrw', priceKrw);
        Hub.set('carId', carId);
        Hub.set('carViews', views);

        if (powerData) {
            Hub.set('carPowerHp', powerData.hp);
            Hub.set('carPowerKw', powerData.kw);
        }

        console.log('[CarData] Итоговые данные:', {
            brand: Hub.get('carBrand'),
            model: Hub.get('carModel'),
            year: Hub.get('carYear'),
            month: Hub.get('carMonth'),
            vin: Hub.get('carVin'),
            mileage: Hub.get('carMileage'),
            engineVolume: Hub.get('carEngineVolume'),
            priceKrw: Hub.get('carPriceKrw'),
            powerHp: Hub.get('carPowerHp')
        });

        Hub.emit('carData:ready', Hub.getAll());
        
        loadAccidentData();
    }

    // Загрузка сохранённой мощности
    function loadSavedPower() {
        const carId = getCarId();
        if (!carId) return false;

        const saved = localStorage.getItem(`encar_power_${carId}`);
        if (saved) {
            try {
                const powerData = JSON.parse(saved);
                if (Date.now() - powerData.timestamp < 30 * 24 * 60 * 60 * 1000) {
                    Hub.set('carPowerHp', powerData.hp);
                    Hub.set('carPowerKw', powerData.kw);
                    return true;
                }
            } catch(e) {}
        }
        return false;
    }

    Hub.on('carPowerHp:changed', (data) => {
        const carId = Hub.get('carId');
        if (carId) {
            localStorage.setItem(`encar_power_${carId}`, JSON.stringify({
                hp: data.value,
                kw: Hub.get('carPowerKw'),
                timestamp: Date.now()
            }));
        }
    });

    // Запуск
    loadSavedPower();
    setTimeout(() => collectAllCarData(), 500);

    console.log('[CarData] Модуль загружен v3.2 (принудительный перевод моделей)');
})();

;


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

;


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

;(()=>{const button=document.createElement('button');button.textContent='Передать в VECTOR';button.style.cssText='position:fixed;bottom:22px;left:22px;z-index:2147483647;background:#ef9663;color:#172127;border:0;border-radius:12px;padding:16px 22px;font:600 16px system-ui;cursor:pointer;box-shadow:0 8px 30px #0005';document.body.append(button);button.onclick=()=>{const h=unsafeWindow.EncarHub;if(!h)return alert('Калькулятор ещё загружается');const get=k=>h.get(k)??'';const data={brand:get('carBrand'),model:get('carModel'),vin:get('carVin'),year:get('carYear'),mileage:get('carMileage'),engine:get('carEngineVolume'),url:location.origin+location.pathname,krw:get('carPriceKrw'),krwPerUsd:get('usdToKrw'),eurUsd:h.get('manualEurUsdRate')??get('eurUsdRate'),usdRub:get('usdtRate'),eur:get('selectedEuroPrice'),manualTpo:get('manualTpo'),koreaUsd:get('koreaLogistics'),bishkekUsd:get('servicesBishkek'),deliveryUsd:0,documentsRub:get('docsRf'),utilRub:get('manualUtilizationFee'),servicesRub:get('ourServices'),rateDate:h.get('lastCurrencyUpdate')?.toISOString?.().slice(0,10)||'',rateSource:'Передано из Encar'};window.open('https://vector-crm-pavel.divine-lime-4457.chatgpt.site/#encar?import='+encodeURIComponent(JSON.stringify(data)),'_blank','noopener,noreferrer');};})();