import { useEffect, useState, useCallback, type FormEvent } from 'react';
import api from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { Plus, Trash2 } from 'lucide-react';

interface Category {
  id: string;
  name: string;
  monthlyLimit: string | null;
  color: string | null;
  type: string;
  spent?: number;
  limit?: number;
}

interface Summary {
  categories: Category[];
  from: string;
  to: string;
}

export default function BudgetPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', monthlyLimit: '', color: '#6366f1', type: 'expense' });

  const load = useCallback(() => {
    setLoading(true);
    api.get<Summary>('/api/budget/summary').then((r) => setSummary(r.data)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    await api.post('/api/budget/categories', {
      name: form.name,
      monthlyLimit: form.monthlyLimit ? parseFloat(form.monthlyLimit) : undefined,
      color: form.color,
      type: form.type,
    });
    setForm({ name: '', monthlyLimit: '', color: '#6366f1', type: 'expense' });
    setShowAdd(false);
    load();
  }

  async function deleteCategory(id: string) {
    await api.delete(`/api/budget/categories/${id}`);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Budget</h1>
        <button onClick={() => setShowAdd((v) => !v)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          <Plus size={15} />Add Category
        </button>
      </div>

      {showAdd && (
        <form onSubmit={addCategory} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">New Category</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Name</label>
              <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Groceries" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Monthly Limit ($)</label>
              <input type="number" min="0" step="0.01" value={form.monthlyLimit} onChange={(e) => setForm((f) => ({ ...f, monthlyLimit: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Type</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none">
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Color</label>
              <input type="color" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} className="h-9 w-full rounded-lg border border-slate-200 cursor-pointer" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowAdd(false)} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-800">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Save</button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-slate-400 text-sm">Loading…</p>
      ) : (
        <div className="space-y-3">
          {summary?.categories.length === 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-sm">No categories yet. Add one above.</div>
          )}
          {summary?.categories.map((cat) => {
            const spent = cat.spent ?? 0;
            const limit = cat.limit ?? 0;
            const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
            const over = limit > 0 && spent > limit;
            return (
              <div key={cat.id} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color ?? '#6366f1' }} />
                    <span className="text-sm font-medium text-slate-800">{cat.name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-slate-500">
                      {formatCurrency(spent)}{limit > 0 ? ` / ${formatCurrency(limit)}` : ''}
                    </span>
                    <button onClick={() => deleteCategory(cat.id)} className="text-slate-300 hover:text-red-400 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {limit > 0 && (
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${over ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${pct}%`, backgroundColor: over ? undefined : (cat.color ?? '#6366f1') }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
