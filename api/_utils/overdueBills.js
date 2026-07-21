const DAY_MS = 86_400_000;

function cents(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function dateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isActiveForMonth(bill, month, year) {
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  return (!bill.start_date || monthKey >= String(bill.start_date).slice(0, 7))
    && (!bill.end_date || monthKey <= String(bill.end_date).slice(0, 7));
}

function anchorOccurrences(anchorDate, fallbackDay, month, year, intervalDays) {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const fallback = Math.min(Math.max(1, Number(fallbackDay) || 1), daysInMonth);
  const anchor = anchorDate || dateKey(year, month, fallback);
  const [anchorYear, anchorMonth, anchorDay] = String(anchor).slice(0, 10).split("-").map(Number);
  if (![anchorYear, anchorMonth, anchorDay].every(Number.isFinite)) return [fallback];

  let cursor = Date.UTC(anchorYear, anchorMonth - 1, anchorDay);
  const target = Date.UTC(year, month, 1);
  while (cursor > target) cursor -= intervalDays * DAY_MS;
  while (cursor < target) cursor += intervalDays * DAY_MS;
  const days = [];
  while (new Date(cursor).getUTCMonth() === month && new Date(cursor).getUTCFullYear() === year) {
    days.push(new Date(cursor).getUTCDate());
    cursor += intervalDays * DAY_MS;
  }
  return days;
}

function occurrenceDays(bill, override, moves, month, year) {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  let days = [];
  if (isActiveForMonth(bill, month, year)) {
    const withinExactDates = day => {
      const date = dateKey(year, month, day);
      return (!bill.start_date || date >= String(bill.start_date).slice(0, 10))
        && (!bill.end_date || date <= String(bill.end_date).slice(0, 10));
    };
    if (bill.frequency === "weekly") {
      const anchor = bill.next_payment_date || bill.start_date;
      const anchorParts = anchor ? String(anchor).slice(0, 10).split("-").map(Number) : [];
      const anchorDayOfWeek = anchorParts.length === 3
        ? new Date(Date.UTC(anchorParts[0], anchorParts[1] - 1, anchorParts[2])).getUTCDay()
        : 0;
      const dayOfWeek = Number.isInteger(bill.day_of_week) ? bill.day_of_week : anchorDayOfWeek;
      for (let day = 1; day <= daysInMonth; day += 1) {
        if (new Date(Date.UTC(year, month, day)).getUTCDay() === dayOfWeek && withinExactDates(day)) days.push(day);
      }
    } else if (bill.frequency === "biweekly") {
      days = anchorOccurrences(bill.next_payment_date || bill.start_date, bill.due_day, month, year, 14)
        .filter(withinExactDates);
    } else {
      const dueDay = override?.custom_due_day ?? bill.due_day;
      const day = Math.min(Math.max(1, Number(dueDay) || 1), daysInMonth);
      if (withinExactDates(day)) days = [day];
    }
  }

  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const activeMoves = new Map();
  (moves || []).filter(move => move.bill_id === bill.id).forEach(move => {
    const existing = activeMoves.get(move.from_date);
    const freshness = Date.parse(move.updated_at || move.created_at || "") || 0;
    const existingFreshness = existing ? Date.parse(existing.updated_at || existing.created_at || "") || 0 : -1;
    if (!existing || freshness >= existingFreshness) activeMoves.set(move.from_date, move);
  });
  const selectedMoves = Array.from(activeMoves.values());
  const kept = days.filter(day => !selectedMoves.some(move => move.from_date === dateKey(year, month, day)));
  const movedIn = selectedMoves
    .filter(move => String(move.to_date).startsWith(prefix))
    .map(move => Number(String(move.to_date).slice(8, 10)))
    .filter(Number.isFinite);
  return Array.from(new Set([...kept, ...movedIn])).sort((left, right) => left - right);
}

function plannedOccurrenceAmount(bill, override, occurrenceCount = 1) {
  if (override?.actual_amount !== null && override?.actual_amount !== undefined) {
    return Math.max(0, Number(override.actual_amount) || 0) / Math.max(1, occurrenceCount);
  }
  const custom = Number(override?.custom_amount);
  const hasCustom = override?.custom_amount !== null && override?.custom_amount !== undefined && Number.isFinite(custom);
  const base = hasCustom && (!bill.is_debt || custom > 0.005)
    ? Math.max(0, custom)
    : Math.max(0, Number(bill.amount) || 0);
  if (!bill.is_debt) return cents(base);
  return cents(base + Math.max(0, Number(bill.snowball_minimum_boost) || 0));
}

function buildOverdueOccurrences({ bills, overrides, moves, today }) {
  const [year, monthNumber, todayDay] = String(today).slice(0, 10).split("-").map(Number);
  const month = monthNumber - 1;
  if (![year, month, todayDay].every(Number.isFinite)) throw new Error("A valid YYYY-MM-DD date is required.");
  const overrideByBill = new Map((overrides || []).map(override => [override.bill_id, override]));

  return (bills || []).flatMap(bill => {
    const override = overrideByBill.get(bill.id);
    const days = occurrenceDays(bill, override, moves, month, year);
    const amount = plannedOccurrenceAmount(bill, override, days.length);
    let paidRemaining = Math.max(0, Number(override?.paid_amount) || 0);

    return days.flatMap(day => {
      const paidForOccurrence = Math.min(amount, paidRemaining);
      paidRemaining = Math.max(0, paidRemaining - paidForOccurrence);
      const remainingAmount = cents(Math.max(0, amount - paidForOccurrence));
      if (day >= todayDay || remainingAmount <= 0.005) return [];
      return [{
        billId: bill.id,
        householdId: bill.household_id || null,
        ownerUserId: bill.user_id,
        occurrenceDate: dateKey(year, month, day),
        remainingAmount,
        daysPastDue: todayDay - day,
      }];
    });
  });
}

module.exports = { buildOverdueOccurrences, occurrenceDays, plannedOccurrenceAmount };
