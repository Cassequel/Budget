import { useState, useEffect } from 'react';
import api from '../lib/api';

export function useAuth() {
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

  return { authed, logout };
}
