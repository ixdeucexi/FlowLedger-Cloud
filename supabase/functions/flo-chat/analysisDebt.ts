import { orderDebts, projectSnowballMonth, type SnowballDebtInput, type DatedSnowballMonthPlanResult } from "../../../artifacts/mobile/lib/snowball.ts";
import { round, sum } from "./analysisTypes.ts";

/** Reuses canonical interest/minimum/rollover calculations. The only added
 * operation is an explicitly selected extra-principal allocation on a copy. */
export function projectAnalystDebt(options:{debts:SnowballDebtInput[];method:"snowball"|"avalanche";year:number;month:number;currentPlan:DatedSnowballMonthPlanResult;targetId?:string;extra:(month:number,year:number)=>number}) {
  const balances=new Map(options.currentPlan.balances);
  let rolled=options.currentPlan.rolledPayment;
  const months:Array<{month:number;year:number;endingDebt:number;interest:number;extra:number;paidOffNames:string[]}>=[];
  const order=[...options.currentPlan.payoffOrder];
  for(let offset=0;offset<=360;offset++) {
    const absolute=options.year*12+options.month+offset,year=Math.floor(absolute/12),month=absolute%12;
    let interest=0;
    const paidOffNames:string[]=offset===0?[...options.currentPlan.paidOffNames]:[];
    if(offset>0) {
      const planned=projectSnowballMonth({debts:options.debts,method:options.method,startingBalances:balances,rolledPayment:rolled,extraPayment:0});
      balances.clear();planned.balances.forEach((value,id)=>balances.set(id,value));rolled=planned.rolledPayment;interest=planned.interest;paidOffNames.push(...planned.paidOffNames);
    }
    let extra=round(Math.max(0,options.extra(month,year))),applied=0;
    const eligible=options.debts.filter(d=>d.included&&(balances.get(d.id)??0)>.009).map(d=>({...d,balance:balances.get(d.id)!}));
    const target=eligible.find(d=>d.id===options.targetId);
    const targets=target?[target,...orderDebts(eligible.filter(d=>d.id!==target.id),options.method)]:orderDebts(eligible,options.method);
    for(const debt of targets) {
      const before=balances.get(debt.id)??0,payment=Math.min(before,extra),after=round(before-payment);
      balances.set(debt.id,after);extra=round(extra-payment);applied=round(applied+payment);
      if(before>.009&&after<=.009) {rolled=round(rolled+debt.minimum);paidOffNames.push(debt.name);}
      if(extra<=.009)break;
    }
    for(const name of paidOffNames)if(!order.includes(name))order.push(name);
    const endingDebt=sum(options.debts.filter(d=>d.included).map(d=>balances.get(d.id)??0));
    months.push({month,year,endingDebt,interest,extra:applied,paidOffNames});
    if(endingDebt<=.009)return {months,payoffOrder:order,debtFreeDate:`${year}-${String(month+1).padStart(2,"0")}`};
  }
  return {months,payoffOrder:order,debtFreeDate:null};
}
