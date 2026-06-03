import { jsonb, numeric, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const incomesTable = pgTable("income_sources", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  frequency: text("frequency").notNull().default("monthly"),
  startDate: text("start_date"),
  nextPaymentDate: text("next_payment_date"),
  amountHistory: jsonb("amount_history").default("[]"),
});

export const insertIncomeSchema = createInsertSchema(incomesTable).omit({ userId: true });
export type InsertIncome = z.infer<typeof insertIncomeSchema>;
export type IncomeRow = typeof incomesTable.$inferSelect;
