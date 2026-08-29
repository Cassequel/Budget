import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../lib/api';
import { formatCurrency, formatCurrency0, formatPercent } from '../lib/utils';
import { CreditCard, CalendarClock, ListChecks, AlertTriangle, Sparkles } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────
interface LadderRung {
  threshold: number;
  payment: number;
  resultingRatio: number | null;
}
interface PayoffCard {
  id: string;
  name: string;
  balance: number;
  limit: number | null;
  apr: number | null;
  ratio: number | null;
  minimumPayment: number | null;
  autopayMinimum: boolean;
  dueDate: string | null;
  daysUntilDue: number | null;
  statementCloseDate: string | null;
  daysUntilClose: number | null;
  payBeforeClose: boolean;
  promoAprExpiry: string | null;
  daysUntilPromoEnd: number | null;
  ladder: LadderRung[];
}
interface PayoffData {
  cards: PayoffCard[];
  combined: { balance: number; limit: number; ratio: number | null; ladder: LadderRung[] };
  cash: { available: number; reserve: number; reserveTarget: number | null; survivalCost: number | null };
}
interface SimResult {
  amount: number;
  unused: number;
  perCard: Array<{
    id: string;
    name: string;
    apr: number | null;
    before: { balance: number; ratio: number | null };
    applied: number;
    after: { balance: number; ratio: number | null };
  }>;
  combined: {
    before: { balance: number; limit: number; ratio: number | null };
    after: { balance: number; limit: number; ratio: number | null };
    milestonesCrossed: number[];
  };
  cash: {
    availableBefore: number;
    spentFromCash: number;
    availableAfter: number;
    monthsCoverageAfter: number | null;
    survivalCost: number | null;
    dropsBelowReserve: boolean;
    warning: string | null;
  };
}

const STRATEGIES = [
  { value: 'highest-util', label: 'Highest utilization first' },
  { value: 'avalanche', label: 'Highest APR first' },
  { value: 'proportional', label: 'Split proportionally' },
] as const;

// ── Small helpers ────────────────────────────────────────────
function utilColor(r: number | null): string {
  if (r == null) return 'text-slate-400';
  if (r >= 0.5) return 'text-red-600';
  if (r >= 0.3) return 'text-amber-600';
  return 'text-green-600';
}
function utilBar(r: number | null): string {
  if (r == null) return 'bg-slate-300';
  if (r >= 0.5) return 'bg-red-500';
  if (r >= 0.3) return 'bg-amber-500';
  return 'bg-green-500';
}
function dLabel(d: number | null): string {
  if (d == null) return 'no date set';
  if (d < 0) return `${-d}d ago`;
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  return `in ${d} days`;
}
const cardCls = 'bg-white rounded-2xl border border-slate-200 p-5';

