import { useEffect, useState, useCallback } from 'react';
import api from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';
import { Search } from 'lucide-react';

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

interface Category { id: string; name: string; }

export default function TransactionsPage() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    Promise.all([
      api.get<Transaction[]>('/api/transactions'),
      api.get<Category[]>('/api/budget/categories'),
    ]).then(([txRes, catRes]) => {
      setTxns(txRes.data);
      setCategories(catRes.data);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function updateCategory(id: string, category: string) {
    setTxns((prev) => prev.map((t) => t.id === id ? { ...t, category } : t));
    await api.patch(`/api/transactions/${id}`, { category });
  }

  const filtered = txns.filter((t) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) || (t.merchantName ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Transactions</h1>
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
                      <select
                        value={t.category ?? ''}
                        onChange={(e) => updateCategory(t.id, e.target.value)}
                        className="text-sm border-0 bg-transparent text-slate-500 focus:outline-none cursor-pointer"
                      >
                        <option value="">— Uncategorized</option>
                        {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
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
