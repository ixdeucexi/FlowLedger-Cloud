import React from "react";
import { ActivityScreen } from "@/components/ActivityScreen";
import { useBudget } from "@/context/BudgetContext";
import { CategoryBudgetScreen } from "./category-budget";

export { ActivityScreen } from "@/components/ActivityScreen";

export default function TransactionsScreen() {
  const { settings } = useBudget();
  return settings.zeroBasedBudgetEnabled ? <CategoryBudgetScreen embedded /> : <ActivityScreen />;
}