function Bar({ ratio }: { ratio: number | null }) {
  return (
    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${utilBar(ratio)}`}
        style={{ width: `${Math.min((ratio ?? 0) * 100, 100)}%` }}
      />
    </div>
  );
}

// ── Combined utilization headline ────────────────────────────
function CombinedCard({ d }: { d: PayoffData }) {
  const c = d.combined;
  const next = c.ladder[0];
  return (
    <div className={cardCls}>
      <div className="flex items-end justify-between mb-2">
        <div>
          <p className="text-sm text-slate-500">Overall card utilization</p>
          <p className={`text-3xl font-semibold ${utilColor(c.ratio)}`}>{formatPercent(c.ratio)}</p>
        </div>
        <p className="text-sm text-slate-400">
          {formatCurrency(c.balance)} of {formatCurrency(c.limit)}
        </p>
      </div>
      <Bar ratio={c.ratio} />
      {next && (
        <p className="text-xs text-slate-500 mt-2">
          {next.threshold === 0
            ? `${formatCurrency(next.payment)} pays every card off`
            : `${formatCurrency(next.payment)} brings you to ${next.threshold}%`}
        </p>
      )}
    </div>
  );
}

// ── "What if I pay $X today?" ────────────────────────────────
function Simulator({ data }: { data: PayoffData }) {
  const [amount, setAmount] = useState('');
  const [strategy, setStrategy] = useState<(typeof STRATEGIES)[number]['value']>('highest-util');
  const [res, setRes] = useState<SimResult | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback((amt: number, strat: string) => {
    setBusy(true);
    api
      .post<SimResult>('/api/credit-cards/simulate', { amount: amt, strategy: strat })
      .then((r) => setRes(r.data))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setRes(null);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(amt, strategy), 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [amount, strategy, run]);

  const cashAfter = res?.cash.availableAfter ?? null;
  const cashTone =
    cashAfter == null
      ? ''
      : res!.cash.dropsBelowReserve
        ? 'text-red-600'
        : res!.cash.warning
          ? 'text-amber-600'
          : 'text-green-600';

  return (
    <div className={cardCls}>
      <div className="flex items-center gap-2 mb-4">
        <Sparkles size={16} className="text-slate-500" />
        <h2 className="text-base font-semibold text-slate-900">What if I pay this today?</h2>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs font-medium text-slate-500">Payment amount</span>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
            <input
              type="number"
              min="0"
              step="50"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="500"
              className="w-full pl-7 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-500">Apply it</span>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as typeof strategy)}
            className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {STRATEGIES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2 text-xs text-slate-400">
        Spendable cash now: {formatCurrency(data.cash.available)}
        {data.cash.survivalCost ? ` · baseline ${formatCurrency0(data.cash.survivalCost)}/mo` : ''}
      </div>

      {res && (
        <div className={`mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4 ${busy ? 'opacity-50' : ''}`}>
          <div className="flex items-baseline gap-3">
            <span className={`text-2xl font-semibold ${utilColor(res.combined.before.ratio)}`}>
              {formatPercent(res.combined.before.ratio)}
            </span>
            <span className="text-slate-400">→</span>
            <span className={`text-2xl font-semibold ${utilColor(res.combined.after.ratio)}`}>
              {formatPercent(res.combined.after.ratio)}
            </span>
            <span className="text-xs text-slate-400">overall utilization</span>
          </div>

          {res.combined.milestonesCrossed.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {res.combined.milestonesCrossed.map((m) => (
                <span
                  key={m}
                  className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700"
                >
                  crosses {m}%
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 space-y-1">
            {res.perCard
              .filter((p) => p.applied > 0)
              .map((p) => (
                <div key={p.id} className="flex justify-between text-xs text-slate-600">
                  <span>
                    {p.name}
                    {p.apr != null && <span className="text-slate-400"> · {p.apr}% APR</span>}
                  </span>
                  <span>
                    {formatCurrency(p.applied)}{' '}
                    <span className="text-slate-400">
                      ({formatPercent(p.before.ratio)} → {formatPercent(p.after.ratio)})
                    </span>
                  </span>
                </div>
              ))}
            {res.unused > 0 && (
              <div className="flex justify-between text-xs text-slate-400">
                <span>Left over (cards paid off)</span>
                <span>{formatCurrency(res.unused)}</span>
              </div>
            )}
          </div>

          <div className="mt-3 pt-3 border-t border-slate-200 text-xs">
            <span className="text-slate-500">Spendable cash after: </span>
            <span className={`font-medium ${cashTone}`}>{formatCurrency(res.cash.availableAfter)}</span>
            {res.cash.monthsCoverageAfter != null && (
              <span className="text-slate-400"> · {res.cash.monthsCoverageAfter.toFixed(1)} mo covered</span>
            )}
            {res.cash.warning && (
              <p className="mt-1 flex items-start gap-1.5 text-amber-700">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                {res.cash.warning}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Payoff ladders ──────────────────────────────────────────
function Ladder({ rungs }: { rungs: LadderRung[] }) {
  if (rungs.length === 0) return <p className="text-xs text-slate-400">Already at the lowest milestone.</p>;
  return (
    <div className="space-y-1">
      {rungs.map((r) => (
        <div key={r.threshold} className="flex justify-between text-xs">
          <span className="text-slate-500">
            {r.threshold === 0 ? 'Pay in full' : `Down to ${r.threshold}%`}
          </span>
          <span className="font-medium text-slate-700">{formatCurrency(r.payment)}</span>
        </div>
      ))}
    </div>
  );
}

function LaddersCard({ d }: { d: PayoffData }) {
  return (
    <div className={cardCls}>
      <h2 className="text-base font-semibold text-slate-900 mb-4">Payoff ladder</h2>
      <div className="grid sm:grid-cols-2 gap-4">
        {d.cards.map((c) => (
          <div key={c.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex justify-between items-baseline mb-2">
              <p className="text-sm font-semibold text-slate-800">{c.name}</p>
              <span className={`text-sm ${utilColor(c.ratio)}`}>{formatPercent(c.ratio)}</span>
            </div>
            <p className="text-xs text-slate-400 mb-2">
              {formatCurrency(c.balance)}
              {c.limit != null && ` of ${formatCurrency(c.limit)}`}
              {c.apr != null && ` · ${c.apr}% APR`}
            </p>
            <Ladder rungs={c.ladder} />
          </div>
        ))}
        {d.cards.length === 0 && (
          <p className="text-sm text-slate-400">
            No cards yet — add them on the <span className="font-medium">Plan</span> page.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Dates & autopay ─────────────────────────────────────────
function DatesCard({ d, onChanged }: { d: PayoffData; onChanged: () => void }) {
  const [saving, setSaving] = useState<string | null>(null);

  async function toggleAutopay(c: PayoffCard) {
    setSaving(c.id);
    try {
      await api.patch(`/api/credit-cards/${c.id}`, { autopayMinimum: !c.autopayMinimum });
      onChanged();
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className={cardCls}>
      <div className="flex items-center gap-2 mb-4">
        <CalendarClock size={16} className="text-slate-500" />
        <h2 className="text-base font-semibold text-slate-900">Dates & autopay</h2>
      </div>
      <div className="rounded-xl border border-slate-100 divide-y divide-slate-100">
        {d.cards.map((c) => {
          const dueSoon = c.daysUntilDue != null && c.daysUntilDue <= 5;
          const promoSoon = c.daysUntilPromoEnd != null && c.daysUntilPromoEnd <= 45 && c.daysUntilPromoEnd >= 0;
          return (
            <div key={c.id} className="px-3 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">{c.name}</p>
                <button
                  onClick={() => toggleAutopay(c)}
                  disabled={saving === c.id}
                  className={`text-xs font-medium px-2 py-1 rounded-lg border transition-colors disabled:opacity-50 ${
                    c.autopayMinimum
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {c.autopayMinimum ? 'Autopay minimum: on' : 'Autopay minimum: off'}
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                <span className={dueSoon ? 'text-red-600 font-medium' : ''}>
                  Payment {dLabel(c.daysUntilDue)}
                  {c.minimumPayment != null && ` · min ${formatCurrency(c.minimumPayment)}`}
                </span>
                <span>Statement closes {dLabel(c.daysUntilClose)}</span>
              </div>
              {c.payBeforeClose && (
                <p className="mt-1 text-xs text-blue-700">
                  Pay before the statement closes to lower the utilization the bureaus see this cycle.
                </p>
              )}
              {promoSoon && (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  Promo APR ends {dLabel(c.daysUntilPromoEnd)} ({c.promoAprExpiry}) — plan to clear this balance first.
                </p>
              )}
            </div>
          );
        })}
        {d.cards.length === 0 && <p className="px-3 py-3 text-sm text-slate-400">No cards yet.</p>}
      </div>
    </div>
  );
}

