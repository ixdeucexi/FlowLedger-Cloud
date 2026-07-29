type AffordabilityResult = {
  projectedBalance: number;
  canAfford: boolean;
  shortfall: number;
};

export type BucketAffordabilitySummary = {
  title: string;
  message: string;
  statusLabel: string;
  statusValue: string;
  safe: boolean;
};

function money(value: number) {
  return `$${Math.max(0, Math.round(value)).toLocaleString()}`;
}

export function buildBucketAffordabilitySummary(
  bucketName: string,
  amount: number,
  targetDate: string,
  safetyFloor: number,
  result: AffordabilityResult,
): BucketAffordabilitySummary {
  const date = new Date(`${targetDate.slice(0, 10)}T12:00:00`);
  const dateLabel = Number.isNaN(date.getTime())
    ? "that date"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  if (result.canAfford) {
    return {
      title: "Yes, this fits your plan.",
      message: `I checked ${bucketName}. Setting aside ${money(amount)} by ${dateLabel} keeps your forecast above your ${money(safetyFloor)} safety floor.`,
      statusLabel: "Forecast after this bucket",
      statusValue: money(result.projectedBalance - amount),
      safe: true,
    };
  }

  return {
    title: "This is not safe yet.",
    message: `I checked ${bucketName}. To protect your safety floor, lower the amount, move the date, or free up ${money(result.shortfall)} first.`,
    statusLabel: "More room needed",
    statusValue: money(result.shortfall),
    safe: false,
  };
}
