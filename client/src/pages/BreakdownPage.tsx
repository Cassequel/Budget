import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import api from '../lib/api';
import { formatCurrency, formatDate, formatMonthLong, monthBounds, monthKey } from '../lib/utils';

interface Transaction {
  id: string;
  name: string;
  merchantName: string | null;
  amount: string;
  date: string;
  category: string | null;
  isPending: boolean;
}

interface Category { id: string; name: string; color: string | null; }

const CURRENT = monthKey(new Date());

// Money-movement categories that shouldn't appear in spending breakdowns.
const HIDDEN_CATEGORIES = new Set(['Loan Payments', 'Transfers']);

export default function BreakdownPage() {
  const [month, setMonth] = useState(CURRENT);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null); // category filter from a bar click

  useEffect(() => {
    api.get<Category[]>('/api/budget/categories').then((r) => setCategories(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setSelected(null); // clear the category filter when the month changes
    const { from, to } = monthBounds(month);
    api.get<Transaction[]>(`/api/transactions?from=${from}&to=${to}`)
      .then((r) => setTxns(r.data))
      .finally(() => setLoading(false));
  }, [month]);

  const colorOf = useCallback(
    (name: string) => categories.find((c) => c.name === name)?.color ?? '#94a3b8',
    [categories]
  );

  // Drop money-movement categories (loan payments, transfers) entirely — they
  // shouldn't show or count anywhere on this page.
  const visible = useMemo(
    () => txns.filter((t) => !HIDDEN_CATEGORIES.has(t.category ?? '')),
    [txns]
  );

  // Spend per category (money out only), sorted high → low, for the bar chart.
  const breakdown = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of visible) {
      const amt = parseFloat(t.amount);
      if (amt <= 0) continue;
      const cat = t.category ?? 'Uncategorized';
      m.set(cat, (m.get(cat) ?? 0) + amt);
    }
    return [...m.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);
  }, [visible]);

  const totalSpend = breakdown.reduce((s, b) => s + b.total, 0);

  // Transactions newest first, biggest charges visible.
  const sortedTxns = useMemo(
    () => [...visible].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [visible]
  );

  // When a bar is selected, the list shows only that category.
  const displayedTxns = useMemo(
    () => (selected ? sortedTxns.filter((t) => (t.category ?? 'Uncategorized') === selected) : sortedTxns),
    [sortedTxns, selected]
  );

  const atCurrent = month >= CURRENT;
  const step = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    setMonth(monthKey(new Date(y, m - 1 + delta, 1)));
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Breakdown</h1>
        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="px-3 text-sm font-medium text-slate-700 w-36 text-center">{formatMonthLong(month)}</span>
          <button
            onClick={() => step(1)}
            disabled={atCurrent}
            className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-slate-400 text-sm">Loading…</p>
      ) : breakdown.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
          No spending recorded for {formatMonthLong(month)}.
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">Spending by Category</h2>
              <span className="text-sm text-slate-500">{formatCurrency(totalSpend)} total</span>
            </div>
            <ResponsiveContainer width="100%" height={Math.max(160, breakdown.length * 40)}>
              <BarChart data={breakdown} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
                />
                <YAxis
                  type="category"
                  dataKey="category"
                  tick={{ fontSize: 12, fill: '#475569' }}
                  axisLine={false}
                  tickLine={false}
                  width={130}
                />
                <Tooltip
                  formatter={(v: number) => [formatCurrency(v), 'Spent']}
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }}
                />
                <Bar
                  dataKey="total"
                  radius={[0, 4, 4, 0]}
                  barSize={22}
                  cursor="pointer"
                  onClick={(_d, index) => {
                    const cat = breakdown[index]?.category;
                    if (cat) setSelected((s) => (s === cat ? null : cat));
                  }}
                >
                  {breakdown.map((b) => (
                    <Cell
                      key={b.category}
                      fill={colorOf(b.category)}
                      fillOpacity={selected && b.category !== selected ? 0.3 : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {selected && (
            <div className="flex items-center gap-2 -mb-1">
              <span className="text-sm text-slate-500">Filtered by</span>
              <button
                onClick={() => setSelected(null)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorOf(selected) }} />
                {selected}
                <X size={12} className="text-slate-400" />
              </button>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Merchant</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Category</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {displayedTxns.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-8 text-slate-400">No transactions in this category.</td></tr>
                )}
                {displayedTxns.map((t) => {
                  const amt = parseFloat(t.amount);
                  const isIncome = amt < 0;
                  const cat = t.category ?? 'Uncategorized';
                  return (
                    <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{formatDate(t.date)}</td>
                      <td className="px-4 py-3">
                        <span className={t.isPending ? 'text-slate-400 italic' : 'text-slate-700'}>{t.merchantName ?? t.name}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2 text-slate-600">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorOf(cat) }} />
                          {cat}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right font-medium tabular-nums ${isIncome ? 'text-green-600' : 'text-slate-900'}`}>
                        {isIncome ? '+' : ''}{formatCurrency(Math.abs(amt))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
