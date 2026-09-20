import test from 'node:test';import assert from 'node:assert/strict';
import {basisInput,costSummary,expenseRate} from '../src/cost-basis.js';
test('planned expenses stay in total, paid totals and per-item rates work independently',()=>{
const c={costBasis:basisInput({krw:1416000,krwPerUsd:1416,usdRub:90,tpoUsd:1000,logisticsUsd:1200,documentsRub:85000,recyclingRub:100000,expenses:{tpoUsd:{paid:true,usdRub:80},krw:{paid:true,usdRub:85,krwPerUsd:1400}}}),costs:[{amount:100,currency:'USD',rate:null,paid:false},{amount:100,currency:'USD',rate:75,paid:true}]};
let s=costSummary(c);assert.equal(s.rub,475471.43);assert.equal(s.paidRub,173471.43);assert.equal(s.unpaidRub,302000);
c.costBasis.usdRub=100;s=costSummary(c);assert.equal(s.paidRub,173471.43);assert.equal(s.unpaidRub,315000);c.costBasis.expenses.tpoUsd.paid=false;assert.equal(costSummary(c).rub,s.rub);
});
test('old rates and amounts preserve previous totals; zero mileage remains zero',()=>{const c={costBasis:{krw:115900000,krwPerUsd:1416,usdRub:81,tpoUsd:21144,logisticsUsd:1200,documentsRub:85000,recyclingRub:2623000},costs:[]};assert.equal(costSummary(c).rub,11147736.88);assert.equal(costSummary(c).unpaidRub,11147736.88);c.utilizationStatus='Оплачен';assert.equal(costSummary(c).paidRub,2623000);});
test('missing default is allowed when individual rate exists, invalid overrides reject',()=>{assert.equal(costSummary({costBasis:{tpoUsd:100,expenses:{tpoUsd:{usdRub:90}}}}).rub,9000);assert.equal(costSummary({costBasis:{tpoUsd:100}}).rub,null);assert.equal(expenseRate({costBasis:{usdRub:91}},{currency:'USD',rate:null}),91);for(const rate of [0,-1,'x',Infinity])assert.throws(()=>basisInput({expenses:{tpoUsd:{usdRub:rate}}}));assert.throws(()=>basisInput({expenses:{tpoUsd:{paid:'true'}}}));});
