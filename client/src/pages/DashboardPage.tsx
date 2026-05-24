import { useEffect, useState } from 'react';
import api from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { TrendingUp, TrendingDown, Clock, Wallet } from 'lucide-react';

interface DashboardData {
  totalNetWorth: number;
  monthlyIncome: number;
  monthlySpend: number;
  runwayMonths: number | null;
  plans: Array<{ id: string; name: string; type: string; totalAmount: number; paidAmount: number }>;
  accountCount: number;
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
