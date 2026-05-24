import { useEffect, useState, useCallback, type FormEvent } from 'react';
import api from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';
import { Plus, Check, Trash2, ChevronDown, ChevronRight } from 'lucide-react';

interface Plan {
  id: string;
  name: string;
  type: string;
  targetDate: string | null;
  notes: string | null;
}

interface PlanItem {
  id: string;
  planId: string;
  name: string;
  amount: string;
  dueDate: string | null;
  isPaid: boolean;
  notes: string | null;
}

const TYPE_LABELS: Record<string, string> = { school: 'School', housing: 'Housing', other: 'Other' };
const TYPE_COLORS: Record<string, string> = { school: 'bg-blue-50 text-blue-700', housing: 'bg-green-50 text-green-700', other: 'bg-slate-100 text-slate-600' };

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [items, setItems] = useState<Record<string, PlanItem[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAddPlan, setShowAddPlan] = useState(false);
  const [addItemFor, setAddItemFor] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({ name: '', type: 'school', targetDate: '', notes: '' });
  const [itemForm, setItemForm] = useState({ name: '', amount: '', dueDate: '', notes: '' });

  const loadPlans = useCallback(() => {
    api.get<Plan[]>('/api/plans').then((r) => setPlans(r.data));
  }, []);

  const loadItems = useCallback(async (planId: string) => {
    const r = await api.get<PlanItem[]>(`/api/plans/${planId}/items`);
    setItems((prev) => ({ ...prev, [planId]: r.data }));
  }, []);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); loadItems(id); }
      return next;
    });
  }

  async function addPlan(e: FormEvent) {
    e.preventDefault();
    await api.post('/api/plans', { name: planForm.name, type: planForm.type, targetDate: planForm.targetDate || undefined, notes: planForm.notes || undefined });
    setPlanForm({ name: '', type: 'school', targetDate: '', notes: '' });
    setShowAddPlan(false);
    loadPlans();
  }

  async function addItem(e: FormEvent, planId: string) {
    e.preventDefault();
    await api.post(`/api/plans/${planId}/items`, { name: itemForm.name, amount: parseFloat(itemForm.amount), dueDate: itemForm.dueDate || undefined, notes: itemForm.notes || undefined });
    setItemForm({ name: '', amount: '', dueDate: '', notes: '' });
    setAddItemFor(null);
    loadItems(planId);
  }

  async function togglePaid(planId: string, item: PlanItem) {
    await api.patch(`/api/plans/${planId}/items/${item.id}`, { isPaid: !item.isPaid });
    loadItems(planId);
  }

  async function deleteItem(planId: string, itemId: string) {
    await api.delete(`/api/plans/${planId}/items/${itemId}`);
    loadItems(planId);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Plans</h1>
        <button onClick={() => setShowAddPlan((v) => !v)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          <Plus size={15} />New Plan
        </button>
      </div>

      {showAddPlan && (
        <form onSubmit={addPlan} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">New Plan</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Plan Name</label>
              <input required value={planForm.name} onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Fall 2026 School" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Type</label>
              <select value={planForm.type} onChange={(e) => setPlanForm((f) => ({ ...f, type: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none">
                <option value="school">School</option>
                <option value="housing">Housing</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Target Date</label>
              <input type="date" value={planForm.targetDate} onChange={(e) => setPlanForm((f) => ({ ...f, targetDate: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowAddPlan(false)} className="px-3 py-2 text-sm text-slate-500">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Save</button>
          </div>
        </form>
      )}

      {plans.length === 0 && !showAddPlan && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-sm">No plans yet. Create one to track your school and housing costs.</div>
      )}

      <div className="space-y-3">
        {plans.map((plan) => {
          const planItems = items[plan.id] ?? [];
          const total = planItems.reduce((s, i) => s + parseFloat(i.amount), 0);
          const paid = planItems.filter((i) => i.isPaid).reduce((s, i) => s + parseFloat(i.amount), 0);
          const isOpen = expanded.has(plan.id);

          return (
            <div key={plan.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <button onClick={() => toggleExpand(plan.id)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors text-left">
                <div className="flex items-center gap-3">
                  {isOpen ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
                  <span className="text-sm font-semibold text-slate-800">{plan.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[plan.type] ?? TYPE_COLORS.other}`}>
                    {TYPE_LABELS[plan.type] ?? plan.type}
                  </span>
                  {plan.targetDate && <span className="text-xs text-slate-400">{formatDate(plan.targetDate)}</span>}
                </div>
                <div className="text-right">
                  <span className="text-sm font-semibold text-slate-700">{formatCurrency(paid)} <span className="font-normal text-slate-400">/ {formatCurrency(total)}</span></span>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-slate-100 px-5 py-3 space-y-2">
                  {planItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                      <div className="flex items-center gap-3">
                        <button onClick={() => togglePaid(plan.id, item)} className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${item.isPaid ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-green-400'}`}>
                          {item.isPaid && <Check size={11} />}
                        </button>
                        <div>
                          <p className={`text-sm ${item.isPaid ? 'line-through text-slate-400' : 'text-slate-700'}`}>{item.name}</p>
                          {item.dueDate && <p className="text-xs text-slate-400">Due {formatDate(item.dueDate)}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-slate-700">{formatCurrency(parseFloat(item.amount))}</span>
                        <button onClick={() => deleteItem(plan.id, item.id)} className="text-slate-300 hover:text-red-400 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}

                  {addItemFor === plan.id ? (
                    <form onSubmit={(e) => addItem(e, plan.id)} className="pt-2 space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <input required value={itemForm.name} onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))} placeholder="Item name" className="col-span-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <input required type="number" min="0" step="0.01" value={itemForm.amount} onChange={(e) => setItemForm((f) => ({ ...f, amount: e.target.value }))} placeholder="Amount" className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <input type="date" value={itemForm.dueDate} onChange={(e) => setItemForm((f) => ({ ...f, dueDate: e.target.value }))} className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none" />
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setAddItemFor(null)} className="px-3 py-1.5 text-xs text-slate-500">Cancel</button>
                        <button type="submit" className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">Add</button>
                      </div>
                    </form>
                  ) : (
                    <button onClick={() => setAddItemFor(plan.id)} className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 pt-1">
                      <Plus size={13} />Add item
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
