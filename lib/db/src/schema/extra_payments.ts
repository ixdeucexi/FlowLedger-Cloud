import { integer, jsonb, numeric, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const extraPaymentsTable = pgTable("extra_payments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  allocations: jsonb("allocations").notNull().default("[]"),
  paymentDate: text("payment_date"),
  sources: jsonb("sources").notNull().default("[]"),
});

export const insertExtraPaymentSchema = createInsertSchema(extraPaymentsTable).omit({ userId: true });
export type InsertExtraPayment = z.infer<typeof insertExtraPaymentSchema>;
export type ExtraPaymentRow = typeof extraPaymentsTable.$inferSelect;
