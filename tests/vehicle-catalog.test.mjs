import test from 'node:test';
import assert from 'node:assert/strict';
import {brandGroups,modelGroups} from '../src/vehicle-catalog.js';
test('popular choices precede an alphabetical, deduplicated catalogue and saved custom values',()=>{
 const brands=brandGroups([{brand:'Моя марка',model:'Особая модель'}]);
 assert.equal(brands[0].items.length,10);
 for(const groups of [brands,modelGroups('Toyota'),modelGroups('BMW')]){
  const all=groups.flatMap(g=>g.items);assert.equal(new Set(all).size,all.length);
  assert.deepEqual(groups[1].items,[...groups[1].items].sort((a,b)=>a.localeCompare(b,'ru',{numeric:true,sensitivity:'base'})));
 }
 assert.ok(modelGroups('Toyota').flatMap(g=>g.items).includes('Camry'));
 assert.ok(!modelGroups('BMW').flatMap(g=>g.items).includes('Camry'));
 assert.deepEqual(modelGroups('Моя марка',[{brand:'Моя марка',model:'Особая модель'}])[0].items,['Особая модель']);
});
