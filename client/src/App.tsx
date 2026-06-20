import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import api from './lib/api';
import LoginPage from './pages/LoginPage';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import AccountsPage from './pages/AccountsPage';
import TransactionsPage from './pages/TransactionsPage';
import BreakdownPage from './pages/BreakdownPage';
import BudgetPage from './pages/BudgetPage';
import PlansPage from './pages/PlansPage';
import SavingsPage from './pages/SavingsPage';

function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setAuthed(false); return; }
    api.get('/api/auth/me')
      .then(() => setAuthed(true))
      .catch(() => { localStorage.removeItem('token'); setAuthed(false); });
  }, []);

  function logout() {
    localStorage.removeItem('token');
    setAuthed(false);
  }

  if (authed === null) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Loading…</div>;
  }

  if (!authed) {
    return <LoginPage onLogin={() => setAuthed(true)} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout onLogout={logout} />}>
          <Route index element={<DashboardPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="breakdown" element={<BreakdownPage />} />
          <Route path="budget" element={<BudgetPage />} />
          <Route path="plans" element={<PlansPage />} />
          <Route path="savings" element={<SavingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
