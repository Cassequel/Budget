import { useEffect, useState, useCallback } from 'react';
import api from '../lib/api';
import { formatCurrency, formatPercent } from '../lib/utils';
import { SlidersHorizontal, CreditCard as CreditCardIcon, PiggyBank, Target, Plus, Trash2, RefreshCw } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────
interface OperatingPlan {
  id: string;
  monthlySurvivalCost: string | null;
  cashReserveTarget: string | null;
  incomeType: 'variable' | 'fixed' | 'mixed';
  incomeNotes: string | null;
}
interface Account {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  currentBalance: string | null;
  availableBalance: string | null;
  institutionName: string | null;
  cashRole: 'spending' | 'reserve' | 'excluded';
}
interface CreditCard {
  id: string;
  accountId: string | null;
  name: string;
  creditLimit: string | null;
  statementBalance: string | null;
  minimumPayment: string | null;
  dueDate: string | null;
  statementCloseDate: string | null;
  apr: string | null;
  promoAprExpiry: string | null;
  autopayMinimum: boolean;
  notes: string | null;
  liveBalance: number | null;
  utilizationBalance: number;
  utilizationRatio: number | null;
}
interface Goal {
  id: string;
  name: string;
  targetAmount: string;
  currentAmount: string | null;
  targetDate: string | null;
  linkedAccountId: string | null;
  priority: number;
  fundingSource: string | null;
  why: string | null;
}

// ── Small form primitives ────────────────────────────────────
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
const inputCls =
  'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400';

