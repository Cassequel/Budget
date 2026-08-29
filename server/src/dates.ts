// Small date helpers shared by the operating-plan and credit-control routes.
// Everything works in local time on 'YYYY-MM-DD' strings.

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

// Whole days from today to `dateStr` (negative = in the past).
export function daysUntil(dateStr: string): number {
  const today = parseYmd(ymd(new Date()));
  return Math.round((parseYmd(dateStr).getTime() - today.getTime()) / 86_400_000);
}

// Credit-card due/close dates recur monthly. Roll a stored date forward whole
// months until it's today or later, so an old value still means "the next one".
export function rollForwardMonthly(dateStr: string): string {
  const today = parseYmd(ymd(new Date()));
  const d = parseYmd(dateStr);
  while (d.getTime() < today.getTime()) d.setMonth(d.getMonth() + 1);
  return ymd(d);
}
