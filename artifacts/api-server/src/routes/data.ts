import {
  db,
  billsTable, overridesTable, transactionsTable,
  incomesTable, goalsTable, settingsTable,
  categoriesTable, extraPaymentsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

// ── Helper: parse numeric fields from DB (stored as strings by pg numeric type)
function parseBill(row: typeof billsTable.$inferSelect) {
  return {
    ...row,
    amount: parseFloat(row.amount as unknown as string),
    balance: parseFloat(row.balance as unknown as string),
    interestRate: parseFloat(row.interestRate as unknown as string),
    interest_rate: parseFloat(row.interestRate as unknown as string),
    is_debt: row.isDebt,
    is_recurring: row.isRecurring,
    due_day: row.dueDay,
    day_of_week: row.dayOfWeek ?? undefined,
    start_date: row.startDate ?? undefined,
    end_date: row.endDate ?? undefined,
    created_at: row.createdAt,
  };
}

function parseOverride(row: typeof overridesTable.$inferSelect) {
  return {
    ...row,
    bill_id: row.billId,
    custom_amount: row.customAmount != null ? parseFloat(row.customAmount as unknown as string) : undefined,
    custom_due_day: row.customDueDay ?? undefined,
    paid_amount: parseFloat(row.paidAmount as unknown as string),
  };
}

function parseTransaction(row: typeof transactionsTable.$inferSelect) {
  return {
    ...row,
    amount: parseFloat(row.amount as unknown as string),
    linked_bill_id: row.linkedBillId ?? undefined,
  };
}

function parseIncome(row: typeof incomesTable.$inferSelect) {
  return {
    ...row,
    amount: parseFloat(row.amount as unknown as string),
    start_date: row.startDate ?? undefined,
    next_payment_date: row.nextPaymentDate ?? undefined,
    amount_history: row.amountHistory ?? [],
  };
}

function parseGoal(row: typeof goalsTable.$inferSelect) {
  return {
    ...row,
    target_amount: parseFloat(row.targetAmount as unknown as string),
    current_amount: parseFloat(row.currentAmount as unknown as string),
    target_date: row.targetDate,
    created_at: row.createdAt,
  };
}

function parseSettings(row: typeof settingsTable.$inferSelect) {
  return {
    paymentMethod: row.paymentMethod as "snowball" | "avalanche",
    starting_balance: parseFloat(row.startingBalance as unknown as string),
    starting_balance_date: row.startingBalanceDate ?? undefined,
  };
}

function parseExtraPayment(row: typeof extraPaymentsTable.$inferSelect) {
  return {
    ...row,
    amount: parseFloat(row.amount as unknown as string),
    allocations: row.allocations ?? [],
  };
}

// ══════════════════════════════════════════
// BILLS
// ══════════════════════════════════════════
router.get("/bills", async (req, res) => {
  const rows = await db.select().from(billsTable).where(eq(billsTable.userId, req.auth!.userId));
  res.json(rows.map(parseBill));
});

router.post("/bills", async (req, res) => {
  const b = req.body;
  const row = {
    id: b.id ?? genId(),
    userId: req.auth!.userId,
    name: b.name,
    amount: String(b.amount ?? 0),
    category: b.category ?? "Other",
    priority: b.priority ?? 99,
    isDebt: b.is_debt ?? false,
    balance: String(b.balance ?? 0),
    interestRate: String(b.interest_rate ?? 0),
    dueDay: b.due_day ?? 1,
    dayOfWeek: b.day_of_week ?? null,
    startDate: b.start_date ?? null,
    endDate: b.end_date ?? null,
    isRecurring: b.is_recurring ?? true,
    frequency: b.frequency ?? "monthly",
    createdAt: b.created_at ?? new Date().toISOString(),
  };
  await db.insert(billsTable).values(row);
  const inserted = await db.select().from(billsTable).where(eq(billsTable.id, row.id)).limit(1);
  res.status(201).json(parseBill(inserted[0]));
});

router.put("/bills/:id", async (req, res) => {
  const { id } = req.params;
  const b = req.body;
  await db.update(billsTable).set({
    name: b.name,
    amount: String(b.amount),
    category: b.category,
    priority: b.priority,
    isDebt: b.is_debt,
    balance: String(b.balance),
    interestRate: String(b.interest_rate),
    dueDay: b.due_day,
    dayOfWeek: b.day_of_week ?? null,
    startDate: b.start_date ?? null,
    endDate: b.end_date ?? null,
    isRecurring: b.is_recurring,
    frequency: b.frequency,
  }).where(and(eq(billsTable.id, id), eq(billsTable.userId, req.auth!.userId)));
  const updated = await db.select().from(billsTable).where(eq(billsTable.id, id)).limit(1);
  res.json(updated.length ? parseBill(updated[0]) : {});
});

router.delete("/bills/:id", async (req, res) => {
  await db.delete(billsTable).where(and(eq(billsTable.id, req.params.id), eq(billsTable.userId, req.auth!.userId)));
  res.json({ ok: true });
});

// ══════════════════════════════════════════
// OVERRIDES
// ══════════════════════════════════════════
router.get("/overrides", async (req, res) => {
  const rows = await db.select().from(overridesTable).where(eq(overridesTable.userId, req.auth!.userId));
  res.json(rows.map(parseOverride));
});

router.post("/overrides", async (req, res) => {
  const o = req.body;
  const existing = await db.select().from(overridesTable)
    .where(and(eq(overridesTable.billId, o.bill_id), eq(overridesTable.month, o.month), eq(overridesTable.year, o.year), eq(overridesTable.userId, req.auth!.userId)))
    .limit(1);
  if (existing.length > 0) {
    await db.update(overridesTable).set({
      customAmount: o.custom_amount != null ? String(o.custom_amount) : null,
      customDueDay: o.custom_due_day ?? null,
      paidAmount: String(o.paid_amount ?? 0),
    }).where(eq(overridesTable.id, existing[0].id));
    const updated = await db.select().from(overridesTable).where(eq(overridesTable.id, existing[0].id)).limit(1);
    res.json(parseOverride(updated[0]));
    return;
  }
  const row = {
    id: o.id ?? genId(),
    userId: req.auth!.userId,
    billId: o.bill_id,
    month: o.month,
    year: o.year,
    customAmount: o.custom_amount != null ? String(o.custom_amount) : null,
    customDueDay: o.custom_due_day ?? null,
    paidAmount: String(o.paid_amount ?? 0),
  };
  await db.insert(overridesTable).values(row);
  const inserted = await db.select().from(overridesTable).where(eq(overridesTable.id, row.id)).limit(1);
  res.status(201).json(parseOverride(inserted[0]));
});

router.put("/overrides/:id", async (req, res) => {
  const o = req.body;
  await db.update(overridesTable).set({
    customAmount: o.custom_amount != null ? String(o.custom_amount) : null,
    customDueDay: o.custom_due_day ?? null,
    paidAmount: String(o.paid_amount ?? 0),
  }).where(and(eq(overridesTable.id, req.params.id), eq(overridesTable.userId, req.auth!.userId)));
  const updated = await db.select().from(overridesTable).where(eq(overridesTable.id, req.params.id)).limit(1);
  res.json(updated.length ? parseOverride(updated[0]) : {});
});

router.delete("/overrides/:id", async (req, res) => {
  await db.delete(overridesTable).where(and(eq(overridesTable.id, req.params.id), eq(overridesTable.userId, req.auth!.userId)));
  res.json({ ok: true });
});

// ══════════════════════════════════════════
// TRANSACTIONS
// ══════════════════════════════════════════
router.get("/transactions", async (req, res) => {
  const rows = await db.select().from(transactionsTable).where(eq(transactionsTable.userId, req.auth!.userId));
  res.json(rows.map(parseTransaction));
});

router.post("/transactions", async (req, res) => {
  const t = req.body;
  const row = {
    id: t.id ?? genId(),
    userId: req.auth!.userId,
    date: t.date,
    amount: String(t.amount),
    category: t.category ?? "Other",
    note: t.note ?? "",
    linkedBillId: t.linked_bill_id ?? null,
  };
  await db.insert(transactionsTable).values(row);
  const inserted = await db.select().from(transactionsTable).where(eq(transactionsTable.id, row.id)).limit(1);
  res.status(201).json(parseTransaction(inserted[0]));
});

router.put("/transactions/:id", async (req, res) => {
  const t = req.body;
  await db.update(transactionsTable).set({
    date: t.date, amount: String(t.amount), category: t.category, note: t.note, linkedBillId: t.linked_bill_id ?? null,
  }).where(and(eq(transactionsTable.id, req.params.id), eq(transactionsTable.userId, req.auth!.userId)));
  const updated = await db.select().from(transactionsTable).where(eq(transactionsTable.id, req.params.id)).limit(1);
  res.json(updated.length ? parseTransaction(updated[0]) : {});
});

router.delete("/transactions/:id", async (req, res) => {
  await db.delete(transactionsTable).where(and(eq(transactionsTable.id, req.params.id), eq(transactionsTable.userId, req.auth!.userId)));
  res.json({ ok: true });
});

// ══════════════════════════════════════════
// INCOMES
// ══════════════════════════════════════════
router.get("/incomes", async (req, res) => {
  const rows = await db.select().from(incomesTable).where(eq(incomesTable.userId, req.auth!.userId));
  res.json(rows.map(parseIncome));
});

router.post("/incomes", async (req, res) => {
  const i = req.body;
  const row = {
    id: i.id ?? genId(),
    userId: req.auth!.userId,
    name: i.name,
    amount: String(i.amount),
    frequency: i.frequency ?? "monthly",
    startDate: i.start_date ?? null,
    nextPaymentDate: i.next_payment_date ?? null,
    amountHistory: i.amount_history ?? [],
  };
  await db.insert(incomesTable).values(row);
  const inserted = await db.select().from(incomesTable).where(eq(incomesTable.id, row.id)).limit(1);
  res.status(201).json(parseIncome(inserted[0]));
});

router.put("/incomes/:id", async (req, res) => {
  const i = req.body;
  await db.update(incomesTable).set({
    name: i.name, amount: String(i.amount), frequency: i.frequency,
    startDate: i.start_date ?? null, nextPaymentDate: i.next_payment_date ?? null,
    amountHistory: i.amount_history ?? [],
  }).where(and(eq(incomesTable.id, req.params.id), eq(incomesTable.userId, req.auth!.userId)));
  const updated = await db.select().from(incomesTable).where(eq(incomesTable.id, req.params.id)).limit(1);
  res.json(updated.length ? parseIncome(updated[0]) : {});
});

router.delete("/incomes/:id", async (req, res) => {
  await db.delete(incomesTable).where(and(eq(incomesTable.id, req.params.id), eq(incomesTable.userId, req.auth!.userId)));
  res.json({ ok: true });
});

// ══════════════════════════════════════════
// GOALS
// ══════════════════════════════════════════
router.get("/goals", async (req, res) => {
  const rows = await db.select().from(goalsTable).where(eq(goalsTable.userId, req.auth!.userId));
  res.json(rows.map(parseGoal));
});

router.post("/goals", async (req, res) => {
  const g = req.body;
  const row = {
    id: g.id ?? genId(),
    userId: req.auth!.userId,
    name: g.name,
    targetAmount: String(g.target_amount),
    targetDate: g.target_date,
    currentAmount: String(g.current_amount ?? 0),
    createdAt: g.created_at ?? new Date().toISOString(),
  };
  await db.insert(goalsTable).values(row);
  const inserted = await db.select().from(goalsTable).where(eq(goalsTable.id, row.id)).limit(1);
  res.status(201).json(parseGoal(inserted[0]));
});

router.put("/goals/:id", async (req, res) => {
  const g = req.body;
  await db.update(goalsTable).set({
    name: g.name, targetAmount: String(g.target_amount),
    targetDate: g.target_date, currentAmount: String(g.current_amount ?? 0),
  }).where(and(eq(goalsTable.id, req.params.id), eq(goalsTable.userId, req.auth!.userId)));
  const updated = await db.select().from(goalsTable).where(eq(goalsTable.id, req.params.id)).limit(1);
  res.json(updated.length ? parseGoal(updated[0]) : {});
});

router.delete("/goals/:id", async (req, res) => {
  await db.delete(goalsTable).where(and(eq(goalsTable.id, req.params.id), eq(goalsTable.userId, req.auth!.userId)));
  res.json({ ok: true });
});

// ══════════════════════════════════════════
// SETTINGS (one row per user)
// ══════════════════════════════════════════
router.get("/settings", async (req, res) => {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.userId, req.auth!.userId)).limit(1);
  if (rows.length === 0) {
    res.json({ paymentMethod: "snowball", starting_balance: 0 });
    return;
  }
  res.json(parseSettings(rows[0]));
});

