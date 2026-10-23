import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind } from "typescript";
import { parseBillCsv } from "./billCsv";
import { getBillOccurrenceDays } from "./schedule";

const header = "Name,Amount,Category,Priority,IsDebt,Balance,InterestRate,DueDay,IsRecurring,Frequency";
const bill = '"Card, everyday",50,Debt,0,true,"1,200.50",5.875,22,true,monthly';

test("a full FlowLedger backup imports only BILLS, never income, activity, overrides or goals", () => {
  const backup = ["=== ACCOUNTS ===", "Id,Name,CurrentBalance", "checking,Checking,3000", "=== INCOME ===", "Name,Amount,Frequency", "Salary,2400,biweekly", "=== BILLS ===", header, bill, "=== TRANSACTIONS ===", "Date,Amount,Category,Note", "2026-10-22,50,Debt,Payment", "=== MONTHLY OVERRIDES ===", "BillId,Month,Year,CustomAmount,PaidAmount", "card,9,2026,50,50", "=== GOALS ===", "Name,TargetAmount,CurrentAmount", "Vacation,1000,500"].join("\n");
  assert.deepEqual(parseBillCsv(backup), [{ name: "Card, everyday", amount: 50, category: "Debt", priority: 0, is_debt: true, balance: 1200.5, interest_rate: 5.875, due_day: 22, is_recurring: true, frequency: "monthly" }]);
  assert.throws(() => parseBillCsv("=== INCOME ===\nName,Amount\nSalary,2400"), /no BILLS section/);
  assert.deepEqual(parseBillCsv(`=== BILLS ===\n${header}\n=== GOALS ===\nName,Amount\nTrip,1000`), []);
  assert.throws(() => parseBillCsv(`=== BILLS ===\n${header}\n${bill}\n=== BILLS ===\n${header}\n${bill}`), /more than one BILLS/);
});

test("standalone bills CSV handles BOM, CRLF, reordered headers and escaped multiline quoted fields", () => {
  const rows = parseBillCsv('\uFEFFAmount,Name,Category\r\n"1,200.50","Landlord, \"\"Unit A\"\"\r\nRent",Housing\r\n');
  assert.equal(rows.length, 1); assert.equal(rows[0].amount, 1200.5);
  assert.equal(rows[0].name, 'Landlord, "Unit A"\r\nRent'); assert.equal(rows[0].frequency, "monthly");
  assert.throws(() => parseBillCsv('Name,Amount\n"Broken,50'), /not closed/);
  assert.throws(() => parseBillCsv('Name,Amount\n"Rent"oops,50'), /quoting/);
  assert.throws(() => parseBillCsv("Name,Amount,Amount\nRent,50,50"), /duplicate/);
  assert.throws(() => parseBillCsv("Name,Amount\nRent,1,200.50"), /number of columns/);
});

test("all numeric, boolean, frequency and date fields are validated before a result can be imported", () => {
  for (const raw of ["25oops", "Infinity", "NaN", "1e3", "-5", "0", "5.123", "\"1,20.50\""]) assert.throws(() => parseBillCsv(`Name,Amount\nValid,20\nInvalid,${raw}`), /Bill row 2/);
  for (const [field, raw] of [["Balance", "bad"], ["InterestRate", "2.12345"], ["Priority", "1oops"], ["Priority", "9007199254740992"], ["DueDay", "32"], ["DueDay", "0"], ["DayOfWeek", "7"], ["IsDebt", "maybe"], ["IsRecurring", "sometimes"], ["Frequency", "yearly"], ["NextPaymentDate", "2026-02-30"], ["StartDate", "tomorrow"]]) {
    assert.throws(() => parseBillCsv(`Name,Amount,${field}\nRent,50,${raw}`), /Bill row 1/, `${field}:${raw}`);
  }
  assert.throws(() => parseBillCsv("Name,Amount,StartDate,EndDate\nRent,50,2026-10-23,2026-10-22"), /end date/);
});

test("the actual backup bill export preserves all four frequencies and optional schedule anchors", () => {
  const source = readFileSync("app/(tabs)/more.tsx", "utf8");
  const start = source.indexOf("      const billHeader =");
  const body = source.slice(start, source.indexOf("      const txHeader =", start));
  const bills = ["monthly", "quarterly", "biweekly", "weekly"].map((frequency, index) => ({ name: `Bill ${frequency}`, amount: 50, category: "Other", priority: index, is_debt: false, balance: 0, interest_rate: 0, due_day: 23, is_recurring: true, frequency, day_of_week: 5, next_payment_date: "2026-10-23", start_date: "2026-01-01", end_date: "2027-01-01" }));
  const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const js = transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const exported = new Function("bills", "csvCell", `${js}; return billHeader + '\\n' + billRows;`)(bills, csvCell);
  assert.deepEqual(parseBillCsv(exported), bills);
});

