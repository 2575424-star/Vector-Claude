import {parse as parseMRZ} from 'mrz';
import {validDate,today,PARTY_FIELDS} from './domain.js';

export const PASSPORT_MAX_FILES=3;
export const PASSPORT_MAX_BYTES=10*1024*1024;
export function checkPassportFiles(files){
 if(!files.length)throw new Error('Выберите фото паспорта');
 if(files.length>PASSPORT_MAX_FILES)throw new Error('Можно выбрать до 3 фотографий');
 if(files.some(f=>!f.size||! /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type)))throw new Error('Выберите JPG, PNG, WEBP или PDF');
 if(files.reduce((n,f)=>n+f.size,0)>PASSPORT_MAX_BYTES)throw new Error('Общий размер фотографий — до 10 МБ');
}
const dateValue=text=>{
 const m=text?.match(/\b(\d{2})[.\s/-](\d{2})[.\s/-](\d{4})\b/);if(!m)return '';
 const date=`${m[3]}-${m[2]}-${m[1]}`;return validDate(date)&&date<=today()?date:'';
};
const nameValue=s=>s.replace(/[^\p{L}\s'-]/gu,' ').replace(/\s+/g,' ').trim();
const clean=s=>s.replace(/[|]/g,' ').replace(/\s+/g,' ').trim();
const labels={
 fullName:/\b(?:full\s*name)\b|Ф\.?\s*И\.?\s*О\.?/iu,
 lastName:/Фамилия|Surname|Last\s*name/iu,firstName:/(?:^|\s)Имя(?:\s|$|:)|Given\s*names?|First\s*name/iu,
 patronymic:/Отчество|Patronymic/iu,birthDate:/Дата\s*рождения|Date\s*of\s*birth/iu,
 birthPlace:/Место\s*рождения|Place\s*of\s*birth/iu,citizenship:/Гражданство|Nationality/iu,
 passportIssuedBy:/Паспорт\s*выдан|Кем\s*выдан|Орган[а-я\s]*выдавший|Authority|Issued\s*by/iu,
 passportIssueDate:/Дата\s*выдачи|Date\s*of\s*issue/iu,passportCode:/Код\s*подразделения/iu,
 address:/Адрес\s*(?:регистрации|проживания)|Место\s*жительства|Зарегистрирован[а]?|Registration\s*address|Address/iu,
 passportNumber:/Номер\s*(?:паспорта|документа)|Passport\s*(?:No\.?|number)|Document\s*(?:No\.?|number)/iu,
 passportSeries:/Серия(?:\s*паспорта)?/iu,inn:/ИНН|Personal\s*(?:No\.?|number)|Персональный\s*номер/iu
};
const isLabel=s=>Object.values(labels).some(re=>re.test(s));
function labeled(lines,key,multiline=false){
 const re=labels[key];for(let i=0;i<lines.length;i++){
  const match=lines[i].match(re);if(!match)continue;
  let value=lines[i].slice(match.index+match[0].length).replace(/^\s*[/.:№-]+\s*/,'');
  // Skip the translated caption on bilingual ID cards.
  value=value.replace(/^(?:Surname|Given names?|First name|Patronymic|Date of birth|Place of birth|Date of issue|Authority|Nationality|Address)\s*[:/.-]?\s*/i,'');
  const out=value?[value]:[];
  for(let j=i+1;j<Math.min(lines.length,i+(multiline?5:3));j++){
   if(isLabel(lines[j])||/^[A-Z0-9<]{25,}$/.test(lines[j])||/^\d{2}[.\s/-]\d{2}[.\s/-]\d{4}/.test(lines[j])&&key==='address')break;
   if(out.length&&!multiline)break;out.push(lines[j]);
  }
  if(out.length)return clean(out.join(' '));
 }return '';
}
export function extractPassport(text){
 const lines=String(text).split(/\r?\n/).map(clean).filter(Boolean);const fields={};const warnings=[];
 const put=(k,v)=>{if(v)fields[k]=v};
 const family=labeled(lines,'lastName'),given=labeled(lines,'firstName'),patronymic=labeled(lines,'patronymic');
 const goodName=s=>/^[\p{L}\s'-]{2,100}$/u.test(s)&&!isLabel(s);
 const full=labeled(lines,'fullName');
 if(goodName(full))put('fullName',nameValue(full));
 else if(goodName(family)&&goodName(given))put('fullName',[family,given,goodName(patronymic)?patronymic:''].filter(Boolean).map(nameValue).join(' '));
 for(const key of ['birthDate','passportIssueDate'])put(key,dateValue(labeled(lines,key)));
 for(const key of ['passportIssuedBy','address']){const value=labeled(lines,key,true);if(value&&!isLabel(value))put(key,value)}
 const code=labeled(lines,'passportCode').match(/\b\d{3}\s*[-–]\s*\d{3}\b/);if(code)put('passportCode',code[0].replace(/\s/g,'').replace('–','-'));
 const joined=lines.join('\n');const ruNumber=joined.match(/\b(\d{2})\s+(\d{2})\s+(\d{6})\b/);const idNumber=joined.match(/\bID\s*\d{6,10}\b/i);
 if(ruNumber){put('passportSeries',ruNumber[1]+ruNumber[2]);put('passportNumber',ruNumber[3])}
 else if(idNumber)put('passportNumber',idNumber[0].toUpperCase().replace(/\s/g,''));
 else{const value=labeled(lines,'passportNumber').replace(/\s/g,'');if(/^[A-ZА-Я0-9]{5,14}$/iu.test(value))put('passportNumber',value);const series=labeled(lines,'passportSeries').replace(/\s/g,'');if(/^\d{4}$/.test(series))put('passportSeries',series)}
 // Use check-digit validated machine-readable fields when visual captions are absent.
 const mrzLines=lines.map(l=>l.toUpperCase().replace(/[«‹]/g,'<').replace(/\s/g,'')).filter(l=>/^[A-Z0-9<]{30,44}$/.test(l));
 for(let i=0;i<mrzLines.length;i++)for(const count of [3,2]){
  const group=mrzLines.slice(i,i+count);if(group.length!==count)continue;
  try{const result=parseMRZ(group,{autocorrect:true});if(!result.valid)continue;const f=result.fields;
   if(!fields.fullName&&f.lastName&&f.firstName){put('fullName',`${f.lastName} ${f.firstName}`);warnings.push('ФИО прочитано латиницей. Сверьте написание с паспортом.')}
   if(!fields.passportNumber)put('passportNumber',result.documentNumber||f.documentNumber);
   if(!fields.birthDate&&f.birthDate)warnings.push('Укажите год рождения полностью: в машиночитаемой строке он сокращён.');
  }catch{/* A normal text line is not necessarily an MRZ. */}
 }
 for(const [key,,max] of PARTY_FIELDS)if(fields[key]?.length>max)delete fields[key];
 return {fields,warnings:[...new Set(warnings)]};
}

export function mergePassportFields(current,incoming){
 const values={...current},conflicts={},allowed=new Set(PARTY_FIELDS.map(([key])=>key));
 for(const [key,value] of Object.entries(incoming))if(allowed.has(key)&&value){if(!String(current[key]||'').trim())values[key]=value;else if(current[key].trim()!==value.trim())conflicts[key]=value;}
 return {values,conflicts};
}
