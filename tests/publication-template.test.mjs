import test from 'node:test';
import assert from 'node:assert/strict';
import {adDescription} from '../src/publication-template.js';
import {publicationInput,project} from '../src/publication.js';
const car={id:'test',brand:'BMW',model:'X7',year:2023,files:[],status:'На складе',publication:{description:'Пробег 10000 км'}};
test('standard description defaults on, follows description and substitutes current car',()=>{
 const s=adDescription(car);assert.ok(s.startsWith('Пробег 10000 км\n\nКомпания'));assert.ok(s.includes('BMW X7 2023 года выпуска.'));assert.equal(adDescription(car,{description:s,useStandardText:false}),s);
 assert.ok(!adDescription({...car,year:null}).includes('года выпуска'));assert.ok(!adDescription({...car,year:null}).includes('undefined'));
});
test('custom text and disabled flag survive subsequent publication changes',()=>{
 const p=publicationInput(car,{enabled:true,description:'Основное',useStandardText:false,standardText:'Наш {марка} {модель} {год}'});
 const c={...car,publication:p};assert.equal(project(c).description,'Основное');
 const next=publicationInput(c,{enabled:true});assert.equal(next.useStandardText,false);assert.equal(next.standardText,p.standardText);
 assert.equal(project({...c,publication:{...p,useStandardText:true}}).description,'Основное\n\nНаш BMW X7 2023');
 assert.throws(()=>publicationInput(car,{standardText:'x'.repeat(10001)}));
});
