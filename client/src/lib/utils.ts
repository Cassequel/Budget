import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Short source label for a transaction's account (Venmo / MACU / Amex), derived
// from the Plaid institution + account name. Falls back to the institution name.
export function accountLabel(institutionName?: string | null, accountName?: string | null): string | null {
  const s = `${institutionName ?? ''} ${accountName ?? ''}`.toLowerCase();
  if (s.includes('venmo')) return 'Venmo';
  if (s.includes('mountain america') || s.includes('macu')) return 'MACU';
  if (s.includes('american express') || s.includes('amex')) return 'Amex';
  return institutionName ?? accountName ?? null;
}

// 'YYYY-MM' key for a Date (local).
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// The last `n` month keys, oldest first, ending with the current month.
export function lastNMonths(n: number): string[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => monthKey(new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1)));
}

// 'YYYY-MM' → 'Jun' (or 'Jun ’25' when the year differs from the current one).
export function formatMonthShort(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const sameYear = y === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', ...(sameYear ? {} : { year: '2-digit' }) });
}

// 'YYYY-MM' → 'June 2026', for page headings.
export function formatMonthLong(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// First and last calendar day of a 'YYYY-MM' month, as YYYY-MM-DD strings.
export function monthBounds(key: string): { from: string; to: string } {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}
