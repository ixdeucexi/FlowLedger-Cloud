import { pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const categoriesTable = pgTable("categories", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
});

export const insertCategorySchema = createInsertSchema(categoriesTable).omit({ userId: true });
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type CategoryRow = typeof categoriesTable.$inferSelect;