function Card({ icon: Icon, title, desc, children }: { icon: typeof CreditCardIcon; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 rounded-lg bg-slate-100 text-slate-600"><Icon size={18} /></div>
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {desc && <p className="text-xs text-slate-400 mt-0.5">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function SaveButton({ onClick, saving, dirty }: { onClick: () => void; saving: boolean; dirty: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={saving || !dirty}
      className="px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
    >
      {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
    </button>
  );
}

// ── Baseline (survival cost + income profile) ────────────────
function BaselineCard({ plan, onSaved }: { plan: OperatingPlan; onSaved: (p: OperatingPlan) => void }) {
  const [survival, setSurvival] = useState(plan.monthlySurvivalCost ?? '');
  const [incomeType, setIncomeType] = useState(plan.incomeType);
  const [incomeNotes, setIncomeNotes] = useState(plan.incomeNotes ?? '');
  const [saving, setSaving] = useState(false);
  const dirty =
    survival !== (plan.monthlySurvivalCost ?? '') ||
    incomeType !== plan.incomeType ||
    incomeNotes !== (plan.incomeNotes ?? '');

  async function save() {
    setSaving(true);
    try {
      const { data } = await api.put<OperatingPlan>('/api/operating-plan', {
        monthlySurvivalCost: survival === '' ? null : Number(survival),
        incomeType,
        incomeNotes: incomeNotes || null,
      });
      onSaved(data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card icon={SlidersHorizontal} title="Financial baseline" desc="The monthly floor everything else is measured against.">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Monthly survival cost" hint="Bills, food, subscriptions, utilities, card minimums.">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
            <input
              type="number" min="0" step="50" value={survival}
              onChange={(e) => setSurvival(e.target.value)}
              className={inputCls + ' pl-7'} placeholder="1000"
            />
          </div>
        </Field>
        <Field label="Income type">
          <select value={incomeType} onChange={(e) => setIncomeType(e.target.value as OperatingPlan['incomeType'])} className={inputCls}>
            <option value="variable">Variable (UGC / freelance)</option>
            <option value="mixed">Mixed</option>
            <option value="fixed">Fixed paycheck</option>
          </select>
        </Field>
      </div>
      <div className="mt-4">
        <Field label="Income notes" hint="Typical clients, payment timing, seasonality.">
          <textarea value={incomeNotes} onChange={(e) => setIncomeNotes(e.target.value)} rows={2} className={inputCls} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <SaveButton onClick={save} saving={saving} dirty={dirty} />
      </div>
    </Card>
  );
}

// ── Cash & reserve ──────────────────────────────────────────
const ROLE_LABEL: Record<Account['cashRole'], string> = {
  spending: 'Spendable',
  reserve: 'Reserve (no-touch)',
  excluded: 'Excluded',
};

function CashCard({
  plan,
  accounts,
  onPlanSaved,
  onAccountsChanged,
}: {
  plan: OperatingPlan;
  accounts: Account[];
  onPlanSaved: (p: OperatingPlan) => void;
  onAccountsChanged: () => void;
}) {
  const [target, setTarget] = useState(plan.cashReserveTarget ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = target !== (plan.cashReserveTarget ?? '');
  const depository = accounts.filter((a) => a.type === 'depository');

  async function saveTarget() {
    setSaving(true);
    try {
      const { data } = await api.put<OperatingPlan>('/api/operating-plan', {
        cashReserveTarget: target === '' ? null : Number(target),
      });
      onPlanSaved(data);
    } finally {
      setSaving(false);
    }
  }

  async function setRole(id: string, cashRole: Account['cashRole']) {
    await api.patch(`/api/accounts/${id}`, { cashRole });
    onAccountsChanged();
  }

  const spendable = depository.filter((a) => a.cashRole === 'spending')
    .reduce((s, a) => s + parseFloat(a.availableBalance ?? a.currentBalance ?? '0'), 0);
  const reserve = depository.filter((a) => a.cashRole === 'reserve')
    .reduce((s, a) => s + parseFloat(a.availableBalance ?? a.currentBalance ?? '0'), 0);

  return (
    <Card icon={PiggyBank} title="Cash & reserve" desc="Which balances are spendable, which are the untouchable cushion.">
      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <Field label="Cash reserve target" hint="Separate from paying down cards. Leave blank if undecided.">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
            <input type="number" min="0" step="100" value={target}
              onChange={(e) => setTarget(e.target.value)} className={inputCls + ' pl-7'} placeholder="—" />
          </div>
        </Field>
        <div className="flex items-end">
          <SaveButton onClick={saveTarget} saving={saving} dirty={dirty} />
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 divide-y divide-slate-100">
        {depository.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-700 truncate">{a.name}</p>
              <p className="text-xs text-slate-400 truncate">
                {a.institutionName} · {formatCurrency(parseFloat(a.availableBalance ?? a.currentBalance ?? '0'))}
              </p>
            </div>
            <select
              value={a.cashRole}
              onChange={(e) => setRole(a.id, e.target.value as Account['cashRole'])}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-400 shrink-0"
            >
              {(Object.keys(ROLE_LABEL) as Account['cashRole'][]).map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </div>
        ))}
        {depository.length === 0 && <p className="px-3 py-3 text-sm text-slate-400">No cash accounts linked yet.</p>}
      </div>
      <div className="mt-3 flex gap-6 text-xs text-slate-500">
        <span>Spendable: <strong className="text-slate-700">{formatCurrency(spendable)}</strong></span>
        <span>Reserve: <strong className="text-slate-700">{formatCurrency(reserve)}</strong></span>
      </div>
    </Card>
  );
}

// ── Credit cards ────────────────────────────────────────────
function CardRow({ card, onChanged }: { card: CreditCard; onChanged: () => void }) {
  const [f, setF] = useState({
    creditLimit: card.creditLimit ?? '',
    statementBalance: card.statementBalance ?? '',
    minimumPayment: card.minimumPayment ?? '',
    dueDate: card.dueDate ?? '',
    statementCloseDate: card.statementCloseDate ?? '',
    apr: card.apr ?? '',
    promoAprExpiry: card.promoAprExpiry ?? '',
    notes: card.notes ?? '',
  });
  const [autopay, setAutopay] = useState(card.autopayMinimum);
  const [saving, setSaving] = useState(false);
  const orig = {
    creditLimit: card.creditLimit ?? '', statementBalance: card.statementBalance ?? '',
    minimumPayment: card.minimumPayment ?? '', dueDate: card.dueDate ?? '',
    statementCloseDate: card.statementCloseDate ?? '', apr: card.apr ?? '',
    promoAprExpiry: card.promoAprExpiry ?? '', notes: card.notes ?? '',
  };
  const dirty = autopay !== card.autopayMinimum || (Object.keys(f) as (keyof typeof f)[]).some((k) => f[k] !== orig[k]);

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/api/credit-cards/${card.id}`, {
        ...f,
        creditLimit: f.creditLimit === '' ? null : Number(f.creditLimit),
        statementBalance: f.statementBalance === '' ? null : Number(f.statementBalance),
        minimumPayment: f.minimumPayment === '' ? null : Number(f.minimumPayment),
        apr: f.apr === '' ? null : Number(f.apr),
        dueDate: f.dueDate || null,
        statementCloseDate: f.statementCloseDate || null,
        promoAprExpiry: f.promoAprExpiry || null,
        notes: f.notes || null,
        autopayMinimum: autopay,
      });
      onChanged();
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!confirm(`Remove "${card.name}" from the plan? (The linked account stays.)`)) return;
    await api.delete(`/api/credit-cards/${card.id}`);
    onChanged();
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">{card.name}</p>
          <p className="text-xs text-slate-400">
            Utilization {formatPercent(card.utilizationRatio)} · {formatCurrency(card.utilizationBalance)}
            {card.liveBalance != null && ` live ${formatCurrency(card.liveBalance)}`}
          </p>
        </div>
        <button onClick={remove} className="text-slate-300 hover:text-red-500 transition-colors" title="Remove"><Trash2 size={16} /></button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="Credit limit"><input type="number" min="0" step="100" value={f.creditLimit} onChange={set('creditLimit')} className={inputCls} /></Field>
        <Field label="Statement balance"><input type="number" min="0" step="1" value={f.statementBalance} onChange={set('statementBalance')} className={inputCls} /></Field>
        <Field label="Minimum payment"><input type="number" min="0" step="1" value={f.minimumPayment} onChange={set('minimumPayment')} className={inputCls} /></Field>
        <Field label="APR %"><input type="number" min="0" step="0.01" value={f.apr} onChange={set('apr')} className={inputCls} /></Field>
        <Field label="Payment due"><input type="date" value={f.dueDate} onChange={set('dueDate')} className={inputCls} /></Field>
        <Field label="Statement closes"><input type="date" value={f.statementCloseDate} onChange={set('statementCloseDate')} className={inputCls} /></Field>
        <Field label="Promo APR ends"><input type="date" value={f.promoAprExpiry} onChange={set('promoAprExpiry')} className={inputCls} /></Field>
        <label className="flex items-center gap-2 mt-5 text-sm text-slate-600">
          <input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} className="rounded border-slate-300" />
          Autopay minimum on
        </label>
      </div>
      <div className="mt-3 flex justify-end">
        <SaveButton onClick={save} saving={saving} dirty={dirty} />
      </div>
    </div>
  );
}

function CreditCardsCard({ cards, onChanged }: { cards: CreditCard[]; onChanged: () => void }) {
  const [importing, setImporting] = useState(false);
  async function importCards() {
    setImporting(true);
    try {
      await api.post('/api/credit-cards/sync-from-accounts');
      onChanged();
    } finally {
      setImporting(false);
    }
  }
  async function addManual() {
    const name = prompt('Card name (e.g. "Store card")');
    if (!name) return;
    await api.post('/api/credit-cards', { name });
    onChanged();
  }

  return (
    <Card icon={CreditCardIcon} title="Credit cards" desc="Terms Plaid can't see — limit, minimum, due & close dates, APR. Utilization is priority #1.">
      <div className="flex gap-2 mb-4">
        <button onClick={importCards} disabled={importing}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={14} className={importing ? 'animate-spin' : ''} /> Import from linked accounts
        </button>
        <button onClick={addManual}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
          <Plus size={14} /> Add card
        </button>
      </div>
      <div className="space-y-3">
        {cards.map((c) => <CardRow key={c.id} card={c} onChanged={onChanged} />)}
        {cards.length === 0 && <p className="text-sm text-slate-400">No cards yet — import your linked credit accounts to start.</p>}
      </div>
    </Card>
  );
}

// ── Goals ──────────────────────────────────────────────────
function GoalRow({ goal, accounts, onChanged }: { goal: Goal; accounts: Account[]; onChanged: () => void }) {
  const [f, setF] = useState({
    name: goal.name,
    targetAmount: goal.targetAmount,
    targetDate: goal.targetDate ?? '',
    priority: String(goal.priority),
    fundingSource: goal.fundingSource ?? '',
    why: goal.why ?? '',
    currentAmount: goal.currentAmount ?? '',
    linkedAccountId: goal.linkedAccountId ?? '',
  });
  const [saving, setSaving] = useState(false);
  const orig = {
    name: goal.name, targetAmount: goal.targetAmount, targetDate: goal.targetDate ?? '',
    priority: String(goal.priority), fundingSource: goal.fundingSource ?? '', why: goal.why ?? '',
    currentAmount: goal.currentAmount ?? '', linkedAccountId: goal.linkedAccountId ?? '',
  };
  const dirty = (Object.keys(f) as (keyof typeof f)[]).some((k) => f[k] !== orig[k]);

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/api/savings/goals/${goal.id}`, {
        name: f.name,
        targetAmount: Number(f.targetAmount),
        targetDate: f.targetDate || null,
        priority: Number(f.priority),
        fundingSource: f.fundingSource || null,
        why: f.why || null,
        linkedAccountId: f.linkedAccountId || null,
        currentAmount: f.linkedAccountId ? undefined : (f.currentAmount === '' ? 0 : Number(f.currentAmount)),
      });
      onChanged();
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!confirm(`Delete goal "${goal.name}"?`)) return;
    await api.delete(`/api/savings/goals/${goal.id}`);
    onChanged();
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })}
          className="text-sm font-semibold text-slate-800 border-b border-transparent hover:border-slate-200 focus:border-blue-400 focus:outline-none" />
        <button onClick={remove} className="text-slate-300 hover:text-red-500 transition-colors" title="Delete"><Trash2 size={16} /></button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="Target $"><input type="number" min="0" step="50" value={f.targetAmount} onChange={(e) => setF({ ...f, targetAmount: e.target.value })} className={inputCls} /></Field>
        <Field label="By date"><input type="date" value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} className={inputCls} /></Field>
        <Field label="Priority" hint="lower = first"><input type="number" min="1" step="1" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} className={inputCls} /></Field>
        <Field label="Linked account">
          <select value={f.linkedAccountId} onChange={(e) => setF({ ...f, linkedAccountId: e.target.value })} className={inputCls}>
            <option value="">None (manual)</option>
            {accounts.filter((a) => a.type === 'depository').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        {!f.linkedAccountId && (
          <Field label="Current $"><input type="number" min="0" step="50" value={f.currentAmount} onChange={(e) => setF({ ...f, currentAmount: e.target.value })} className={inputCls} /></Field>
        )}
        <Field label="Funding source"><input value={f.fundingSource} onChange={(e) => setF({ ...f, fundingSource: e.target.value })} className={inputCls} placeholder="UGC surplus" /></Field>
        <div className="col-span-2">
          <Field label="Why it matters"><input value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} className={inputCls} /></Field>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <SaveButton onClick={save} saving={saving} dirty={dirty} />
      </div>
    </div>
  );
}

