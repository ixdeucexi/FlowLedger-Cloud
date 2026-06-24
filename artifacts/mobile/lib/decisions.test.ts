import test from "node:test"; import assert from "node:assert/strict";
import { compareDecisionVariants, evaluateDecision, scenarioDates } from "./decisions";
const days = Array.from({ length: 90 }, (_, i) => { const d = new Date("2026-07-01T00:00:00Z"); d.setUTCDate(d.getUTCDate() + i); return { date: d.toISOString().slice(0,10), balance: 1000 }; });
test("preview never mutates baseline and protects safety floor", () => { const original=JSON.stringify(days); const r=evaluateDecision(days,{type:"one_time_purchase",name:"Trip",amount:900,date:"2026-07-10"},200); assert.equal(r.verdict,"unsafe"); assert.equal(JSON.stringify(days),original); assert.equal(r.saferAmount,800); });
test("recurring decisions affect every month",()=>assert.deepEqual(scenarioDates({type:"recurring_bill",name:"Gym",amount:20,date:"2026-07-31",frequency:"monthly"},"2026-09-30"),["2026-07-31","2026-08-31","2026-09-30"]));
test("comparison is limited to three options",()=>assert.equal(compareDecisionVariants(days,[100,200,300,400].map(amount=>({type:"one_time_purchase" as const,name:"Option",amount,date:"2026-07-10"})),200).length,3));
test("payment-date changes have no monthly cash-flow impact",()=>assert.equal(evaluateDecision(days,{type:"payment_date_change",name:"Move bill",amount:100,date:"2026-07-20",oldDate:"2026-07-05"},200).monthlyCashFlowChange,0));
