/** Fictional, read-only live-model evaluation. Never points at a database. */
export const evaluationNow = "2026-09-10T15:00:00Z";
export const evaluationHousehold = "fictional-flo-evaluation";
export function createFloEvaluationClient() {
  const h = evaluationHousehold;
  const rows: Record<string, any[]> = {
    household_settings: [{household_id:h,time_zone:"America/Chicago",payment_method:"snowball",starting_balance:500,starting_balance_date:"2026-09-10",calendar_start_date:"2026-06-01",safety_floor:200,forecast_horizon_months:12,planning_mode:"standard",debt_payoff_enabled:true}],
    accounts: [
      {id:"checking",household_id:h,name:"Main Checking",account_type:"checking",is_active:true,current_balance:500,balance_as_of:"2026-09-10",created_at:"2026-06-01"},
      {id:"savings",household_id:h,name:"Rainy Day Savings",account_type:"savings",is_active:true,current_balance:300,balance_as_of:"2026-09-10",created_at:"2026-06-01"},
    ],
    incomes: [{id:"salary",household_id:h,name:"Salary",amount:1500,frequency:"biweekly",start_date:"2026-06-05",next_payment_date:"2026-09-11",amount_history:[],excluded_dates:[],last_reviewed_at:evaluationNow}],
    bills: [
      {id:"rent",household_id:h,name:"Rent",amount:900,category:"Housing",priority:1,is_debt:false,balance:0,interest_rate:0,due_day:15,is_recurring:true,frequency:"monthly",created_at:"2026-06-01T00:00:00Z",start_date:"2026-06-01",last_reviewed_at:evaluationNow},
      {id:"card",household_id:h,name:"Test Card",amount:35,category:"Credit Card",priority:2,is_debt:true,balance:1000,interest_rate:18,due_day:20,is_recurring:true,frequency:"monthly",created_at:"2026-06-01T00:00:00Z",start_date:"2026-06-01",include_in_snowball:true,last_reviewed_at:evaluationNow},
      {id:"stream",household_id:h,name:"Streaming",amount:15,category:"Subscriptions",priority:3,is_debt:false,balance:0,interest_rate:0,due_day:24,is_recurring:true,frequency:"monthly",created_at:"2026-06-01T00:00:00Z",start_date:"2026-06-01",last_reviewed_at:evaluationNow},
    ],
    goals:[{id:"vacation",household_id:h,name:"Vacation",target_amount:1000,current_amount:100,target_date:"2026-12-31",goal_type:"savings",created_at:"2026-06-01"}],
    plaid_accounts:[{id:"main-card",household_id:h,name:"Main Card",display_name:"Main Card",account_type:"credit",account_subtype:"credit card",is_active:true,current_balance:400,credit_limit:2000,purchase_apr:22,minimum_payment_amount:25,updated_at:evaluationNow,liability_last_synced_at:evaluationNow}],
    category_budgets:[{id:"groceries-budget",household_id:h,category:"Groceries",month:8,year:2026,amount:450,updated_at:evaluationNow}],
    transactions:[],monthly_overrides:[],bill_date_moves:[],extra_payments:[],decisions:[],pending_plan_matches:[],plaid_transactions:[],household_daily_checking_closes:[],account_balances:[],flo_messages:[],
  };
  for(const month of [6,7,8]) {
    const m=String(month).padStart(2,"0");
    for(const day of [5,19])rows.transactions.push({id:`income-${m}-${day}`,household_id:h,date:`2026-${m}-${String(day).padStart(2,"0")}`,amount:1500,category:"Income",note:"Salary",linked_income_id:"salary",account_id:"checking"});
    rows.transactions.push({id:`food-${m}`,household_id:h,date:`2026-${m}-12`,amount:-400,category:"Groceries",merchant_name:"Walmart",note:"Walmart",account_id:"checking"});
    for(const b of rows.bills)rows.monthly_overrides.push({id:`paid-${b.id}-${m}`,household_id:h,bill_id:b.id,month:month-1,year:2026,paid_amount:b.amount,actual_amount:b.amount,paid_date:`2026-${m}-${b.due_day}`});
    rows.household_daily_checking_closes.push({household_id:h,balance_date:`2026-${m}-04`,checking_balance:150+month*20,observed_at:`2026-${m}-04T15:00:00Z`,account_count:1,source:"fixture"});
  }
  rows.transactions.push({id:"netflix",household_id:h,date:"2026-08-24",amount:-15,category:"Subscriptions",merchant_name:"Netflix",note:"Netflix",account_id:"checking"});
  rows.transactions.push({id:"thirty-five",household_id:h,date:"2026-09-06",amount:-35,category:"Groceries",merchant_name:"Walmart",note:"Walmart",account_id:"checking"});
  return {from(table:string) {
    let selection=[...(rows[table]??[])];let take=Infinity;
    const query:any={
      select(){return query;},eq(key:string,value:unknown){selection=selection.filter(r=>r[key]===value);return query;},
      neq(key:string,value:unknown){selection=selection.filter(r=>r[key]!==value);return query;},
      gt(key:string,value:string){selection=selection.filter(r=>String(r[key])>value);return query;},
      order(key:string,options?:{ascending?:boolean}){selection.sort((a,b)=>String(a[key]??"").localeCompare(String(b[key]??""))*(options?.ascending===false?-1:1));return query;},
      limit(value:number){take=value;return query;},
      maybeSingle:async()=>({data:selection[0]??null,error:null}),
      then(resolve:any){return Promise.resolve({data:selection.slice(0,take),error:null}).then(resolve);},
    };return query;
  }};
}
