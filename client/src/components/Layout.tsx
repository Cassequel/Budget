import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, CreditCard, ArrowLeftRight, PieChart, BookOpen, Target, LogOut } from 'lucide-react';
import { cn } from '../lib/utils';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/accounts', label: 'Accounts', icon: CreditCard },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/budget', label: 'Budget', icon: PieChart },
  { to: '/plans', label: 'Plans', icon: BookOpen },
  { to: '/savings', label: 'Savings', icon: Target },
];

export default function Layout({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="px-5 py-5 border-b border-slate-100">
          <span className="text-lg font-semibold text-slate-900">Budget</span>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-slate-100">
          <button
            onClick={onLogout}
            className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
