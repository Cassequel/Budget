import { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';
import { Search, RefreshCw, Sparkles } from 'lucide-react';

interface Transaction {
  id: string;
  name: string;
  merchantName: string | null;
  amount: string;
  date: string;
  category: string | null;
  plaidCategory: string | null;
  isPending: boolean;
  accountId: string | null;
}

interface Category {
  id: string;
  name: string;
  color: string | null;
}

const UNCATEGORIZED = '__uncat__';

export default function TransactionsPage() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('all'); // 'all' | category name | UNCATEGORIZED
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [categorizing, setCategorizing] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      api.get<Transaction[]>('/api/transactions'),
      api.get<Category[]>('/api/budget/categories'),
    ])
      .then(([txRes, catRes]) => {
        setTxns(txRes.data);
        setCategories(catRes.data);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const colorOf = useCallback(
    (name: string | null) => categories.find((c) => c.name === name)?.color ?? '#cbd5e1',
    [categories]
  );

  async function sync() {
    setSyncing(true);
    await api.post('/api/plaid/sync').catch(console.error);
    load();
    setSyncing(false);
  }

  async function categorize() {
    setCategorizing(true);
    await api.post('/api/transactions/categorize').catch(console.error);
    load();
    setCategorizing(false);
  }

  async function updateCategory(id: string, category: string) {
    setTxns((prev) => prev.map((t) => (t.id === id ? { ...t, category: category || null } : t)));
    await api.patch(`/api/transactions/${id}`, { category });
  }

  // Counts per category (plus uncategorized) for the filter chips.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txns) {
      const key = t.category ?? UNCATEGORIZED;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [txns]);

  // Spend per category (money out only) for the totals strip.
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txns) {
      const amt = parseFloat(t.amount);
      if (amt <= 0 || !t.category) continue; // skip income/refunds and uncategorized
      m.set(t.category, (m.get(t.category) ?? 0) + amt);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [txns]);

  const filtered = txns.filter((t) => {
    if (filter === UNCATEGORIZED && t.category) return false;
    if (filter !== 'all' && filter !== UNCATEGORIZED && t.category !== filter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return t.name.toLowerCase().includes(q) || (t.merchantName ?? '').toLowerCase().includes(q);
  });

  const uncatCount = counts.get(UNCATEGORIZED) ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Transactions</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={categorize}
            disabled={categorizing || uncatCount === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            title={uncatCount === 0 ? 'Everything is categorized' : `Auto-categorize ${uncatCount} transactions`}
          >
            <Sparkles size={14} className={categorizing ? 'animate-pulse' : ''} />
            Auto-categorize{uncatCount > 0 ? ` (${uncatCount})` : ''}
          </button>
          <button
            onClick={sync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            Sync
          </button>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
            />
          </div>
        </div>
      </div>

      {/* Per-category spend totals */}
      {!loading && totals.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {totals.map(([name, total]) => (
            <button
              key={name}
              onClick={() => setFilter((f) => (f === name ? 'all' : name))}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-colors ${
                filter === name ? 'border-slate-300 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorOf(name) }} />
                <span className="text-xs text-slate-600 truncate">{name}</span>
              </span>
              <span className="text-xs font-medium text-slate-900 tabular-nums shrink-0">{formatCurrency(total)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Filter chips */}
      {!loading && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={filter === 'all'} onClick={() => setFilter('all')} label="All" count={txns.length} />
          {uncatCount > 0 && (
            <Chip
              active={filter === UNCATEGORIZED}
              onClick={() => setFilter(UNCATEGORIZED)}
              label="Uncategorized"
              count={uncatCount}
              dot="#cbd5e1"
            />
          )}
          {categories
            .filter((c) => (counts.get(c.name) ?? 0) > 0)
            .map((c) => (
              <Chip
                key={c.id}
                active={filter === c.name}
                onClick={() => setFilter((f) => (f === c.name ? 'all' : c.name))}
                label={c.name}
                count={counts.get(c.name) ?? 0}
                dot={c.color ?? '#cbd5e1'}
              />
            ))}
        </div>
      )}

      {loading ? (
        <p className="text-slate-400 text-sm">Loading…</p>
      ) : (
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
              {filtered.length === 0 && (
                <tr><td colSpan={4} className="text-center py-8 text-slate-400">No transactions found.</td></tr>
              )}
              {filtered.map((t) => {
                const amt = parseFloat(t.amount);
                const isIncome = amt < 0;
                return (
                  <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{formatDate(t.date)}</td>
                    <td className="px-4 py-3">
                      <span className={t.isPending ? 'text-slate-400 italic' : 'text-slate-700'}>{t.merchantName ?? t.name}</span>
                      {t.isPending && <span className="ml-2 text-xs text-slate-400">pending</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorOf(t.category) }} />
                        <select
                          value={t.category ?? ''}
                          onChange={(e) => updateCategory(t.id, e.target.value)}
                          className="text-sm border-0 bg-transparent text-slate-600 focus:outline-none cursor-pointer"
                        >
                          <option value="">— Uncategorized</option>
                          {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                      </div>
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
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  count,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  dot?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
        active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
      }`}
    >
      {dot && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: dot }} />}
      {label}
      <span className={active ? 'text-slate-300' : 'text-slate-400'}>{count}</span>
    </button>
  );
}
