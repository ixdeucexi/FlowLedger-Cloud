export function goalAffordabilityFromProjectedBalance(
  projectedBalance: number,
  needed: number,
  safetyFloor: number,
) {
  const available = projectedBalance - safetyFloor;
  const canAfford = available >= needed;
  return {
    projectedBalance,
    canAfford,
    shortfall: canAfford ? 0 : needed - available,
  };
}
