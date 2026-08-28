// Credit-utilization math. Utilization is the user's #1 financial priority, so
// the whole app leans on these helpers to keep the definition in one place.

// Milestone ladder, high → low — the utilization thresholds worth aiming for
// (30% and 10% are the widely-cited scoring breakpoints; 70/50 are staging
// posts on the way down). "Next milestone" is the highest rung strictly below
// current utilization.
export const UTILIZATION_MILESTONES = [70, 50, 30, 10] as const;

export interface CardUtilInput {
  balance: number; // amount owed that counts toward utilization
  limit: number | null; // credit limit; null/0 → utilization is unknown
}

// Ratio in [0, 1+], or null when we can't compute it (no limit).
export function utilizationRatio({ balance, limit }: CardUtilInput): number | null {
  if (!limit || limit <= 0) return null;
  return balance / limit;
}

// Dollars to pay down to bring utilization to `targetRatio` (e.g. 0.3).
// Never negative — if you're already under, the answer is 0.
export function paymentToReach(balance: number, limit: number | null, targetRatio: number): number | null {
  if (!limit || limit <= 0) return null;
  return Math.max(0, round2(balance - targetRatio * limit));
}

// The next milestone below `ratio` (as a percentage), plus the payment needed
// to get there for the given balance/limit. Returns null once you're at or
// under the lowest rung.
export function nextMilestone(
  balance: number,
  limit: number | null,
  ratio: number | null
): { threshold: number; paymentToReach: number } | null {
  if (ratio == null || limit == null || limit <= 0) return null;
  const pct = ratio * 100;
  const threshold = UTILIZATION_MILESTONES.find((m) => m < pct - 0.0001);
  if (threshold == null) return null;
  return { threshold, paymentToReach: paymentToReach(balance, limit, threshold / 100)! };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
