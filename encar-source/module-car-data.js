// ==UserScript==
// @name         Encar Car Data Module FIXED
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  Улучшенный сбор данных с Encar + страховые выплаты + принудительный перевод моделей
// @match        *://www.encar.com/cars/detail/*
// @match        *://fem.encar.com/cars/detail/*
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      api.encar.com
// ==/UserScript==

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
