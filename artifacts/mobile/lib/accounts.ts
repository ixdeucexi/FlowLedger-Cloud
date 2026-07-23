export type AccountType = "checking" | "savings" | "cash";

export interface AccountSnapshot {
  id: string;
  name: string;
  type: AccountType;
  currentBalance: number;
  balanceAsOf: string;
  lastReconciledAt?: string;
  active: boolean;
}

export interface ForecastConfidence {
  level: "high" | "medium" | "low";
  label: "High" | "Medium" | "Low";
  reasons: string[];
}

export interface ImportedTransactionRow {
  date: string;
  amount: number;
  description: string;
  importHash: string;
}

export interface ConnectedCheckingSnapshot {
  account_subtype?: string;
  current_balance: number;
  is_active: boolean;
}

export function connectedCheckingBalance(accounts: ConnectedCheckingSnapshot[]): number | null {
  const checking = accounts.filter(account => account.is_active && account.account_subtype === "checking");
  return checking.length ? checking.reduce((sum, account) => sum + account.current_balance, 0) : null;
}

export function connectedCheckingAnchor(accounts: ConnectedCheckingSnapshot[], date: string): { balance: number; date: string } | null {
  const balance = connectedCheckingBalance(accounts);
  return balance === null ? null : { balance, date };
}

export function historicalMonthOpeningBalance(
  projectedOpeningBalance: number,
  balanceAsOfDate: string | undefined,
  monthStartDate: string,
): number | undefined {
  if (!Number.isFinite(projectedOpeningBalance)) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(balanceAsOfDate ?? "")) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monthStartDate)) return undefined;
  return balanceAsOfDate! <= monthStartDate ? projectedOpeningBalance : undefined;
}

export function accountForecastValue(account: Pick<AccountSnapshot, "type" | "currentBalance">): number {
  return account.currentBalance;
}

export function totalForecastBalance(accounts: AccountSnapshot[]): number {
  return accounts.filter(account => account.active).reduce((sum, account) => sum + accountForecastValue(account), 0);
}

export function operatingAccountAnchor(accounts: AccountSnapshot[]): { balance: number; date: string } | null {
  const active = accounts.filter(account => account.active);
  if (!active.length) return null;
  const operating = active.filter(account => account.type === "checking" || account.type === "cash");
  if (!operating.length) return null;
  const date = operating
    .map(account => account.balanceAsOf)
    .filter(Boolean)
    .sort()
    .at(-1);
  if (!date) return null;
  return { balance: totalForecastBalance(operating), date };
}

export function bankBalanceAdjustment(
  openingBalance: number,
  bankBalance: number,
  reconciliationDate: string,
  events: Array<{ date: string; amount: number }>,
): number {
  const netThroughReconciliation = events
    .filter(event => event.date <= reconciliationDate)
    .reduce((sum, event) => sum + event.amount, 0);
  return bankBalance - (openingBalance + netThroughReconciliation);
}

export function evaluateForecastConfidence(
  accounts: AccountSnapshot[],
  hasIncome: boolean,
  hasBills: boolean,
  now = new Date()
): ForecastConfidence {
  const active = accounts.filter(account => account.active);
  const reasons: string[] = [];
  if (!active.length) reasons.push("Add an account balance");
  if (!hasIncome) reasons.push("Add an income source");
  if (!hasBills) reasons.push("Add recurring bills");

  let oldestDays = 0;
  if (active.length) {
    oldestDays = Math.max(...active.map(account => {
      const reviewed = account.lastReconciledAt ?? account.balanceAsOf;
      const elapsed = now.getTime() - new Date(`${reviewed.slice(0, 10)}T00:00:00`).getTime();
      return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / 86_400_000)) : 999;
    }));
    if (oldestDays > 30) reasons.push("Reconcile accounts older than 30 days");
    else if (oldestDays > 7) reasons.push("Reconcile accounts for the strongest forecast");
  }

  if (!active.length || !hasIncome || !hasBills || oldestDays > 30) return { level: "low", label: "Low", reasons };
  if (oldestDays > 7) return { level: "medium", label: "Medium", reasons };
  return { level: "high", label: "High", reasons: ["Accounts and recurring cash flow are current"] };
}

function csvCells(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"' && quoted) { value += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { cells.push(value.trim()); value = ""; }
    else value += char;
  }
  cells.push(value.trim());
  return cells;
}

function normalizeDate(value: string): string | null {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  return null;
}

export function transactionImportHash(accountId: string, date: string, amount: number, description: string): string {
  const input = `${accountId}|${date}|${amount.toFixed(2)}|${description.trim().toLowerCase().replace(/\s+/g, " ")}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `statement_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function parseStatementCsv(csv: string, accountId: string): ImportedTransactionRow[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const headers = csvCells(lines[0]).map(header => header.toLowerCase().replace(/[^a-z]/g, ""));
  const dateIndex = headers.findIndex(header => ["date", "transactiondate", "posteddate"].includes(header));
  const descriptionIndex = headers.findIndex(header => ["description", "name", "memo", "details", "merchant"].includes(header));
  const amountIndex = headers.findIndex(header => ["amount", "transactionamount"].includes(header));
  const debitIndex = headers.findIndex(header => ["debit", "withdrawal", "withdrawals"].includes(header));
  const creditIndex = headers.findIndex(header => ["credit", "deposit", "deposits"].includes(header));
  if (dateIndex < 0 || descriptionIndex < 0 || (amountIndex < 0 && debitIndex < 0 && creditIndex < 0)) return [];

  return lines.slice(1).flatMap(line => {
    const cells = csvCells(line);
    const date = normalizeDate(cells[dateIndex] ?? "");
    const description = (cells[descriptionIndex] ?? "").trim();
    const number = (value: string | undefined) => Number((value ?? "").replace(/[$,()]/g, match => match === "(" ? "-" : ""));
    let amount = amountIndex >= 0 ? number(cells[amountIndex]) : 0;
    if (amountIndex < 0) amount = (creditIndex >= 0 ? Math.abs(number(cells[creditIndex]) || 0) : 0) - (debitIndex >= 0 ? Math.abs(number(cells[debitIndex]) || 0) : 0);
    if (!date || !description || !Number.isFinite(amount) || amount === 0) return [];
    return [{ date, amount, description, importHash: transactionImportHash(accountId, date, amount, description) }];
  });
}
