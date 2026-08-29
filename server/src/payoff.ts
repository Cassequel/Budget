// Credit-card pay-down math for the credit-control page: milestone ladders,
// splitting a lump payment across cards, and the before/after picture of a
// hypothetical payment. Utilization definitions come from ./utilization so
// there's one source of truth.

import { UTILIZATION_MILESTONES, utilizationRatio, round2 } from './utilization';

export type Strategy = 'avalanche' | 'highest-util' | 'proportional';

export interface PayoffCard {
  id: string;
  name: string;
  balance: number; // amount that counts toward utilization (statement or live)
  limit: number | null;
  apr: number | null;
}

// One rung of the ladder: pay `payment` to bring utilization to `threshold`%.
// `threshold: 0` is the pay-in-full rung.
export interface LadderRung {
  threshold: number;
  payment: number;
  resultingRatio: number | null;
}

// Every milestone strictly below current utilization, plus a "paid in full"
// rung when there's a balance. Empty when there's no limit and no balance.
export function milestoneLadder(balance: number, limit: number | null): LadderRung[] {
  const ratio = utilizationRatio({ balance, limit });
  const rungs: LadderRung[] = [];
  if (limit && limit > 0 && ratio != null) {
    for (const m of UTILIZATION_MILESTONES) {
      if (m < ratio * 100 - 0.0001) {
        const payment = Math.max(0, round2(balance - (m / 100) * limit));
        rungs.push({ threshold: m, payment, resultingRatio: (balance - payment) / limit });
      }
    }
  }
  if (balance > 0) rungs.push({ threshold: 0, payment: round2(balance), resultingRatio: 0 });
  return rungs;
}

// Split `amount` across `cards` by strategy, never paying more than a card
// owes. Whatever can't be applied (every card paid off) comes back as `unused`.
export function allocatePayment(
  cards: PayoffCard[],
  amount: number,
  strategy: Strategy
): { applied: Record<string, number>; unused: number } {
  const applied: Record<string, number> = {};
  let left = round2(Math.max(0, amount));

  if (strategy === 'proportional') {
    const totalOwed = cards.reduce((s, c) => s + Math.max(0, c.balance), 0);
    if (totalOwed <= 0) return { applied, unused: left };
    const pay = Math.min(left, totalOwed);
    for (const c of cards) {
      const share = round2((Math.max(0, c.balance) / totalOwed) * pay);
      applied[c.id] = Math.min(Math.max(0, c.balance), share);
    }
    let placed = round2(Object.values(applied).reduce((s, v) => s + v, 0));
    left = round2(left - placed);
    // Rounding crumbs (and any headroom under totalOwed) → biggest remaining balance.
    if (left > 0.009) {
      const target = [...cards]
        .map((c) => ({ c, owed: Math.max(0, c.balance) - (applied[c.id] ?? 0) }))
        .sort((a, b) => b.owed - a.owed)[0];
      if (target && target.owed > 0) {
        applied[target.c.id] = round2((applied[target.c.id] ?? 0) + Math.min(left, target.owed));
        left = round2(left - Math.min(left, target.owed));
      }
    }
    return { applied, unused: round2(Math.max(0, left)) };
  }

  const order = [...cards].sort((a, b) => {
    if (strategy === 'avalanche') return (b.apr ?? -1) - (a.apr ?? -1);
    return (
      (utilizationRatio({ balance: b.balance, limit: b.limit }) ?? -1) -
      (utilizationRatio({ balance: a.balance, limit: a.limit }) ?? -1)
    );
  });
  for (const c of order) {
    if (left <= 0) break;
    const pay = Math.min(left, Math.max(0, c.balance));
    if (pay > 0) applied[c.id] = round2(pay);
    left = round2(left - pay);
  }
  return { applied, unused: round2(Math.max(0, left)) };
}

export interface CardResult {
  id: string;
  name: string;
  apr: number | null;
  before: { balance: number; ratio: number | null };
  applied: number;
  after: { balance: number; ratio: number | null };
}

// The before/after picture for a set of per-card payments.
export function applyPayments(cards: PayoffCard[], applied: Record<string, number>) {
  const perCard: CardResult[] = cards.map((c) => {
    const pay = round2(applied[c.id] ?? 0);
    const afterBal = round2(Math.max(0, c.balance - pay));
    return {
      id: c.id,
      name: c.name,
      apr: c.apr,
      before: { balance: round2(c.balance), ratio: utilizationRatio({ balance: c.balance, limit: c.limit }) },
      applied: pay,
      after: { balance: afterBal, ratio: utilizationRatio({ balance: afterBal, limit: c.limit }) },
    };
  });

  const withLimit = cards.filter((c) => c.limit != null && c.limit > 0);
  const limit = round2(withLimit.reduce((s, c) => s + (c.limit ?? 0), 0));
  const beforeBal = round2(withLimit.reduce((s, c) => s + c.balance, 0));
  const afterBal = round2(
    withLimit.reduce((s, c) => s + Math.max(0, c.balance - (applied[c.id] ?? 0)), 0)
  );
  const beforeRatio = limit > 0 ? beforeBal / limit : null;
  const afterRatio = limit > 0 ? afterBal / limit : null;
  const milestonesCrossed =
    beforeRatio != null && afterRatio != null
      ? UTILIZATION_MILESTONES.filter(
          (m) => beforeRatio * 100 > m + 0.0001 && afterRatio * 100 <= m + 0.0001
        )
      : [];

  return {
    perCard,
    combined: {
      before: { balance: beforeBal, limit, ratio: beforeRatio },
      after: { balance: afterBal, limit, ratio: afterRatio },
      milestonesCrossed,
    },
  };
}
