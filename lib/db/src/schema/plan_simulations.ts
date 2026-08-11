import { integer, jsonb, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const planSimulationsTable = pgTable("plan_simulations", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull(),
  name: text("name").notNull(),
  horizonMonths: integer("horizon_months").notNull(),
  changes: jsonb("changes").notNull().default([]),
  schemaVersion: smallint("schema_version").notNull().default(1),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlanSimulationSchema = createInsertSchema(planSimulationsTable).omit({
  id: true,
  schemaVersion: true,
  version: true,
  createdBy: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPlanSimulation = z.infer<typeof insertPlanSimulationSchema>;
export type PlanSimulationRow = typeof planSimulationsTable.$inferSelect;
