import { useEffect, useState, useCallback, type FormEvent } from 'react';
import api from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';
import { Plus } from 'lucide-react';

interface Goal {
  id: string;
  name: string;
  targetAmount: string;
  currentAmount: string | null;
  targetDate: string | null;
}

interface Runway {
  totalLiquid: number;
  avgMonthlySpend: number;
  runwayMonths: number | null;
}

export default function SavingsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [runway, setRunway] = useState<Runway | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', targetAmount: '', currentAmount: '', targetDate: '' });

  const load = useCallback(() => {
    Promise.all([
      api.get<Goal[]>('/api/savings/goals'),
      api.get<Runway>('/api/savings/runway'),
    ]).then(([gRes, rRes]) => {
      setGoals(gRes.data);
      setRunway(rRes.data);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addGoal(e: FormEvent) {
    e.preventDefault();
    await api.post('/api/savings/goals', {
      name: form.name,
      targetAmount: parseFloat(form.targetAmount),
      currentAmount: form.currentAmount ? parseFloat(form.currentAmount) : 0,
      targetDate: form.targetDate || undefined,
    });
    setForm({ name: '', targetAmount: '', currentAmount: '', targetDate: '' });
    setShowAdd(false);
    load();
  }

  async function updateCurrent(id: string, currentAmount: number) {
    await api.patch(`/api/savings/goals/${id}`, { currentAmount });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Savings</h1>
        <button onClick={() => setShowAdd((v) => !v)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          <Plus size={15} />New Goal
        </button>
      </div>

      {/* Runway card */}
      {runway && (
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-2xl p-6">
          <p className="text-blue-200 text-sm mb-1">Cash Runway</p>
          <p className="text-4xl font-bold mb-1">{runway.runwayMonths != null ? `${runway.runwayMonths.toFixed(1)} months` : '—'}</p>
          <p className="text-blue-200 text-sm">{formatCurrency(runway.totalLiquid)} liquid · {formatCurrency(runway.avgMonthlySpend)}/mo avg spend</p>
        </div>
      )}

      {showAdd && (
        <form onSubmit={addGoal} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">New Savings Goal</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Goal Name</label>
              <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Emergency Fund" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Target Amount ($)</label>
              <input required type="number" min="0" step="0.01" value={form.targetAmount} onChange={(e) => setForm((f) => ({ ...f, targetAmount: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="10000" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Current Amount ($)</label>
              <input type="number" min="0" step="0.01" value={form.currentAmount} onChange={(e) => setForm((f) => ({ ...f, currentAmount: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none" placeholder="0" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Target Date</label>
              <input type="date" value={form.targetDate} onChange={(e) => setForm((f) => ({ ...f, targetDate: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowAdd(false)} className="px-3 py-2 text-sm text-slate-500">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Save</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {goals.length === 0 && !showAdd && (
          <div className="col-span-2 bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-sm">No savings goals yet.</div>
        )}
        {goals.map((goal) => {
          const target = parseFloat(goal.targetAmount);
          const current = parseFloat(goal.currentAmount ?? '0');
          const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
          const remaining = target - current;

          return (
            <div key={goal.id} className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{goal.name}</p>
                  {goal.targetDate && <p className="text-xs text-slate-400">by {formatDate(goal.targetDate)}</p>}
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-900">{formatCurrency(current)}</p>
                  <p className="text-xs text-slate-400">of {formatCurrency(target)}</p>
                </div>
              </div>

              {/* Circular-ish progress */}
              <div className="mb-3 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{pct.toFixed(0)}% · {formatCurrency(remaining)} to go</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={current}
                  onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updateCurrent(goal.id, v); }}
                  className="w-28 px-2 py-1 text-xs border border-slate-200 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-green-400"
                  title="Update current amount"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
