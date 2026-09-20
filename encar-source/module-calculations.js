// ==UserScript==
// @name         Encar Calculations Module
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Расчёт ТПО, утильсбора, итоговой стоимости
// @match        *://www.encar.com/cars/detail/*
// @match        *://fem.encar.com/cars/detail/*
// @grant        unsafeWindow
// ==/UserScript==

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
