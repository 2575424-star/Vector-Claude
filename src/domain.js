export const EXPORT_ORIGINS=['Корея','Китай','Бишкек'];
export function compareExportOrigin(a,b){const rank=c=>!c?999:EXPORT_ORIGINS.includes(c)?EXPORT_ORIGINS.indexOf(c):100;return rank(a.country)-rank(b.country)||(a.country||'').localeCompare(b.country||'','ru')||(a.brand+' '+a.model).localeCompare(b.brand+' '+b.model,'ru');}
import {costSummary} from './cost-basis.js';
export const STATUSES=['Не уточнён','Забронирован','Выкуплен','В пути в Бишкек','В пути в Воронеж','Прибыл','Продан'];
export const DOCUMENT_STATUSES=['Нет','Прошёл лабораторию','ПТС / СБКТС недействующий','ПТС действующий'];
export const LEGACY_STATUSES=['Заказан','В пути','На таможне','Таможня пройдена','На складе'];
export const COST_TYPES=['Покупка','Доставка','Таможня','Утильсбор','Сертификация','Подготовка','Комиссия','Логистика Бишкек—Воронеж','Документы','ТПО','Другое'];
export const FILE_TYPES=['Фото','Видео','Документ','Договор','Инвойс','Чек','Другое'];
export const PARTY_FIELDS=[
 ['fullName','ФИО',200],['birthDate','Дата рождения',10,'date'],
 ['passportSeries','Серия паспорта',40],['passportNumber','Номер паспорта / ID',80],
 ['passportIssuedBy','Кем выдан',500],['passportIssueDate','Дата выдачи',10,'date'],['passportCode','Код подразделения',50],
 ['address','Адрес регистрации',1000],['phone','Телефон',80,'tel']
];
export function validateParty(p){
 const errors=[];if(!p.fullName||p.fullName.trim().length<2)errors.push('Укажите ФИО');
 for(const [key,label,max,type] of PARTY_FIELDS){if(typeof p[key]!=='string'||p[key].length>max)errors.push('Проверьте поле «'+label+'»');if(type==='date'&&p[key]&&(!validDate(p[key])||p[key]>today()))errors.push('Проверьте поле «'+label+'»');}
 if(p.birthDate&&p.passportIssueDate&&p.passportIssueDate<p.birthDate)errors.push('Дата выдачи паспорта не может быть раньше даты рождения');
 return errors;
}
export const today=()=>new Date().toISOString().slice(0,10);
export function validDate(d){return typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d}
export function daysInStock(c,at=today()){if(!c.stockDate||(c.status==='Продан'&&!c.soldDate))return null;const end=c.soldDate||at;return Math.max(0,Math.floor((Date.parse(end)-Date.parse(c.stockDate))/86400000))}
export function costTotal(c){return costSummary(c).rub}
export function validateCar(b){
 const errs=[];if(b.customsCountry&&!['Киргизия','Россия'].includes(b.customsCountry))errs.push('Выберите таможню');if(b.country==='Бишкек'&&b.customsCountry&&b.customsCountry!=='Киргизия')errs.push('Для Бишкека доступна только таможня Киргизия');if(b.documentStatus&&!DOCUMENT_STATUSES.includes(b.documentStatus))errs.push('Выберите статус документов');if(b.productionMonth&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(b.productionMonth))errs.push('Проверьте месяц выпуска');if(b.productionMonth&&b.year&&Number(b.productionMonth.slice(0,4))!==Number(b.year))errs.push('Месяц и год выпуска должны совпадать');if(!String(b.brand||'').trim())errs.push('Укажите марку');if(!String(b.model||'').trim())errs.push('Укажите модель');
 if(b.vin&&!/^[A-HJ-NPR-Z0-9]{17}$/.test(b.vin))errs.push('VIN должен содержать 17 латинских букв и цифр, без I, O, Q');
 if(b.year!==null&&b.year!==undefined&&b.year!==''&&(!Number.isInteger(Number(b.year))||b.year<1950||b.year>new Date().getUTCFullYear()+2))errs.push('Проверьте год выпуска');
 if(b.status&&![...STATUSES,...LEGACY_STATUSES].includes(b.status))errs.push('Выберите статус');
 for(const k of ['purchaseDate','stockDate','soldDate'])if(b[k]&&!validDate(b[k]))errs.push('Проверьте даты');
 if(b.stockDate&&b.stockDate>today())errs.push('Дата поступления не может быть в будущем');
 if(b.soldDate&&b.soldDate>today())errs.push('Дата продажи не может быть в будущем');
 if(b.stockDate&&b.soldDate&&b.soldDate<b.stockDate)errs.push('Продажа не может быть раньше поступления');
 if(b.status!=='Продан'&&b.soldDate)errs.push('Дата продажи доступна только в статусе «Продан»');
 if(b.price!==null&&b.price!==undefined&&b.price!==''&&(!Number.isFinite(Number(b.price))||Number(b.price)<0))errs.push('Проверьте цену продажи');
 if(b.mileage!==null&&b.mileage!==undefined&&b.mileage!==''&&(!Number.isFinite(Number(b.mileage))||Number(b.mileage)<0))errs.push('Проверьте пробег');
 for(const k of ['brand','model','trim','color','location','country','contact','notes'])if(String(b[k]||'').length>(k==='notes'?5000:200))errs.push('Слишком длинное поле: '+k);
 return errs;
}
