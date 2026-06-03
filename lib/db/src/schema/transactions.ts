import { numeric, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transactionsTable = pgTable("transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: text("date").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  category: text("category").notNull().default("Other"),
  note: text("note").notNull().default(""),
  linkedBillId: text("linked_bill_id"),
});

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ userId: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type TransactionRow = typeof transactionsTable.$inferSelect;