router.put("/settings", async (req, res) => {
  const s = req.body;
  await db.insert(settingsTable).values({
    userId: req.auth!.userId,
    paymentMethod: s.paymentMethod ?? "snowball",
    startingBalance: String(s.starting_balance ?? 0),
    startingBalanceDate: s.starting_balance_date ?? null,
  }).onConflictDoUpdate({
    target: settingsTable.userId,
    set: {
      paymentMethod: s.paymentMethod ?? "snowball",
      startingBalance: String(s.starting_balance ?? 0),
      startingBalanceDate: s.starting_balance_date ?? null,
    },
  });
  const updated = await db.select().from(settingsTable).where(eq(settingsTable.userId, req.auth!.userId)).limit(1);
  res.json(parseSettings(updated[0]));
});

// ══════════════════════════════════════════
// CATEGORIES
// ══════════════════════════════════════════
router.get("/categories", async (req, res) => {
  const rows = await db.select().from(categoriesTable).where(eq(categoriesTable.userId, req.auth!.userId));
  res.json(rows.map(r => r.name));
});

router.post("/categories", async (req, res) => {
  const { name } = req.body;
  const row = { id: genId(), userId: req.auth!.userId, name };
  await db.insert(categoriesTable).values(row);
  res.status(201).json({ ok: true });
});

