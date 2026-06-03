import { numeric, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("user_settings", {
  userId: text("user_id").primaryKey(),
  paymentMethod: text("payment_method").notNull().default("snowball"),
  startingBalance: numeric("starting_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  startingBalanceDate: text("starting_balance_date"),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ userId: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type SettingsRow = typeof settingsTable.$inferSelect;
