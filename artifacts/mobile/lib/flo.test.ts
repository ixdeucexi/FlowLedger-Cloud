import test from "node:test"; import assert from "node:assert/strict";
import { localFloAnswer, sanitizeFloSummary, type FloFacts } from "./floPolicy";
const facts: FloFacts={balanceToday:1000,lowestBalance:800,lowestBalanceDate:"2026-07-01",safetyFloor:200,monthlyIncome:4000,monthlyBills:2000,upcoming:[],activePlans:0,forecastConfidence:"high"};
const days=[{date:"2026-06-24",balance:1000},{date:"2026-07-01",balance:800}];
test("Flo affordability uses deterministic result",()=>assert.match(localFloAnswer("Can I afford $700 on 2026-06-24?",facts,days)??"",/^Not safely\./));
test("Flo memory strips financial and identifying values",()=>{const value=sanitizeFloSummary("john@example.com asked about $2,450 on 2026-12-01");assert.equal(value.includes("2450"),false);assert.equal(value.includes("john@"),false);});