router.delete("/categories/:name", async (req, res) => {
  await db.delete(categoriesTable).where(and(eq(categoriesTable.name, req.params.name), eq(categoriesTable.userId, req.auth!.userId)));
  res.json({ ok: true });
});

router.put("/categories/:oldName", async (req, res) => {
  const { name: newName } = req.body;
  await db.update(categoriesTable).set({ name: newName }).where(and(eq(categoriesTable.name, req.params.oldName), eq(categoriesTable.userId, req.auth!.userId)));
  res.json({ ok: true });
});

// ══════════════════════════════════════════
// EXTRA PAYMENTS
// ══════════════════════════════════════════
router.get("/extra-payments", async (req, res) => {
  const rows = await db.select().from(extraPaymentsTable).where(eq(extraPaymentsTable.userId, req.auth!.userId));
  res.json(rows.map(parseExtraPayment));
});

router.post("/extra-payments", async (req, res) => {
  const ep = req.body;
  const row = {
    id: ep.id ?? genId(),
    userId: req.auth!.userId,
    month: ep.month,
    year: ep.year,
    amount: String(ep.amount),
    allocations: ep.allocations ?? [],
  };
  await db.insert(extraPaymentsTable).values(row).onConflictDoNothing();
  const inserted = await db.select().from(extraPaymentsTable).where(eq(extraPaymentsTable.id, row.id)).limit(1);
  res.status(201).json(parseExtraPayment(inserted[0]));
});

router.put("/extra-payments/:id", async (req, res) => {
  const ep = req.body;
  await db.update(extraPaymentsTable).set({
    amount: String(ep.amount), allocations: ep.allocations ?? [],
  }).where(and(eq(extraPaymentsTable.id, req.params.id), eq(extraPaymentsTable.userId, req.auth!.userId)));
  const updated = await db.select().from(extraPaymentsTable).where(eq(extraPaymentsTable.id, req.params.id)).limit(1);
  res.json(updated.length ? parseExtraPayment(updated[0]) : {});
});

router.delete("/extra-payments/:id", async (req, res) => {
  await db.delete(extraPaymentsTable).where(and(eq(extraPaymentsTable.id, req.params.id), eq(extraPaymentsTable.userId, req.auth!.userId)));
  res.json({ ok: true });
});

export default router;
