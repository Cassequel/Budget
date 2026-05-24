import { useEffect, useState, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import api from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { Plus, RefreshCw, Building2 } from 'lucide-react';

interface Account {
  id: string;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  currentBalance: string | null;
  availableBalance: string | null;
  institutionName: string | null;
}

function AccountCard({ acct }: { acct: Account }) {
  const balance = parseFloat(acct.availableBalance ?? acct.currentBalance ?? '0');
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center">
          <Building2 size={16} className="text-slate-500" />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-900">{acct.name}</p>
          <p className="text-xs text-slate-400">{acct.institutionName ?? ''}{acct.mask ? ` ···${acct.mask}` : ''} · {acct.subtype ?? acct.type}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-slate-900">{formatCurrency(balance)}</p>
        {acct.availableBalance && acct.currentBalance && acct.availableBalance !== acct.currentBalance && (
          <p className="text-xs text-slate-400">{formatCurrency(parseFloat(acct.currentBalance))} current</p>
        )}
      </div>
    </div>
  );
}

function ConnectButton({ onSuccess }: { onSuccess: () => void }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);

  useEffect(() => {
    api.post<{ link_token: string }>('/api/plaid/link-token').then((r) => setLinkToken(r.data.link_token));
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken ?? '',
    onSuccess: async (public_token, metadata) => {
      await api.post('/api/plaid/exchange', {
        public_token,
        institution: { institution_id: metadata.institution?.institution_id, name: metadata.institution?.name },
      });
      onSuccess();
    },
  });

  return (
    <button
      onClick={() => open()}
      disabled={!ready || !linkToken}
      className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
    >
      <Plus size={15} />
      Connect Account
    </button>
  );
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Account[]>('/api/accounts').then((r) => setAccounts(r.data)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function sync() {
    setSyncing(true);
    await api.post('/api/plaid/sync').catch(console.error);
    load();
    setSyncing(false);
  }

  const groups = accounts.reduce<Record<string, Account[]>>((acc, a) => {
    const key = a.institutionName ?? 'Other';
    (acc[key] ??= []).push(a);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Accounts</h1>
        <div className="flex gap-2">
          <button onClick={sync} disabled={syncing} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors">
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            Sync
          </button>
          <ConnectButton onSuccess={load} />
        </div>
      </div>

      {loading ? (
        <p className="text-slate-400 text-sm">Loading…</p>
      ) : accounts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <p className="text-slate-500 text-sm mb-2">No accounts connected yet.</p>
          <p className="text-slate-400 text-xs">Click "Connect Account" to link your bank or Venmo via Plaid.</p>
        </div>
      ) : (
        Object.entries(groups).map(([institution, accts]) => (
          <div key={institution}>
            <h2 className="text-sm font-medium text-slate-500 mb-2">{institution}</h2>
            <div className="space-y-2">
              {accts.map((a) => <AccountCard key={a.id} acct={a} />)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