test("recurring imports require the schedule facts needed by the canonical occurrence engine", () => {
  for (const frequency of ["quarterly", "biweekly", "weekly"]) {
    assert.throws(() => parseBillCsv(`Name,Amount,Frequency\nRent,50,${frequency}`), /required/);
  }
  const quarterly = parseBillCsv("Name,Amount,Frequency,DueDay,NextPaymentDate\nQuarterly,50,quarterly,23,2026-10-23")[0];
  assert.deepEqual(getBillOccurrenceDays(quarterly, 9, 2026), [23]);
  assert.deepEqual(getBillOccurrenceDays(quarterly, 10, 2026), []);
  assert.deepEqual(getBillOccurrenceDays(quarterly, 0, 2027), [23]);
  const anchoredQuarterly = parseBillCsv("Name,Amount,Frequency,NextPaymentDate\nQuarterly,50,quarterly,2026-10-23")[0];
  assert.equal(anchoredQuarterly.due_day, 23);
  assert.deepEqual(getBillOccurrenceDays(anchoredQuarterly, 9, 2026), [23]);
  const biweekly = parseBillCsv("Name,Amount,Frequency,StartDate\nFortnightly,50,biweekly,2026-10-23")[0];
  assert.deepEqual(getBillOccurrenceDays(biweekly, 10, 2026), [6, 20]);
  const weekly = parseBillCsv("Name,Amount,Frequency,NextPaymentDate\nWeekly,50,weekly,2026-10-23")[0];
  assert.equal(weekly.day_of_week, 5);
  assert.deepEqual(getBillOccurrenceDays(weekly, 9, 2026), [2, 9, 16, 23, 30]);
  const explicitWeekly = parseBillCsv("Name,Amount,Frequency,DayOfWeek\nWeekly,50,weekly,0")[0];
  assert.equal(explicitWeekly.day_of_week, 0);
});

function importHandler(bindings: Record<string, unknown>) {
  const source = readFileSync("app/(tabs)/more.tsx", "utf8"), start = source.indexOf("  const handleImport =");
  const body = source.slice(start, source.indexOf("  const readPickedFile =", start));
  return new Function(...Object.keys(bindings), `${transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText}; return handleImport;`)(...Object.values(bindings));
}

test("the actual import handler waits for persistence, blocks concurrent imports and reports rejection truthfully", async () => {
  for (const success of [true, false]) {
    let settle!: () => void, calls = 0, picks = 0;
    const notices: string[] = [], ref = { current: false };
    const pending = new Promise<void>((resolve, reject) => { settle = () => success ? resolve() : reject(new Error("Connection lost")); });
    const handle = importHandler({ billImportInFlightRef: ref, billImportScopeRef: { current: { key: "user-a/home-a/budget-a", canEdit: true } }, parseBillCsv,
      DocumentPicker: { getDocumentAsync: async () => { picks++; return { assets: [{ uri: "fixture.csv" }] }; } },
      Platform: { OS: "web" }, fetch: async () => ({ ok: true, text: async () => "Name,Amount\nRent,50" }),
      Haptics: { impactAsync() {}, ImpactFeedbackStyle: { Medium: "medium" } },
      importBills: async (rows: unknown[]) => { calls++; assert.equal(rows.length, 1); await pending; },
      showFormError: (title: string, message: string) => notices.push(`${title}:${message}`),
    });
    const saving = handle();
    await new Promise(resolve => setImmediate(resolve));
    await handle();
    assert.equal(picks, 1); assert.equal(calls, 1); assert.deepEqual(notices, []); assert.equal(ref.current, true);
    settle(); await saving;
    assert.equal(ref.current, false); assert.equal(notices.length, 1);
    assert.match(notices[0], success ? /^Imported:1 bills added/ : /^Import failed:Connection lost/);
  }
});

test("cancelled, unreadable and invalid imports never invoke persistence and always release the guard", async () => {
  for (const failure of ["cancel", "read", "invalid"]) {
    let calls = 0; const ref = { current: false }, notices: string[] = [];
    const handle = importHandler({ billImportInFlightRef: ref, billImportScopeRef: { current: { key: "user-a/home-a/budget-a", canEdit: true } }, parseBillCsv,
      DocumentPicker: { getDocumentAsync: async () => failure === "cancel" ? { canceled: true } : { assets: [{ uri: "fixture.csv" }] } },
      Platform: { OS: "web" }, fetch: async () => ({ ok: failure !== "read", text: async () => "Name,Amount\nRent,50\nCorrupted,25oops" }),
      importBills: async () => { calls++; }, showFormError: (title: string) => notices.push(title),
    });
    await handle(); assert.equal(calls, 0); assert.equal(ref.current, false);
    assert.deepEqual(notices, failure === "cancel" ? [] : ["Import failed"]);
  }
});

test("the actual import handler rejects account, household, budget and permission changes during file reading", async () => {
  for (const changed of ["user", "household", "budget", "permission"]) {
    let calls = 0; const ref = { current: false }, notices: string[] = [];
    const scope = { current: { key: JSON.stringify(["user-a", "home-a", "budget-a"]), canEdit: true } };
    const handle = importHandler({ billImportInFlightRef: ref, billImportScopeRef: scope, parseBillCsv,
      DocumentPicker: { getDocumentAsync: async () => ({ assets: [{ uri: "fixture.csv" }] }) },
      Platform: { OS: "web" }, fetch: async () => ({ ok: true, text: async () => {
        scope.current = changed === "permission" ? { ...scope.current, canEdit: false }
          : { key: JSON.stringify([changed === "user" ? "user-b" : "user-a", changed === "household" ? "home-b" : "home-a", changed === "budget" ? "budget-b" : "budget-a"]), canEdit: true };
        return "Name,Amount\nRent,50";
      } }), importBills: async () => { calls++; }, showFormError: (title: string, message: string) => notices.push(`${title}:${message}`),
    });
    await handle(); assert.equal(calls, 0); assert.equal(ref.current, false); assert.match(notices[0], /changed/);
  }
});
