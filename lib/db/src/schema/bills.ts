import { boolean, integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const billsTable = pgTable("bills", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  category: text("category").notNull().default("Other"),
  priority: integer("priority").notNull().default(99),
  isDebt: boolean("is_debt").notNull().default(false),
  balance: numeric("balance", { precision: 12, scale: 2 }).notNull().default("0"),
  interestRate: numeric("interest_rate", { precision: 6, scale: 3 }).notNull().default("0"),
  dueDay: integer("due_day").notNull().default(1),
  dayOfWeek: integer("day_of_week"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  isRecurring: boolean("is_recurring").notNull().default(true),
  frequency: text("frequency").notNull().default("monthly"),
  createdAt: text("created_at").notNull(),
});

export const insertBillSchema = createInsertSchema(billsTable).omit({ userId: true });
export type InsertBill = z.infer<typeof insertBillSchema>;
export type BillRow = typeof billsTable.$inferSelect;
