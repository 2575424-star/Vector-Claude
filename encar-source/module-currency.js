// ==UserScript==
// @name         Encar Currency Module
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Курсы валют (USD, EUR, KRW)
// @match        *://www.encar.com/cars/detail/*
// @match        *://fem.encar.com/cars/detail/*
// @connect      cbr-xml-daily.ru
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// ==/UserScript==

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
