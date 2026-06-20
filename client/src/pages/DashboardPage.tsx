import { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../lib/api';
import { formatCurrency, lastNMonths, formatMonthShort } from '../lib/utils';
import { TrendingUp, TrendingDown, Clock, Wallet } from 'lucide-react';

interface DashboardData {
  totalNetWorth: number;
  monthlyIncome: number;
  monthlySpend: number;
  runwayMonths: number | null;
  plans: Array<{ id: string; name: string; type: string; totalAmount: number; paidAmount: number }>;
  accountCount: number;
}

interface TrendRow { month: string; category: string; total: number; }

const MONTHS = 12;

function SpendingTrend() {
  const [rows, setRows] = useState<TrendRow[]>([]);
  const [category, setCategory] = useState('All');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<TrendRow[]>(`/api/dashboard/spending-trend?months=${MONTHS}`)
      .then((r) => setRows(r.data))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category))].sort(),
    [rows]
  );

  const data = useMemo(() => {
    const keys = lastNMonths(MONTHS);
    const byMonth = new Map<string, number>();
    for (const r of rows) {
      if (category !== 'All' && r.category !== category) continue;
      byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.total);
    }
    return keys.map((k) => ({ label: formatMonthShort(k), spend: byMonth.get(k) ?? 0 }));
  }, [rows, category]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-900">Monthly Spending</h2>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="All">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {loading ? (
        <p className="text-slate-400 text-sm">Loading…</p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 12, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              width={64}
              tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
            />
            <Tooltip
              formatter={(v: number) => [formatCurrency(v), 'Spent']}
              contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }}
            />
            <Line type="monotone" dataKey="spend" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub?: string; icon: typeof Wallet; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 mb-1">{label}</p>
          <p className="text-2xl font-semibold text-slate-900">{value}</p>
          {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
        </div>
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<DashboardData>('/api/dashboard')
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-slate-400 text-sm">Loading dashboard…</div>;
  if (!data) return <div className="text-red-500 text-sm">Failed to load dashboard.</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Net Worth"
          value={formatCurrency(data.totalNetWorth)}
          sub={`${data.accountCount} accounts`}
          icon={Wallet}
          color="bg-blue-50 text-blue-600"
        />
        <StatCard
          label="Income This Month"
          value={formatCurrency(data.monthlyIncome)}
          icon={TrendingUp}
          color="bg-green-50 text-green-600"
        />
        <StatCard
          label="Spend This Month"
          value={formatCurrency(data.monthlySpend)}
          icon={TrendingDown}
          color="bg-orange-50 text-orange-600"
        />
        <StatCard
          label="Runway"
          value={data.runwayMonths != null ? `${data.runwayMonths.toFixed(1)} mo` : '—'}
          sub="at current spend rate"
          icon={Clock}
          color="bg-purple-50 text-purple-600"
        />
      </div>

      <SpendingTrend />

      {data.plans.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Upcoming Plans</h2>
          <div className="space-y-4">
            {data.plans.map((plan) => {
              const pct = plan.totalAmount > 0 ? (plan.paidAmount / plan.totalAmount) * 100 : 0;
              return (
                <div key={plan.id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-slate-700">{plan.name}</span>
                    <span className="text-slate-500">{formatCurrency(plan.paidAmount)} / {formatCurrency(plan.totalAmount)}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.plans.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
          No plans yet — go to Plans to add your school and housing costs.
        </div>
      )}
    </div>
  );
}