function GoalsCard({ goals, accounts, onChanged }: { goals: Goal[]; accounts: Account[]; onChanged: () => void }) {
  async function add() {
    const name = prompt('Goal name (e.g. "May travel")');
    if (!name) return;
    const amount = Number(prompt('Target amount ($)') ?? '');
    if (!Number.isFinite(amount) || amount <= 0) return;
    await api.post('/api/savings/goals', { name, targetAmount: amount, priority: goals.length + 1 });
    onChanged();
  }
  return (
    <Card icon={Target} title="Goals" desc="Generic goal system — amount, deadline, priority, funding source, and why.">
      <button onClick={add} className="inline-flex items-center gap-1.5 px-3 py-2 mb-4 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
        <Plus size={14} /> Add goal
      </button>
      <div className="space-y-3">
        {goals.map((g) => <GoalRow key={g.id} goal={g} accounts={accounts} onChanged={onChanged} />)}
        {goals.length === 0 && <p className="text-sm text-slate-400">No goals yet.</p>}
      </div>
    </Card>
  );
}

// ── Page ───────────────────────────────────────────────────
export default function PlanPage() {
  const [plan, setPlan] = useState<OperatingPlan | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAccounts = useCallback(() => api.get<Account[]>('/api/accounts').then((r) => setAccounts(r.data)), []);
  const loadCards = useCallback(() => api.get<CreditCard[]>('/api/credit-cards').then((r) => setCards(r.data)), []);
  const loadGoals = useCallback(() => api.get<Goal[]>('/api/savings/goals').then((r) => setGoals(r.data)), []);

  useEffect(() => {
    Promise.all([
      api.get<OperatingPlan>('/api/operating-plan').then((r) => setPlan(r.data)),
      loadAccounts(),
      loadCards(),
      loadGoals(),
    ]).finally(() => setLoading(false));
  }, [loadAccounts, loadCards, loadGoals]);

  if (loading || !plan) return <div className="text-slate-400 text-sm">Loading plan…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Operating plan</h1>
        <p className="text-sm text-slate-400 mt-1">The personal rules the dashboard runs against.</p>
      </div>
      <BaselineCard plan={plan} onSaved={setPlan} />
      <CashCard plan={plan} accounts={accounts} onPlanSaved={setPlan} onAccountsChanged={loadAccounts} />
      <CreditCardsCard cards={cards} onChanged={() => { loadCards(); }} />
      <GoalsCard goals={goals} accounts={accounts} onChanged={loadGoals} />
    </div>
  );
}
