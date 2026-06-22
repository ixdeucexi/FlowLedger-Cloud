import { integer, numeric, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const overridesTable = pgTable("monthly_overrides", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  billId: text("bill_id").notNull(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  customAmount: numeric("custom_amount", { precision: 12, scale: 2 }),
  customDueDay: integer("custom_due_day"),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  actualAmount: numeric("actual_amount", { precision: 12, scale: 2 }),
  paidDate: text("paid_date"),
});

export const insertOverrideSchema = createInsertSchema(overridesTable).omit({ userId: true });
export type InsertOverride = z.infer<typeof insertOverrideSchema>;
export type OverrideRow = typeof overridesTable.$inferSelect;