// ── Credit-report review checklist (local, per-browser) ──────
const CHECKLIST = [
  { id: 'pull', label: 'Pull all three reports', blurb: 'annualcreditreport.com — free weekly from Equifax, Experian, and TransUnion.' },
  { id: 'limits', label: 'Verify every balance and limit', blurb: 'A limit reported low inflates your utilization. Dispute anything that is off.' },
  { id: 'accounts', label: 'Confirm every account and address is yours', blurb: 'Anything unfamiliar can mean fraud — dispute it and add a fraud alert.' },
  { id: 'late', label: 'Check late-payment marks', blurb: 'One inaccurate 30-day late can cost 50+ points. Dispute with proof of payment.' },
  { id: 'derogatory', label: 'Review collections and charge-offs', blurb: 'Check the amount, the date, and that it is not past the ~7-year reporting window.' },
  { id: 'inquiries', label: 'Review hard inquiries', blurb: 'Dispute any you did not authorize.' },
  { id: 'dispute', label: 'File disputes for anything wrong', blurb: 'Online with each bureau; keep the confirmation numbers. They must respond in ~30 days.' },
  { id: 'freeze', label: 'Consider a credit freeze', blurb: 'Free and reversible; blocks new-account fraud without touching your existing cards.' },
];
const CHECK_KEY = 'creditReportChecklist';

function ChecklistCard() {
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHECK_KEY);
      if (raw) setDone(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  function toggle(id: string) {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(CHECK_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const count = CHECKLIST.filter((i) => done[i.id]).length;

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <ListChecks size={16} className="text-slate-500" />
          <h2 className="text-base font-semibold text-slate-900">Credit-report review</h2>
        </div>
        <span className="text-xs text-slate-400">
          {count} / {CHECKLIST.length}
        </span>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Do this once or twice a year. Fixing errors is the fastest legitimate score gain — no product to
        buy, no new accounts to open.
      </p>
      <div className="space-y-2">
        {CHECKLIST.map((item) => (
          <label key={item.id} className="flex gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={!!done[item.id]}
              onChange={() => toggle(item.id)}
              className="mt-0.5 rounded border-slate-300"
            />
            <div>
              <p className={`text-sm ${done[item.id] ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                {item.label}
              </p>
              <p className="text-xs text-slate-400">{item.blurb}</p>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────
export default function CreditPage() {
  const [data, setData] = useState<PayoffData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    return api.get<PayoffData>('/api/credit-cards/payoff').then((r) => setData(r.data));
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const hasLimits = useMemo(
    () => !!data && data.cards.some((c) => c.limit != null && c.limit > 0),
    [data]
  );

  if (loading) return <div className="text-slate-400 text-sm">Loading credit…</div>;
  if (!data) return <div className="text-red-500 text-sm">Failed to load credit data.</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Credit control</h1>
        <p className="text-sm text-slate-400 mt-1">
          Lower utilization on purpose — this is priority #1. Kept separate from your emergency cash.
        </p>
      </div>

      {!hasLimits && (
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-5 py-4">
          <CreditCard size={18} className="text-blue-700 mt-0.5 shrink-0" />
          <p className="text-sm text-blue-900">
            Add each card's real credit limit on the <span className="font-medium">Plan</span> page so
            these numbers are accurate.
          </p>
        </div>
      )}

      <CombinedCard d={data} />
      <Simulator data={data} />
      <LaddersCard d={data} />
      <DatesCard d={data} onChanged={load} />
      <ChecklistCard />
    </div>
  );
}
