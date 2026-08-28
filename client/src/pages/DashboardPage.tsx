import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../lib/api';
import { formatCurrency, formatCurrency0, formatPercent, lastNMonths, formatMonthShort, formatRelativeTime } from '../lib/utils';
import { TrendingUp, TrendingDown, Clock, Wallet, ShieldCheck, CreditCard, CalendarClock, ArrowRight } from 'lucide-react';

interface DashboardData {
  totalNetWorth: number;
  monthlyIncome: number;
  monthlySpend: number;
  runwayMonths: number | null;
  plans: Array<{ id: string; name: string; type: string; totalAmount: number; paidAmount: number }>;
  accountCount: number;
  balancesUpdatedAt: string | null;
}

interface StatusData {
  planComplete: boolean;
  balancesUpdatedAt: string | null;
  cash: {
    available: number; reserve: number; reserveTarget: number | null; reserveGap: number | null;
    monthsCoverage: number | null; monthlySurvivalCost: number | null; avgMonthlySpend: number;
  };
  utilization: {
    combined: {
      balance: number; limit: number; ratio: number | null;
      nextMilestone: { threshold: number; paymentToReach: number } | null;
    };
    perCard: Array<{
      id: string; name: string; balance: number; limit: number | null; ratio: number | null;
      minimumPayment: number | null; dueDate: string | null; autopayMinimum: boolean;
      nextMilestone: { threshold: number; paymentToReach: number } | null;
    }>;
  };
  billsDueNext: Array<{ kind: string; name: string; amount: number | null; dueDate: string; daysUntil: number; autopayMinimum?: boolean }>;
  goals: Array<{ id: string; name: string; remaining: number; targetDate: string | null; requiredMonthlyPace: number | null; done: boolean }>;
  actions: Array<{ title: string; detail: string; kind: string }>;
}

interface TrendRow { month: string; category: string; total: number; }

const MONTHS = 12;

function utilColor(ratio: number | null): string {
  if (ratio == null) return 'text-slate-400';
  if (ratio >= 0.5) return 'text-red-600';
  if (ratio >= 0.3) return 'text-amber-600';
  return 'text-green-600';
}
function utilBar(ratio: number | null): string {
  if (ratio == null) return 'bg-slate-300';
  if (ratio >= 0.5) return 'bg-red-500';
  if (ratio >= 0.3) return 'bg-amber-500';
  return 'bg-green-500';
}
function dueLabel(days: number): string {
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days}d`;
}

function MiniStat({ label, value, sub, icon: Icon, accent }: { label: string; value: string; sub?: string; icon: typeof Wallet; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 text-slate-500 mb-1">
        <Icon size={15} />
        <p className="text-xs font-medium">{label}</p>
      </div>
      <p className={`text-xl font-semibold ${accent ?? 'text-slate-900'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function ControlCenter() {
  const [s, setS] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<StatusData>('/api/operating-plan/status').then((r) => setS(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-slate-400 text-sm">Loading control center…</div>;
  if (!s) return null;

  const c = s.cash;
  const u = s.utilization.combined;
  const nextBill = s.billsDueNext[0];

  return (
    <div className="space-y-4">
      {!s.planComplete && (
        <Link to="/plan" className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-2xl px-5 py-4 hover:bg-blue-100 transition-colors">
          <div>
            <p className="text-sm font-semibold text-blue-900">Finish your operating plan</p>
            <p className="text-xs text-blue-700 mt-0.5">Set your monthly baseline and card limits so these numbers mean something.</p>
          </div>
          <ArrowRight size={18} className="text-blue-700" />
        </Link>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniStat
          label="Cash available" icon={Wallet}
          value={formatCurrency0(c.available)}
          sub={c.monthsCoverage != null ? `${c.monthsCoverage.toFixed(1)} mo at ${formatCurrency0(c.monthlySurvivalCost ?? 0)}/mo` : 'set a monthly baseline'}
          accent={c.monthsCoverage != null && c.monthsCoverage < 1 ? 'text-red-600' : undefined}
        />
        <MiniStat
          label="Card utilization" icon={CreditCard}
          value={formatPercent(u.ratio)}
          sub={u.nextMilestone ? `${formatCurrency0(u.nextMilestone.paymentToReach)} to ${u.nextMilestone.threshold}%` : (u.limit > 0 ? 'at target' : 'add card limits')}
          accent={utilColor(u.ratio)}
        />
        <MiniStat
          label="Cash reserve" icon={ShieldCheck}
          value={formatCurrency0(c.reserve)}
          sub={c.reserveTarget == null ? 'no target set' : c.reserveGap && c.reserveGap > 0 ? `${formatCurrency0(c.reserveGap)} to ${formatCurrency0(c.reserveTarget)}` : 'target met'}
          accent={c.reserveTarget != null && c.reserveGap && c.reserveGap > 0 ? 'text-amber-600' : undefined}
        />
        <MiniStat
          label="Next due" icon={CalendarClock}
          value={nextBill ? formatCurrency0(nextBill.amount ?? 0) : '—'}
          sub={nextBill ? `${nextBill.name} · ${dueLabel(nextBill.daysUntil)}` : 'nothing in 21 days'}
          accent={nextBill && nextBill.daysUntil <= 3 ? 'text-red-600' : undefined}
        />
      </div>

      {s.actions.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-3">Do next</h2>
          <ol className="space-y-3">
            {s.actions.map((a, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-xs font-semibold flex items-center justify-center">{i + 1}</span>
                <div>
                  <p className="text-sm font-medium text-slate-800">{a.title}</p>
                  <p className="text-xs text-slate-400">{a.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {s.utilization.perCard.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Utilization by card</h2>
          <div className="space-y-3">
            {s.utilization.perCard.map((card) => (
              <div key={card.id}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-slate-700">{card.name}</span>
                  <span className={utilColor(card.ratio)}>
                    {formatPercent(card.ratio)}
                    <span className="text-slate-400 font-normal"> · {formatCurrency(card.balance)}{card.limit != null && ` / ${formatCurrency(card.limit)}`}</span>
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${utilBar(card.ratio)}`} style={{ width: `${Math.min((card.ratio ?? 0) * 100, 100)}%` }} />
                </div>
                {card.nextMilestone && (
                  <p className="text-xs text-slate-400 mt-1">
                    {formatCurrency(card.nextMilestone.paymentToReach)} to reach {card.nextMilestone.threshold}%
                    {card.dueDate && ` · min ${formatCurrency(card.minimumPayment ?? 0)} due ${card.dueDate}`}
                    {card.autopayMinimum && ' · autopay on'}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        {data.balancesUpdatedAt && (
          <p className="text-xs text-slate-400">Balances updated {formatRelativeTime(data.balancesUpdatedAt)}</p>
        )}
      </div>

      <ControlCenter />

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
    </div>
  );
}
