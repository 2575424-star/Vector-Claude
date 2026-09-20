import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPassport,mergePassportFields,checkPassportFiles} from '../src/passport.js';

test('Russian passport captions populate dated fields without mixing issue and birth dates',()=>{
 const text='Фамилия: ТЕСТОВ\nИмя: ИВАН\nОтчество: ПЕТРОВИЧ\nДата рождения: 12.04.1985\nПаспорт выдан: ОТДЕЛОМ ТЕСТОВОГО РАЙОНА\nДата выдачи: 15.06.2020\nКод подразделения: 123-456\nСерия и номер: 12 34 000567\nАдрес регистрации: ГОРОД ПРИМЕР, УЛИЦА ТЕСТОВАЯ, ДОМ 1';
 const {fields}=extractPassport(text);assert.equal(fields.fullName,'ТЕСТОВ ИВАН ПЕТРОВИЧ');assert.equal(fields.birthDate,'1985-04-12');assert.equal(fields.passportIssueDate,'2020-06-15');assert.equal(fields.passportNumber,'000567');assert.equal(fields.passportSeries,'1234');assert.equal(fields.passportIssuedBy,'ОТДЕЛОМ ТЕСТОВОГО РАЙОНА');assert.equal(fields.address,'ГОРОД ПРИМЕР, УЛИЦА ТЕСТОВАЯ, ДОМ 1');
});
test('bilingual ID keeps the ID prefix and does not invent an address',()=>{
 const {fields}=extractPassport('Фамилия / Surname\nТЕСТОВ\nИмя / Given name\nИВАН\nОтчество\nПЕТРОВИЧ\nID0123456\nДата рождения / Date of birth\n03.02.1988\nДата выдачи / Date of issue\n01.06.2025');
 assert.equal(fields.fullName,'ТЕСТОВ ИВАН ПЕТРОВИЧ');assert.equal(fields.passportNumber,'ID0123456');assert.equal(fields.birthDate,'1988-02-03');assert.equal(fields.address,undefined);
});
test('invalid dates and unrelated photos leave missing fields empty',()=>{
 const {fields}=extractPassport('Дата рождения: 31.02.1980\nДата выдачи: 15.06.2099\nMERCEDES G450D 2024');assert.equal(fields.birthDate,undefined);assert.equal(fields.passportIssueDate,undefined);assert.equal(fields.fullName,undefined);
});
test('OCR fills blanks and reports conflicting saved data instead of overwriting',()=>{
 const r=mergePassportFields({fullName:'Иван Тестов',phone:'+70000000000',address:''},{fullName:'ИВАН ТЕСТОВ',address:'Тестовый адрес',email:'remove@example.com',inn:'123',birthPlace:'Москва',citizenship:'Россия'});
 assert.equal(r.values.fullName,'Иван Тестов');assert.equal(r.values.phone,'+70000000000');assert.equal(r.values.address,'Тестовый адрес');assert.equal(r.conflicts.fullName,'ИВАН ТЕСТОВ');
 assert.equal(r.values.email,undefined);assert.equal(r.values.inn,undefined);assert.equal(r.values.birthPlace,undefined);assert.equal(r.values.citizenship,undefined);
 assert.doesNotThrow(()=>checkPassportFiles([{type:'application/pdf',size:100}]));
 assert.throws(()=>checkPassportFiles([{type:'image/jpeg',size:11*1024*1024}]));
});
