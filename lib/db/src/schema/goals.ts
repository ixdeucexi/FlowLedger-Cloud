import { numeric, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const goalsTable = pgTable("goals", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  targetAmount: numeric("target_amount", { precision: 12, scale: 2 }).notNull(),
  targetDate: text("target_date").notNull(),
  currentAmount: numeric("current_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: text("created_at").notNull(),
});

export const insertGoalSchema = createInsertSchema(goalsTable).omit({ userId: true });
export type InsertGoal = z.infer<typeof insertGoalSchema>;
export type GoalRow = typeof goalsTable.$inferSelect;
